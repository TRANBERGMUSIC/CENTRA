/**
 * Notes on a calendar event: flight tickets, booking numbers, the plan for the day, a packing list.
 * They live with the event (its own synced text, Markdown like the notes), not as a note in Noter.
 * The event keeps a short plain preview (`notesPreview`), so the calendar can show that there are
 * notes, and what they start with, without opening every event's text.
 */
import type { SyncEngine } from '@centra/sync';
import { plainText } from './notes.ts';

export const NOTES = 'notes';

export const eventNotes = (e: SyncEngine, id: string) => e.doc(id).getText(NOTES).toString();

/** Updates the event's preview from its notes (call after editing). */
export function stampNotes(e: SyncEngine, id: string) {
  if (!e.get(id)) return;
  // (empty list items, like the one Enter leaves at the end of a checklist, don't count)
  const preview = plainText(eventNotes(e, id)).split('\n').filter((l) => !/^\s*[☐☑•]?\s*$/.test(l)).join(' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (((e.get(id) as any).notesPreview ?? '') !== preview) e.set('event', id, { notesPreview: preview || null });
}

export function setEventNotes(e: SyncEngine, id: string, text: string) {
  const t = e.doc(id).getText(NOTES);
  e.doc(id).transact(() => { t.delete(0, t.length); t.insert(0, text); });
  stampNotes(e, id);
}

/** Adds to the end, on its own line(s). */
export function appendEventNotes(e: SyncEngine, id: string, text: string) {
  const cur = eventNotes(e, id);
  const add = text.trim();
  if (!add) return;
  const t = e.doc(id).getText(NOTES);
  t.insert(t.length, (cur.trim() ? (cur.endsWith('\n') ? '\n' : '\n\n') : '') + add);
  stampNotes(e, id);
}
