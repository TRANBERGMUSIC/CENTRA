/**
 * Mail accounts in CENTRA (Mac app): IMAP for reading, SMTP for sending, run by the Rust side.
 *
 * Accounts (with their app passwords) live in the encrypted engine as `mailacct` records, so
 * they're protected by your CENTRA password like everything else. Mails are stored as `mail`
 * records with a stable id per account + IMAP UID, so fetching twice never duplicates.
 */
import type { SyncEngine } from '@centra/sync';
import { syncAllLunchHub, setLunchHubStatus } from './lunchhub.ts';
const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type Security = 'tls' | 'starttls' | 'none';
export type MailAccount = {
  id: string; name: string; provider: string; email: string; fromName?: string;
  host: string; port: number; security: Security; user: string; pass: string;
  smtpHost: string; smtpPort: number; smtpSecurity: Security;
  uidValidity?: number; lastUid?: number; sentUidValidity?: number; sentLastUid?: number; sentFolder?: string; lastSync?: string; lastError?: string; enabled?: boolean;
};

export type Preset = { id: string; name: string; host: string; port: number; security: Security; smtpHost: string; smtpPort: number; smtpSecurity: Security; guide: string; link?: [string, string]; blocked?: string };
export const PRESETS: Preset[] = [
  { id: 'gmail', name: 'Gmail', host: 'imap.gmail.com', port: 993, security: 'tls', smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecurity: 'tls',
    guide: 'Google kræver en app-adgangskode: slå totrinsbekræftelse til på din Google-konto, og lav så en app-adgangskode (16 tegn) med navnet CENTRA. Brug den her i stedet for din normale adgangskode.', link: ['Lav app-adgangskode hos Google', 'https://myaccount.google.com/apppasswords'] },
  { id: 'icloud', name: 'iCloud Mail', host: 'imap.mail.me.com', port: 993, security: 'tls', smtpHost: 'smtp.mail.me.com', smtpPort: 587, smtpSecurity: 'starttls',
    guide: 'Apple kræver en app-specifik adgangskode: log ind på account.apple.com → Log ind og sikkerhed → App-specifikke adgangskoder, og lav en til CENTRA. Brug din @icloud.com-adresse som e-mail.', link: ['Lav app-adgangskode hos Apple', 'https://account.apple.com/account/manage'] },
  { id: 'onecom', name: 'one.com', host: 'imap.one.com', port: 993, security: 'tls', smtpHost: 'send.one.com', smtpPort: 465, smtpSecurity: 'tls',
    guide: 'Brug din fulde e-mailadresse og den adgangskode, du bruger til webmail hos one.com.' },
  { id: 'simply', name: 'Simply.com', host: 'imap.simply.com', port: 993, security: 'tls', smtpHost: 'smtp.simply.com', smtpPort: 587, smtpSecurity: 'starttls',
    guide: 'Brug din fulde e-mailadresse og adgangskoden til postkassen hos Simply.com.' },
  { id: 'outlook', name: 'Outlook / Microsoft 365', host: 'outlook.office365.com', port: 993, security: 'tls', smtpHost: 'smtp.office365.com', smtpPort: 587, smtpSecurity: 'starttls',
    guide: '', blocked: 'Microsoft tillader ikke længere login med adgangskode til Outlook.com og de fleste Microsoft 365-konti. Det kræver et Microsoft-login (OAuth), som kommer i en senere version. Indtil da: lav en videresendelse fra Outlook til en af dine andre konti.' },
  { id: 'other', name: 'Anden (IMAP)', host: '', port: 993, security: 'tls', smtpHost: '', smtpPort: 465, smtpSecurity: 'tls',
    guide: 'Find IMAP- og SMTP-serverne i din udbyders hjælpesider. De fleste bruger port 993 (IMAP) og 465 eller 587 (SMTP).' },
];

