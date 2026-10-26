/** Goal progress is always computed from its updates; nothing derived is ever stored. */
export type Goal = { id: string; title: string; area: string; kind: 'measure' | 'milestones' | 'habit'; unit?: string; target?: number; start?: string; due?: string; steps?: [string, boolean][]; perWeek?: number; order?: number; event?: string };
export type GoalUpdate = { id: string; goal: string; at: string; delta: number; text?: string; src?: string };

const DAY = 86400000;
const dueLabel = (iso?: string) => (iso ? new Date(iso + 'T12:00').toLocaleDateString('da-DK', { day: 'numeric', month: 'short' }).replace('.', '') : 'vane');

export function goalStats(g: Goal, updates: GoalUpdate[], now = new Date()) {
  const mine = updates.filter((u) => u.goal === g.id).sort((a, b) => a.at.localeCompare(b.at));
  const daysLeft = g.due ? Math.max(1, Math.ceil((new Date(g.due + 'T23:59').getTime() - now.getTime()) / DAY)) : null;
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
