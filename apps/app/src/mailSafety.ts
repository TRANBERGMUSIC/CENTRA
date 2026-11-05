/**
 * Scam and phishing in the inbox. Every new mail is looked over the moment it arrives:
 *  - phishing: pretends to be someone you trust (MitID, your bank, PostNord, Netflix …) to get your
 *    login, card or MitID: the name doesn't match where it comes from, links lead somewhere else than
 *    they say, the mail server couldn't confirm the sender, it asks you to log in or pay, it hurries you;
 *  - svindel: promises winnings, inheritance or quick money, threatens you ("I have recorded you"),
 *    wants gift cards or crypto, or the mail server itself marked it as spam.
 * A hit is flagged, gets the reasons in plain words, and goes to its own folder ("Phishing" or
 * "Svindel"). Your contacts, people you've written to and senders you've cleared are never flagged.
 * Everything happens here on the device; nothing is sent anywhere to be checked.
 */
import type { SyncEngine } from '@centra/sync';

export type Danger = 'phishing' | 'scam';
export type Verdict = { danger: Danger | null; why: string[] };
type MailLike = { list?: boolean; fromName?: string; fromEmail?: string; replyTo?: string; subject?: string; body?: string; preview?: string; html?: string; auth?: string; spam?: boolean; attachments?: string[] };

export const SAFETY_FOLDERS: Record<Danger, { id: string; name: string }> = {
  phishing: { id: 'mailfolder-phishing', name: 'Phishing' },
  scam: { id: 'mailfolder-scam', name: 'Svindel' },
};
const SAFE = 'setting-mailsafe';
/** Bumped when the rules get better, so mails already here are looked over again. */
const VERSION = 1;

/** Who mails come from in real life: the name people use, and the domains they really send from. */
const BRANDS: [RegExp, string[]][] = [
  [/\bmit ?id\b/i, ['mitid.dk']], [/\bnem ?id\b/i, ['nemid.nu']], [/\be-?boks\b/i, ['e-boks.dk', 'e-boks.com']],
  [/\bskat(testyrelsen)?\b|\bskat\.dk\b/i, ['skat.dk', 'sktst.dk']], [/\bborger\.dk\b|\budbetaling danmark\b/i, ['borger.dk', 'atp.dk', 'udbetaling.dk']],
  [/\bpost ?nord\b/i, ['postnord.dk', 'postnord.com', 'postnord.se']], [/\bgls\b/i, ['gls-group.eu', 'gls.dk', 'gls-group.com']], [/\bdao\b/i, ['dao.as', 'dao.dk']],
  [/\bbring\b/i, ['bring.dk', 'bring.com', 'posten.no']], [/\bdhl\b/i, ['dhl.com', 'dhl.dk', 'dhl.de']], [/^ups\b/i, ['ups.com']], [/\bfedex\b/i, ['fedex.com']],
  [/\bmobile ?pay\b/i, ['mobilepay.dk', 'vippsmobilepay.com']], [/\bdanske ?bank\b/i, ['danskebank.dk', 'danskebank.com']], [/\bnordea\b/i, ['nordea.dk', 'nordea.com']],
  [/\bjyske ?bank\b/i, ['jyskebank.dk']], [/\bnykredit\b/i, ['nykredit.dk']], [/\bsydbank\b/i, ['sydbank.dk']], [/\barbejdernes landsbank\b/i, ['al-bank.dk']], [/\bspar nord\b/i, ['sparnord.dk']],
  [/\bnets\b|\bdankort\b/i, ['nets.eu', 'nets.dk', 'dankort.dk']], [/\bnetflix\b/i, ['netflix.com']], [/\bapple\b|\bicloud\b|\bitunes\b/i, ['apple.com', 'icloud.com', 'itunes.com', 'insideapple.apple.com']],
  [/\bmicrosoft\b|\boffice ?365\b/i, ['microsoft.com', 'office.com', 'outlook.com', 'microsoftonline.com', 'live.com']],
  [/\bpaypal\b/i, ['paypal.com', 'paypal.dk']], [/\bamazon\b/i, ['amazon.com', 'amazon.de', 'amazon.co.uk', 'amazon.se']], [/\bfacebook\b|\binstagram\b/i, ['facebookmail.com', 'facebook.com', 'meta.com', 'instagram.com', 'mail.instagram.com']],
  [/\bspotify\b/i, ['spotify.com']], [/\bdisney\+?\b/i, ['disneyplus.com', 'disney.com']], [/\bviaplay\b/i, ['viaplay.dk', 'viaplay.com']], [/\bhbo max\b/i, ['hbomax.com', 'max.com']],
  [/\btelenor\b/i, ['telenor.dk']], [/\btelia\b/i, ['telia.dk']], [/\byousee\b/i, ['yousee.dk']], [/\bnorlys\b/i, ['norlys.dk']], [/\bpolitiet\b/i, ['politi.dk']],
  [/\bcoinbase\b/i, ['coinbase.com']], [/\bbinance\b/i, ['binance.com']], [/\bdsb\b/i, ['dsb.dk']], [/\brejsekort\b/i, ['rejsekort.dk']], [/\bwolt\b/i, ['wolt.com']], [/\bjust ?eat\b/i, ['just-eat.dk', 'justeat.dk']],
  [/\bgoogle\b|\bgmail\b/i, ['google.com', 'accounts.google.com']], [/\bmastercard\b/i, ['mastercard.com']],
];
const FREEMAIL = /(^|\.)(gmail|googlemail|hotmail|outlook|live|yahoo|aol|icloud|me|mail|gmx|protonmail|proton|yandex|zoho)\.[a-z.]+$/i;
const SHORTENERS = /^(bit\.ly|tinyurl\.com|t\.co|cutt\.ly|is\.gd|rb\.gy|ow\.ly|shorturl\.at|tiny\.cc|rebrand\.ly|s\.id|buff\.ly)$/i;

