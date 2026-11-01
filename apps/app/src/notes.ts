/**
 * Note folders: a note's `folder` is a path like "Arbejde/Netto/Vagtplaner". Folders exist when a note
 * lives in them or when you made them (a 'notefolder' record), so empty folders stay too.
 */
import type { SyncEngine } from '@centra/sync';

export const INBOX = 'Indbakke';
export const clean = (p: string) => String(p ?? '').split('/').map((x) => x.trim()).filter(Boolean).join('/');
export const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const leaf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const within = (p: string, root: string) => p === root || p.startsWith(root + '/');

/** Every folder path there is, with all parents, sorted (Indbakke first). */
export function folderPaths(e: SyncEngine): string[] {
  const set = new Set<string>([INBOX]);
  const add = (p: string) => { let x = clean(p); while (x) { set.add(x); x = parentOf(x); } };
  for (const n of e.list('note') as any[]) add(n.folder || INBOX);
  for (const f of e.list('notefolder') as any[]) add(f.path);
  return [...set].sort((a, b) => (a === INBOX ? -1 : b === INBOX ? 1 : a.localeCompare(b, 'da')));
}

export type FolderNode = { path: string; name: string; children: FolderNode[]; count: number; total: number };
export function folderTree(e: SyncEngine): FolderNode[] {
  const notes = e.list('note') as any[];
  const nodes = new Map<string, FolderNode>();
  for (const p of folderPaths(e)) nodes.set(p, { path: p, name: leaf(p), children: [], count: notes.filter((n) => (n.folder || INBOX) === p).length, total: 0 });
  const roots: FolderNode[] = [];
  for (const n of nodes.values()) { const par = nodes.get(parentOf(n.path)); (par ? par.children : roots).push(n); }
  const sum = (n: FolderNode): number => (n.total = n.count + n.children.reduce((s, c) => s + sum(c), 0));
  roots.forEach(sum);
  return roots;
}

export function createFolder(e: SyncEngine, path: string): string {
  const p = clean(path);
  if (!p) throw new Error('Mappen skal have et navn');
  if (!(e.list('notefolder') as any[]).some((f) => f.path === p)) e.create('notefolder', { path: p, createdAt: new Date().toISOString() });
  return p;
}

/** Renames or moves a folder with everything in it. Returns what to undo. */
export function renameFolder(e: SyncEngine, from: string, to: string) {
  const a = clean(from), b = clean(to);
  if (!a || !b || a === INBOX) throw new Error(a === INBOX ? 'Indbakke kan ikke omdøbes' : 'Mappen skal have et navn');
  if (within(b, a) && b !== a) throw new Error('En mappe kan ikke ligge i sig selv');
  const undo: { type: string; id: string; fields: Record<string, unknown> }[] = [];
  for (const n of e.list('note') as any[]) if (within(n.folder || INBOX, a)) { undo.push({ type: 'note', id: n.id, fields: { folder: n.folder } }); e.set('note', n.id, { folder: b + (n.folder || '').slice(a.length) }); }
  for (const f of e.list('notefolder') as any[]) if (within(f.path, a)) { undo.push({ type: 'notefolder', id: f.id, fields: { path: f.path } }); e.set('notefolder', f.id, { path: b + f.path.slice(a.length) }); }
  if (!(e.list('notefolder') as any[]).some((f) => f.path === b)) createFolder(e, b);
  return undo;
}

/** Deletes a folder; its notes (and subfolders' notes) move to the parent folder, or Indbakke. */
export function deleteFolder(e: SyncEngine, path: string) {
  const a = clean(path);
  if (a === INBOX) throw new Error('Indbakke kan ikke slettes');
  const to = parentOf(a) || INBOX;
  const undo: { type: string; id: string; fields: Record<string, unknown> }[] = [];
  for (const n of e.list('note') as any[]) if (within(n.folder || INBOX, a)) { undo.push({ type: 'note', id: n.id, fields: { folder: n.folder } }); e.set('note', n.id, { folder: to }); }
  for (const f of e.list('notefolder') as any[]) if (within(f.path, a)) { undo.push({ type: 'notefolder', id: f.id, fields: { ...f, _deleted: false } }); e.remove('notefolder', f.id); }
  return { to, undo };
}