export const mailAvailable = isDesktop;

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (!mailAvailable()) throw new Error('Mail virker kun i CENTRA-appen på din Mac.');
  const { invoke } = await import('@tauri-apps/api/core');
  try { return await invoke<T>(cmd, args); } catch (e) { throw new Error(typeof e === 'string' ? e : (e as Error)?.message ?? String(e)); }
}

const wire = (a: MailAccount) => ({
  host: a.host.trim(), port: Number(a.port), security: a.security, user: a.user.trim(), pass: a.pass,
  smtp_host: a.smtpHost.trim(), smtp_port: Number(a.smtpPort), smtp_security: a.smtpSecurity, from_name: a.fromName || null, from_email: a.email.trim(),
});

type Wire = { uid: number; message_id: string; in_reply_to: string; references: string; from_name: string; from_email: string; to: string[]; cc: string[]; subject: string; date: string; text: string; seen: boolean; flagged: boolean; answered: boolean; attachments: string[]; list: boolean; html?: string; parts?: Part[] };
export type Part = { index: number; name: string; mime: string; size: number; cid: string; inline: boolean };
/** HTML up to this size is kept with the mail; bigger mails fetch it again when opened. */
const HTML_KEEP = 250_000;

export const testAccount = (a: MailAccount) => invoke<number>('mail_test', { account: wire(a) });

const RECEIPT = /faktura|kvittering|ordrebekræftelse|ordre ?nr|ordre(n)? er|receipt|invoice|betaling|din bestilling|order confirmation|billet/i;
const ROBOT = /no-?reply|donotreply|do-not-reply|notification|notifikation|mailer-daemon|bounce|news(letter)?@|info@|kundeservice@/i;

export function classify(m: Wire, me: string) {
  const cat = m.list ? 'Nyhedsbreve' : RECEIPT.test(m.subject) || m.attachments.some((x) => /faktura|invoice|kvittering|receipt/i.test(x)) ? 'Kvitteringer'
    : /^(invitation|opdateret invitation|updated invitation)/i.test(m.subject) || m.attachments.some((x) => x.endsWith('.ics')) ? 'Invitationer'
    : ROBOT.test(m.from_email) ? 'Notifikationer' : 'Personer';
  const direct = m.to.some((t) => t.toLowerCase() === me.toLowerCase());
  const recent = !m.date || Date.now() - new Date(m.date).getTime() < 14 * 86400000;
  const needsReply = cat === 'Personer' && direct && !m.answered && recent;
  return { cat, needsReply };
}

const mailId = (acct: string, uid: number) => `m-${acct}-${uid}`;
const preview = (t: string) => t.replace(/\s+/g, ' ').trim().slice(0, 180);

export type SyncResult = { added: string[]; error?: string };

/** Fetches new mail for one account. The first time: the last 30 days (at most 300 mails). */
export async function syncAccount(e: SyncEngine, a: MailAccount): Promise<SyncResult> {
  try {
    const r = await invoke<{ uid_validity: number; messages: Wire[] }>('mail_fetch', { account: wire(a), sinceUid: a.lastUid ?? 0, uidValidity: a.uidValidity ?? 0, days: 30, max: 300 });
    if (a.uidValidity && r.uid_validity !== a.uidValidity) for (const m of e.list('mail')) if ((m as any).acct === a.id) e.remove('mail', m.id);
    const added: string[] = [];
    let last = r.uid_validity === a.uidValidity ? a.lastUid ?? 0 : 0;
    for (const m of r.messages) {
      last = Math.max(last, m.uid);
      const id = mailId(a.id, m.uid);
      if (e.get(id) || e.fieldClock(id, '_deleted')) continue; // deleted here stays deleted
      const { cat, needsReply } = classify(m, a.email);
      e.set('mail', id, {
        acct: a.id, acctName: a.name, uid: m.uid, fromName: m.from_name || m.from_email, fromEmail: m.from_email, to: m.to, cc: m.cc,
        subject: m.subject || '(intet emne)', at: m.date || new Date().toISOString(), preview: preview(m.text), body: m.text,
        unread: !m.seen, flagged: m.flagged, answered: m.answered, attachments: m.attachments, attachment: m.attachments[0] ?? '',
        list: m.list, messageId: m.message_id, inReplyTo: m.in_reply_to, references: m.references, cat, needsReply, archived: false,
        html: (m.html?.length ?? 0) <= HTML_KEEP ? m.html ?? '' : '', parts: m.parts ?? [], full: true,
      });
      added.push(id);
    }
    e.set('mailacct', a.id, { uidValidity: r.uid_validity, lastUid: last, lastSync: new Date().toISOString(), lastError: '' });
    await syncSent(e, { ...a, ...(e.get(a.id) as any) }).catch(() => {}); // a missing Sent folder never stops the inbox
    return { added };
  } catch (err) {
    const msg = (err as Error).message;
    e.set('mailacct', a.id, { lastError: msg, lastSync: new Date().toISOString() });
    return { added: [], error: msg };
  }
}

