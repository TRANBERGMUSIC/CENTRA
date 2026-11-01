/**
 * Calendar types ("Personlig", "Arbejde", "Træning" …): as many as you like, each with its own colour,
 * chosen on the colour wheel. An event points at its type (`cat`); the calendar, Today and the Mac's
 * week draw it in that colour. Two types exist from the start, with fixed ids, so the Mac and the
 * iPhone never make two of them.
 */
import type { SyncEngine } from '@centra/sync';

export type CalType = { id: string; type: string; name: string; color: string; order?: number };

export const DEFAULT_TYPES: { id: string; name: string; color: string; order: number }[] = [
  { id: 'calcat-personal', name: 'Personlig', color: '#7B4DFF', order: 0 },
  { id: 'calcat-work', name: 'Arbejde', color: '#FF9A5C', order: 1 },
];
/** Subscribed calendars without a type of their own. */
export const FEED_COLOR = '#4FA3D9';
/** Colours offered first for a new type (anything on the wheel works too). */
export const SWATCHES = ['#7B4DFF', '#FF9A5C', '#D9507A', '#34C759', '#0A84FF', '#FFCC00', '#5AC8FA', '#AF52DE', '#8E8E93'];

/**
 * All types in order. The starting two are only stored as what you changed about them (a new
 * colour, a new name), on top of their defaults: so a change on the Mac and another on the iPhone
 * never overwrite each other with the defaults.
 */
export function calTypes(e: SyncEngine): CalType[] {
  const out = (e.list('calcat') as unknown as CalType[]).map((t) => {
    const d = DEFAULT_TYPES.find((x) => x.id === t.id);
    return d ? { ...d, type: 'calcat', ...Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined)) } as CalType : t;
  });
  for (const d of DEFAULT_TYPES) if (!out.some((t) => t.id === d.id) && !e.fieldClock(d.id, '_deleted')) out.push({ ...d, type: 'calcat' });
  return out.filter((t) => t.name).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name, 'da'));
}

export function createType(e: SyncEngine, name: string, color: string): string {
  const clean = name.trim().slice(0, 40);
  if (!clean) throw new Error('Giv typen et navn');
  const same = calTypes(e).find((t) => t.name.toLowerCase() === clean.toLowerCase());
  if (same) return same.id;
  return e.create('calcat', { name: clean, color: validColor(color), order: calTypes(e).length });
}

export function updateType(e: SyncEngine, id: string, f: { name?: string; color?: string }) {
  e.set('calcat', id, { ...(f.name !== undefined ? { name: f.name.trim().slice(0, 40) || 'Uden navn' } : {}), ...(f.color ? { color: validColor(f.color) } : {}) });
}

/** Deletes a type; its events keep their place and fall back to Personlig's colour. */
export function deleteType(e: SyncEngine, id: string) {
  e.remove('calcat', id);
  for (const ev of e.list('event') as any[]) if (ev.cat === id) e.set('event', ev.id, { cat: null });
}

/** The type for a name ("arbejde", "Træning"): an existing one, or a new one in the next free colour. */
export function typeForName(e: SyncEngine, name: string): string {
  const all = calTypes(e);
  const hit = all.find((t) => t.name.toLowerCase() === name.trim().toLowerCase());
  if (hit) return hit.id;
  const used = new Set(all.map((t) => t.color.toLowerCase()));
  return createType(e, name, SWATCHES.find((c) => !used.has(c.toLowerCase())) ?? SWATCHES[all.length % SWATCHES.length]);
}

/** The colour to draw an event in. */
export function eventColor(types: CalType[], ev: { cat?: string | null; feed?: unknown; cal?: string }): string {
  const t = typeOf(types, ev);
  if (t) return t.color;
  if (ev.feed) return FEED_COLOR;
  return types.find((x) => x.id === 'calcat-personal')?.color ?? DEFAULT_TYPES[0].color;
}

export const validColor = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : DEFAULT_TYPES[0].color);

/** An event's type: the one it points at, or (events from before types) the one named like its calendar. */
export function typeOf(types: CalType[], ev: { cat?: string | null; cal?: string }): CalType | null {
  if (ev.cat) return types.find((x) => x.id === ev.cat) ?? null;
  const name = (ev.cal ?? '').toLowerCase();
  return name ? types.find((x) => x.name.toLowerCase() === name) ?? null : null;
}
