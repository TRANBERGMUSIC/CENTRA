/**
 * What Assist can do in CENTRA. Every tool works on the encrypted local engine and returns an undo
 * step, so anything Assist did can be taken back with one click ("Fortryd").
 */
import type { SyncEngine } from '@centra/sync';
import { occurrences, dayKey, repeatLabel, type CalEvent } from '../calendar.ts';
import { goalStats, type Goal, type GoalUpdate } from '../goals.ts';
import type { Route } from '../state.tsx';
import { ME, findPerson, findOrCreatePerson, balances, debts, payDebt, iOwe, owed, total, shares, payBack, perMonth, cancelLink, serviceFor, CATEGORIES, people, personName, kr, type Person, type Outlay, type Payment, type Expense } from '../money.ts';

export type Undo =
  | { kind: 'remove'; type: string; id: string }
  | { kind: 'restore'; type: string; id: string; fields: Record<string, unknown> }
  | { kind: 'noteText'; id: string; text: string }
  | { kind: 'removeMany'; type: string; ids: string[] };

export type Action = { label: string; undo?: Undo; open?: Route; undone?: boolean };
export type ToolResult = { result: unknown; action?: Action };

export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> };

const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });

export const TOOLS: ToolDef[] = [
  {
    name: 'remember',
    description: 'Save a lasting fact about the user (routine, work, people, preferences, health habits, places, things they care about). Use whenever the user tells you something about themselves that will still be true later. One fact per call, written in Danish as a short statement.',
    input_schema: obj({ kind: { type: 'string', enum: ['Om dig', 'Rutine', 'Arbejde', 'Person', 'Præference', 'Sted', 'Mål'] }, statement: str('Short Danish statement, e.g. "Arbejder i Netto tirsdag–fredag 06–16, torsdag til 15"') }, ['kind', 'statement']),
  },
  {
    name: 'update_memory',
    description: 'Correct something already remembered (by id from the context).',
    input_schema: obj({ id: str('memory id'), statement: str('the corrected statement') }, ['id', 'statement']),
  },
  {
    name: 'forget',
    description: 'Delete a remembered fact (by id) when the user says it is wrong or no longer true.',
    input_schema: obj({ id: str('memory id') }, ['id']),
  },
  {
    name: 'create_note',
    description: 'Create a note. Use for dictated thoughts, ideas, lists, meeting notes or anything the user wants written down. Clean up dictation (punctuation, paragraphs, lists with "- ") but keep the user\'s own words and meaning.',
    input_schema: obj({ title: str('short title'), body: str('the note text'), folder: str('folder, e.g. "Privat", "Arbejde", "Ideer". Default "Indbakke"'), tags: { type: 'array', items: { type: 'string' } } }, ['title', 'body']),
  },
  {
    name: 'append_to_note',
    description: 'Add text to the end of an existing note (by id).',
    input_schema: obj({ note_id: str('note id'), text: str('text to add') }, ['note_id', 'text']),
  },
  {
    name: 'read_note',
    description: 'Read the full text of a note (by id).',
    input_schema: obj({ note_id: str('note id') }, ['note_id']),
  },
  {
    name: 'create_event',
    description: 'Put something in the calendar. For fixed weekly schedules (work hours, training, classes) use repeat_days, and make separate events when the times differ between days (e.g. Thursday ends earlier). Times are local Danish time.',
    input_schema: obj({
      title: str('e.g. "Arbejde · Netto"'),
      date: str('first date, YYYY-MM-DD. For a weekly repeat starting now, use the next matching day.'),
      start_time: str('HH:MM'),
      end_time: str('HH:MM'),
      repeat_days: { type: 'array', items: { type: 'string', enum: ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'] }, description: 'weekdays it repeats on; omit for a single event' },
      repeat_until: str('optional last date YYYY-MM-DD'),
      place: str('optional place'),
      calendar: str('optional calendar name: "Arbejde", "Privat", "Træning", "Påmindelser"'),
    }, ['title', 'date', 'start_time', 'end_time']),
  },
  {
    name: 'delete_event',
    description: 'Remove an event (by id). For a repeating event, set only_date to skip one day instead of removing the whole series.',
    input_schema: obj({ event_id: str('event id (the part before "@" for repeats)'), only_date: str('optional YYYY-MM-DD to cancel just that day') }, ['event_id']),
  },
  {
    name: 'list_events',
    description: 'List calendar events (repeats expanded) between two dates.',
    input_schema: obj({ from: str('YYYY-MM-DD'), to: str('YYYY-MM-DD (inclusive)') }, ['from', 'to']),
  },
  {
    name: 'create_goal',
    description: 'Create a goal. kind "measure" = reach a number (target + unit), "milestones" = list of steps, "habit" = times per week.',
    input_schema: obj({
      title: str('goal title'), kind: { type: 'string', enum: ['measure', 'milestones', 'habit'] },
      target: num('for measure'), unit: str('for measure, e.g. "km", "kr", "bøger"'), per_week: num('for habit'),
      steps: { type: 'array', items: { type: 'string' }, description: 'for milestones' },
      due: str('optional deadline YYYY-MM-DD'), area: str('e.g. "Sundhed", "Arbejde", "Privat", "Økonomi", "Projekter"'),
    }, ['title', 'kind']),
  },
  {
    name: 'log_goal_progress',
    description: 'Record progress on a goal (by id): an amount for measure goals (e.g. 5.2 km), 1 for a habit session. For milestones, give step_done with the step name instead.',
    input_schema: obj({ goal_id: str('goal id'), amount: num('amount to add'), step_done: str('milestone step that is now done'), note: str('optional note') }, ['goal_id']),
  },
  {
    name: 'watch_mail',
    description: 'Ask CENTRA to watch for a specific future mail (from a sender and/or with words in the subject) and alert the user when it arrives. Give "from" and/or "subject_contains" so it can match. Works for every connected mail account.',
    input_schema: obj({ description: str('what to look for, in Danish'), from: str('optional sender name or address'), subject_contains: str('optional words in the subject') }, ['description']),
  },
  {
    name: 'search',
    description: 'Search notes (including their text), calendar, goals and what you remember about the user.',
    input_schema: obj({ query: str('search words') }, ['query']),
  },
  {
    name: 'save_contact',
    description: 'Create or update a contact (person the user knows). Matches an existing contact by name/e-mail/phone first. Put what they do, how the user knows them and what the contact is useful for in notes (it is appended, not replaced).',
    input_schema: obj({
      name: str('full name'), phone: str('optional'), email: str('optional'), relation: str('optional: Familie, Ven, Kæreste, Kollega, Arbejde, Kunde, Bekendt, Andet'),
      company: str('optional work/company'), birthday: str('optional YYYY-MM-DD'), address: str('optional'),
      socials: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['instagram', 'facebook', 'tiktok', 'snapchat', 'linkedin', 'x', 'web'] }, value: { type: 'string' } } }, description: 'optional social profiles' },
      notes: str('optional note to add about the person'),
    }, ['name']),
  },
  {
    name: 'find_contact',
    description: 'Look up contacts by name, relation, company or anything in their notes (e.g. "hvem kan låne en trailer").',
    input_schema: obj({ query: str('search words') }, ['query']),
  },
  {
    name: 'create_outlay',
    description: 'Register an udlæg. Normally the user paid and others owe their part. If someone ELSE paid and the user owes them ("jeg skylder Maria 150 for biograf", "Mads betalte pizzaen"), set paid_by to that person: then only the user\'s own part is tracked as a debt. List items with amounts; for each item "who" are the people sharing it ("mig" for the user); leave "who" empty to split it evenly among everyone in "people". People are created as contacts if new.',
    input_schema: obj({
      title: str('short title, e.g. "Pizza fredag"'), place: str('optional shop/place'), date: str('YYYY-MM-DD, default today'),
      paid_by: str('who paid the bill: omit (or "mig") when the user paid; a name when someone else paid and the user owes them'),
      people: { type: 'array', items: { type: 'string' }, description: 'everyone who shares the cost, by name; include "mig" if the user pays a part too' },
      items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, amount: { type: 'number' }, who: { type: 'array', items: { type: 'string' } } }, required: ['name', 'amount'] } },
    }, ['title', 'people', 'items']),
  },
  {
    name: 'record_payment',
    description: 'Someone paid the user back (all or part). Without outlay_id the money pays off their oldest open udlæg first.',
    input_schema: obj({ person: str('name of who paid'), amount: num('kroner'), outlay_id: str('optional specific udlæg id') }, ['person', 'amount']),
  },
  {
    name: 'i_paid_back',
    description: 'The user paid someone back what they owed them (all or part). Pays off the oldest debt to that person first.',
    input_schema: obj({ person: str('name of who the user paid'), amount: num('kroner') }, ['person', 'amount']),
  },
  {
    name: 'balances',
    description: 'Who owes the user money right now, and what the user owes others, per person and per udlæg.',
    input_schema: obj({}),
  },
  {
    name: 'add_expense',
    description: 'Add a fixed or one-off expense to Udgifter (rent, subscriptions, insurance, phone, gym …). For known services a cancel link is added automatically.',
    input_schema: obj({
      name: str('e.g. "Netflix", "Husleje"'), amount: num('kroner per payment'),
      interval: { type: 'string', enum: ['month', 'quarter', 'halfyear', 'year', 'week', 'once'] },
      category: { type: 'string', enum: CATEGORIES }, date: str('first payment date YYYY-MM-DD (or the date for once)'),
      cancel_url: str('optional link to cancel or change'), note: str('optional'),
    }, ['name', 'amount', 'interval']),
  },
  {
    name: 'list_expenses',
    description: 'The user\'s expenses with monthly cost, category and cancel link.',
    input_schema: obj({}),
  },
  {
    name: 'search_mail',
    description: 'Search the user\'s mail (all connected accounts) by sender, subject and text. Returns the newest matches with ids. Use an empty query with only_needs_reply=true to list mails waiting for an answer.',
    input_schema: obj({ query: str('words to look for (sender, subject, text)'), only_needs_reply: { type: 'boolean' }, days: num('optional: only the last N days') }, ['query']),
  },
  {
    name: 'read_mail',
    description: 'Read one mail in full (by id).',
    input_schema: obj({ mail_id: str('mail id') }, ['mail_id']),
  },
  {
    name: 'draft_reply',
    description: 'Write a reply draft for a mail. The draft is shown in the inbox for the user to edit and send; it is never sent automatically. Write in Danish (or the mail\'s language), short and in the user\'s tone, no subject line, sign with "Willads".',
    input_schema: obj({ mail_id: str('mail id'), body: str('the reply text') }, ['mail_id', 'body']),
  },
];

