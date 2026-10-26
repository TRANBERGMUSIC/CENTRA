/**
 * Events, including weekly repeats ("arbejde tirsdag–fredag 06–16").
 *
 * A repeating event is stored once: `start`/`end` hold the first occurrence (and so the times of day),
 * `repeat.days` the weekdays (0 = søndag … 6 = lørdag) and `repeat.until` an optional last date.
 * Occurrences are computed when shown; nothing derived is stored.
 */
export type Repeat = { days: number[]; until?: string; skip?: string[] };
export type CalEvent = {
  id: string; title: string; start: string; end: string;
  place?: string; cal?: string; note?: string; mail?: string; link?: string; with?: string; focus?: boolean;
  repeat?: Repeat; sourceId?: string;
};

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/** All events (repeats expanded) that start within [from, to), sorted by start. */
export function occurrences(events: CalEvent[], from: Date, to: Date): CalEvent[] {
  const out: CalEvent[] = [];
  for (const ev of events) {
    const s = new Date(ev.start), e = new Date(ev.end);
    if (!ev.repeat?.days?.length) {
      if (s < to && e > from) out.push(ev);
      continue;
    }
    const len = e.getTime() - s.getTime();
    const first = startOfDay(s);
    const until = ev.repeat.until ? new Date(ev.repeat.until + 'T23:59:59') : null;
    for (let d = startOfDay(from); d < to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      if (d < first || (until && d > until)) continue;
      if (!ev.repeat.days.includes(d.getDay())) continue;
      const key = dayKey(d);
      if (ev.repeat.skip?.includes(key)) continue;
      const os = new Date(d); os.setHours(s.getHours(), s.getMinutes(), 0, 0);
      const oe = new Date(os.getTime() + len);
      out.push({ ...ev, id: `${ev.id}@${key}`, sourceId: ev.id, start: os.toISOString(), end: oe.toISOString() });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export function dayOccurrences(events: CalEvent[], day: Date): CalEvent[] {
  const a = startOfDay(day);
  return occurrences(events, a, new Date(a.getFullYear(), a.getMonth(), a.getDate() + 1)).filter((x) => new Date(x.start).toDateString() === a.toDateString());
}

const NAMES = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
/** "tirsdag, onsdag og fredag" in week order (mandag first). */
export function repeatLabel(r?: Repeat): string {
  if (!r?.days?.length) return '';
  const order = [...r.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (order.length === 7) return 'hver dag';
  if (order.length === 5 && !order.includes(0) && !order.includes(6)) return 'hverdage';
  const names = order.map((d) => NAMES[d]);
  return 'hver ' + (names.length > 1 ? names.slice(0, -1).join(', ') + ' og ' + names.at(-1) : names[0]);
}