const ASK = /bekræft (din|dine|jeres) (konto|identitet|oplysninger)|verific[eé]r|opdater (din|dine) (oplysninger|betaling|kort)|kortoplysninger|dit (betalings)?kort er|betal (told|fragt|gebyret)|toldgebyr|fragtgebyr|din konto (er|bliver) (spærret|lukket|suspenderet|låst)|din mitid (udløber|er spærret)|log ind (her|for at)|indtast (din|dit) (kode|adgangskode|cpr)|verify your (account|identity)|confirm your (account|identity|details)|unusual (sign-?in|activity)|password (expires|expired)|account (suspended|locked|on hold)|update (your )?payment|payment (failed|declined)|betaling(en)? (mislykkedes|blev afvist)|refund|tilbagebetaling/i;
const HURRY = /inden for 24 timer|inden 24 timer|inden for 48 timer|i dag inden|straks|omgående|sidste (chance|advarsel)|within (24|48) hours|immediately|final (notice|warning)|act now|urgent/i;
const SCAM: [RegExp, string][] = [
  [/du har vundet|lotteri(et)?\b|lottery|you (have |'ve )?won|you('ve| have) been selected|congratulations.{0,40}(won|winner)/i, 'Lover en gevinst, du ikke har deltaget om.'],
  [/\barv\b|inheritance|beneficiary|next of kin|deceased|million (dollars|usd|euro)|\$\d+[.,]?\d* ?(million|m)\b/i, 'Lover arv eller store pengebeløb.'],
  [/i have (access|hacked|recorded)|recorded you|your webcam|din webcam|optaget dig|pay .{0,20}bitcoin|btc wallet|bitcoin[- ]?adresse/i, 'Truer dig og kræver betaling i kryptovaluta.'],
  [/gavekort|gift ?cards?|itunes card|steam card|western union|moneygram/i, 'Beder om betaling med gavekort eller pengeoverførsel.'],
  [/garanteret afkast|guaranteed (return|profit)|investér? i (bitcoin|krypto)|crypto (investment|trading)|double your (money|bitcoin)|tjen \d+ ?kr\.? om dagen/i, 'Lover hurtige penge eller investering uden risiko.'],
];
const BAD_ATTACH = /\.(exe|scr|js|jse|vbs|bat|cmd|com|pif|iso|img|msi|jar|lnk|hta|html?|svg)$|\.(pdf|docx?|xlsx?|jpe?g)\.[a-z0-9]{2,4}$/i;

const domainOf = (addr = '') => addr.split('@')[1]?.toLowerCase().trim() ?? '';
const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const isFrom = (domain: string, list: string[]) => list.some((d) => domain === d || domain.endsWith('.' + d));
/** "mail.danskebank.dk" and "danskebank.dk" are the same place; "danskebank-dk.info" is not. */
const site = (host: string) => host.split('.').slice(-2).join('.');

