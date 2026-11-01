/**
 * The front page is built from modules ("Din dag", "Næste", "Penge" …) that you arrange yourself:
 * order, size and which ones show. The Mac and the iPhone each keep their own arrangement (synced,
 * so another Mac looks like this one). A new module is added to the list in screens/Today.tsx; a
 * module the saved arrangement doesn't know yet shows up by itself (or in "Tilføj", if it starts
 * hidden), so nothing has to be migrated.
 */
import type { SyncEngine } from '@centra/sync';

export type Size = 'full' | 'large' | 'small';
export const SIZE_SPAN: Record<Size, string> = { full: 'span-12', large: 'span-7', small: 'span-5' };
export const SIZE_NAME: Record<Size, string> = { full: 'Bred', large: 'Halv', small: 'Smal' };
export type ModuleInfo = { id: string; size: Size; on: boolean };
export type Layout = { order: string[]; hidden: string[]; sizes: Record<string, Size> };

const key = (device: 'desk' | 'phone') => `setting-home-${device}`;

/** The arrangement to draw: saved order first, then modules it doesn't know yet, in their own order. */
export function arrange(e: SyncEngine, device: 'desk' | 'phone', modules: ModuleInfo[]): { id: string; size: Size; hidden: boolean }[] {
  const saved = (e.get(key(device)) ?? {}) as Partial<Layout>;
  const order = (saved.order ?? []).filter((id) => modules.some((m) => m.id === id));
  for (const m of modules) if (!order.includes(m.id)) order.push(m.id);
  const known = new Set(saved.order ?? []);
  return order.map((id) => {
    const m = modules.find((x) => x.id === id)!;
    // Hidden if you hid it, or if it is new to this arrangement and starts hidden.
    const hidden = (saved.hidden ?? []).includes(id) || (!known.has(id) && !m.on);
    return { id, size: saved.sizes?.[id] ?? m.size, hidden };
  });
}

export function saveLayout(e: SyncEngine, device: 'desk' | 'phone', items: { id: string; size: Size; hidden: boolean }[]) {
  e.set('setting', key(device), {
    order: items.map((x) => x.id),
    hidden: items.filter((x) => x.hidden).map((x) => x.id),
    sizes: Object.fromEntries(items.map((x) => [x.id, x.size])),
  });
}

export const resetLayout = (e: SyncEngine, device: 'desk' | 'phone') => e.set('setting', key(device), { order: null, hidden: null, sizes: null });

/** Moves one module up or down among the visible ones. */
export function move(items: { id: string; size: Size; hidden: boolean }[], id: string, by: -1 | 1) {
  const vis = items.filter((x) => !x.hidden);
  const i = vis.findIndex((x) => x.id === id), j = i + by;
  if (i < 0 || j < 0 || j >= vis.length) return items;
  [vis[i], vis[j]] = [vis[j], vis[i]];
  return [...vis, ...items.filter((x) => x.hidden)];
}

/** Puts `id` right before `before` (dragging on the Mac). */
export function place(items: { id: string; size: Size; hidden: boolean }[], id: string, before: string) {
  if (id === before) return items;
  const it = items.find((x) => x.id === id);
  if (!it) return items;
  const rest = items.filter((x) => x.id !== id);
  const at = rest.findIndex((x) => x.id === before);
  rest.splice(at < 0 ? rest.length : at, 0, it);
  return rest;
}
