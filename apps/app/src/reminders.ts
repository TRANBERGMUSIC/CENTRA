/**
 * Huskelisten: things to remember to do, with or without a time ("levere udstyr tilbage til Sigge
 * kl. 12"). One with a time gives a notification then, on the iPhone (planned with the system, so it
 * comes even when CENTRA is closed) and on the Mac (while the app is open). Tick it off when done.
 * Made by hand, by Assist, or by Siri ("Hey Siri, husk i CENTRA").
 */
import type { SyncEngine } from '@centra/sync';

export type Reminder = { id: string; type: 'reminder'; text: string; at?: string | null; done?: boolean; doneAt?: string | null; createdAt: string; source?: string };

export function addReminder(e: SyncEngine, text: string, at?: Date | string | null, source?: string): string {
  const clean = text.trim().replace(/\s+/g, ' ').slice(0, 300);
  if (!clean) throw new Error('Skriv, hvad du skal huske');
  const when = at ? new Date(at) : null;
  if (when && isNaN(when.getTime())) throw new Error('Ukendt tidspunkt');
  return e.create('reminder', { text: clean, at: when ? when.toISOString() : null, done: false, createdAt: new Date().toISOString(), ...(source ? { source } : {}) });
}

export function setDone(e: SyncEngine, id: string, done: boolean) {
  e.set('reminder', id, { done, doneAt: done ? new Date().toISOString() : null });
}

/** Open ones first: those with a time by time, then the rest newest first; done ones last, newest first. */
export function sorted(list: Reminder[]): Reminder[] {
  const open = list.filter((r) => !r.done), done = list.filter((r) => r.done);
  open.sort((a, b) => (a.at ? 0 : 1) - (b.at ? 0 : 1) || (a.at && b.at ? a.at.localeCompare(b.at) : b.createdAt.localeCompare(a.createdAt)));
  done.sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  return [...open, ...done];
}

export const reminders = (e: SyncEngine) => sorted(e.list('reminder') as unknown as Reminder[]);

export const overdue = (r: Reminder, now = new Date()) => !r.done && !!r.at && new Date(r.at) <= now;

/** "i dag kl. 12.00", "i morgen kl. 9.30", "fre. 7. nov. kl. 14.00", "for 2 timer siden" */
export function whenLabel(at: string, now = new Date()): string {
  const d = new Date(at);
  const hm = d.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86400000);
  const ago = now.getTime() - d.getTime();
  if (ago > 0 && ago < 3600_000) return `for ${Math.max(1, Math.round(ago / 60000))} min. siden`;
  if (diff === 0) return `i dag kl. ${hm}`;
  if (diff === 1) return `i morgen kl. ${hm}`;
  if (diff === -1) return `i går kl. ${hm}`;
  const same = d.getFullYear() === now.getFullYear();
  return `${d.toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short', ...(same ? {} : { year: 'numeric' }) })} kl. ${hm}`;
}

/** A stable small number for the system's notification id (it wants a 32-bit integer). */
export function notifyId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 1) || 1;
}

/** The reminders the system should have planned: open, with a time in the future (the next 60, iOS keeps 64). */
export function toPlan(list: Reminder[], now = new Date()) {
  return list.filter((r) => !r.done && r.at && new Date(r.at) > now).sort((a, b) => a.at!.localeCompare(b.at!)).slice(0, 60)
    .map((r) => ({ id: notifyId(r.id), key: `${r.at}|${r.text}`, at: r.at!, text: r.text }));
}
