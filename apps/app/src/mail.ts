/**
 * Mail accounts in CENTRA (Mac app): IMAP for reading, SMTP for sending, run by the Rust side.
 *
 * Accounts (with their app passwords) live in the encrypted engine as `mailacct` records, so
 * they're protected by your CENTRA password like everything else. Mails are stored as `mail`
 * records with a stable id per account + IMAP UID, so fetching twice never duplicates.
 */
import type { SyncEngine } from '@centra/sync';
const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type Security = 'tls' | 'starttls' | 'none';
export type MailAccount = {
  id: string; name: string; provider: string; email: string; fromName?: string;
  host: string; port: number; security: Security; user: string; pass: string;
  smtpHost: string; smtpPort: number; smtpSecurity: Security;
  uidValidity?: number; lastUid?: number; lastSync?: string; lastError?: string; enabled?: boolean;
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

type Wire = { uid: number; message_id: string; in_reply_to: string; references: string; from_name: string; from_email: string; to: string[]; cc: string[]; subject: string; date: string; text: string; seen: boolean; flagged: boolean; answered: boolean; attachments: string[]; list: boolean };

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
      });
      added.push(id);
    }
    e.set('mailacct', a.id, { uidValidity: r.uid_validity, lastUid: last, lastSync: new Date().toISOString(), lastError: '' });
    return { added };
  } catch (err) {
    const msg = (err as Error).message;
    e.set('mailacct', a.id, { lastError: msg, lastSync: new Date().toISOString() });
    return { added: [], error: msg };
  }
}

const acctOf = (e: SyncEngine, m: any) => e.get(m.acct) as unknown as MailAccount | null;

/** Read / unread, star: changed here at once, then on the server in the background. */
export function setMailFlag(e: SyncEngine, m: any, f: { unread?: boolean; flagged?: boolean }) {
  e.set('mail', m.id, f);
  const a = acctOf(e, m);
  if (a && mailAvailable()) void invoke('mail_update', { account: wire(a), uids: [m.uid], seen: f.unread === undefined ? null : !f.unread, flagged: f.flagged ?? null, action: null }).catch(() => {});
}

/** Archive or delete: moves the mail on the server too (to Archive / Trash), so it's gone everywhere. */
export async function moveMail(e: SyncEngine, m: any, action: 'archive' | 'trash') {
  const a = acctOf(e, m);
  if (a && mailAvailable()) await invoke('mail_update', { account: wire(a), uids: [m.uid], seen: true, flagged: null, action });
  if (action === 'trash') e.remove('mail', m.id); else e.set('mail', m.id, { archived: true, unread: false });
}

export async function sendMail(e: SyncEngine, acctId: string, out: { to: string[]; cc?: string[]; subject: string; body: string; replyTo?: any }) {
  const a = e.get(acctId) as unknown as MailAccount;
  if (!a) throw new Error('Kontoen findes ikke længere');
  const r = out.replyTo;
  await invoke('mail_send', { account: wire(a), mail: { to: out.to, cc: out.cc ?? [], subject: out.subject, body: out.body,
    in_reply_to: r?.messageId || null, references: r ? [r.references, r.messageId].filter(Boolean).join(' ') : null } });
  if (r) e.set('mail', r.id, { answered: true, needsReply: false, draft: '' });
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
  if (running || !mailAvailable()) return { added: [] as string[], hits: [] as ReturnType<typeof matchWatches>, errors: [] as string[] };
  running = true;
  try {
    const accts = e.list('mailacct').filter((a: any) => a.enabled !== false) as unknown as MailAccount[];
    const added: string[] = [], errors: string[] = [];
    for (const a of accts) { const r = await syncAccount(e, a); added.push(...r.added); if (r.error) errors.push(`${a.name}: ${r.error}`); }
    const firstRun = accts.some((a) => !a.lastUid);
    return { added, hits: firstRun ? [] : matchWatches(e, added), errors };
  } finally { running = false; }
}
