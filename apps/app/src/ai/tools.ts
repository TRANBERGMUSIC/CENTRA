/**
 * What Assist can do in CENTRA. Every tool works on the encrypted local engine and returns an undo
 * step, so anything Assist did can be taken back with one click ("Fortryd").
 */
import { addAlarm, daysLabel } from '../alarms.ts';
import { NOTES, eventNotes, setEventNotes, appendEventNotes } from '../eventNotes.ts';
import { addReminder, setDone, whenLabel, sorted as sortedReminders, type Reminder } from '../reminders.ts';
import { calTypes, typeForName } from '../calTypes.ts';
import type { SyncEngine } from '@centra/sync';
import { fullText, fetchedHtml } from '../mailText.ts';
import { folders, sortByRules, moveToFolder, folderByName, type FolderRule } from '../mailFolders.ts';
import { createFolder as createNoteFolder, renameFolder as renameNoteFolder, clean as cleanPath, folderTree } from '../notes.ts';
import { occurrences, dayKey, repeatLabel, type CalEvent } from '../calendar.ts';
import { goalStats, type Goal, type GoalUpdate } from '../goals.ts';
import type { Route } from '../state.tsx';
import { tallyNet, lineExplain, toLines, type Tally } from '../money.ts';
import { searchPhotos, storePhoto, type Photo } from '../photos.ts';
import { ME, findPerson, findOrCreatePerson, balances, debts, payDebt, iOwe, owed, total, shares, payBack, perMonth, cancelLink, serviceFor, CATEGORIES, people, personName, kr, type Person, type Outlay, type Payment, type Expense } from '../money.ts';

export type Undo =
  | { kind: 'remove'; type: string; id: string }
  | { kind: 'restore'; type: string; id: string; fields: Record<string, unknown> }
  | { kind: 'noteText'; id: string; text: string; field?: string }
  | { kind: 'removeMany'; type: string; ids: string[] }
  | { kind: 'many'; steps: Undo[] };

export type Action = { label: string; undo?: Undo; open?: Route; undone?: boolean };
export type ToolResult = { result: unknown; action?: Action; images?: string[] };

/** Pictures attached to the question being answered (for save_attached_photos). */
let attached: string[] = [];
export const setAttachments = (x: string[]) => { attached = x; };

export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> };

const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });

