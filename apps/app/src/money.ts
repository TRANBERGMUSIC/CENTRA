/**
 * Money, people and the maths behind udlæg (shared costs) and udgifter (spending).
 * Amounts are kroner as numbers; every split is done in whole øre so totals always add up.
 */
import type { SyncEngine } from '@centra/sync';

/* ---------------------------------------------------------------- formatting */
export const kr = (n: number, opts: { sign?: boolean; short?: boolean } = {}) => {
  const v = Math.round((n ?? 0) * 100) / 100;
  const s = v.toLocaleString('da-DK', { minimumFractionDigits: opts.short || Number.isInteger(v) ? 0 : 2, maximumFractionDigits: opts.short ? 0 : 2 });
  return `${opts.sign && v > 0 ? '+' : ''}${s} kr`;
};
/** "1.234,50", "1234.5", "12,-", "99 kr" → number (NaN when it isn't one). */
export function parseKr(s: string | number): number {
  if (typeof s === 'number') return s;
  let t = String(s).replace(/kr\.?|dkk|,-|\s/gi, '').trim();
  if (!t) return NaN;
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{1,2}$/.test(t)) t = t.replace(/,/g, '');
  else t = t.replace(/[.,]/g, '');
  return Number(t);
}
const ore = (n: number) => Math.round(n * 100);

/* ---------------------------------------------------------------- people (contacts) */
export type Social = { kind: string; value: string };
export type Person = {
  id: string; name: string; phone?: string; email?: string; socials?: Social[]; relation?: string; notes?: string;
  photo?: string; birthday?: string; address?: string; company?: string; tags?: string[]; createdAt?: string;
  /** More numbers, mails and addresses (from an import, or added by hand). */
  extra?: { label: string; value: string }[];
  /** The contact it came from on the Mac (or in a vCard), so a new import updates instead of duplicating. */
  macId?: string;
};
export const ME = 'me';
export const SOCIALS: [string, string, (v: string) => string][] = [
  ['Instagram', 'instagram', (v) => `https://instagram.com/${v.replace(/^@/, '')}`],
  ['Facebook', 'facebook', (v) => (/^https?:/.test(v) ? v : `https://facebook.com/${v.replace(/^@/, '')}`)],
  ['TikTok', 'tiktok', (v) => `https://www.tiktok.com/@${v.replace(/^@/, '')}`],
  ['Snapchat', 'snapchat', (v) => `https://www.snapchat.com/add/${v.replace(/^@/, '')}`],
  ['LinkedIn', 'linkedin', (v) => (/^https?:/.test(v) ? v : `https://www.linkedin.com/in/${v.replace(/^@/, '')}`)],
  ['X', 'x', (v) => `https://x.com/${v.replace(/^@/, '')}`],
  ['Hjemmeside', 'web', (v) => (/^https?:/.test(v) ? v : `https://${v}`)],
];
export const socialUrl = (s: Social) => (SOCIALS.find(([, k]) => k === s.kind)?.[2] ?? ((v: string) => v))(s.value.trim());
export const RELATIONS = ['Familie', 'Ven', 'Kæreste', 'Kollega', 'Arbejde', 'Kunde', 'Bekendt', 'Andet'];

export const people = (e: SyncEngine) => e.list('person') as unknown as Person[];
export const personName = (e: SyncEngine, id: string) => (id === ME ? 'Mig' : (e.get(id) as unknown as Person | null)?.name ?? 'Ukendt');
export const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('') || '?';
export const hueOf = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

