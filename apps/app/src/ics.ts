/**
 * iCalendar (.ics) feeds: the "secret address" Google, iCloud and Outlook give for a calendar.
 * Parses VEVENTs with time zones, all-day events, repeats (RRULE), exceptions (EXDATE) and moved
 * occurrences (RECURRENCE-ID), and expands everything into plain events inside a time window.
 */
export type IcsEvent = { uid: string; title: string; start: string; end: string; allDay: boolean; place?: string; note?: string };

type Prop = { name: string; params: Record<string, string>; value: string };
type Raw = Record<string, Prop[]>;

const WIN_TZ: Record<string, string> = {
  'Romance Standard Time': 'Europe/Copenhagen', 'W. Europe Standard Time': 'Europe/Berlin', 'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw', 'GMT Standard Time': 'Europe/London', 'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'UTC': 'UTC', 'Coordinated Universal Time': 'UTC', 'Eastern Standard Time': 'America/New_York', 'Pacific Standard Time': 'America/Los_Angeles',
  'Central Standard Time': 'America/Chicago', 'FLE Standard Time': 'Europe/Helsinki', 'E. Europe Standard Time': 'Europe/Chisinau',
};

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n').filter(Boolean);
}

function parseLine(line: string): Prop | null {
  // NAME;PARAM=a;PARAM2="b:c":VALUE — the first ':' outside quotes ends the parameters.
  let q = false, i = 0;
  for (; i < line.length; i++) { const c = line[i]; if (c === '"') q = !q; else if (c === ':' && !q) break; }
  if (i >= line.length) return null;
  const [name, ...ps] = line.slice(0, i).split(';');
  const params: Record<string, string> = {};
  for (const p of ps) { const k = p.indexOf('='); if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, ''); }
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

const unescape = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

/** Wall-clock time in a named zone → UTC milliseconds (two passes settle DST edges). */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz?: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const zone = tz ? WIN_TZ[tz] ?? tz : undefined;
  if (!zone) return new Date(y, mo - 1, d, h, mi, s).getTime(); // floating: this computer's time
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    const off = (t: number) => {
      const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - t;
    };
    let t = guess - off(guess);
    t = guess - off(t);
    return t;
  } catch {
    return new Date(y, mo - 1, d, h, mi, s).getTime();
  }
}

type When = { t: number; allDay: boolean; tz?: string; wall: [number, number, number, number, number, number] };
function when(p?: Prop): When | null {
  if (!p) return null;
  const v = p.value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v);
  if (!m) return null;
  const wall = [+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)] as When['wall'];
  if (!m[4] || p.params.VALUE === 'DATE') return { t: new Date(wall[0], wall[1] - 1, wall[2]).getTime(), allDay: true, wall };
  if (m[7]) return { t: Date.UTC(wall[0], wall[1] - 1, wall[2], wall[3], wall[4], wall[5]), allDay: false, tz: 'UTC', wall };
  return { t: zonedToUtc(...wall, p.params.TZID), allDay: false, tz: p.params.TZID, wall };
}

function duration(v?: string): number {
  if (!v) return 0;
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
}