/** Every kind of thing in CENTRA, with the Danish name Assist and the user use for it. */
const KINDS: Record<string, string> = {
  note: 'note', event: 'aftale', goal: 'mål', goalUpdate: 'målopdatering', person: 'kontakt', outlay: 'udlæg', tally: 'regnestykke',
  payment: 'betaling', expense: 'fast udgift', memory: 'hukommelse', photo: 'billede', mail: 'mail', mailfolder: 'mailmappe',
  notefolder: 'notemappe', calcat: 'kalendertype', suggestion: 'forslag', reminder: 'huskeliste-punkt', alarm: 'vækkeur', mailacct: 'mailkonto', lhconn: 'LunchHub-forbindelse', feed: 'kalenderabonnement',
};
const KIND_KEYS = Object.keys(KINDS);
/** One line about a record, for find_items. */
function summary(e: SyncEngine, r: any): string {
  const name = r.title || r.name || r.subject || r.statement || r.text || r.path || r.label || '';
  const bits: string[] = [];
  if (r.start) bits.push(new Date(r.start).toLocaleString('da-DK', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
  if (r.date) bits.push(r.date);
  if (r.at && !r.start && !r.date) bits.push(String(r.at).slice(0, 10));
  if (typeof r.amount === 'number') bits.push(kr(r.amount));
  if (r.person) bits.push('med ' + personName(e, r.person));
  if (r.type === 'tally') { try { bits.push(tallyNet(r as Tally) >= 0 ? `${personName(e, r.person)} skylder dig ${kr(tallyNet(r as Tally))}` : `du skylder ${personName(e, r.person)} ${kr(-tallyNet(r as Tally))}`); } catch { /* fine */ } }
  if (r.type === 'outlay' && Array.isArray(r.items)) bits.push(kr(r.items.reduce((a: number, x: any) => a + (Number(x.amount) || 0), 0)));
  if (r.fromName) bits.push('fra ' + r.fromName);
  if (r.phone) bits.push(r.phone);
  if (r.email) bits.push(r.email);
  if (r.folder) bits.push(r.folder);
  return [String(name).slice(0, 120), ...bits].filter(Boolean).join(' · ');
}

export const TOOLS: ToolDef[] = [
  {
    name: 'remember',
    description: 'Save a lasting fact about the user (routine, work, people, preferences, health habits, places, things they care about). Use whenever the user tells you something about themselves that will still be true later. Use kind "Svarstil" for how the user wants YOUR answers (length, tone, format, what to always/never do), and "Skrivestil" for how the user writes mails and messages (greeting, sign-off, tone). One fact per call, written in Danish as a short statement.',
    input_schema: obj({ kind: { type: 'string', enum: ['Om dig', 'Rutine', 'Arbejde', 'Person', 'Præference', 'Sted', 'Mål', 'Svarstil', 'Skrivestil'] }, statement: str('Short Danish statement, e.g. "Arbejder i Netto tirsdag–fredag 06–16, torsdag til 15"') }, ['kind', 'statement']),
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
    input_schema: obj({ title: str('short title'), body: str('the note text'), folder: str('folder path; subfolders with "/", e.g. "Arbejde/Netto" or "Ideer". Use an existing folder from the context when one fits. Default "Indbakke"'), tags: { type: 'array', items: { type: 'string' } } }, ['title', 'body']),
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
      kind: str('the event\'s type, which sets its colour: one of Kalendertyper in the context when it fits (e.g. "Arbejde" for shifts, "Personlig"); a new name makes a new type'),
      notes: str('optional notes kept with the event, Markdown (flight/booking numbers, times, addresses, the plan, a packing list as "- [ ] …")'),
      alert_minutes: num('optional: a push notification this many minutes before it starts (0 = when it starts, 1440 = a day before). Use when the user asks to be reminded of the event.'),
    }, ['title', 'date', 'start_time', 'end_time']),
  },
  {
    name: 'set_alarm',
    description: 'Set an alarm clock (vækkeur) on the iPhone: it rings at the time, also on silent and with CENTRA closed. Weekdays to repeat (man…søn), none = once (the next time it comes). For "væk mig kl 6.30 i morgen", "vækkeur hverdage kl 7". To change or delete one, use update_item / delete_items with its id (find_items kinds ["alarm"]).',
    input_schema: obj({ time: str('HH:MM'), days: { type: 'array', items: { type: 'string', enum: ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'] } }, label: str('optional name, e.g. "Arbejde"') }, ['time']),
  },
  {
    name: 'event_notes',
    description: 'Write in a calendar event\'s own notes (Markdown, shown with the event). Use it for everything that belongs to that event: flight tickets and booking numbers, check-in and gate times, addresses, the plan for the day, a packing list ("- [ ] …"), links. Never make a separate note in Noter for this. mode "append" (default) adds at the end; "replace" rewrites them all. The id is in the context, or from list_events / find_items.',
    input_schema: obj({ event_id: str('the event id'), text: str('the notes (Markdown)'), mode: { type: 'string', enum: ['append', 'replace'] } }, ['event_id', 'text']),
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
    description: 'Create a goal. Pick the kind that fits what the user says: "once" = something to get done one time ("få lavet hjemmesiden", optional steps and due), "milestones" = a bigger project with steps, "count" = do something N times in a period ("løbe 5 km 10 gange i år" → target 10, each "løbe 5 km", period "year"; "2 koncerter om måneden" → period "month"), "measure" = reach a number (target + unit, e.g. 10000 kr, 300 km), "habit" = times per week. Add why and next (the first concrete step) when you can. Check the goals in the context first so you don\'t make a duplicate (update it instead).',
    input_schema: obj({
      title: str('goal title, short'), kind: { type: 'string', enum: ['once', 'milestones', 'count', 'measure', 'habit'] },
      target: num('measure: the number; count: how many times; habit: times per week'), unit: str('measure: e.g. "km", "kr", "bøger"'),
      each: str('count: what one time is, e.g. "løbe 5 km"'), period: { type: 'string', enum: ['year', 'month', 'week', 'total'], description: 'count: the period the target is for ("total" = before the due date)' },
      steps: { type: 'array', items: { type: 'string' }, description: 'milestones/once: the steps' },
      due: str('optional deadline YYYY-MM-DD'), area: str('e.g. "Sundhed", "Arbejde", "Privat", "Økonomi", "Projekter", "Musik"'),
      why: str('optional: why it matters to the user, in their words'), next: str('optional: the very next concrete step'),
    }, ['title', 'kind']),
  },
  {
    name: 'update_goal',
    description: 'Change a goal (by id from the context): title, numbers, deadline, area, why/next, add or remove steps, or status ("active", "paused", "done"). Use this to keep goals tidy when the user changes their mind or a goal is finished.',
    input_schema: obj({
      goal_id: str('goal id'), title: str(''), target: num(''), unit: str(''), each: str(''), period: { type: 'string', enum: ['year', 'month', 'week', 'total'] }, due: str('YYYY-MM-DD, or "" to remove'),
      area: str(''), why: str(''), next: str(''), add_steps: { type: 'array', items: { type: 'string' } }, remove_steps: { type: 'array', items: { type: 'string' } },
      status: { type: 'string', enum: ['active', 'paused', 'done'] },
    }, ['goal_id']),
  },
  {
    name: 'log_goal_progress',
    description: 'Record progress on a goal (by id): measure = the amount (e.g. 5.2 km, 500 kr); count and habit = 1 per time (omit amount); milestones/once = step_done with the step name; once without steps = done true. Match what the user did to the right goal ("jeg løb 5 km i dag" → the count goal "løbe 5 km 10 gange").',
    input_schema: obj({ goal_id: str('goal id'), amount: num('amount to add (default 1 for count/habit)'), step_done: str('step that is now done'), done: { type: 'boolean', description: 'once: the whole thing is done' }, note: str('optional note'), date: str('optional YYYY-MM-DD if it happened another day') }, ['goal_id']),
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
    name: 'create_tally',
    description: 'A "regnestykke" with ONE other person: several things that went back and forth (pant, mad, ting den ene gav den anden …), so CENTRA works out who owes whom. Use this instead of create_outlay when money went both ways or there is income (pant, salg). Each line: text, amount (kroner, positive), kind (expense = paid out, income = money received, gift = a present, no debt), by ("mig" or "person": who paid / got the money / gave it), whose ("begge" = split equally, "mig" = only the user\'s, "person" = only the other\'s). When unclear who paid or got the money, assume the user and say so in your answer. The result (who owes whom, and how much) comes back; tell the user in one sentence and mention any assumption.',
    input_schema: obj({
      person: str('the other person\'s name'), title: str('short title, e.g. "Pant og mad med Jonas"'), date: str('YYYY-MM-DD, default today'),
      lines: { type: 'array', items: obj({ text: str('what, e.g. "Pant"'), amount: num('kroner'), kind: { type: 'string', enum: ['expense', 'income', 'gift'] }, by: { type: 'string', enum: ['mig', 'person'] }, whose: { type: 'string', enum: ['begge', 'mig', 'person'] } }, ['text', 'amount', 'kind', 'by', 'whose']) },
    }, ['person', 'lines']),
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
    description: 'Search the user\'s mail (all connected accounts, also sent and archived) by sender, subject and text. Returns the newest matches with ids and a SHORT preview only. To know what a mail says (times, prices, addresses, booking numbers, links), read it with read_mail.',
    input_schema: obj({ query: str('words to look for (sender, subject, text)'), only_needs_reply: { type: 'boolean' }, days: num('optional: only the last N days'), folder: str('optional: only in this folder (id or name), or "inbox"'), limit: num('max results, default 15, up to 100') }, ['query']),
  },
  {
    name: 'read_mail',
    description: 'Read mails in full: the complete text, also what is only in the HTML version (tables, times, links). Give one id, or several in mail_ids to read them in one go. Always read before answering about details in a mail.',
    input_schema: obj({ mail_id: str('mail id'), mail_ids: { type: 'array', items: { type: 'string' }, description: 'several mail ids (up to 10)' } }, []),
  },
  {
    name: 'draft_reply',
    description: 'Write a reply draft for a mail. The draft is shown in the inbox for the user to edit and send; it is never sent automatically. Call my_writing_style first and write the way the user writes. Danish (or the mail\'s language), no subject line.',
    input_schema: obj({ mail_id: str('mail id'), body: str('the reply text') }, ['mail_id', 'body']),
  },
  {
    name: 'organize_notes',
    description: 'Keep the user\'s notes in order: create note folders (paths with "/" for subfolders), move notes to folders, rename/move a folder, set tags, pin. Several operations in one call.',
    input_schema: obj({
      create_folders: { type: 'array', items: { type: 'string' }, description: 'folder paths to create, e.g. "Projekter/SmartLink"' },
      move: { type: 'array', items: obj({ note_id: str('note id'), folder: str('folder path') }, ['note_id', 'folder']) },
      rename_folder: obj({ from: str('existing path'), to: str('new path') }, ['from', 'to']),
      tags: { type: 'array', items: obj({ note_id: str('note id'), tags: { type: 'array', items: { type: 'string' } } }, ['note_id', 'tags']) },
      pin: { type: 'array', items: obj({ note_id: str('note id'), pinned: { type: 'boolean' } }, ['note_id', 'pinned']) },
    }, []),
  },
  {
    name: 'create_mail_folder',
    description: 'Create a mail folder in CENTRA\'s inbox, so mails are sorted into it. Give rules for exact matches (sender name/address, words in the subject or text; comma = any of them) and/or a description of what belongs there (used to sort new mails with AI). New mails are sorted the moment they arrive. Set sort_existing to also move matching mails already in the inbox. To move specific mails that rules don\'t catch, use search_mail and then move_mails.',
    input_schema: obj({ name: str('folder name, e.g. "Kvitteringer"'), description: str('what belongs in the folder, in Danish'), rules: { type: 'array', items: obj({ from: str('sender name or address contains'), subject: str('subject contains (comma-separated alternatives)'), words: str('subject or text contains (comma-separated alternatives)') }, []) }, sort_existing: { type: 'boolean' } }, ['name']),
  },
  {
    name: 'update_mail_folder',
    description: 'Rename a mail folder, change its description, or add rules (by folder id from the context). Set sort_existing to apply the rules to the inbox now.',
    input_schema: obj({ folder_id: str('folder id'), name: str('new name'), description: str('new description'), add_rules: { type: 'array', items: obj({ from: str(''), subject: str(''), words: str('') }, []) }, clear_rules: { type: 'boolean' }, sort_existing: { type: 'boolean' } }, ['folder_id']),
  },
  {
    name: 'delete_mail_folder',
    description: 'Delete a mail folder. Its mails go back to the inbox (nothing is deleted).',
    input_schema: obj({ folder_id: str('folder id') }, ['folder_id']),
  },
  {
    name: 'move_mails',
    description: 'Move mails into a folder (folder id or name), or back to the inbox with folder "inbox". Up to 200 at a time.',
    input_schema: obj({ mail_ids: { type: 'array', items: { type: 'string' } }, folder: str('folder id or name, or "inbox"') }, ['mail_ids', 'folder']),
  },
  {
    name: 'search_photos',
    description: 'Search the photos the user has saved in CENTRA (Billeder) by words (what is in it, colours, brands, text in it) and/or dates. Returns matches with title, description and date, plus small previews of the best ones. Turn relative days into dates yourself (today is in the context).',
    input_schema: obj({ query: str('words, e.g. "grøn trøje" or "booking" (may be empty with dates)'), from_date: str('YYYY-MM-DD'), to_date: str('YYYY-MM-DD'), limit: num('max results, default 8') }, []),
  },
  {
    name: 'look_at_photos',
    description: 'Look at saved photos in full (by id), to read details or text from them. Up to 4 at a time.',
    input_schema: obj({ photo_ids: { type: 'array', items: { type: 'string' } } }, ['photo_ids']),
  },
  {
    name: 'save_attached_photos',
    description: 'Save the picture(s) the user attached to this message in CENTRA\'s Billeder, so they can be found later. Describe each from what you see: title (2-6 words), description (what it is, colours, brand, price, shop …), tags (Danish, lowercase), all text in it, and kind (tøj, produkt, dokument, kvittering, skærmbillede, seddel, mad, sted, person, andet).',
    input_schema: obj({ photos: { type: 'array', items: obj({ index: num('0 for the first attached picture'), title: str(''), description: str(''), tags: { type: 'array', items: { type: 'string' } }, text: str(''), kind: str(''), note: str('optional: what the user said about it') }, ['title']) } }, ['photos']),
  },
  {
    name: 'my_writing_style',
    description: 'How the user writes: what they have said about their style, and their own most recent sent mails (to the same person first, if given). Use before writing anything in the user\'s name.',
    input_schema: obj({ to: str('optional: e-mail address of the person the text is for') }, []),
  },
  {
    name: 'add_reminder',
    description: 'Put something on the huskeliste ("husk mig på …", "mind mig om …", "jeg skal huske at …"). With a date and time the user gets a notification on the iPhone and the Mac then. Write the text as what to do, short ("Levere udstyr tilbage til Sigge"), without the time. A time without a day is today (tomorrow if it has passed). Use this, not the calendar, for things to remember to do.',
    input_schema: obj({
      text: str('what to remember to do'),
      date: str('optional day, YYYY-MM-DD'),
      time: str('optional time, HH:MM (Danish time)'),
    }, ['text']),
  },
  {
    name: 'complete_reminder',
    description: 'Tick something on the huskeliste off as done (or not done again), by id from Huskeliste in the context. "Jeg har afleveret udstyret" → tick it off.',
    input_schema: obj({ id: str('the reminder id'), done: { type: 'boolean', description: 'false to open it again; default true' } }, ['id']),
  },
  {
    name: 'find_items',
    description: 'Find anything in CENTRA by words, of any kind (tally = regnestykke, outlay = udlæg, person = kontakt, memory = hukommelse …). Gives id, kind and a summary, for update_item or delete_items. Empty query = the newest.',
    input_schema: obj({
      query: str('words to look for (names, titles, amounts, text); empty = newest'),
      kinds: { type: 'array', items: { type: 'string', enum: KIND_KEYS }, description: 'which kinds to look in; omit for all except mail' },
      limit: num('max results, default 20'),
    }),
  },
  {
    name: 'get_item',
    description: 'Everything stored about one thing (all fields; a note\'s text; a regnestykke\'s lines with who owes whom), by id. Use before update_item when you need the current values.',
    input_schema: obj({ id: str('the id') }, ['id']),
  },
  {
    name: 'update_item',
    description: 'Change anything in CENTRA by id: set any fields to new values (same names and shapes as get_item shows). A note\'s text: field "body" replaces the whole text. A regnestykke: give "lines" in the same form as get_item (kind expense|income|gift, by me|person, whose both|me|person). Set a field to null to clear it. Can be undone.',
    input_schema: obj({ id: str('the id'), fields: { type: 'object', description: 'field name → new value' } }, ['id', 'fields']),
  },
  {
    name: 'delete_items',
    description: 'Delete anything in CENTRA by id, one or many. Can be undone with one click, so just do it; ask first only if unclear or more than 10 things.',
    input_schema: obj({ ids: { type: 'array', items: { type: 'string' }, description: 'the ids to delete' } }, ['ids']),
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
      const id = e.create('note', { title: String(input.title), folder: cleanPath(input.folder ?? '') || 'Indbakke', tags: (input.tags ?? []).map((t: string) => String(t).replace(/^#/, '').toLowerCase()), editedAt: nowIso(), createdAt: nowIso(), by: 'Assist' });
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
      const cat = input.kind ? typeForName(e, String(input.kind)) : /arbejd|vagt|netto/i.test(`${input.title} ${input.calendar ?? ''}`) ? typeForName(e, 'Arbejde') : 'calcat-personal';
      const id = e.create('event', { title: String(input.title), start: s.toISOString(), end: en.toISOString(), place: input.place, cal: input.calendar ?? (repeat ? 'Faste' : 'Privat'), cat, ...(repeat ? { repeat } : {}), by: 'Assist' });
      if (typeof input.notes === 'string' && input.notes.trim()) setEventNotes(e, id, input.notes.trim());
      if (Number.isFinite(Number(input.alert_minutes)) && input.alert_minutes !== null && input.alert_minutes !== undefined) e.set('event', id, { alert: Math.max(0, Math.round(Number(input.alert_minutes))) });
      const when = repeat ? `${repeatLabel(repeat)} ${input.start_time}–${input.end_time}` : `${new Date(date + 'T12:00').toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' })} ${input.start_time}–${input.end_time}`;
      return { result: { ok: true, id }, action: { label: `I kalenderen: ${input.title}, ${when}`, undo: { kind: 'remove', type: 'event', id }, open: { screen: 'calendar' } } };
    }
    case 'set_alarm': {
      const days = (input.days ?? []).map((d: string) => DAYS[String(d).slice(0, 3).toLowerCase()]).filter((d: number | undefined) => d !== undefined);
      const id = addAlarm(e, String(input.time ?? '').replace('.', ':'), days, String(input.label ?? ''));
      const t = String((e.get(id) as any).time);
      return { result: { ok: true, id, when: `${t} · ${daysLabel(days)}` }, action: { label: `Vækkeur ${t.replace(':', '.')} · ${daysLabel(days)}`, undo: { kind: 'remove', type: 'alarm', id }, open: { screen: 'reminders' } } };
    }
    case 'event_notes': {
      const ev = e.get(String(input.event_id)) as any;
      if (!ev || ev.type !== 'event') throw new Error('Fandt ikke aftalen');
      const before = eventNotes(e, ev.id);
      if (input.mode === 'replace') setEventNotes(e, ev.id, String(input.text ?? '')); else appendEventNotes(e, ev.id, String(input.text ?? ''));
      return { result: { ok: true, notes: eventNotes(e, ev.id).slice(0, 1500) }, action: { label: `Noter på ${ev.title}`, undo: { kind: 'noteText', id: ev.id, text: before, field: NOTES }, open: { screen: 'calendar' } } };
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
      const kind = ['once', 'milestones', 'count', 'measure', 'habit'].includes(input.kind) ? input.kind : 'once';
      const f: Record<string, unknown> = { title: String(input.title), kind, area: input.area ?? 'Privat', order, start: dayKey(new Date()), by: 'Assist', status: 'active' };
      if (input.due) f.due = ymd(input.due);
      if (input.why) f.why = String(input.why);
      if (input.next) f.next = String(input.next);
      if (kind === 'measure') { f.target = Number(input.target ?? 1); f.unit = input.unit ?? ''; }
      if (kind === 'count') { f.target = Math.max(1, Math.round(Number(input.target ?? 1))); f.each = String(input.each ?? ''); f.period = ['year', 'month', 'week', 'total'].includes(input.period) ? input.period : input.due ? 'total' : 'year'; }
      if (kind === 'habit') f.perWeek = Number(input.per_week ?? input.target ?? 1);
      if (kind === 'milestones' || kind === 'once') f.steps = (input.steps ?? []).map((st: string) => [String(st), false]);
      const id = e.create('goal', f);
      return { result: { ok: true, id }, action: { label: `Nyt mål: ${input.title}`, undo: { kind: 'remove', type: 'goal', id }, open: { screen: 'goals', id } } };
    }
    case 'update_goal': {
      const g = e.get(input.goal_id) as any;
      if (!g || g.type !== 'goal') throw new Error('Ukendt mål');
      const before: Record<string, unknown> = {};
      const f: Record<string, unknown> = {};
      const put = (k: string, v: unknown) => { before[k] = g[k] ?? ''; f[k] = v; };
      for (const k of ['title', 'unit', 'each', 'area', 'why', 'next']) if (typeof input[k] === 'string' && input[k].trim()) put(k, input[k].trim());
      if (Number(input.target) > 0) put('target', Number(input.target));
      if (input.period) put('period', input.period);
      if (input.due !== undefined) put('due', input.due ? ymd(input.due) : '');
      if (input.status) { put('status', input.status); if (input.status === 'done') put('doneAt', nowIso()); }
      if (input.add_steps?.length || input.remove_steps?.length) {
        const rm = (input.remove_steps ?? []).map((x: string) => x.toLowerCase());
        put('steps', [...(g.steps ?? []).filter(([st]: [string, boolean]) => !rm.includes(st.toLowerCase())), ...(input.add_steps ?? []).map((x: string) => [String(x), false])]);
      }
      if (!Object.keys(f).length) throw new Error('Intet at ændre');
      e.set('goal', g.id, f);
      return { result: { ok: true }, action: { label: `${f.title ?? g.title}: ${input.status === 'done' ? 'fuldført' : input.status === 'paused' ? 'sat på pause' : 'opdateret'}`, undo: { kind: 'restore', type: 'goal', id: g.id, fields: before }, open: { screen: 'goals', id: g.id } } };
    }
    case 'log_goal_progress': {
      const g = e.get(input.goal_id) as any;
      if (!g || g.type !== 'goal') throw new Error('Ukendt mål');
      const at = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? new Date(input.date + 'T12:00').toISOString() : nowIso();
      if (input.step_done && (g.kind === 'milestones' || g.kind === 'once')) {
        const steps = (g.steps as [string, boolean][] ?? []).map(([st, d]) => [st, d || st.toLowerCase() === String(input.step_done).toLowerCase()] as [string, boolean]);
        e.set('goal', g.id, { steps });
        return { result: { ok: true }, action: { label: `${g.title}: "${input.step_done}" er klaret`, undo: { kind: 'restore', type: 'goal', id: g.id, fields: { steps: g.steps } }, open: { screen: 'goals', id: g.id } } };
      }
      if (g.kind === 'once' && (input.done || !g.steps?.length)) {
        e.set('goal', g.id, { status: 'done', doneAt: at });
        return { result: { ok: true }, action: { label: `${g.title}: gjort`, undo: { kind: 'restore', type: 'goal', id: g.id, fields: { status: g.status ?? 'active', doneAt: g.doneAt ?? '' } }, open: { screen: 'goals', id: g.id } } };
      }
      const amount = Number(input.amount ?? 1) || 1;
      const id = e.create('goalUpdate', { goal: g.id, at, delta: amount, text: input.note ?? (g.kind === 'count' ? g.each ?? '' : ''), src: 'Via Assist' });
      const st = goalStats(e.get(g.id) as unknown as Goal, e.list('goalUpdate') as unknown as GoalUpdate[]);
      return { result: { ok: true, id, progress: st.label, left: st.left }, action: { label: `${g.title}: ${g.kind === 'count' || g.kind === 'habit' ? `+${amount} ${amount === 1 ? 'gang' : 'gange'}` : `+${amount.toLocaleString('da-DK')} ${g.unit ?? ''}`.trim()} · ${st.label}`, undo: { kind: 'remove', type: 'goalUpdate', id }, open: { screen: 'goals', id: g.id } } };
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
      const fs = folders(e);
      const fsel = input.folder ? (String(input.folder).toLowerCase() === 'inbox' ? '' : (fs.find((f) => f.id === input.folder) ?? folderByName(e, String(input.folder)))?.id ?? '-none-') : null;
      const hits = (e.list('mail') as any[]).filter((m) => !m.archived && (!input.only_needs_reply || m.needsReply) && (!since || new Date(m.at).getTime() >= since) && (fsel === null || (m.mbox ?? '') === fsel)
        && q.every((w) => `${m.fromName} ${m.fromEmail} ${m.subject} ${m.body ?? m.preview}`.toLowerCase().includes(w)))
        .sort((a, b) => b.at.localeCompare(a.at)).slice(0, Math.min(100, Number(input.limit) || 15))
        .map((m) => ({ id: m.id, ...(m.sent ? { sent_by_you_to: m.to } : { from: `${m.fromName} <${m.fromEmail}>` }), subject: m.subject, at: m.at, account: m.acctName, folder: m.mbox ? fs.find((f) => f.id === m.mbox)?.name : undefined, unread: !!m.unread, needsReply: !!m.needsReply, preview: m.preview }));
      return { result: hits.length ? hits : 'Ingen mails fundet.' };
    }
    case 'read_mail': {
      const ids: string[] = [...new Set([...(Array.isArray(input.mail_ids) ? input.mail_ids : []), ...(input.mail_id ? [input.mail_id] : [])].map(String))].slice(0, 10);
      if (!ids.length) throw new Error('Angiv mail_id eller mail_ids');
      const read = (id: string) => {
        const m = e.get(id) as any;
        if (!m || m.type !== 'mail') return { id, error: 'Ukendt mail' };
        const text = fullText(m, fetchedHtml.get(id));
        return { id, from: m.sent ? 'dig (sendt)' : `${m.fromName} <${m.fromEmail}>`, to: m.to, cc: m.cc, subject: m.subject, at: m.at, account: m.acctName, attachments: m.attachments,
          text: text.length > 40_000 ? text.slice(0, 40_000) + '\n… (resten af en meget lang mail er udeladt)' : text };
      };
      return { result: ids.length === 1 && input.mail_id && !input.mail_ids ? read(ids[0]) : ids.map(read) };
    }
    case 'organize_notes': {
      const steps: Undo[] = [];
      const done: string[] = [];
      for (const p of (Array.isArray(input.create_folders) ? input.create_folders : []).map(String)) {
        const before = (e.list('notefolder') as any[]).map((f) => f.id);
        const path = createNoteFolder(e, p);
        const made = (e.list('notefolder') as any[]).find((f) => !before.includes(f.id));
        if (made) steps.push({ kind: 'remove', type: 'notefolder', id: made.id });
        done.push(`mappe ${path}`);
      }
      for (const m of Array.isArray(input.move) ? input.move : []) {
        const n = e.get(m.note_id) as any;
        if (!n || n.type !== 'note') continue;
        const to = cleanPath(m.folder) || 'Indbakke';
        steps.push({ kind: 'restore', type: 'note', id: n.id, fields: { folder: n.folder ?? 'Indbakke' } });
        e.set('note', n.id, { folder: to });
        done.push(`${n.title || 'note'} → ${to}`);
      }
      if (input.rename_folder?.from && input.rename_folder?.to) {
        const undo = renameNoteFolder(e, input.rename_folder.from, input.rename_folder.to);
        for (const u of undo) steps.push({ kind: 'restore', type: u.type, id: u.id, fields: u.fields });
        done.push(`${input.rename_folder.from} → ${input.rename_folder.to}`);
      }
      for (const t of Array.isArray(input.tags) ? input.tags : []) {
        const n = e.get(t.note_id) as any;
        if (!n || n.type !== 'note') continue;
        steps.push({ kind: 'restore', type: 'note', id: n.id, fields: { tags: n.tags ?? [] } });
        e.set('note', n.id, { tags: [...new Set((t.tags ?? []).map((x: string) => String(x).replace(/^#/, '').trim().toLowerCase()).filter(Boolean))] });
        done.push(`tags på ${n.title || 'note'}`);
      }
      for (const pn of Array.isArray(input.pin) ? input.pin : []) {
        const n = e.get(pn.note_id) as any;
        if (!n || n.type !== 'note') continue;
        steps.push({ kind: 'restore', type: 'note', id: n.id, fields: { pinned: !!n.pinned } });
        e.set('note', n.id, { pinned: !!pn.pinned });
      }
      if (!steps.length && !done.length) throw new Error('Intet at gøre');
      return { result: { ok: true, done }, action: { label: `Noter ordnet: ${done.slice(0, 4).join(', ')}${done.length > 4 ? ` og ${done.length - 4} mere` : ''}`, undo: { kind: 'many', steps }, open: { screen: 'notes' } } };
    }
    case 'create_mail_folder': {
      const name = String(input.name ?? '').trim();
      if (!name) throw new Error('Mappen skal have et navn');
      if (folderByName(e, name)) throw new Error(`Mappen "${name}" findes allerede (brug update_mail_folder)`);
      const rules = cleanRules(input.rules);
      const id = e.create('mailfolder', { name, description: String(input.description ?? '').trim(), rules, order: folders(e).length, createdAt: nowIso() });
      const before = (e.list('mail') as any[]).filter((m) => !m.mbox).map((m) => m.id);
      const moved = input.sort_existing ? sortByRules(e, undefined, id) : 0;
      const movedIds = before.filter((mid) => (e.get(mid) as any)?.mbox === id);
      return { result: { ok: true, id, moved }, action: { label: `Mailmappe: ${name}${moved ? ` · ${moved} mails flyttet` : ''}`, undo: { kind: 'many', steps: [{ kind: 'remove', type: 'mailfolder', id }, ...movedIds.map((mid) => ({ kind: 'restore', type: 'mail', id: mid, fields: { mbox: '' } }) as Undo)] }, open: { screen: 'inbox', id: 'folder:' + id } } };
    }
    case 'update_mail_folder': {
      const f = e.get(input.folder_id) as any;
      if (!f || f.type !== 'mailfolder') throw new Error('Ukendt mappe');
      const rules = input.clear_rules ? cleanRules(input.add_rules) : [...(f.rules ?? []), ...cleanRules(input.add_rules)];
      e.set('mailfolder', f.id, { ...(input.name ? { name: String(input.name).trim() } : {}), ...(input.description !== undefined ? { description: String(input.description).trim() } : {}), rules });
      const moved = input.sort_existing ? sortByRules(e, undefined, f.id) : 0;
      return { result: { ok: true, moved }, action: { label: `Mailmappe ${input.name ?? f.name} er opdateret${moved ? ` · ${moved} mails flyttet` : ''}`, undo: { kind: 'restore', type: 'mailfolder', id: f.id, fields: { name: f.name, description: f.description ?? '', rules: f.rules ?? [] } }, open: { screen: 'inbox', id: 'folder:' + f.id } } };
    }
    case 'delete_mail_folder': {
      const f = e.get(input.folder_id) as any;
      if (!f || f.type !== 'mailfolder') throw new Error('Ukendt mappe');
      const { id: _i, type: _t, ...fields } = f;
      const inIt = (e.list('mail') as any[]).filter((m) => m.mbox === f.id).map((m) => m.id);
      for (const mid of inIt) e.set('mail', mid, { mbox: '' });
      e.remove('mailfolder', f.id);
      return { result: { ok: true, back_in_inbox: inIt.length }, action: { label: `Mappen ${f.name} er slettet (${inIt.length} mails tilbage i indbakken)`, undo: { kind: 'many', steps: [{ kind: 'restore', type: 'mailfolder', id: f.id, fields: { ...fields, _deleted: false } }, ...inIt.map((mid) => ({ kind: 'restore', type: 'mail', id: mid, fields: { mbox: f.id } }) as Undo)] } } };
    }
    case 'move_mails': {
      const target = String(input.folder ?? '').trim();
      const f = target.toLowerCase() === 'inbox' || target.toLowerCase() === 'indbakke' ? null : (e.get(target) as any)?.type === 'mailfolder' ? e.get(target) as any : folderByName(e, target);
      if (!f && !['inbox', 'indbakke'].includes(target.toLowerCase())) throw new Error(`Ukendt mappe: ${target}`);
      const ids = (Array.isArray(input.mail_ids) ? input.mail_ids : []).map(String).filter((id: string) => (e.get(id) as any)?.type === 'mail').slice(0, 200);
      if (!ids.length) throw new Error('Ingen kendte mails at flytte');
      const before = moveToFolder(e, ids, f?.id ?? '');
      return { result: { ok: true, moved: ids.length }, action: { label: `${ids.length} ${ids.length === 1 ? 'mail' : 'mails'} flyttet til ${f?.name ?? 'Indbakke'}`, undo: { kind: 'many', steps: before.map((b) => ({ kind: 'restore', type: 'mail', id: b.id, fields: b.fields }) as Undo) }, open: { screen: 'inbox', id: f ? 'folder:' + f.id : undefined } } };
    }
    case 'create_tally': {
      const { id: pid, created } = findOrCreatePerson(e, String(input.person ?? ''));
      if (pid === ME || !String(input.person ?? '').trim()) throw new Error('Et regnestykke skal være med én anden person');
      let n = 0;
      const lines = toLines(input.lines, () => `l${Date.now().toString(36)}${n++}`);
      if (!lines.length) throw new Error('Ingen poster med beløb');
      const first = personName(e, pid).split(' ')[0];
      const id = e.create('tally', { title: String(input.title ?? '').trim() || `Regnestykke med ${first}`, date: /^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '') ? input.date : nowIso().slice(0, 10), person: pid, lines, createdAt: nowIso() });
      const t = e.get(id) as unknown as Tally;
      const net = tallyNet(t);
      const result = net > 0 ? `${first} skylder brugeren ${kr(net)}` : net < 0 ? `Brugeren skylder ${first} ${kr(-net)}` : 'De er kvit';
      return {
        result: { ok: true, id, result, lines: lines.map((l) => lineExplain(l, first)), total_now_between_them: (() => { const b = balances(e).find((x) => x.person === pid)?.left ?? 0, d = debts(e).find((x) => x.person === pid)?.left ?? 0; return b - d > 0 ? `${first} skylder brugeren ${kr(b - d)} i alt` : b - d < 0 ? `Brugeren skylder ${first} ${kr(d - b)} i alt` : 'kvit i alt'; })() },
        action: { label: `Regnestykke med ${first}: ${result.replace('brugeren', 'dig').replace('Brugeren', 'Du')}`, undo: { kind: 'many', steps: [{ kind: 'remove', type: 'tally', id }, ...(created ? [{ kind: 'remove', type: 'person', id: pid } as Undo] : [])] }, open: { screen: 'outlays', id } },
      };
    }
    case 'search_photos': {
      const hits = searchPhotos(e, String(input.query ?? ''), { from: input.from_date, to: input.to_date, limit: Math.min(20, Number(input.limit) || 8) });
      const day = (p: Photo) => new Date(p.takenAt || p.at).toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      return {
        result: hits.length ? hits.map((p) => ({ id: p.id, title: p.title, kind: p.kind, date: day(p), description: p.description, tags: p.tags, has_text: !!p.text, text_start: (p.text ?? '').slice(0, 200) })) : 'Ingen billeder fundet.',
        images: hits.slice(0, 3).map((p) => p.thumb).filter(Boolean),
        action: hits.length ? { label: `Fandt ${hits.length} ${hits.length === 1 ? 'billede' : 'billeder'}: ${hits.slice(0, 3).map((p) => p.title).join(', ')}`, open: { screen: 'photos', id: hits[0].id } } : undefined,
      };
    }
    case 'look_at_photos': {
      const ps: Photo[] = (Array.isArray(input.photo_ids) ? input.photo_ids : []).map((id: string) => e.get(String(id)) as unknown as Photo | null).filter((p: any): p is Photo => !!p && p.type === 'photo').slice(0, 4);
      if (!ps.length) throw new Error('Ukendte billeder');
      return { result: ps.map((p) => ({ id: p.id, title: p.title, date: (p.takenAt || p.at).slice(0, 10), description: p.description, text: p.text, note: p.note })), images: ps.map((p) => p.image) };
    }
    case 'save_attached_photos': {
      if (!attached.length) throw new Error('Der er ikke noget billede med i denne besked');
      const ids: string[] = [];
      for (const x of Array.isArray(input.photos) ? input.photos : []) {
        const img = attached[Math.max(0, Math.min(attached.length - 1, Number(x.index) || 0))];
        if (!img) continue;
        ids.push(storePhoto(e, { image: img, thumb: img, source: 'assist', note: x.note ?? '', analysis: { title: x.title, description: x.description, tags: x.tags, text: x.text, kind: x.kind } }));
      }
      if (!ids.length) throw new Error('Intet gemt');
      return { result: { ok: true, ids }, action: { label: `Gemt i Billeder: ${ids.map((id) => (e.get(id) as any)?.title).join(', ')}`, undo: { kind: 'removeMany', type: 'photo', ids }, open: { screen: 'photos', id: ids[0] } } };
    }
    case 'add_reminder': {
      let at: Date | null = null;
      if (input.time || input.date) {
        const t = /^\d{1,2}[:.]\d{2}$/.test(String(input.time ?? '')) ? String(input.time).replace('.', ':').padStart(5, '0') : '09:00';
        const today = new Date();
        const day = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date ?? '')) ? String(input.date) : `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        at = new Date(`${day}T${t}`);
        if (isNaN(at.getTime())) throw new Error('Ukendt tidspunkt: brug YYYY-MM-DD og HH:MM');
        if (!input.date && at <= today) at.setDate(at.getDate() + 1);
      }
      const id = addReminder(e, String(input.text ?? ''), at);
      const when = at ? whenLabel(at.toISOString()) : '';
      return { result: { ok: true, id, at: at?.toISOString() ?? null, when: when || 'uden tidspunkt' }, action: { label: `Husk: ${input.text}${when ? ' · ' + when : ''}`, undo: { kind: 'remove', type: 'reminder', id }, open: { screen: 'reminders' } } };
    }
    case 'complete_reminder': {
      const r = e.get(String(input.id)) as any;
      if (!r || r.type !== 'reminder') throw new Error('Fandt ikke punktet på huskelisten');
      const done = input.done !== false;
      setDone(e, r.id, done);
      return { result: { ok: true }, action: { label: `${done ? 'Klaret' : 'Åbnet igen'}: ${r.text}`, undo: { kind: 'restore', type: 'reminder', id: r.id, fields: { done: !!r.done, doneAt: r.doneAt ?? null } }, open: { screen: 'reminders' } } };
    }
    case 'find_items': {
      const words = String(input.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const kinds: string[] = (input.kinds?.length ? input.kinds : KIND_KEYS.filter((k) => k !== 'mail')).filter((k: string) => KINDS[k]);
      const limit = Math.min(100, Math.max(1, Number(input.limit) || 20));
      const found: { id: string; kind: string; summary: string; when: string }[] = [];
      for (const k of kinds) for (const r of e.list(k) as any[]) {
        const hay = (JSON.stringify(r) + (k === 'note' ? ' ' + e.doc(r.id).getText('body').toString() : k === 'event' && r.notesPreview ? ' ' + eventNotes(e, r.id) : '') + (r.person ? ' ' + personName(e, r.person) : '')).toLowerCase();
        if (words.every((w) => hay.includes(w))) found.push({ id: r.id, kind: KINDS[k], summary: summary(e, r), when: String(r.editedAt ?? r.createdAt ?? r.at ?? r.date ?? r.start ?? '') });
      }
      found.sort((a, b) => b.when.localeCompare(a.when));
      return { result: { count: found.length, items: found.slice(0, limit).map(({ when: _w, ...x }) => x) } };
    }
    case 'get_item': {
      const r = e.get(String(input.id)) as any;
      if (!r) throw new Error('Findes ikke (måske allerede slettet)');
      const out: Record<string, unknown> = { ...r, kind: KINDS[r.type] ?? r.type };
      if (r.type === 'note') out.body = e.doc(r.id).getText('body').toString();
      if (r.type === 'event') { out.notes = eventNotes(e, r.id); delete out.notesPreview; }
      if (r.type === 'tally') { out.person_name = personName(e, r.person); out.net = tallyNet(r as Tally); out.lines_explained = (r.lines ?? []).map((l: any) => lineExplain(l, personName(e, r.person))); }
      if (r.person && r.type !== 'tally') out.person_name = personName(e, r.person);
      for (const k of ['image', 'thumb', 'html']) if (typeof out[k] === 'string' && (out[k] as string).length > 400) out[k] = `(${Math.round((out[k] as string).length / 1000)} kB, ikke vist)`;
      return { result: out };
    }
    case 'update_item': {
      const r = e.get(String(input.id)) as any;
      if (!r) throw new Error('Findes ikke (måske slettet)');
      const fields = { ...(input.fields ?? {}) } as Record<string, unknown>;
      for (const k of ['id', 'type', '_deleted']) delete fields[k];
      const steps: Undo[] = [];
      if (r.type === 'note' && typeof fields.body === 'string') {
        const t = e.doc(r.id).getText('body');
        steps.push({ kind: 'noteText', id: r.id, text: t.toString() });
        e.doc(r.id).transact(() => { t.delete(0, t.length); t.insert(0, fields.body as string); });
        delete fields.body;
        fields.editedAt = nowIso();
      }
      if (r.type === 'event' && typeof fields.notes === 'string') {
        steps.push({ kind: 'noteText', id: r.id, text: eventNotes(e, r.id), field: NOTES });
        setEventNotes(e, r.id, fields.notes as string);
        delete fields.notes;
      }
      if (r.type === 'tally' && Array.isArray(fields.lines)) fields.lines = toLines((fields.lines as any[]).map((l) => ({ ...l, by: l.by === 'mig' ? 'me' : l.by, whose: l.whose === 'begge' ? 'both' : l.whose === 'mig' ? 'me' : l.whose })), () => Math.random().toString(36).slice(2, 10), r.lines ?? []);
      const prev = Object.fromEntries(Object.keys(fields).map((k) => [k, r[k] ?? null]));
      if (Object.keys(fields).length) { e.set(r.type, r.id, fields); steps.push({ kind: 'restore', type: r.type, id: r.id, fields: prev }); }
      const what = `${KINDS[r.type] ?? r.type} ${r.title || r.name || r.subject || r.statement || ''}`.trim();
      return { result: { ok: true, changed: Object.keys(fields).concat(steps.some((x) => x.kind === 'noteText') ? ['body'] : []) }, action: { label: `Rettet: ${what}`, undo: { kind: 'many', steps } } };
    }
    case 'delete_items': {
      const ids: string[] = (input.ids ?? []).map(String);
      const steps: Undo[] = [], names: string[] = [], missing: string[] = [];
      for (const id of ids) {
        const r = e.get(id) as any;
        if (!r) { missing.push(id); continue; }
        const { id: _i, type: _t, ...fields } = r;
        e.remove(r.type, id);
        steps.push({ kind: 'restore', type: r.type, id, fields: { ...fields, _deleted: false } });
        names.push(`${KINDS[r.type] ?? r.type} ${r.title || r.name || r.subject || r.statement || ''}`.trim());
      }
      if (!steps.length) throw new Error('Fandt intet at slette (allerede slettet?)');
      return { result: { ok: true, deleted: steps.length, missing }, action: { label: `Slettet: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` og ${names.length - 3} mere` : ''}`, undo: { kind: 'many', steps } } };
    }
    case 'my_writing_style': {
      const to = String(input.to ?? '').toLowerCase();
      const said = e.list('memory').filter((m: any) => m.kind === 'Skrivestil').map((m: any) => m.statement);
      const own = (t: string) => t.split(/\n(?:>|Den .{3,80} skrev.{0,80}:|On .{3,120} wrote.{0,80}:|-----Original|Fra: |From: )/)[0].trim();
      const sent = (e.list('mail') as any[]).filter((m) => m.sent && String(m.body ?? '').trim()).sort((a, b) => b.at.localeCompare(a.at));
      const pick = [...sent.filter((m) => to && (m.to ?? []).some((x: string) => x.toLowerCase() === to)), ...sent].filter((m, i, a) => a.indexOf(m) === i).slice(0, 6);
      return { result: { what_the_user_said: said.length ? said : '(intet endnu)', recent_sent: pick.map((m) => ({ to: (m.to ?? []).join(', '), subject: m.subject, text: own(String(m.body)).slice(0, 700) })) } };
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

const cleanRules = (x: unknown): FolderRule[] => (Array.isArray(x) ? x : []).map((r: any) => ({ from: String(r?.from ?? '').trim(), subject: String(r?.subject ?? '').trim(), words: String(r?.words ?? '').trim() })).filter((r) => r.from || r.subject || r.words);

export function applyUndo(e: SyncEngine, u: Undo) {
  if (u.kind === 'remove') e.remove(u.type, u.id);
  else if (u.kind === 'restore') e.set(u.type, u.id, u.fields);
  else if (u.kind === 'removeMany') for (const id of u.ids) e.remove(u.type, id);
  else if (u.kind === 'many') for (const st of [...u.steps].reverse()) applyUndo(e, st);
  else if (u.field === NOTES) setEventNotes(e, u.id, u.text);
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
    return `- [${g.id}] ${g.title} (${g.kind}${g.kind === 'count' && g.each ? ': ' + g.each : ''}${(g.kind === 'milestones' || g.kind === 'once') && g.steps?.length ? ': ' + (g.steps ?? []).map(([n, d]) => (d ? '✓' : '○') + n).join(', ') : ''}) · ${s.label}${g.due ? ' · frist ' + g.due : ''}${g.status && g.status !== 'active' ? ' · ' + g.status : ''}${g.area ? ' · ' + g.area : ''}${g.next ? ' · næste: ' + g.next : ''}`;
  });
  const notes = e.list('note').sort((a: any, b: any) => (b.editedAt ?? '').localeCompare(a.editedAt ?? '')).slice(0, 15).map((n: any) => `- [${n.id}] ${n.title || 'Uden titel'} (${n.folder ?? ''})${(n.tags ?? []).length ? ' ' + n.tags.map((t: string) => '#' + t).join(' ') : ''}`);
  const flat = (ns: ReturnType<typeof folderTree>): string[] => ns.flatMap((f) => [`${f.path} (${f.total})`, ...flat(f.children)]);
  const noteFolders = flat(folderTree(e));
  const all = e.list('event') as unknown as CalEvent[];
  const fixed = all.filter((x) => x.repeat).map((x) => { const d = evDef(x); return `- [${d.id}] ${d.title}: ${d.when}${x.repeat?.skip?.length ? ' (aflyst: ' + x.repeat.skip.join(', ') + ')' : ''}`; });
  const end = new Date(now); end.setDate(end.getDate() + 8);
  const soon = occurrences(all.filter((x) => !x.repeat), now, end).map((x) => { const l = evLine(x); const np = (x as any).notesPreview as string | undefined; return `- [${l.id}] ${l.day} ${l.time} ${l.title}${l.place ? ' · ' + l.place : ''}${np ? ` · noter: ${np.slice(0, 80)}${np.length > 80 ? '…' : ''}` : ''}`; });
  const remind = sortedReminders(e.list('reminder') as unknown as Reminder[]).filter((r) => !r.done).slice(0, 40).map((r) => `- [${r.id}] ${r.text}${r.at ? ' · ' + whenLabel(r.at, now) : ''}`);
  const watches = e.list('watch').filter((w: any) => w.active).map((w: any) => `- [${w.id}] ${w.description}`);
  const accts = e.list('mailacct').map((a: any) => `${a.name} (${a.email})`);
  const mails = (e.list('mail') as any[]).filter((m) => !m.archived && !m.sent);
  const waiting = mails.filter((m) => m.needsReply).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8).map((m) => `- [${m.id}] ${m.fromName}: ${m.subject} (${String(m.at).slice(0, 10)})`);
  const mailInfo = accts.length ? [`Forbundne konti: ${accts.join(', ')}. ${mails.length} mails i indbakken, ${mails.filter((m) => m.unread).length} ulæste. Brug search_mail og read_mail til resten.`, ...(waiting.length ? ['Venter på svar:', ...waiting] : [])] : ['Ingen mailkonti forbundet endnu (det gøres under Forbindelser).'];
  // Only the people closest to you by name and relation; the rest (and all details) via find_contact. Keeps every question cheap.
  const everyone = people(e) as Person[];
  const close = everyone.filter((p) => p.relation && !['Bekendt', 'Andet'].includes(p.relation)).sort((a, b) => a.name.localeCompare(b.name, 'da')).slice(0, 30);
  const contacts = [...close.map((p) => `- [${p.id}] ${p.name} (${p.relation})`), ...(everyone.length > close.length ? [`(${everyone.length} kontakter i alt. Brug find_contact for at finde andre og for detaljer som telefon, mail og noter.)`] : [])];
  const owing = [
    ...balances(e).filter((b) => b.left > 0).map((b) => `- ${personName(e, b.person)} skylder brugeren ${kr(b.left)}`),
    ...debts(e).filter((b) => b.left > 0).map((b) => `- Brugeren skylder ${personName(e, b.person)} ${kr(b.left)}`),
  ];
  const xs = (e.list('expense') as unknown as Expense[]).filter((x) => x.active !== false);
  const money = xs.length ? [`Faste udgifter: ${kr(xs.reduce((s, x) => s + perMonth(x), 0), { short: true })} pr. måned fordelt på ${xs.length} poster (brug list_expenses).`] : [];
  const sec = (t: string, l: string[], empty: string) => `## ${t}\n${l.length ? l.join('\n') : empty}`;
  const style = e.list('memory').filter((m: any) => m.kind === 'Svarstil').map((m: any) => `- ${m.statement}`);
  const fb = (e.list('feedback') as any[]).sort((a, b) => b.at.localeCompare(a.at));
  const liked = fb.filter((f) => f.rating === 'up' && f.reply).slice(0, 2).map((f) => `- Spørgsmål: "${String(f.question ?? '').slice(0, 100)}" → svar brugeren kunne lide: "${String(f.reply).replace(/\s+/g, ' ').slice(0, 240)}"`);
  const disliked = fb.filter((f) => f.rating === 'down' && !f.note).slice(0, 2).map((f) => `- Svar brugeren IKKE kunne lide: "${String(f.reply ?? '').replace(/\s+/g, ' ').slice(0, 200)}"`);
  return [
    sec('Sådan vil brugeren have dine svar (følg det altid)', [...style, ...liked, ...disliked], '(intet endnu: kort, venligt og direkte)'),
    sec('Det ved du om brugeren', memory.filter((l) => !/\(Svarstil\)/.test(l)), '(intet endnu — brugeren er ny, så lær dem at kende)'),
    sec('Faste aftaler', fixed, '(ingen)'),
    sec('Enkeltaftaler de næste 8 dage', soon, '(ingen)'),
    sec('Huskeliste (ikke klaret)', remind, '(tom)'),
    sec('Mål', goals, '(ingen)'),
    sec('Notemapper', noteFolders.length ? [noteFolders.join(' · ')] : [], '(kun Indbakke)'),
    sec('Kalendertyper', [calTypes(e).map((t) => t.name).join(' · ')], ''),
    sec('Seneste noter', notes, '(ingen)'),
    sec('Kontakter (brug find_contact for detaljer)', contacts, '(ingen endnu)'),
    sec('Udlæg: skylder brugeren penge', owing, '(ingen)'),
    sec('Udgifter', money, '(ingen registreret)'),
    sec('Mail', mailInfo, ''),
    sec('Mailmapper (sorterer nye mails af sig selv)', folders(e).map((f) => `- [${f.id}] ${f.name}: ${(e.list('mail') as any[]).filter((m) => m.mbox === f.id && !m.archived).length} mails${f.description ? ' · ' + f.description : ''}${(f.rules ?? []).length ? ' · regler: ' + (f.rules ?? []).map((r) => [r.from && 'fra ' + r.from, r.subject && 'emne ' + r.subject, r.words && 'ord ' + r.words].filter(Boolean).join(' & ')).join(' | ') : ''}`), '(ingen endnu)'),
    sec('Mail-overvågninger', watches, '(ingen)'),
    sec('Gemte billeder', (() => { const ps = e.list('photo') as any[]; return ps.length ? [`${ps.length} billeder (brug search_photos). Seneste: ${ps.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')).slice(0, 5).map((p) => `${p.title} (${String(p.takenAt || p.at).slice(0, 10)})`).join(', ')}`] : []; })(), '(ingen endnu)'),
  ].join('\n\n');
}