/** Finds a contact by full name, unique first name, e-mail or phone; creates one when nobody matches. */
export function findPerson(e: SyncEngine, q: string): Person | null {
  const t = q.trim().toLowerCase();
  if (!t) return null;
  const all = people(e);
  return all.find((p) => p.id === q) ?? all.find((p) => p.name.toLowerCase() === t) ?? all.find((p) => p.email?.toLowerCase() === t) ?? all.find((p) => p.phone?.replace(/\s/g, '') === t.replace(/\s/g, ''))
    ?? (() => { const first = all.filter((p) => p.name.toLowerCase().split(/\s+/)[0] === t.split(/\s+/)[0] && !t.includes(' ')); return first.length === 1 ? first[0] : null; })();
}
export function findOrCreatePerson(e: SyncEngine, name: string, fields: Partial<Person> = {}): { id: string; created: boolean } {
  if (['mig', 'me', 'jeg', 'willads'].includes(name.trim().toLowerCase())) return { id: ME, created: false };
  const p = findPerson(e, name);
  if (p) return { id: p.id, created: false };
  const id = e.create('person', { name: name.trim().replace(/^./, (c) => c.toUpperCase()), createdAt: new Date().toISOString(), ...fields });
  return { id, created: true };
}

/* ---------------------------------------------------------------- udlæg */
export type Item = { id: string; name: string; amount: number; who: string[] };
export type Outlay = { id: string; title: string; place?: string; date: string; items: Item[]; people: string[]; receipt?: string; note?: string; countMine?: boolean; category?: string; createdAt?: string };
export type Payment = { id: string; outlay: string; person: string; amount: number; at: string; note?: string };

export const total = (o: Pick<Outlay, 'items'>) => (o.items ?? []).reduce((s, i) => s + ore(i.amount || 0), 0) / 100;

/** What each participant's part of the bill is (me included). Each item is split evenly among its "who". */
export function shares(o: Pick<Outlay, 'items' | 'people'>): Record<string, number> {
  const ppl = o.people ?? [];
  const exact: Record<string, number> = Object.fromEntries(ppl.map((p) => [p, 0]));
  let cents = 0;
  for (const it of o.items ?? []) {
    const who = (it.who?.length ? it.who : ppl).filter((w) => ppl.includes(w));
    if (!who.length) continue;
    const c = ore(it.amount || 0);
    cents += c;
    for (const w of who) exact[w] += c / who.length;
  }
  // Round each person's total once; leftover øre go to the largest remainders, me first on ties.
  const out: Record<string, number> = Object.fromEntries(ppl.map((p) => [p, Math.floor(exact[p] + 1e-9)]));
  let rest = cents - Object.values(out).reduce((a, b) => a + b, 0);
  const order = [...ppl].sort((a, b) => (exact[b] - Math.floor(exact[b] + 1e-9)) - (exact[a] - Math.floor(exact[a] + 1e-9)) || (a === ME ? -1 : b === ME ? 1 : 0));
  for (const p of order) { if (rest <= 0) break; if (exact[p] - out[p] > 1e-9) { out[p]++; rest--; } }
  for (const k of Object.keys(out)) out[k] = out[k] / 100;
  return out;
}

export type Owed = { person: string; share: number; paid: number; left: number };
export function owed(o: Outlay, payments: Payment[]): Owed[] {
  const sh = shares(o);
  return Object.entries(sh).filter(([p]) => p !== ME).map(([person, share]) => {
    const paid = payments.filter((x) => x.outlay === o.id && x.person === person).reduce((s, x) => s + ore(x.amount), 0) / 100;
    return { person, share, paid, left: Math.max(0, Math.round((share - paid) * 100) / 100) };
  });
}
export const isOpen = (o: Outlay, payments: Payment[]) => owed(o, payments).some((x) => x.left > 0.004);

/** Per person across every udlæg: how much they owe in total right now. */
export function balances(e: SyncEngine) {
  const outlays = e.list('outlay') as unknown as Outlay[];
  const pays = e.list('payment') as unknown as Payment[];
  const by = new Map<string, { person: string; share: number; paid: number; left: number; open: string[] }>();
  for (const o of outlays) for (const w of owed(o, pays)) {
    const b = by.get(w.person) ?? { person: w.person, share: 0, paid: 0, left: 0, open: [] };
    b.share += w.share; b.paid += w.paid; b.left = Math.round((b.left + w.left) * 100) / 100;
    if (w.left > 0.004) b.open.push(o.id);
    by.set(w.person, b);
  }
  return [...by.values()].filter((b) => b.share > 0).sort((a, b) => b.left - a.left);
}

