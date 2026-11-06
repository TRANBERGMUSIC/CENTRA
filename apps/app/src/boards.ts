/**
 * Boards (like Trello): a board per project, lists on it (Skal laves, I gang, Færdig …), cards in the
 * lists. Everything is ordinary synced records, so a card moved on the Mac moves on the iPhone a
 * moment later, and two devices can work on the same board at once.
 *
 *  board  { name, color, order, labels: [{ id, name, color }] }
 *  blist  { board, name, order }
 *  bcard  { board, list, title, order, notes, due, done, labels: [label id], checklist: [{ id, text, done }] }
 *
 * Order is a number between the neighbours (fractional), so a move writes one field on one card and
 * two devices moving different cards never fight.
 */
import type { SyncEngine } from '@centra/sync';

export type Label = { id: string; name: string; color: string };
export type Board = { id: string; name: string; color: string; order: number; labels?: Label[]; createdAt?: string; archived?: boolean };
export type BList = { id: string; board: string; name: string; order: number };
export type Check = { id: string; text: string; done: boolean };
export type BCard = { id: string; board: string; list: string; title: string; order: number; notes?: string; due?: string | null; done?: boolean; labels?: string[]; checklist?: Check[]; createdAt?: string };

/** Board colours: the brand's light first, then calmer ones. */
export const BOARD_COLORS: [string, string][] = [
  ['violet', 'linear-gradient(135deg, #7B4DFF, #4A2BD1)'], ['flare', 'linear-gradient(135deg, #FF9A5C, #D9507A)'], ['rose', 'linear-gradient(135deg, #D9507A, #8E2E6B)'],
  ['amber', 'linear-gradient(135deg, #FFC37A, #FF8A4C)'], ['ocean', 'linear-gradient(135deg, #3A8DFF, #1F4FC2)'], ['teal', 'linear-gradient(135deg, #2BC4B0, #127C8F)'],
  ['forest', 'linear-gradient(135deg, #47B76A, #1E7A4A)'], ['graphite', 'linear-gradient(135deg, #5A5D66, #2C2E35)'],
];
export const boardBg = (c: string) => BOARD_COLORS.find((x) => x[0] === c)?.[1] ?? BOARD_COLORS[0][1];
export const LABEL_COLORS: [string, string][] = [['green', '#34C759'], ['yellow', '#FFCC00'], ['orange', '#FF9500'], ['red', '#FF3B30'], ['purple', '#AF52DE'], ['blue', '#0A84FF']];
export const labelHex = (c: string) => LABEL_COLORS.find((x) => x[0] === c)?.[1] ?? c;
export const DEFAULT_LISTS = ['Skal laves', 'I gang', 'Færdig'];