function links(m: MailLike): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  const html = m.html ?? '';
  const re = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let x: RegExpExecArray | null;
  while ((x = re.exec(html)) && out.length < 200) out.push({ href: x[1].trim(), text: x[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() });
  for (const u of String(m.body ?? '').match(/https?:\/\/[^\s<>()"']+/g) ?? []) if (out.length < 300) out.push({ href: u, text: '' });
  return out;
}

/** Looks a mail over. `trusted` = the sender is a contact, someone you've written to, or cleared by you. */
export function judge(m: MailLike, trusted = false): Verdict {
  if (trusted) return { danger: null, why: [] };
  const name = String(m.fromName ?? ''), from = String(m.fromEmail ?? '').toLowerCase(), dom = domainOf(from);
  const subject = String(m.subject ?? ''), text = `${subject}\n${m.body ?? m.preview ?? ''}`;
  const auth = String(m.auth ?? '');
  let ph = 0, sc = 0;
  const why: string[] = [];
  const add = (p: number, s: number, reason: string) => { ph += p; sc += s; if (!why.includes(reason)) why.push(reason); };

  // Pretends to be a known company or authority.
  for (const [re, domains] of BRANDS) {
    const inName = re.test(name), inDomain = re.test(dom.replace(/[-.]/g, ' ')), inSubject = re.test(subject);
    if (!inName && !inDomain && !inSubject) continue;
    if (isFrom(dom, domains)) continue;
    const brand = (name.match(re) ?? dom.replace(/[-.]/g, ' ').match(re) ?? subject.match(re))?.[0] ?? '';
    if (inName || inDomain) add(4, 0, `Afsenderen kalder sig ${brand.trim()}, men mailen kommer fra ${dom || 'en ukendt adresse'}.`);
    else if (ASK.test(text)) add(2, 0, `Handler om ${brand.trim()}, men kommer ikke fra ${brand.trim()}.`);
    break;
  }
  // A name that is itself an address ("support@paypal.com" <x@andet.ru>).
  const inner = name.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0]?.toLowerCase();
  if (inner && domainOf(inner) !== dom) add(3, 0, `Navnet viser ${inner}, men mailen kommer fra ${from}.`);
  // The mail server's own check of the sender.
  if (/dmarc=fail/.test(auth)) add(3, 1, 'Mailserveren kunne ikke bekræfte, at mailen kommer fra den, der står som afsender.');
  else if (/spf=(fail|softfail)/.test(auth) && /dkim=(fail|none|neutral)/.test(auth)) add(2, 1, 'Mailserveren kunne ikke bekræfte afsenderen.');
  if (m.spam) add(1, 3, 'Mailserveren har selv markeret den som spam.');
  // Links that lie about where they go.
  let lying = 0, ip = 0, short = 0;
  for (const l of links(m)) {
    const h = hostOf(l.href);
    if (!h) continue;
    const shown = (l.text.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i)?.[1] ?? '').toLowerCase();
    if (shown && /\.[a-z]{2,}$/.test(shown) && site(shown) !== site(h) && lying < 1) { lying++; add(m.list ? 2 : 4, 0, `Et link viser "${shown}", men fører til ${h}.`); }
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) && ip < 1) { ip++; add(2, 0, 'Et link går til en IP-adresse i stedet for et navn.'); }
    if (SHORTENERS.test(h) && short < 1) { short++; add(1, 0, 'Linket skjuler, hvor det fører hen.'); }
  }
  const asks = ASK.test(text), hurry = HURRY.test(text);
  if (asks) add(2, 0, 'Beder dig logge ind, bekræfte dine oplysninger eller betale.');
  if (hurry) add(1, 1, 'Presser på med en kort frist.');
  // Replies go somewhere else.
  const rt = String(m.replyTo ?? '').toLowerCase();
  if (rt && site(domainOf(rt)) !== site(dom)) add(asks ? 2 : 1, 1, `Svar går til en anden adresse (${rt}).`);
  // A company name from a free mail address.
  if (FREEMAIL.test(dom) && /\b(support|kundeservice|service|team|sikkerhed|security|admin|bank|faktura|billing)\b/i.test(name)) add(2, 1, `"${name}" skriver fra en privat mailadresse (${dom}).`);
  // Attachments that run programs or pretend to be documents.
  const badFile = (m.attachments ?? []).find((a) => BAD_ATTACH.test(a));
  if (badFile) add(3, 1, `Vedhæftningen ${badFile} kan være skadelig.`);
  for (const [re, reason] of SCAM) if (re.test(text)) add(0, 4, reason);

  // A sender the mail server could confirm, and newsletters you signed up for, need more to be flagged.
  const impersonates = why.some((w) => w.startsWith('Afsenderen kalder sig') || w.startsWith('Navnet viser'));
  if (/dmarc=pass/.test(auth) && !impersonates) ph -= 2;
  const scamAt = m.list ? 6 : 4;
  const danger: Danger | null = ph >= 5 && ph >= sc ? 'phishing' : sc >= scamAt ? 'scam' : ph >= 5 ? 'phishing' : null;
  return { danger, why: danger ? why : [] };
}

