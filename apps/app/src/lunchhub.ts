/**
 * LunchHub → CENTRA: the enquiries that land in LunchHub's inbox (from frajorden.dk, smagssans.dk,
 * bord.dk) show up in CENTRA's inbox as mails, and answering or archiving them here updates LunchHub.
 *
 * LunchHub's app API (spec: docs/LUNCHHUB-CENTRA-API.md):
 *   GET  /api/ext/me                    → who the app key belongs to, and which companies they see
 *   GET  /api/ext/inbox?since=<ISO>     → enquiries created or changed since then
 *   POST /api/ext/inbox/<id>            → { status: "ny" | "besvaret" | "arkiv", note? }
 * Every call carries the personal app key ("Authorization: Bearer lh_app_…"), made in LunchHub under
 * your profile. The key is stored encrypted in CENTRA like the mail passwords.
 */
import type { SyncEngine } from '@centra/sync';

export type LhConn = { id: string; name: string; url: string; token: string; who?: string; sites?: string; since?: string; lastSync?: string; lastError?: string; enabled?: boolean };
export type LhItem = {
  id: string | number; site: string; siteName?: string; type?: string; kind?: string; status: 'ny' | 'besvaret' | 'arkiv' | string;
  name?: string; company?: string; email?: string; phone?: string; subject?: string; employees?: number | null; zip?: string;
  message?: string; source?: string; receivedAt: string; updatedAt?: string; note?: string;
};
type Me = { name?: string; username?: string; sites?: { id: string; name: string; domain?: string }[] };

const desktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const DEFAULT_URL = 'https://lunchhub.dk';

async function call<T>(c: Pick<LhConn, 'url' | 'token'>, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  if (!desktop()) throw new Error('LunchHub virker kun i CENTRA-appen på din Mac.');
  const { invoke } = await import('@tauri-apps/api/core');
  try { return await invoke<T>('lunchhub_request', { base: c.url, token: c.token, method, path, body: body ?? null }); }
  catch (e) { throw new Error(typeof e === 'string' ? e : (e as Error)?.message ?? String(e)); }
}

/** Checks the address and key, and says whose inbox it is. */
export async function testLunchHub(url: string, token: string): Promise<Me> {
  return call<Me>({ url, token }, 'GET', '/api/ext/me');
}

export const lhMailId = (connId: string, itemId: string | number) => `lh-${connId}-${itemId}`;

/** What an enquiry looks like as a mail in CENTRA's inbox. */
export function toMail(c: LhConn, i: LhItem) {
  const kind = i.kind || (i.type === 'smagning' ? 'Smagning' : 'Kontakt');
  const site = i.siteName || i.site;
  const lines = [
    i.message?.trim() || '(Ingen besked skrevet)',
    '',
    '—',
    `${kind} via ${i.source || site}`,
    i.company ? `Virksomhed: ${i.company}` : '',
    i.phone ? `Telefon: ${i.phone}` : '',
    i.email ? `Mail: ${i.email}` : '',
    i.employees ? `Medarbejdere: ${i.employees}` : '',
    i.zip ? `Postnummer: ${i.zip}` : '',
    i.note ? `Intern note i LunchHub: ${i.note}` : '',
  ].filter((l, n) => l !== '' || n === 1);
  const body = lines.join('\n');
  return {
    acct: c.id, acctName: `LunchHub · ${site}`, source: 'lunchhub', lhId: i.id, lhSite: i.site, lhStatus: i.status, lhKind: kind,
    fromName: [i.name, i.company].filter(Boolean).join(' · ') || i.email || 'Ukendt', fromEmail: i.email ?? '', to: [], cc: [],
    subject: `${kind}: ${i.subject || 'Henvendelse'}`, at: i.receivedAt, preview: body.replace(/\s+/g, ' ').slice(0, 180), body,
    html: '', parts: [], full: true, attachments: [], list: false,
    cat: 'Personer', needsReply: i.status === 'ny', answered: i.status === 'besvaret', archived: i.status === 'arkiv',
  };
}

/** Fetches what is new or changed since last time. Returns the ids of enquiries seen for the first time. */
export async function syncLunchHub(e: SyncEngine, c: LhConn): Promise<{ added: string[]; error?: string }> {
  try {
    const r = await call<{ items: LhItem[]; now?: string }>(c, 'GET', `/api/ext/inbox?since=${encodeURIComponent(c.since ?? '')}`);
    const added: string[] = [];
    let since = c.since ?? '';
    for (const i of r.items ?? []) {
      const id = lhMailId(c.id, i.id);
      const stamp = i.updatedAt || i.receivedAt;
      if (stamp > since) since = stamp;
      if (e.fieldClock(id, '_deleted') && !e.get(id)) continue; // removed here on purpose
      const fresh = !e.get(id);
      const m = toMail(c, i);
      // Keep what you did in CENTRA (read, star, draft) — only LunchHub's own fields follow LunchHub.
      e.set('mail', id, fresh ? { ...m, unread: i.status === 'ny' } : { ...m, unread: (e.get(id) as any)?.unread ?? false });
      if (fresh) added.push(id);
    }
    e.set('lhconn', c.id, { since: r.now && r.now > since ? r.now : since, lastSync: new Date().toISOString(), lastError: '' });
    return { added };
  } catch (x) {
    const msg = (x as Error).message;
    e.set('lhconn', c.id, { lastError: msg, lastSync: new Date().toISOString() });
    return { added: [], error: msg };
  }
}

export async function syncAllLunchHub(e: SyncEngine) {
  const conns = (e.list('lhconn') as unknown as LhConn[]).filter((c) => c.enabled !== false);
  const added: string[] = [], errors: string[] = [];
  for (const c of conns) { const r = await syncLunchHub(e, c); added.push(...r.added); if (r.error) errors.push(`${c.name}: ${r.error}`); }
  return { added, errors };
}

/** Answered / archived / back to new — in LunchHub too, so the team sees it there. */
export async function setLunchHubStatus(e: SyncEngine, m: any, status: 'ny' | 'besvaret' | 'arkiv') {
  const c = e.get(m.acct) as unknown as LhConn | null;
  if (!c) throw new Error('LunchHub-forbindelsen findes ikke længere');
  await call(c, 'POST', `/api/ext/inbox/${encodeURIComponent(String(m.lhId))}`, { status });
  e.set('mail', m.id, { lhStatus: status, needsReply: status === 'ny', answered: status === 'besvaret', archived: status === 'arkiv', ...(status !== 'ny' ? { unread: false } : {}) });
}

export function removeLunchHub(e: SyncEngine, id: string) {
  for (const m of e.list('mail')) if ((m as any).acct === id) e.remove('mail', m.id);
  e.remove('lhconn', id);
}
