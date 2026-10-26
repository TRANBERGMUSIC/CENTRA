/**
 * What Assist can do in CENTRA. Every tool works on the encrypted local engine and returns an undo
 * step, so anything Assist did can be taken back with one click ("Fortryd").
 */
import type { SyncEngine } from '@centra/sync';
import { occurrences, dayKey, repeatLabel, type CalEvent } from '../calendar.ts';
import { goalStats, type Goal, type GoalUpdate } from '../goals.ts';
import type { Route } from '../state.tsx';

export type Undo =
  | { kind: 'remove'; type: string; id: string }
  | { kind: 'restore'; type: string; id: string; fields: Record<string, unknown> }
  | { kind: 'noteText'; id: string; text: string };

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
    case 'search_mail': {
      const q = String(input.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const since = input.days ? Date.now() - Number(input.days) * 86400000 : 0;
      const hits = (e.list('mail') as any[]).filter((m) => !m.archived && (!input.only_needs_reply || m.needsReply) && (!since || new Date(m.at).getTime() >= since)
        && q.every((w) => `${m.fromName} ${m.fromEmail} ${m.subject} ${m.body ?? m.preview}`.toLowerCase().includes(w)))
        .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 15)
        .map((m) => ({ id: m.id, from: `${m.fromName} <${m.fromEmail}>`, subject: m.subject, at: m.at, account: m.acctName, unread: !!m.unread, needsReply: !!m.needsReply, preview: m.preview }));
      return { result: hits.length ? hits : 'Ingen mails fundet.' };
    }
    case 'read_mail': {
      const m = e.get(input.mail_id) as any;
      if (!m || m.type !== 'mail') throw new Error('Ukendt mail');
      return { result: { from: `${m.fromName} <${m.fromEmail}>`, to: m.to, subject: m.subject, at: m.at, account: m.acctName, attachments: m.attachments, text: String(m.body ?? m.preview ?? '').slice(0, 12000) } };
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
  const mails = (e.list('mail') as any[]).filter((m) => !m.archived);
  const waiting = mails.filter((m) => m.needsReply).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8).map((m) => `- [${m.id}] ${m.fromName}: ${m.subject} (${String(m.at).slice(0, 10)})`);
  const mailInfo = accts.length ? [`Forbundne konti: ${accts.join(', ')}. ${mails.length} mails i indbakken, ${mails.filter((m) => m.unread).length} ulæste. Brug search_mail og read_mail til resten.`, ...(waiting.length ? ['Venter på svar:', ...waiting] : [])] : ['Ingen mailkonti forbundet endnu (det gøres under Forbindelser).'];
  const sec = (t: string, l: string[], empty: string) => `## ${t}\n${l.length ? l.join('\n') : empty}`;
  return [
    sec('Det ved du om brugeren', memory, '(intet endnu — brugeren er ny, så lær dem at kende)'),
    sec('Faste aftaler', fixed, '(ingen)'),
    sec('Enkeltaftaler de næste 8 dage', soon, '(ingen)'),
    sec('Mål', goals, '(ingen)'),
    sec('Seneste noter', notes, '(ingen)'),
    sec('Mail', mailInfo, ''),
    sec('Mail-overvågninger', watches, '(ingen)'),
  ].join('\n\n');
}