/** The same wall-clock time as `start`, on another date. */
function at(start: When, y: number, m: number, d: number): number {
  if (start.allDay) return new Date(y, m - 1, d).getTime();
  if (start.tz === 'UTC') return Date.UTC(y, m - 1, d, start.wall[3], start.wall[4], start.wall[5]);
  return zonedToUtc(y, m, d, start.wall[3], start.wall[4], start.wall[5], start.tz);
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const dim = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based
const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

/** All start dates (as wall-clock y/m/d) of a repeat rule, from the first one, until `to` or the rule ends. */
function expand(rule: string, start: When, toMs: number, limit = 1500): [number, number, number][] {
  const r = Object.fromEntries(rule.split(';').map((kv) => { const [k, v] = kv.split('='); return [k.toUpperCase(), v]; }));
  const freq = r.FREQ, interval = Math.max(1, +(r.INTERVAL ?? 1)), count = r.COUNT ? +r.COUNT : Infinity;
  const until = r.UNTIL ? when({ name: 'UNTIL', params: {}, value: r.UNTIL })?.t ?? Infinity : Infinity;
  const byday = (r.BYDAY ?? '').split(',').filter(Boolean).map((x) => { const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(x)!; return { n: m?.[1] ? +m[1] : 0, d: DAYS.indexOf(m?.[2] ?? '') }; }).filter((x) => x.d >= 0);
  const bymd = (r.BYMONTHDAY ?? '').split(',').filter(Boolean).map(Number);
  const bymonth = (r.BYMONTH ?? '').split(',').filter(Boolean).map(Number);
  const [y0, m0, d0] = start.wall;
  const out: [number, number, number][] = [];
  const startKey = y0 * 10000 + m0 * 100 + d0;
  const push = (y: number, m: number, d: number) => {
    const key = y * 10000 + m * 100 + d;
    if (key < startKey) return true;
    const t = at(start, y, m, d);
    if (t > until || out.length >= count || t > toMs || out.length >= limit) return false;
    out.push([y, m, d]);
    return true;
  };
  let guard = 0;
  if (freq === 'DAILY') {
    for (let i = 0; guard++ < 20000; i += interval) {
      const dt = new Date(Date.UTC(y0, m0 - 1, d0 + i));
      if (byday.length && !byday.some((b) => b.d === dt.getUTCDay())) continue;
      if (!push(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())) break;
    }
  } else if (freq === 'WEEKLY') {
    const days = byday.length ? byday.map((b) => b.d) : [dow(y0, m0, d0)];
    const wkst = DAYS.indexOf(r.WKST ?? 'MO');
    const back = (dow(y0, m0, d0) - wkst + 7) % 7;
    outer: for (let w = 0; guard++ < 5000; w += interval) {
      for (let k = 0; k < 7; k++) {
        const dt = new Date(Date.UTC(y0, m0 - 1, d0 - back + w * 7 + k));
        if (!days.includes(dt.getUTCDay())) continue;
        if (!push(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())) break outer;
      }
    }
  } else if (freq === 'MONTHLY' || freq === 'YEARLY') {
    const step = freq === 'MONTHLY' ? interval : interval * 12;
    outer: for (let i = 0; guard++ < 3000; i += step) {
      const months = freq === 'YEARLY' && bymonth.length ? bymonth.map((bm) => [y0 + Math.floor(i / 12), bm]) : [[y0 + Math.floor((m0 - 1 + i) / 12), ((m0 - 1 + i) % 12) + 1]];
      for (const [y, m] of months) {
        const n = dim(y, m);
        let ds: number[];
        if (bymd.length) ds = bymd.map((x) => (x < 0 ? n + 1 + x : x)).filter((x) => x >= 1 && x <= n);
        else if (byday.length) {
          ds = [];
          for (const b of byday) {
            const all = Array.from({ length: n }, (_, k) => k + 1).filter((d) => dow(y, m, d) === b.d);
            if (b.n > 0) { if (all[b.n - 1]) ds.push(all[b.n - 1]); } else if (b.n < 0) { if (all[all.length + b.n]) ds.push(all[all.length + b.n]); } else ds.push(...all);
          }
        } else ds = d0 <= n ? [d0] : [];
        for (const d of ds.sort((a, b) => a - b)) if (!push(y, m, d)) break outer;
      }
    }
  } else {
    push(y0, m0, d0);
  }
  return out;
}

/** Expands a whole feed into events that overlap [from, to]. */
export function parseIcs(text: string, from: Date, to: Date): IcsEvent[] {
  const lines = unfold(text);
  const events: Raw[] = [];
  let cur: Raw | null = null, depth = 0;
  for (const l of lines) {
    const up = l.toUpperCase();
    if (up === 'BEGIN:VEVENT') { cur = {}; depth = 0; continue; }
    if (!cur) continue;
    if (up.startsWith('BEGIN:')) { depth++; continue; } // VALARM etc.
    if (up.startsWith('END:') && depth > 0) { depth--; continue; }
    if (up === 'END:VEVENT') { events.push(cur); cur = null; continue; }
    if (depth > 0) continue;
    const p = parseLine(l);
    if (p) (cur[p.name] ??= []).push(p);
  }
  const one = (r: Raw, k: string) => r[k]?.[0];
  const moved = new Map<string, Raw>(); // uid|original start → replacement
  const masters: Raw[] = [];
  for (const r of events) {
    if ((one(r, 'STATUS')?.value ?? '').toUpperCase() === 'CANCELLED' && !one(r, 'RECURRENCE-ID')) continue;
    const rid = when(one(r, 'RECURRENCE-ID'));
    if (rid) moved.set(`${one(r, 'UID')?.value}|${rid.t}`, r); else masters.push(r);
  }
  const fromMs = from.getTime(), toMs = to.getTime();
  const out: IcsEvent[] = [];
  const emit = (r: Raw, s: number, allDay: boolean, len: number, uid: string) => {
    if ((one(r, 'STATUS')?.value ?? '').toUpperCase() === 'CANCELLED') return;
    const e = s + Math.max(len, allDay ? 86400000 : 0);
    if (e <= fromMs || s >= toMs) return;
    out.push({ uid, title: unescape(one(r, 'SUMMARY')?.value ?? '(uden titel)'), start: new Date(s).toISOString(), end: new Date(e).toISOString(), allDay,
      place: one(r, 'LOCATION') ? unescape(one(r, 'LOCATION')!.value) : undefined });
  };
  for (const r of masters) {
    const s = when(one(r, 'DTSTART'));
    if (!s) continue;
    const uid = one(r, 'UID')?.value ?? `${s.t}-${one(r, 'SUMMARY')?.value}`;
    const e = when(one(r, 'DTEND'));
    const len = e ? e.t - s.t : duration(one(r, 'DURATION')?.value) || (s.allDay ? 86400000 : 0);
    const rule = one(r, 'RRULE')?.value;
    if (!rule) { emit(r, s.t, s.allDay, len, uid); continue; }
    const ex = new Set<number>();
    for (const p of r.EXDATE ?? []) for (const v of p.value.split(',')) { const w = when({ ...p, value: v }); if (w) ex.add(w.t); }
    for (const [y, m, d] of expand(rule, s, toMs)) {
      const tt = at(s, y, m, d);
      if (ex.has(tt)) continue;
      const mv = moved.get(`${uid}|${tt}`);
      if (mv) {
        const ms = when(one(mv, 'DTSTART')), me = when(one(mv, 'DTEND'));
        if (ms) emit(mv, ms.t, ms.allDay, me ? me.t - ms.t : len, `${uid}|${tt}`);
        moved.delete(`${uid}|${tt}`);
        continue;
      }
      emit(r, tt, s.allDay, len, `${uid}|${tt}`);
    }
  }
  // Moved occurrences whose original date fell outside the rule window still count.
  for (const [k, mv] of moved) { const ms = when(one(mv, 'DTSTART')), me = when(one(mv, 'DTEND')); if (ms) emit(mv, ms.t, ms.allDay, me ? me.t - ms.t : 3600000, k); }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