/* ---------------------------------------------------------------- Sendt */
const sentId = (acct: string, uid: number) => `m-${acct}-s-${uid}`;
const norm = (id?: string) => (id ?? '').trim().replace(/^<|>$/g, '');
/** "Sofie Lund, mads@holm.dk": the names of contacts you have, the address for the rest. */
const toLine = (e: SyncEngine, to: string[]) => {
  if (!to.length) return '(ingen modtager)';
  const known = new Map((e.list('person') as any[]).filter((p) => p.email).map((p) => [String(p.email).toLowerCase(), p.name as string]));
  return to.map((t) => known.get(t.toLowerCase()) ?? t).join(', ');
};

/** What you sent, from the server's own Sent folder (so mails sent from your phone show up too). */
export async function syncSent(e: SyncEngine, a: MailAccount): Promise<string[]> {
  const r = await invoke<{ folder: string; uid_validity: number; messages: Wire[] }>('mail_fetch', { account: wire(a), folder: 'SENT', sinceUid: a.sentLastUid ?? 0, uidValidity: a.sentUidValidity ?? 0, days: 30, max: 200 });
  if (a.sentUidValidity && r.uid_validity !== a.sentUidValidity) for (const m of e.list('mail')) if ((m as any).acct === a.id && (m as any).sent && (m as any).uid) e.remove('mail', m.id);
  const added: string[] = [];
  let last = r.uid_validity === a.sentUidValidity ? a.sentLastUid ?? 0 : 0;
  // Mails sent from CENTRA are already here (made when sent); the server's copy takes their place.
  const local = new Map((e.list('mail') as any[]).filter((m) => m.acct === a.id && m.sent && !m.uid && m.messageId).map((m) => [norm(m.messageId), m]));
  for (const m of r.messages) {
    last = Math.max(last, m.uid);
    const id = sentId(a.id, m.uid);
    if (e.get(id) || e.fieldClock(id, '_deleted')) continue;
    const mine = local.get(norm(m.message_id));
    if (mine) e.remove('mail', mine.id);
    e.set('mail', id, {
      acct: a.id, acctName: a.name, uid: m.uid, folder: r.folder, sent: true,
      fromName: toLine(e, m.to), fromEmail: m.to[0] ?? '', to: m.to, cc: m.cc,
      subject: m.subject || '(intet emne)', at: m.date || new Date().toISOString(), preview: preview(m.text), body: m.text,
      unread: false, flagged: m.flagged, answered: false, attachments: m.attachments, attachment: m.attachments[0] ?? '',
      list: false, messageId: m.message_id, inReplyTo: m.in_reply_to, references: m.references, cat: 'Sendt', needsReply: false, archived: false,
      html: (m.html?.length ?? 0) <= HTML_KEEP ? m.html ?? '' : '', parts: m.parts ?? [], full: true,
    });
    added.push(id);
  }
  e.set('mailacct', a.id, { sentUidValidity: r.uid_validity, sentLastUid: last, sentFolder: r.folder });
  return added;
}