/* ---------------------------------------------------------------- in CENTRA */
const safeList = (e: SyncEngine) => (e.get(SAFE) as { senders?: string[] } | null)?.senders ?? [];

/** Contacts, people you've written to, senders you've cleared: their mails are never flagged. */
export function trustedSenders(e: SyncEngine): Set<string> {
  const s = new Set<string>(safeList(e).map((x) => x.toLowerCase()));
  for (const p of e.list('person') as any[]) if (p.email) s.add(String(p.email).toLowerCase());
  for (const m of e.list('mail') as any[]) if (m.sent) for (const t of m.to ?? []) s.add(String(t).toLowerCase());
  return s;
}

function folderFor(e: SyncEngine, d: Danger): string {
  const f = SAFETY_FOLDERS[d];
  const have = e.get(f.id) as any;
  if (!have || have._deleted) e.set('mailfolder', f.id, { name: f.name, system: d, order: d === 'phishing' ? -20 : -19, createdAt: new Date().toISOString(), _deleted: false });
  return f.id;
}

/** Looks over new mail (or everything not yet looked over) and moves what's dangerous to its folder. */
export function screenMail(e: SyncEngine, ids?: string[]): string[] {
  const trusted = trustedSenders(e);
  const list = ids ? ids.map((id) => e.get(id) as any).filter(Boolean) : (e.list('mail') as any[]).filter((m) => (m.screened ?? 0) < VERSION);
  const hits: string[] = [];
  for (const m of list) {
    if (m.sent || m.source === 'lunchhub') { if ((m.screened ?? 0) < VERSION) e.set('mail', m.id, { screened: VERSION }); continue; }
    const v = m.dangerOk ? { danger: null, why: [] } : judge(m, trusted.has(String(m.fromEmail ?? '').toLowerCase()));
    const fields: Record<string, unknown> = { screened: VERSION };
    if (v.danger && !m.danger) {
      Object.assign(fields, { danger: v.danger, dangerWhy: v.why, flagged: m.flagged });
      if (!m.mboxManual && !m.archived) fields.mbox = folderFor(e, v.danger);
      hits.push(m.id);
    }
    e.set('mail', m.id, fields);
  }
  return hits;
}

/** "Ikke svindel": back to Indbakke, and the sender is trusted from now on. */
export function clearDanger(e: SyncEngine, m: any) {
  const before = { danger: m.danger ?? null, dangerWhy: m.dangerWhy ?? [], mbox: m.mbox ?? '', dangerOk: !!m.dangerOk, mboxManual: !!m.mboxManual };
  e.set('mail', m.id, { danger: null, dangerWhy: [], dangerOk: true, mbox: '', mboxManual: true });
  const from = String(m.fromEmail ?? '').toLowerCase();
  const senders = safeList(e);
  if (from && !senders.includes(from)) e.set('setting', SAFE, { senders: [...senders, from].slice(-500) });
  return () => { e.set('mail', m.id, before); if (from) e.set('setting', SAFE, { senders: safeList(e).filter((s) => s !== from) }); };
}

/** Marks a mail as scam or phishing by hand (it goes to that folder). */
export function markDanger(e: SyncEngine, m: any, d: Danger) {
  e.set('mail', m.id, { danger: d, dangerWhy: m.dangerWhy?.length ? m.dangerWhy : ['Markeret af dig.'], dangerOk: false, mbox: folderFor(e, d), mboxManual: true });
}
