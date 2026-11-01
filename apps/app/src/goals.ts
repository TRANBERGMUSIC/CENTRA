/**
 * Goal progress is always computed from its updates; nothing derived is ever stored.
 * Kinds:
 *  - once: do it one time ("få lavet hjemmesiden"), optionally with steps
 *  - milestones: a project with steps
 *  - count: do something N times in a period ("løbe 5 km 10 gange i år", "2 koncerter om måneden")
 *  - measure: reach a number ("spare 10.000 kr", "løbe 300 km")
 *  - habit: N times every week
 */
export type GoalKind = 'once' | 'milestones' | 'count' | 'measure' | 'habit';
export type Period = 'total' | 'year' | 'month' | 'week';
export type Goal = {
  id: string; title: string; area: string; kind: GoalKind; unit?: string; target?: number; start?: string; due?: string;
  steps?: [string, boolean][]; perWeek?: number; order?: number; event?: string;
  /** count: what one time is ("løbe 5 km"), and the period the target is for. */
  each?: string; period?: Period;
  /** Why it matters, and the very next thing to do. */
  why?: string; next?: string;
  status?: 'active' | 'paused' | 'done'; doneAt?: string;
};
export const KIND_NAMES: Record<GoalKind, string> = { once: 'Gøres én gang', milestones: 'Projekt med trin', count: 'Antal gange', measure: 'Nå et tal', habit: 'Vane hver uge' };
export const PERIOD_NAMES: Record<Period, string> = { total: 'i alt', year: 'om året', month: 'om måneden', week: 'om ugen' };
export type GoalUpdate = { id: string; goal: string; at: string; delta: number; text?: string; src?: string };

const DAY = 86400000;
const dueLabel = (iso?: string) => (iso ? new Date(iso + 'T12:00').toLocaleDateString('da-DK', { day: 'numeric', month: 'short' }).replace('.', '') : 'vane');

/** The current window of a count goal: from when, to when. */
export function periodWindow(g: Pick<Goal, 'period' | 'start' | 'due'>, now = new Date()): { from: Date; to: Date | null; label: string } {
  const p = g.period ?? 'total';
  if (p === 'year') return { from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear(), 11, 31, 23, 59), label: `i ${now.getFullYear()}` };
  if (p === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59), label: `i ${now.toLocaleDateString('da-DK', { month: 'long' })}` };
  if (p === 'week') { const m = new Date(now); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); const end = new Date(m.getTime() + 7 * DAY - 60000); return { from: m, to: end, label: 'denne uge' }; }
  return { from: g.start ? new Date(g.start + 'T00:00') : new Date(0), to: g.due ? new Date(g.due + 'T23:59') : null, label: g.due ? `inden ${dueLabel(g.due)}` : 'i alt' };
}

export function goalStats(g: Goal, updates: GoalUpdate[], now = new Date()) {
  const mine = updates.filter((u) => u.goal === g.id).sort((a, b) => a.at.localeCompare(b.at));
  const daysLeft = g.due ? Math.max(1, Math.ceil((new Date(g.due + 'T23:59').getTime() - now.getTime()) / DAY)) : null;
  if (g.kind === 'once') {
    const steps = g.steps ?? [];
    const done = g.status === 'done' || (steps.length > 0 && steps.every(([, d]) => d));
    const ratio = done ? 1 : steps.length ? steps.filter(([, d]) => d).length / steps.length : 0;
    const onTrack = done || daysLeft == null || daysLeft > 3;
    return { mine, value: done ? 1 : 0, ratio, left: done ? 0 : 1, daysLeft, onTrack, due: dueLabel(g.due) === 'vane' ? 'engang' : dueLabel(g.due), label: done ? 'Gjort' : steps.length ? `${steps.filter(([, d]) => d).length} af ${steps.length} trin` : g.due ? `Inden ${dueLabel(g.due)}` : 'Ikke gjort endnu' };
  }
  if (g.kind === 'count') {
    const w = periodWindow(g, now);
    const target = Math.max(1, g.target ?? 1);
    const value = Math.round(mine.filter((u) => new Date(u.at) >= w.from && (!w.to || new Date(u.at) <= w.to)).reduce((s, u) => s + (u.delta || 0), 0) * 10) / 10;
    const left = Math.max(0, target - value);
    // Expected by now: the share of the period that has gone, times the target.
    // A goal made in the middle of a period is measured from when it was made.
    const from = g.start && new Date(g.start + 'T00:00') > w.from ? new Date(g.start + 'T00:00') : w.from;
    const span = w.to ? w.to.getTime() - from.getTime() : null;
    const gone = span && span > 0 ? Math.min(1, Math.max(0, (now.getTime() - from.getTime()) / span)) : null;
    const expected = gone == null ? null : Math.floor(target * gone);
    const onTrack = left === 0 || expected == null || value >= expected - (g.period === 'week' ? 0 : 1);
    const daysToEnd = w.to ? Math.max(1, Math.ceil((w.to.getTime() - now.getTime()) / DAY)) : daysLeft;
    return { mine, value, ratio: value / target, left, daysLeft: daysToEnd, onTrack, expected, window: w, due: g.period && g.period !== 'total' ? PERIOD_NAMES[g.period] : dueLabel(g.due), label: `${fmtN(value)} af ${fmtN(target)} gange ${w.label}` };
  }
  if (g.kind === 'measure') {
    const value = Math.round(mine.reduce((s, u) => s + u.delta, 0) * 10) / 10;
    const target = g.target ?? 1;
    const left = Math.max(0, Math.round((target - value) * 10) / 10);
    const daysGone = g.start ? Math.max(1, (now.getTime() - new Date(g.start + 'T00:00').getTime()) / DAY) : null;
    const needPerWeek = daysLeft ? (left / daysLeft) * 7 : 0;
    const pacePerWeek = daysGone ? (value / daysGone) * 7 : null;
    const onTrack = left === 0 || pacePerWeek == null || pacePerWeek >= needPerWeek;
    return { mine, value, ratio: value / target, left, daysLeft, needPerWeek, pacePerWeek, onTrack, due: dueLabel(g.due), label: `${fmtN(value)} af ${fmtN(target)} ${g.unit ?? ''}`.trim() };
  }
  if (g.kind === 'milestones') {
    const steps = g.steps ?? [];
    const done = steps.filter(([, d]) => d).length;
    const onTrack = done === steps.length || (daysLeft ?? 99) > 7 || done / Math.max(1, steps.length) >= 0.8;
    return { mine, value: done, ratio: done / Math.max(1, steps.length), left: steps.length - done, daysLeft, onTrack, due: dueLabel(g.due), label: `${done} af ${steps.length} trin` };
  }
  const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const thisWeek = mine.filter((u) => new Date(u.at) >= monday).reduce((s, u) => s + u.delta, 0);
  const fourWeeks = mine.filter((u) => new Date(u.at) >= new Date(monday.getTime() - 28 * DAY) && new Date(u.at) < monday).reduce((s, u) => s + u.delta, 0);
  const per = g.perWeek ?? 1;
  return { mine, value: thisWeek, ratio: thisWeek / per, left: Math.max(0, per - thisWeek), daysLeft, onTrack: fourWeeks >= per * 4 * 0.75, due: 'vane', label: `${thisWeek} af ${per} denne uge` };
}

export const fmtN = (n: number) => n.toLocaleString('da-DK', { maximumFractionDigits: 1 });