const acctOf = (e: SyncEngine, m: any) => e.get(m.acct) as unknown as MailAccount | null;

/* ---------------------------------------------------------------- the mail as it was sent */
export type Body = { text: string; html: string; parts: Part[] };
/** The mail's own HTML and parts. Kept with the mail when small; fetched from the server otherwise. */
export async function mailBody(e: SyncEngine, m: any): Promise<Body> {
  // Fetched by this version (or opened once already), and not too big to keep: it's all here.
  if (m.full && !m.htmlTooBig) return { text: m.body ?? '', html: m.html ?? '', parts: m.parts ?? [] };
  const a = acctOf(e, m);
  if (!a || !mailAvailable()) return { text: m.body ?? '', html: '', parts: [] };
  const b = await invoke<Body>('mail_body', { account: wire(a), uid: m.uid, folder: m.folder ?? null });
  e.set('mail', m.id, { full: true, parts: b.parts, htmlTooBig: b.html.length > HTML_KEEP, ...(b.html.length <= HTML_KEEP ? { html: b.html } : {}) });
  return b;
}

const partCache = new Map<string, Promise<string>>();
/** One attachment or inline image as a data: URL (cached while the app runs). */
export function mailPart(e: SyncEngine, m: any, index: number): Promise<string> {
  const key = `${m.id}:${index}`;
  let p = partCache.get(key);
  if (!p) {
    const a = acctOf(e, m);
    p = !a ? Promise.reject(new Error('Kontoen findes ikke længere')) : invoke<{ mime: string; data: string }>('mail_part', { account: wire(a), uid: m.uid, index, folder: m.folder ?? null }).then((r) => `data:${r.mime};base64,${r.data}`);
    p.catch(() => partCache.delete(key));
    partCache.set(key, p);
  }
  return p;
}

/** Saves an attachment to Overførsler (and shows it in Finder), or opens it in its own app. */
export async function openMailPart(e: SyncEngine, m: any, index: number, save: boolean): Promise<string> {
  const a = acctOf(e, m);
  if (!a) throw new Error('Kontoen findes ikke længere');
  return invoke<string>('mail_save_part', { account: wire(a), uid: m.uid, index, save, folder: m.folder ?? null });
}

/** Read / unread, star: changed here at once, then on the server in the background. */
export function setMailFlag(e: SyncEngine, m: any, f: { unread?: boolean; flagged?: boolean }) {
  e.set('mail', m.id, f);
  if (m.source === 'lunchhub' || m.sent) return; // read and star are yours alone; LunchHub keeps its own status
  const a = acctOf(e, m);
  if (a && mailAvailable()) void invoke('mail_update', { account: wire(a), uids: [m.uid], seen: f.unread === undefined ? null : !f.unread, flagged: f.flagged ?? null, action: null }).catch(() => {});
}

/** Archive or delete: moves the mail on the server too (to Archive / Trash), so it's gone everywhere. */
export async function moveMail(e: SyncEngine, m: any, action: 'archive' | 'trash') {
  // A LunchHub enquiry is archived in LunchHub (it can't be deleted there); "delete" also hides it here.
  if (m.source === 'lunchhub') { await setLunchHubStatus(e, m, 'arkiv'); if (action === 'trash') e.remove('mail', m.id); return; }
  // What you sent is only tidied away here; the copy in Sent on the server stays.
  if (m.sent) { if (action === 'trash') e.remove('mail', m.id); else e.set('mail', m.id, { archived: true }); return; }
  const a = acctOf(e, m);
  if (a && mailAvailable()) await invoke('mail_update', { account: wire(a), uids: [m.uid], seen: true, flagged: null, action });
  if (action === 'trash') e.remove('mail', m.id); else e.set('mail', m.id, { archived: true, unread: false });
}

/** The mail accounts you can send from (a LunchHub enquiry is answered from one of these). */
export const sendAccounts = (e: SyncEngine) => (e.list('mailacct') as unknown as MailAccount[]).filter((a) => a.enabled !== false);