export const inFolder = (n: any, path: string, deep = true) => (deep ? within(n.folder || INBOX, path) : (n.folder || INBOX) === path);

/** [[Titel]] links in a note's text, and which notes link to a note. */
export const linksIn = (text: string) => [...new Set([...String(text).matchAll(/\[\[([^\]\n]{1,120})\]\]/g)].map((m) => m[1].trim()))];
export function backlinks(e: SyncEngine, title: string, self: string) {
  const t = title.trim().toLowerCase();
  if (!t) return [];
  return (e.list('note') as any[]).filter((n) => n.id !== self && linksIn(e.doc(n.id).getText('body').toString()).some((l) => l.toLowerCase() === t));
}

export const TEMPLATES: { id: string; name: string; title: string; folder?: string; body: string }[] = [
  { id: 'blank', name: 'Tom note', title: '', body: '' },
  { id: 'meeting', name: 'Møde', title: 'Møde: ', folder: 'Møder', body: 'Dato: \nDeltagere: \n\nDagsorden\n- \n\nNoter\n- \n\nBeslutninger\n- \n\nOpgaver\n- [ ] ' },
  { id: 'project', name: 'Projekt', title: 'Projekt: ', folder: 'Projekter', body: 'Mål: \nDeadline: \n\nHvorfor\n\n\nNæste skridt\n- [ ] \n\nIdéer\n- \n\nLinks\n- ' },
  { id: 'journal', name: 'Dagbog', title: `Dagbog ${new Date().toLocaleDateString('da-DK', { day: 'numeric', month: 'long' })}`, folder: 'Dagbog', body: 'Hvordan har dagen været?\n\n\nDet var godt\n- \n\nDet vil jeg gøre bedre i morgen\n- ' },
  { id: 'idea', name: 'Idé', title: 'Idé: ', folder: 'Ideer', body: 'Idéen kort\n\n\nHvem er den til\n\n\nFørste skridt\n- [ ] ' },
  { id: 'list', name: 'Liste', title: '', body: '- [ ] \n- [ ] \n- [ ] ' },
];

/** A note's text without the Markdown signs (lists and previews): "• mælk", "☐ æg", "☑ brød". */
export function plainText(md: string): string {
  return md
    .replace(/^(\s*)[-*+] \[[xX]\] /gm, '$1☑ ').replace(/^(\s*)[-*+] \[ \] /gm, '$1☐ ')
    .replace(/^(\s*)[-*+] /gm, '$1• ').replace(/^#{1,6} /gm, '')
    .replace(/(\*\*|__|\+\+|~~)(.+?)\1/g, '$2').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2').replace(/`([^`\n]+)`/g, '$1');
}

/** The checklist lines in a note's text ("- [ ] mælk"), with where their box sits, for ticking off elsewhere. */
export type CheckItem = { at: number; done: boolean; text: string };
export function checkItems(md: string): CheckItem[] {
  const out: CheckItem[] = [];
  let pos = 0;
  for (const line of md.split('\n')) {
    const m = /^(\s*[-*+] \[)([ xX])\] (.*)$/.exec(line);
    if (m) out.push({ at: pos + m[1].length, done: m[2] !== ' ', text: plainText(m[3]) });
    pos += line.length + 1;
  }
  return out;
}
/** Ticks a box on or off (`at` from checkItems), in the note's shared text. */
export function toggleCheck(text: { toString(): string; delete(i: number, n: number): void; insert(i: number, s: string): void; doc: { transact(f: () => void): void } | null }, at: number) {
  const cur = text.toString()[at];
  if (cur === undefined || !/[ xX]/.test(cur)) return;
  const run = () => { text.delete(at, 1); text.insert(at, cur === ' ' ? 'x' : ' '); };
  if (text.doc) text.doc.transact(run); else run();
}
