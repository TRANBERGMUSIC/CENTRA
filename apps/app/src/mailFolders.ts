/**
 * Mail folders in CENTRA ("Kvitteringer", "Netto", "Fra Jorden" …). A mail in a folder leaves the
 * Indbakke and shows under the folder. Folders sort new mail by themselves:
 *  - rules: from (name or address contains), subject or text words — exact, instant, free;
 *  - a description ("alt om mine DJ-lektioner") that Assist's mail sorting (Haiku) uses for the rest.
 * The folders live in CENTRA (encrypted, synced); the mails stay where they are on the mail server.
 */
import type { SyncEngine } from '@centra/sync';

export type FolderRule = { from?: string; subject?: string; words?: string };
export type MailFolder = { id: string; name: string; description?: string; rules?: FolderRule[]; order?: number; createdAt?: string };

export const folders = (e: SyncEngine) => (e.list('mailfolder') as unknown as MailFolder[]).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'da'));
export const folderByName = (e: SyncEngine, name: string) => folders(e).find((f) => f.name.toLowerCase() === name.trim().toLowerCase()) ?? null;

const has = (hay: string, needle?: string) => {
  const words = String(needle ?? '').toLowerCase().split(/[,;]/).map((w) => w.trim()).filter(Boolean);
  return words.length > 0 && words.some((w) => hay.includes(w));
};

/** Does this rule fit the mail? Every part that is filled in must fit. */
export function ruleMatches(m: any, r: FolderRule): boolean {
  const parts: [string, string | undefined][] = [
    [`${m.fromName ?? ''} ${m.fromEmail ?? ''}`.toLowerCase(), r.from],
    [String(m.subject ?? '').toLowerCase(), r.subject],
    [`${m.subject ?? ''} ${m.body ?? m.preview ?? ''}`.toLowerCase(), r.words],
  ];
  const used = parts.filter(([, n]) => String(n ?? '').trim());
  return used.length > 0 && used.every(([hay, n]) => has(hay, n));
}

export const folderFor = (e: SyncEngine, m: any): MailFolder | null => folders(e).find((f) => (f.rules ?? []).some((r) => ruleMatches(m, r))) ?? null;

/** Sorts mails by the folders' rules (new mail, or all of the inbox). Returns how many were moved. */
export function sortByRules(e: SyncEngine, ids?: string[], onlyFolder?: string): number {
  let n = 0;
  const list = ids ? ids.map((id) => e.get(id) as any).filter(Boolean) : (e.list('mail') as any[]);
  for (const m of list) {
    if (m.mbox || m.archived || m.sent || m.mboxManual) continue;
    const f = folderFor(e, m);
    if (f && (!onlyFolder || f.id === onlyFolder)) { e.set('mail', m.id, { mbox: f.id }); n++; }
  }
  return n;
}

/** Moves mails to a folder ('' = back to Indbakke). Remembers you did it by hand, so rules won't move it again. */
export function moveToFolder(e: SyncEngine, ids: string[], folder: string) {
  const before = ids.map((id) => ({ id, fields: { mbox: (e.get(id) as any)?.mbox ?? '', mboxManual: !!(e.get(id) as any)?.mboxManual } }));
  for (const id of ids) if (e.get(id)) e.set('mail', id, { mbox: folder, mboxManual: true, archived: false });
  return before;
}

export function removeFolder(e: SyncEngine, id: string) {
  const moved = (e.list('mail') as any[]).filter((m) => m.mbox === id).map((m) => m.id);
  for (const mid of moved) e.set('mail', mid, { mbox: '' });
  e.remove('mailfolder', id);
  return moved;
}

/** For Assist's mail sorting: the folders it can choose between, with what belongs in them. */
export const folderGuide = (e: SyncEngine) => folders(e).filter((f) => f.description?.trim() || (f.rules ?? []).length).map((f) => ({ id: f.id, name: f.name, what: [f.description, ...(f.rules ?? []).map((r) => [r.from && `fra ${r.from}`, r.subject && `emne med ${r.subject}`, r.words && `ord: ${r.words}`].filter(Boolean).join(', '))].filter(Boolean).join('; ') }));