/**
 * A payment from someone who owes across several udlæg: it pays off the oldest first.
 * Returns the payment ids created (for undo).
 */
export function payBack(e: SyncEngine, person: string, amount: number, note = ''): string[] {
  const outlays = (e.list('outlay') as unknown as Outlay[]).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  let left = ore(amount);
  const ids: string[] = [];
  for (const o of outlays) {
    if (left <= 0) break;
    const w = owed(o, e.list('payment') as unknown as Payment[]).find((x) => x.person === person);
    if (!w || w.left <= 0) continue;
    const take = Math.min(left, ore(w.left));
    ids.push(e.create('payment', { outlay: o.id, person, amount: take / 100, at: new Date().toISOString(), note }));
    left -= take;
  }
  if (left > 0 && ids.length) { const last = e.get(ids[ids.length - 1]) as unknown as Payment; e.set('payment', last.id, { amount: last.amount + left / 100, note: (note ? note + ' · ' : '') + 'mere end skyldt' }); }
  return ids;
}

/** Turns "Pizza 120\n2x øl 90,50" into items (no AI needed for simple lists). */
export function parseItemLines(text: string): { name: string; amount: number }[] {
  const out: { name: string; amount: number }[] = [];
  for (const raw of text.split(/\n|;/)) {
    const l = raw.trim();
    const a = /^(.*?)[\s:=]+(\d[\d.,]*)\s*(?:kr\.?|dkk|,-)?$/i.exec(l);
    const b = a ? null : /^(\d[\d.,]*)\s*(?:kr\.?|dkk)?\s+(.+)$/i.exec(l);
    if (!a && !b) continue;
    const name = (a ? a[1] : b![2]).trim().replace(/[\s:=-]+$/, ''), amount = parseKr(a ? a[2] : b![1]);
    if (name && Number.isFinite(amount) && amount > 0) out.push({ name, amount });
  }
  return out;
}

/* ---------------------------------------------------------------- udgifter */
export type Interval = 'month' | 'year' | 'quarter' | 'halfyear' | 'week' | 'once';
export type Expense = {
  id: string; name: string; amount: number; interval: Interval; category: string;
  /** For recurring: the first payment date; the day of month repeats. For 'once': the date. */
  date: string; end?: string; cancelUrl?: string; site?: string; note?: string; active?: boolean;
};
export const INTERVALS: [Interval, string][] = [['month', 'Hver måned'], ['quarter', 'Hvert kvartal'], ['halfyear', 'Hvert halve år'], ['year', 'Hvert år'], ['week', 'Hver uge'], ['once', 'Én gang']];
/** Fixed order: a category keeps its colour no matter what else is on screen. */
export const CATEGORIES = ['Bolig', 'Abonnementer', 'Transport', 'Mad & ude', 'Forsikring', 'Telefon & internet', 'Fitness & sundhed', 'Lån & gæld', 'Andet'];