const DAYS: Record<string, number> = { søn: 0, man: 1, tir: 2, ons: 3, tor: 4, fre: 5, lør: 6 };
const at = (date: string, hm: string) => new Date(`${date}T${/^\d:/.test(hm) ? '0' + hm : hm}:00`);
const ymd = (s: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s ?? '')) throw new Error(`Ugyldig dato "${s}", brug YYYY-MM-DD`); return s; };
const hm = (s: string) => { if (!/^\d{1,2}[:.]\d{2}$/.test(s ?? '')) throw new Error(`Ugyldigt klokkeslæt "${s}", brug HH:MM`); return s.replace('.', ':'); };
const nowIso = () => new Date().toISOString();

export function runTool(e: SyncEngine, name: string, input: any): ToolResult {
  switch (name) {
    case 'remember': {
      const id = e.create('memory', { kind: input.kind ?? 'Om dig', statement: String(input.statement), source: 'Fortalt til Assist', at: nowIso() });
      return { result: { ok: true, id }, action: { label: `Husker: ${input.statement}`, undo: { kind: 'remove', type: 'memory', id }, open: { screen: 'assist' } } };
    }
    case 'update_memory': {
      const m = e.get(input.id) as any;
      if (!m || m.type !== 'memory') throw new Error('Ukendt id');
      e.set('memory', input.id, { statement: input.statement, source: 'Rettet via Assist' });
      return { result: { ok: true }, action: { label: `Rettet: ${input.statement}`, undo: { kind: 'restore', type: 'memory', id: input.id, fields: { statement: m.statement, source: m.source } } } };
    }
    case 'forget': {
      const m = e.get(input.id) as any;
      if (!m || m.type !== 'memory') throw new Error('Ukendt id');
      const { id: _i, type: _t, ...fields } = m;
      e.remove('memory', input.id);
      return { result: { ok: true }, action: { label: `Glemt: ${m.statement}`, undo: { kind: 'restore', type: 'memory', id: input.id, fields: { ...fields, _deleted: false } } } };
    }
    case 'create_note': {
      const id = e.create('note', { title: String(input.title), folder: input.folder || 'Indbakke', tags: input.tags ?? [], editedAt: nowIso(), by: 'Assist' });
      e.doc(id).getText('body').insert(0, String(input.body ?? ''));
      return { result: { ok: true, id }, action: { label: `Ny note: ${input.title}`, undo: { kind: 'remove', type: 'note', id }, open: { screen: 'notes', id } } };
    }
    case 'append_to_note': {
      const n = e.get(input.note_id) as any;
      if (!n || n.type !== 'note') throw new Error('Ukendt note');
      const t = e.doc(n.id).getText('body');
      const before = t.toString();
      t.insert(t.length, (before && !before.endsWith('\n') ? '\n' : '') + String(input.text));
      e.set('note', n.id, { editedAt: nowIso() });
      return { result: { ok: true }, action: { label: `Tilføjet til ${n.title || 'note'}`, undo: { kind: 'noteText', id: n.id, text: before }, open: { screen: 'notes', id: n.id } } };
    }
    case 'read_note': {
      const n = e.get(input.note_id) as any;
      if (!n || n.type !== 'note') throw new Error('Ukendt note');
      return { result: { title: n.title, folder: n.folder, text: e.doc(n.id).getText('body').toString() } };
    }
    case 'create_event': {
      const date = ymd(input.date);
      const s = at(date, hm(input.start_time));
      let en = at(date, hm(input.end_time));
      if (en <= s) en = new Date(en.getTime() + 86400000); // night shift past midnight
      const days = (input.repeat_days ?? []).map((d: string) => DAYS[String(d).slice(0, 3).toLowerCase()]).filter((d: number | undefined) => d !== undefined);
      const repeat = days.length ? { days, ...(input.repeat_until ? { until: ymd(input.repeat_until) } : {}) } : undefined;
      const id = e.create('event', { title: String(input.title), start: s.toISOString(), end: en.toISOString(), place: input.place, cal: input.calendar ?? (repeat ? 'Faste' : 'Privat'), ...(repeat ? { repeat } : {}), by: 'Assist' });
      const when = repeat ? `${repeatLabel(repeat)} ${input.start_time}–${input.end_time}` : `${new Date(date + 'T12:00').toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' })} ${input.start_time}–${input.end_time}`;
      return { result: { ok: true, id }, action: { label: `I kalenderen: ${input.title}, ${when}`, undo: { kind: 'remove', type: 'event', id }, open: { screen: 'calendar' } } };
    }
    case 'delete_event': {
      const ev = e.get(String(input.event_id).split('@')[0]) as any;
      if (!ev || ev.type !== 'event') throw new Error('Ukendt aftale');
      if (input.only_date && ev.repeat) {
        const skip = [...(ev.repeat.skip ?? []), ymd(input.only_date)];
        e.set('event', ev.id, { repeat: { ...ev.repeat, skip } });
        return { result: { ok: true }, action: { label: `Aflyst ${input.only_date}: ${ev.title}`, undo: { kind: 'restore', type: 'event', id: ev.id, fields: { repeat: ev.repeat } } } };
      }
      const { id: _i, type: _t, ...fields } = ev;
      e.remove('event', ev.id);
      return { result: { ok: true }, action: { label: `Fjernet fra kalenderen: ${ev.title}`, undo: { kind: 'restore', type: 'event', id: ev.id, fields: { ...fields, _deleted: false } } } };
    }
    case 'list_events': {
      const from = new Date(ymd(input.from) + 'T00:00');
      const to = new Date(ymd(input.to) + 'T00:00'); to.setDate(to.getDate() + 1);
      return { result: occurrences(e.list('event') as unknown as CalEvent[], from, to).slice(0, 80).map(evLine) };
    }
    case 'create_goal': {
      const order = e.list('goal').length + 1;
      const f: Record<string, unknown> = { title: String(input.title), kind: input.kind, area: input.area ?? 'Privat', order, start: dayKey(new Date()), by: 'Assist' };
      if (input.due) f.due = ymd(input.due);
      if (input.kind === 'measure') { f.target = Number(input.target ?? 1); f.unit = input.unit ?? ''; }
      if (input.kind === 'habit') f.perWeek = Number(input.per_week ?? 1);
      if (input.kind === 'milestones') f.steps = (input.steps ?? []).map((s: string) => [s, false]);
      const id = e.create('goal', f);
      return { result: { ok: true, id }, action: { label: `Nyt mål: ${input.title}`, undo: { kind: 'remove', type: 'goal', id }, open: { screen: 'goals', id } } };
    }
    case 'log_goal_progress': {
      const g = e.get(input.goal_id) as any;
      if (!g || g.type !== 'goal') throw new Error('Ukendt mål');
      if (input.step_done && g.kind === 'milestones') {
        const steps = (g.steps as [string, boolean][]).map(([s, d]) => [s, d || s.toLowerCase() === String(input.step_done).toLowerCase()] as [string, boolean]);
        e.set('goal', g.id, { steps });
        return { result: { ok: true }, action: { label: `${g.title}: "${input.step_done}" er klaret`, undo: { kind: 'restore', type: 'goal', id: g.id, fields: { steps: g.steps } }, open: { screen: 'goals', id: g.id } } };
      }
      const amount = Number(input.amount ?? 1);
      const id = e.create('goalUpdate', { goal: g.id, at: nowIso(), delta: amount, text: input.note ?? '', src: 'Via Assist' });
      return { result: { ok: true, id }, action: { label: `${g.title}: +${amount.toLocaleString('da-DK')} ${g.unit ?? ''}`.trim(), undo: { kind: 'remove', type: 'goalUpdate', id }, open: { screen: 'goals', id: g.id } } };
    }
    case 'watch_mail': {
      const id = e.create('watch', { description: String(input.description), from: input.from ?? '', subject: input.subject_contains ?? '', active: true, at: nowIso() });
      return { result: { ok: true, id, note: 'Mail is not connected yet; the watch starts when it is.' }, action: { label: `Holder øje med: ${input.description}`, undo: { kind: 'remove', type: 'watch', id }, open: { screen: 'assist' } } };
    }
    case 'search': {
      const q = String(input.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const hit = (s: string) => q.every((w) => s.toLowerCase().includes(w));
      const notes = e.list('note').filter((n: any) => hit(`${n.title} ${n.folder} ${(n.tags ?? []).join(' ')} ${e.doc(n.id).getText('body').toString()}`))
        .slice(0, 10).map((n: any) => ({ id: n.id, title: n.title, excerpt: e.doc(n.id).getText('body').toString().slice(0, 300) }));
      const events = (e.list('event') as unknown as CalEvent[]).filter((x) => hit(`${x.title} ${x.place ?? ''}`)).slice(0, 10).map(evDef);
      const goals = e.list('goal').filter((g: any) => hit(`${g.title} ${g.area}`)).map((g: any) => ({ id: g.id, title: g.title }));
      const memory = e.list('memory').filter((m: any) => hit(m.statement)).map((m: any) => ({ id: m.id, statement: m.statement }));
      return { result: { notes, events, goals, memory } };
    }
    case 'save_contact': {
      const existing = findPerson(e, input.email || input.phone || input.name) ?? findPerson(e, input.name);
      const f: Record<string, unknown> = {};
      for (const k of ['phone', 'email', 'relation', 'company', 'birthday', 'address']) if (input[k]) f[k] = String(input[k]).trim();
      if (existing) {
        const { id: _i, type: _t, ...prev } = existing as any;
        if (input.socials?.length) f.socials = [...(existing.socials ?? []), ...input.socials.filter((s: any) => !(existing.socials ?? []).some((x) => x.kind === s.kind && x.value === s.value))];
        if (input.notes) f.notes = [existing.notes, input.notes].filter(Boolean).join('\n');
        if (input.name && input.name.length > existing.name.length && input.name.toLowerCase().startsWith(existing.name.toLowerCase())) f.name = input.name;
        e.set('person', existing.id, f);
        return { result: { ok: true, id: existing.id, updated: Object.keys(f) }, action: { label: `Kontakt opdateret: ${existing.name}`, undo: { kind: 'restore', type: 'person', id: existing.id, fields: prev }, open: { screen: 'contacts', id: existing.id } } };
      }
      const id = e.create('person', { name: String(input.name).trim(), ...f, socials: input.socials ?? [], notes: input.notes ?? '', createdAt: nowIso() });
      return { result: { ok: true, id }, action: { label: `Ny kontakt: ${input.name}`, undo: { kind: 'remove', type: 'person', id }, open: { screen: 'contacts', id } } };
    }
    case 'find_contact': {
      const q = String(input.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const hits = people(e).filter((p) => q.some((w) => `${p.name} ${p.relation ?? ''} ${p.company ?? ''} ${p.notes ?? ''} ${p.email ?? ''} ${p.phone ?? ''}`.toLowerCase().includes(w)))
        .slice(0, 12).map((p) => ({ id: p.id, name: p.name, relation: p.relation, phone: p.phone, email: p.email, company: p.company, notes: p.notes?.slice(0, 400), socials: p.socials }));
      return { result: hits.length ? hits : 'Ingen kontakter fundet.' };
    }
    case 'create_outlay': {
      const created: string[] = [];
      const ids = (input.people ?? []).map((n: string) => { const r = findOrCreatePerson(e, n); if (r.created) created.push(n); return r.id; });
      const payer = input.paid_by && !['mig', 'me', 'jeg'].includes(String(input.paid_by).trim().toLowerCase()) ? findOrCreatePerson(e, String(input.paid_by)) : null;
      if (payer?.created) created.push(String(input.paid_by));
      const ppl = [...new Set<string>(payer ? [ME, ...ids, payer.id] : ids)];
      const items = (input.items ?? []).map((it: any, i: number) => ({ id: 'i' + i + Math.random().toString(36).slice(2, 7), name: String(it.name), amount: Number(it.amount),
        who: (it.who ?? []).map((n: string) => findOrCreatePerson(e, n).id).filter((w: string) => ppl.includes(w)) }));
      if (!ppl.length || !items.length) throw new Error('Mangler personer eller varer');
      const id = e.create('outlay', { title: String(input.title), place: input.place ?? '', date: input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : dayKey(new Date()), people: ppl, items, countMine: true, createdAt: nowIso(), by: 'Assist', ...(payer ? { paidBy: payer.id } : {}) });
      const o = e.get(id) as unknown as Outlay;
      if (payer) {
        const d = iOwe(o, [])!;
        return { result: { ok: true, id, total: total(o), you_owe: d.share, to: personName(e, payer.id), new_contacts: created },
          action: { label: `Du skylder ${personName(e, payer.id).split(' ')[0]} ${kr(d.share)} for ${input.title}`, undo: { kind: 'remove', type: 'outlay', id }, open: { screen: 'outlays', id } } };
      }
      const ow = owed(o, []).map((w) => ({ person: personName(e, w.person), owes: w.share }));
      return { result: { ok: true, id, total: total(o), my_share: shares(o)[ME] ?? 0, owes: ow, new_contacts: created },
        action: { label: `Udlæg: ${input.title}, ${kr(total(o))}${ow.length ? ' · ' + ow.map((w) => `${w.person.split(' ')[0]} ${kr(w.owes)}`).join(', ') : ''}`, undo: { kind: 'remove', type: 'outlay', id }, open: { screen: 'outlays', id } } };
    }
    case 'record_payment': {
      const p = findPerson(e, input.person);
      if (!p) throw new Error(`Kender ingen ved navn ${input.person}`);
      const amount = Number(input.amount);
      let ids: string[];
      if (input.outlay_id) ids = [e.create('payment', { outlay: input.outlay_id, person: p.id, amount, at: nowIso() })];
      else ids = payBack(e, p.id, amount);
      if (!ids.length) throw new Error(`${p.name} skylder ikke noget lige nu`);
      const left = balances(e).find((b) => b.person === p.id)?.left ?? 0;
      return { result: { ok: true, still_owes: left }, action: { label: `${p.name} har betalt ${kr(amount)}${left > 0 ? ` · mangler ${kr(left)}` : ' · alt betalt'}`, undo: { kind: 'removeMany', type: 'payment', ids }, open: { screen: 'outlays' } } };
    }
    case 'i_paid_back': {
      const p = findPerson(e, input.person);
      if (!p) throw new Error(`Kender ingen ved navn ${input.person}`);
      const amount = Number(input.amount);
      const ids = payDebt(e, p.id, amount);
      if (!ids.length) throw new Error(`Du skylder ikke ${p.name} noget lige nu`);
      const left = debts(e).find((b) => b.person === p.id)?.left ?? 0;
      return { result: { ok: true, you_still_owe: left }, action: { label: `Du har betalt ${p.name} ${kr(amount)}${left > 0 ? ` · du skylder stadig ${kr(left)}` : ' · alt betalt'}`, undo: { kind: 'removeMany', type: 'payment', ids }, open: { screen: 'outlays' } } };
    }
    case 'balances': {
      const outs = e.list('outlay') as unknown as Outlay[], pays = e.list('payment') as unknown as Payment[];
      const owed_to_you = balances(e).filter((b) => b.left > 0).map((b) => ({ person: personName(e, b.person), owes: b.left, open: b.open.map((id) => { const o = outs.find((x) => x.id === id)!; return { id, title: o.title, date: o.date, left: owed(o, pays).find((w) => w.person === b.person)?.left }; }) }));
      const you_owe = debts(e).filter((b) => b.left > 0).map((b) => ({ person: personName(e, b.person), you_owe: b.left, open: b.open.map((id) => { const o = outs.find((x) => x.id === id)!; return { id, title: o.title, date: o.date, left: iOwe(o, pays)?.left }; }) }));
      return { result: { owed_to_you, you_owe } };
    }
    case 'add_expense': {
      const svc = serviceFor(String(input.name));
      const id = e.create('expense', { name: String(input.name), amount: Number(input.amount), interval: input.interval ?? 'month', category: input.category ?? svc?.category ?? 'Andet',
        date: input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : dayKey(new Date()), cancelUrl: input.cancel_url ?? '', note: input.note ?? '', active: true });
      return { result: { ok: true, id }, action: { label: `Udgift: ${input.name}, ${kr(Number(input.amount))}${input.interval === 'once' ? '' : input.interval === 'year' ? '/år' : '/md'}`, undo: { kind: 'remove', type: 'expense', id }, open: { screen: 'expenses' } } };
    }
    case 'list_expenses': {
      const xs = e.list('expense') as unknown as Expense[];
      return { result: { per_month_total: Math.round(xs.reduce((s, x) => s + perMonth(x), 0)), items: xs.map((x) => ({ id: x.id, name: x.name, amount: x.amount, interval: x.interval, category: x.category, per_month: Math.round(perMonth(x) * 100) / 100, active: x.active !== false, cancel: cancelLink(x) })) } };
    }
    case 'search_mail': {
      const q = String(input.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const since = input.days ? Date.now() - Number(input.days) * 86400000 : 0;
      const hits = (e.list('mail') as any[]).filter((m) => !m.archived && (!input.only_needs_reply || m.needsReply) && (!since || new Date(m.at).getTime() >= since)
        && q.every((w) => `${m.fromName} ${m.fromEmail} ${m.subject} ${m.body ?? m.preview}`.toLowerCase().includes(w)))
        .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 15)
        .map((m) => ({ id: m.id, ...(m.sent ? { sent_by_you_to: m.to } : { from: `${m.fromName} <${m.fromEmail}>` }), subject: m.subject, at: m.at, account: m.acctName, unread: !!m.unread, needsReply: !!m.needsReply, preview: m.preview }));
      return { result: hits.length ? hits : 'Ingen mails fundet.' };
    }
    case 'read_mail': {
      const m = e.get(input.mail_id) as any;
      if (!m || m.type !== 'mail') throw new Error('Ukendt mail');
      return { result: { from: m.sent ? 'dig (sendt)' : `${m.fromName} <${m.fromEmail}>`, to: m.to, subject: m.subject, at: m.at, account: m.acctName, attachments: m.attachments, text: String(m.body ?? m.preview ?? '').slice(0, 12000) } };
    }
    case 'draft_reply': {
      const m = e.get(input.mail_id) as any;
      if (!m || m.type !== 'mail') throw new Error('Ukendt mail');
      e.set('mail', m.id, { draft: String(input.body) });
      return { result: { ok: true }, action: { label: `Svarudkast til ${m.fromName || m.fromEmail}: ${m.subject}`, undo: { kind: 'restore', type: 'mail', id: m.id, fields: { draft: m.draft ?? '' } }, open: { screen: 'inbox', id: m.id } } };
    }
  }
  throw new Error(`Ukendt værktøj: ${name}`);
}

export function applyUndo(e: SyncEngine, u: Undo) {
  if (u.kind === 'remove') e.remove(u.type, u.id);
  else if (u.kind === 'restore') e.set(u.type, u.id, u.fields);
  else if (u.kind === 'removeMany') for (const id of u.ids) e.remove(u.type, id);
  else { const t = e.doc(u.id).getText('body'); t.delete(0, t.length); t.insert(0, u.text); }
}

const hmOf = (iso: string) => new Date(iso).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
const evLine = (x: CalEvent) => ({ id: x.id, title: x.title, day: new Date(x.start).toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' }), time: `${hmOf(x.start)}–${hmOf(x.end)}`, place: x.place });
const evDef = (x: CalEvent) => ({ id: x.id, title: x.title, when: x.repeat ? `${repeatLabel(x.repeat)} ${hmOf(x.start)}–${hmOf(x.end)} fra ${dayKey(new Date(x.start))}` : `${dayKey(new Date(x.start))} ${hmOf(x.start)}–${hmOf(x.end)}`, place: x.place });

/** A compact picture of the user's world for the system prompt. */
export function contextFor(e: SyncEngine): string {
  const now = new Date();
  const memory = e.list('memory').map((m: any) => `- [${m.id}] (${m.kind}) ${m.statement}`);
  const goals = (e.list('goal') as unknown as Goal[]).map((g) => {
    const s = goalStats(g, e.list('goalUpdate') as unknown as GoalUpdate[], now);
    return `- [${g.id}] ${g.title} (${g.kind}${g.kind === 'milestones' ? ': ' + (g.steps ?? []).map(([n, d]) => (d ? '✓' : '○') + n).join(', ') : ''}) · ${s.label}${g.due ? ' · frist ' + g.due : ''}`;
  });
  const notes = e.list('note').sort((a: any, b: any) => (b.editedAt ?? '').localeCompare(a.editedAt ?? '')).slice(0, 40).map((n: any) => `- [${n.id}] ${n.title || 'Uden titel'} (${n.folder ?? ''})`);
  const all = e.list('event') as unknown as CalEvent[];
  const fixed = all.filter((x) => x.repeat).map((x) => { const d = evDef(x); return `- [${d.id}] ${d.title}: ${d.when}${x.repeat?.skip?.length ? ' (aflyst: ' + x.repeat.skip.join(', ') + ')' : ''}`; });
  const end = new Date(now); end.setDate(end.getDate() + 8);
  const soon = occurrences(all.filter((x) => !x.repeat), now, end).map((x) => { const l = evLine(x); return `- [${l.id}] ${l.day} ${l.time} ${l.title}${l.place ? ' · ' + l.place : ''}`; });
  const watches = e.list('watch').filter((w: any) => w.active).map((w: any) => `- [${w.id}] ${w.description}`);
  const accts = e.list('mailacct').map((a: any) => `${a.name} (${a.email})`);
  const mails = (e.list('mail') as any[]).filter((m) => !m.archived && !m.sent);
  const waiting = mails.filter((m) => m.needsReply).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8).map((m) => `- [${m.id}] ${m.fromName}: ${m.subject} (${String(m.at).slice(0, 10)})`);
  const mailInfo = accts.length ? [`Forbundne konti: ${accts.join(', ')}. ${mails.length} mails i indbakken, ${mails.filter((m) => m.unread).length} ulæste. Brug search_mail og read_mail til resten.`, ...(waiting.length ? ['Venter på svar:', ...waiting] : [])] : ['Ingen mailkonti forbundet endnu (det gøres under Forbindelser).'];
  const contacts = (people(e) as Person[]).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 80).map((p) => `- [${p.id}] ${p.name}${p.relation ? ' (' + p.relation + ')' : ''}${p.company ? ', ' + p.company : ''}${p.notes ? ': ' + p.notes.replace(/\s+/g, ' ').slice(0, 140) : ''}`);
  const owing = [
    ...balances(e).filter((b) => b.left > 0).map((b) => `- ${personName(e, b.person)} skylder brugeren ${kr(b.left)}`),
    ...debts(e).filter((b) => b.left > 0).map((b) => `- Brugeren skylder ${personName(e, b.person)} ${kr(b.left)}`),
  ];
  const xs = (e.list('expense') as unknown as Expense[]).filter((x) => x.active !== false);
  const money = xs.length ? [`Faste udgifter: ${kr(xs.reduce((s, x) => s + perMonth(x), 0), { short: true })} pr. måned fordelt på ${xs.length} poster (brug list_expenses).`] : [];
  const sec = (t: string, l: string[], empty: string) => `## ${t}\n${l.length ? l.join('\n') : empty}`;
  return [
    sec('Det ved du om brugeren', memory, '(intet endnu — brugeren er ny, så lær dem at kende)'),
    sec('Faste aftaler', fixed, '(ingen)'),
    sec('Enkeltaftaler de næste 8 dage', soon, '(ingen)'),
    sec('Mål', goals, '(ingen)'),
    sec('Seneste noter', notes, '(ingen)'),
    sec('Kontakter (brug find_contact for detaljer)', contacts, '(ingen endnu)'),
    sec('Udlæg: skylder brugeren penge', owing, '(ingen)'),
    sec('Udgifter', money, '(ingen registreret)'),
    sec('Mail', mailInfo, ''),
    sec('Mail-overvågninger', watches, '(ingen)'),
  ].join('\n\n');
}
