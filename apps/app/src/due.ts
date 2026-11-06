/**
 * Everything that should tell you something at a time: reminders on the huskeliste, alerts before
 * calendar events ("15 min før"), alarms (vækkeure), and deadlines on board cards. One list, used three ways:
 *  - the relay sends them as push to the iPhone (push.ts), also with every app closed,
 *  - the iPhone plans them itself when the relay can't push (reminderAlerts.ts),
 *  - the Mac shows them while CENTRA runs (it keeps running with the window closed).
 */
import type { SyncEngine } from '@centra/sync';
import { reminders } from './reminders.ts';
import { occurrences, type CalEvent } from './calendar.ts';

export type DueItem = { id: string; at: number; title: string; body: string; kind: 'reminder' | 'event' | 'alarm' | 'card'; ref: string };

/** Minutes before an event, as offered in the event editor (null = no alert). */
export const ALERTS: [number | null, string][] = [[null, 'Ingen'], [0, 'Når den starter'], [5, '5 min før'], [15, '15 min før'], [30, '30 min før'], [60, '1 time før'], [120, '2 timer før'], [1440, '1 dag før']];
export const alertLabel = (m: number | null | undefined) => ALERTS.find(([v]) => v === (m ?? null))?.[1] ?? `${m} min før`;

export type Alarm = { id: string; type: 'alarm'; time: string; days: number[]; label?: string; on: boolean };

const hm = (d: Date) => d.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
function before(m: number) {
  if (m === 0) return 'Nu';
  if (m < 60) return `Om ${m} min`;
  if (m < 1440) return `Om ${m / 60 === 1 ? 'en time' : `${m / 60} timer`}`;
  return 'I morgen';
}

/** The alarm's next times within [from, to) (days: 0 = søndag … 6 = lørdag; none = once). */
export function alarmTimes(a: Alarm, from: Date, to: Date): Date[] {
  const [h, m] = a.time.split(':').map(Number);
  const out: Date[] = [];
  for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d < to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const t = new Date(d); t.setHours(h, m, 0, 0);
    if (t < from || t >= to) continue;
    if (a.days.length && !a.days.includes(t.getDay())) continue;
    out.push(t);
    if (!a.days.length) break; // once: the next time it comes
  }
  return out;
}

/** What's due from now on (the next `days` days), sorted by time. */
export function dueItems(e: SyncEngine, opts: { days?: number; alarms?: boolean; now?: Date } = {}): DueItem[] {
  const now = opts.now ?? new Date();
  const to = new Date(now.getTime() + (opts.days ?? 14) * 86_400_000);
  const out: DueItem[] = [];
  for (const r of reminders(e)) {
    if (r.done || !r.at) continue;
    const at = new Date(r.at).getTime();
    if (at > now.getTime() - 60_000 && at < to.getTime()) out.push({ id: `rem:${r.id}`, at, title: 'Husk', body: r.text, kind: 'reminder', ref: r.id });
  }
  const events = (e.list('event') as unknown as (CalEvent & { alert?: number | null })[]).filter((x) => x.alert != null);
  // Occurrences that start up to a day after the window (a "1 dag før" alert for them is inside it).
  for (const o of occurrences(events, now, new Date(to.getTime() + 86_400_000)) as (CalEvent & { alert?: number | null })[]) {
    const start = new Date(o.start);
    const at = start.getTime() - (o.alert ?? 0) * 60_000;
    if (at <= now.getTime() - 60_000 || at >= to.getTime()) continue;
    const when = `${hm(start)}${o.place ? ' · ' + o.place : ''}`;
    out.push({ id: `ev:${o.id}`.slice(0, 64), at, title: o.title, body: `${before(o.alert ?? 0)} · ${when}`, kind: 'event', ref: o.sourceId ?? o.id });
  }
  // A card's deadline: when it comes (cards that are done stay quiet).
  for (const c of e.list('bcard') as any[]) {
    if (c.done || !c.due) continue;
    const at = new Date(c.due).getTime();
    if (!(at > now.getTime() - 60_000 && at < to.getTime())) continue;
    const b = e.get(c.board) as any;
    out.push({ id: `card:${c.id}`, at, title: `Frist: ${c.title}`.slice(0, 120), body: b?.name ? `${b.name} · ${hm(new Date(at))}` : hm(new Date(at)), kind: 'card', ref: c.id });
  }
  if (opts.alarms !== false) for (const a of e.list('alarm') as unknown as Alarm[]) {
    if (!a.on) continue;
    for (const t of alarmTimes(a, now, to)) out.push({ id: `alarm:${a.id}:${t.getTime()}`.slice(0, 64), at: t.getTime(), title: a.label || 'Vækkeur', body: hm(t), kind: 'alarm', ref: a.id });
  }
  // (ids as the relay takes them: letters, digits and : . _ -)
  return out.map((x) => ({ ...x, id: x.id.replace(/[^A-Za-z0-9:._-]/g, '.') })).sort((a, b) => a.at - b.at);
}