const rid = () => Math.random().toString(36).slice(2, 10);
const clean = (s: string, max = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export const boards = (e: SyncEngine) => (e.list('board') as unknown as Board[]).filter((b) => !b.archived).sort((a, b) => a.order - b.order);
export const listsOf = (e: SyncEngine, board: string) => (e.list('blist') as unknown as BList[]).filter((l) => l.board === board).sort((a, b) => a.order - b.order);
export const cardsOf = (e: SyncEngine, list: string) => (e.list('bcard') as unknown as BCard[]).filter((c) => c.list === list).sort((a, b) => a.order - b.order);
export const boardCards = (e: SyncEngine, board: string) => (e.list('bcard') as unknown as BCard[]).filter((c) => c.board === board);

/** A place between two neighbours (or at an end). */
export function between(before?: number, after?: number) {
  if (before == null && after == null) return 1000;
  if (before == null) return after! - 1000;
  if (after == null) return before + 1000;
  return (before + after) / 2;
}

/** Finds a board by id or by (part of) its name. */
export function findBoard(e: SyncEngine, q: string): Board | null {
  const all = boards(e), w = q.trim().toLowerCase();
  return all.find((b) => b.id === q) ?? all.find((b) => b.name.toLowerCase() === w) ?? all.find((b) => b.name.toLowerCase().includes(w)) ?? null;
}
export function findList(e: SyncEngine, board: string, q: string): BList | null {
  const all = listsOf(e, board), w = q.trim().toLowerCase();
  return all.find((l) => l.id === q) ?? all.find((l) => l.name.toLowerCase() === w) ?? all.find((l) => l.name.toLowerCase().includes(w)) ?? null;
}

export function addBoard(e: SyncEngine, name: string, color?: string, lists: string[] = DEFAULT_LISTS): string {
  const n = clean(name, 80);
  if (!n) throw new Error('Giv boardet et navn');
  const all = boards(e);
  const id = e.create('board', {
    name: n, color: color ?? BOARD_COLORS[all.length % BOARD_COLORS.length][0], order: between(all.at(-1)?.order),
    labels: LABEL_COLORS.map(([c]) => ({ id: c, name: '', color: c })), createdAt: new Date().toISOString(),
  });
  lists.forEach((l, i) => e.create('blist', { board: id, name: clean(l, 60) || 'Liste', order: (i + 1) * 1000 }));
  return id;
}

export function addList(e: SyncEngine, board: string, name: string): string {
  const all = listsOf(e, board);
  return e.create('blist', { board, name: clean(name, 60) || 'Liste', order: between(all.at(-1)?.order) });
}

export function addCard(e: SyncEngine, board: string, list: string, title: string, extra: Partial<BCard> = {}): string {
  const t = clean(title, 300);
  if (!t) throw new Error('Skriv hvad kortet handler om');
  const all = cardsOf(e, list);
  return e.create('bcard', { board, list, title: t, order: between(all.at(-1)?.order), labels: [], checklist: [], done: false, due: null, notes: '', createdAt: new Date().toISOString(), ...extra });
}

/** Moves a card into `list` at position `index` (0 = top; past the end = bottom). */
export function moveCard(e: SyncEngine, id: string, list: string, index: number) {
  const card = e.get(id) as unknown as BCard | null;
  if (!card) return;
  const others = cardsOf(e, list).filter((c) => c.id !== id);
  const i = Math.max(0, Math.min(index, others.length));
  const order = between(others[i - 1]?.order, others[i]?.order);
  const listRec = e.get(list) as unknown as BList | null;
  e.set('bcard', id, { list, order, board: listRec?.board ?? card.board });
}

/** Moves a list one step left (-1) or right (+1), or to an index. */
export function moveList(e: SyncEngine, id: string, index: number) {
  const l = e.get(id) as unknown as BList | null;
  if (!l) return;
  const others = listsOf(e, l.board).filter((x) => x.id !== id);
  const i = Math.max(0, Math.min(index, others.length));
  e.set('blist', id, { order: between(others[i - 1]?.order, others[i]?.order) });
}

/** Removes a list and its cards; returns how to bring them back. */
export function removeList(e: SyncEngine, id: string): () => void {
  const l = e.get(id) as any;
  const cards = cardsOf(e, id) as any[];
  for (const c of cards) e.remove('bcard', c.id);
  e.remove('blist', id);
  return () => {
    if (l) { const { id: _i, type: _t, ...f } = l; e.set('blist', id, { ...f, _deleted: false }); }
    for (const c of cards) { const { id: cid, type: _t, ...f } = c; e.set('bcard', cid, { ...f, _deleted: false }); }
  };
}

/** Removes a whole board with its lists and cards; returns how to bring it back. */
export function removeBoard(e: SyncEngine, id: string): () => void {
  const b = e.get(id) as any;
  const lists = listsOf(e, id) as any[];
  const cards = boardCards(e, id) as any[];
  for (const c of cards) e.remove('bcard', c.id);
  for (const l of lists) e.remove('blist', l.id);
  e.remove('board', id);
  return () => {
    const back = (type: string, r: any) => { const { id: rid2, type: _t, ...f } = r; e.set(type, rid2, { ...f, _deleted: false }); };
    if (b) back('board', b);
    lists.forEach((l) => back('blist', l));
    cards.forEach((c) => back('bcard', c));
  };
}

export function setChecklist(e: SyncEngine, card: BCard, list: Check[]) { e.set('bcard', card.id, { checklist: list.slice(0, 100) }); }
export const addCheck = (e: SyncEngine, card: BCard, text: string) => { const t = clean(text, 200); if (t) setChecklist(e, card, [...(card.checklist ?? []), { id: rid(), text: t, done: false }]); };

/** "3/5" for a checklist, '' without one. */
export const progress = (c: BCard) => { const l = c.checklist ?? []; return l.length ? `${l.filter((x) => x.done).length}/${l.length}` : ''; };

/** For Assist: the boards, their lists and the open cards, short. */
export function boardsContext(e: SyncEngine, max = 6): string {
  return boards(e).slice(0, max).map((b) => {
    const lists = listsOf(e, b.id).map((l) => {
      const cards = cardsOf(e, l.id).filter((c) => !c.done).slice(0, 12).map((c) => `${c.title}${c.due ? ` (frist ${c.due.slice(0, 10)})` : ''} [${c.id}]`);
      return `  ${l.name}: ${cards.join('; ') || '–'}`;
    });
    return `${b.name} [${b.id}]\n${lists.join('\n')}`;
  }).join('\n');
}