export async function sendMail(e: SyncEngine, acctId: string, out: { to: string[]; cc?: string[]; subject: string; body: string; replyTo?: any; via?: string }) {
  const lh = out.replyTo?.source === 'lunchhub';
  const a = (lh ? e.get(out.via ?? '') ?? sendAccounts(e)[0] : e.get(acctId)) as unknown as MailAccount;
  if (!a) throw new Error(lh ? 'Tilføj en mailkonto under Forbindelser for at kunne svare.' : 'Kontoen findes ikke længere');
  const r = out.replyTo;
  const references = r ? [r.references, r.messageId].filter(Boolean).join(' ') : null;
  const sent = await invoke<{ from: string; message_id: string; saved_in: string }>('mail_send', { account: wire(a), mail: { to: out.to, cc: out.cc ?? [], subject: out.subject, body: out.body,
    in_reply_to: r?.messageId || null, references } });
  // In Sendt at once; the server's copy replaces it at the next fetch.
  e.set('mail', `m-${a.id}-out-${norm(sent?.message_id) || Date.now()}`, {
    acct: a.id, acctName: a.name, sent: true, fromName: toLine(e, out.to), fromEmail: out.to[0] ?? '', to: out.to, cc: out.cc ?? [],
    subject: out.subject, at: new Date().toISOString(), preview: preview(out.body), body: out.body, unread: false, flagged: false,
    answered: false, attachments: [], attachment: '', list: false, messageId: sent?.message_id ?? '', inReplyTo: r?.messageId ?? '', references: references ?? '',
    cat: 'Sendt', needsReply: false, archived: false, html: '', parts: [], full: true,
  });
  if (r) e.set('mail', r.id, { answered: true, needsReply: false, draft: '' });
  if (lh) await setLunchHubStatus(e, r, 'besvaret').catch(() => {}); // the mail is sent either way
}

/** Checks new mail against the watches Assist was asked to keep ("hold øje med …"). */
export function matchWatches(e: SyncEngine, ids: string[]): { watch: any; mail: any }[] {
  const watches = e.list('watch').filter((w: any) => w.active) as any[];
  const hits: { watch: any; mail: any }[] = [];
  for (const id of ids) {
    const m = e.get(id) as any;
    if (!m) continue;
    for (const w of watches) {
      const from = (w.from ?? '').toLowerCase().trim();
      const subj = (w.subject ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const fromOk = !from || `${m.fromName} ${m.fromEmail}`.toLowerCase().includes(from);
      const subjOk = !subj.length || subj.every((s: string) => `${m.subject} ${m.preview}`.toLowerCase().includes(s));
      if ((from || subj.length) && fromOk && subjOk) {
        hits.push({ watch: w, mail: m });
        e.set('mail', m.id, { watch: w.id });
        e.set('watch', w.id, { lastHit: m.id, lastHitAt: new Date().toISOString(), hits: (w.hits ?? 0) + 1 });
      }
    }
  }
  return hits;
}

let running = false;
/** Fetches all enabled accounts; returns new mail ids and watch hits. */
export async function syncAll(e: SyncEngine) {
  if (running || !mailAvailable()) return { added: [] as string[], hits: [] as ReturnType<typeof matchWatches>, errors: [] as string[], firstLh: true };
  running = true;
  try {
    const accts = e.list('mailacct').filter((a: any) => a.enabled !== false) as unknown as MailAccount[];
    const added: string[] = [], errors: string[] = [];
    for (const a of accts) { const r = await syncAccount(e, a); added.push(...r.added); if (r.error) errors.push(`${a.name}: ${r.error}`); }
    const firstRun = accts.some((a) => !a.lastUid);
    const firstLh = (e.list('lhconn') as any[]).some((c) => c.enabled !== false && !c.since);
    const lh = await syncAllLunchHub(e);
    errors.push(...lh.errors);
    return { added: [...added, ...lh.added], hits: firstRun ? [] : matchWatches(e, added), errors, firstLh };
  } finally { running = false; }
}