const monthsBetween = (a: Date, b: Date) => (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** What one expense costs per month on average. */
export function perMonth(x: Expense) {
  if (x.active === false || x.interval === 'once') return 0;
  return { month: x.amount, quarter: x.amount / 3, halfyear: x.amount / 6, year: x.amount / 12, week: (x.amount * 52) / 12 }[x.interval] ?? 0;
}

/** Payment dates of one expense inside [from, to). */
export function payDates(x: Expense, from: Date, to: Date): Date[] {
  if (x.active === false && x.interval !== 'once') return [];
  const start = new Date(x.date + 'T12:00');
  if (isNaN(start.getTime())) return [];
  const end = x.end ? new Date(x.end + 'T23:59') : null;
  const out: Date[] = [];
  if (x.interval === 'once') return start >= from && start < to ? [start] : [];
  if (x.interval === 'week') {
    for (let d = new Date(start); d < to && out.length < 600; d.setDate(d.getDate() + 7)) if (d >= from && (!end || d <= end)) out.push(new Date(d));
    return out;
  }
  const step = { month: 1, quarter: 3, halfyear: 6, year: 12 }[x.interval];
  for (let k = Math.max(0, Math.floor(monthsBetween(start, from) / step) * step); out.length < 600; k += step) {
    const d = new Date(start.getFullYear(), start.getMonth() + k, 1, 12);
    d.setDate(Math.min(start.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    if (d >= to) break;
    if (d >= from && d >= start && (!end || d <= end)) out.push(d);
  }
  return out;
}

export type Spend = { name: string; amount: number; category: string; date: string; source: 'expense' | 'outlay'; ref: string };
/** Every krone spent in a month: fixed expenses, one-offs and your own share of udlæg. */
export function monthSpend(e: SyncEngine, year: number, month: number): Spend[] {
  const from = new Date(year, month, 1), to = new Date(year, month + 1, 1);
  const out: Spend[] = [];
  for (const x of e.list('expense') as unknown as Expense[]) for (const d of payDates(x, from, to)) out.push({ name: x.name, amount: x.amount, category: x.category || 'Andet', date: ymd(d), source: 'expense', ref: x.id });
  for (const o of e.list('outlay') as unknown as Outlay[]) {
    if (o.countMine === false) continue;
    const d = new Date((o.date ?? '') + 'T12:00');
    if (!(d >= from && d < to)) continue;
    const mine = shares(o)[ME] ?? 0;
    if (mine > 0) out.push({ name: `${o.title} (din andel)`, amount: mine, category: o.category || 'Mad & ude', date: o.date, source: 'outlay', ref: o.id });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Well-known services: where to cancel or change the plan. Matched on the name you type. */
export const SERVICES: { name: string; match: RegExp; category: string; cancel: string }[] = [
  { name: 'Netflix', match: /netflix/i, category: 'Abonnementer', cancel: 'https://www.netflix.com/cancelplan' },
  { name: 'Spotify', match: /spotify/i, category: 'Abonnementer', cancel: 'https://www.spotify.com/account/subscription/' },
  { name: 'Disney+', match: /disney/i, category: 'Abonnementer', cancel: 'https://www.disneyplus.com/account/subscription' },
  { name: 'YouTube Premium', match: /youtube/i, category: 'Abonnementer', cancel: 'https://www.youtube.com/paid_memberships' },
  { name: 'Apple (abonnementer)', match: /apple|icloud|app store|apple music|apple tv/i, category: 'Abonnementer', cancel: 'https://apps.apple.com/account/subscriptions' },
  { name: 'Google Play / Google One', match: /google ?(one|play)/i, category: 'Abonnementer', cancel: 'https://play.google.com/store/account/subscriptions' },
  { name: 'Microsoft 365 / Xbox', match: /microsoft|office 365|xbox|game ?pass/i, category: 'Abonnementer', cancel: 'https://account.microsoft.com/services' },
  { name: 'Adobe', match: /adobe|photoshop|lightroom|creative cloud/i, category: 'Abonnementer', cancel: 'https://account.adobe.com/plans' },
  { name: 'Amazon Prime', match: /amazon|prime video/i, category: 'Abonnementer', cancel: 'https://www.amazon.de/gp/primecentral' },
  { name: 'Dropbox', match: /dropbox/i, category: 'Abonnementer', cancel: 'https://www.dropbox.com/account/plan' },
  { name: 'ChatGPT', match: /chatgpt|openai/i, category: 'Abonnementer', cancel: 'https://chatgpt.com/#settings/Subscription' },
  { name: 'Claude', match: /claude|anthropic/i, category: 'Abonnementer', cancel: 'https://claude.ai/settings/billing' },
];
export const serviceFor = (name: string) => SERVICES.find((s) => s.match.test(name));
/** A cancel link we can always offer: the known page, your own link, or a search for how to cancel. */
export const cancelLink = (x: Pick<Expense, 'name' | 'cancelUrl'>) => x.cancelUrl || serviceFor(x.name)?.cancel || `https://www.google.com/search?q=${encodeURIComponent('opsig ' + x.name)}`;
