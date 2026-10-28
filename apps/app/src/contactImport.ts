/**
 * Importing contacts: from the Mac's Contacts app (native, see apps/desktop/src-tauri/src/contacts)
 * or from a vCard file (.vcf, exported from Contacts, iCloud, Google or a phone).
 *
 * Everything becomes the same `Incoming` shape, then each is matched against the people already in
 * CENTRA (same Mac contact, same mail, same number, or same name). A match only gains what it lacks:
 * nothing you typed in CENTRA is overwritten. People you deleted after an import are remembered and
 * left out next time, unless you pick them again.
 */
import type { SyncEngine } from '@centra/sync';
import type { Person, Social } from './money.ts';

export type Labeled = { label: string; value: string };
export type Incoming = {
  uid: string; name: string; phones: Labeled[]; emails: Labeled[]; addresses: Labeled[];
  company?: string; birthday?: string; socials: Social[]; urls: string[]; notes?: string; photo?: string;
};
export type MacContact = {
  id: string; given: string; middle: string; family: string; nickname: string; company: string; title: string;
  phones: Labeled[]; emails: Labeled[]; addresses: Labeled[]; urls: Labeled[]; socials: Labeled[]; birthday?: string | null; photo?: string | null;
};

/* ---------------------------------------------------------------- labels and socials */
const LABELS: Record<string, string> = {
  cell: 'Mobil', mobile: 'Mobil', iphone: 'iPhone', home: 'Hjem', work: 'Arbejde', main: 'Hoved', other: 'Andet', pager: 'Personsøger',
  fax: 'Fax', 'home fax': 'Fax', 'work fax': 'Fax', internet: '', pref: '', voice: '', school: 'Skole', homepage: 'Hjemmeside',
};
/** "_$!<Mobile>!$_" (Apple) or TYPE=CELL → "Mobil". */
export function niceLabel(raw: string): string {
  const m = /^_\$!<(.+)>!\$_$/.exec(raw.trim());
  const k = (m ? m[1] : raw).trim();
  const known = LABELS[k.toLowerCase()];
  return known ?? k;
}
const SOCIAL_KIND: [RegExp, string][] = [
  [/instagram/i, 'instagram'], [/facebook|fb\.com/i, 'facebook'], [/tiktok/i, 'tiktok'], [/snapchat/i, 'snapchat'],
  [/linkedin/i, 'linkedin'], [/twitter|(^|\W)x\.com|^x$/i, 'x'],
];
const socialKind = (s: string) => SOCIAL_KIND.find(([re]) => re.test(s))?.[1];
/** A social profile from a service name and a username or link. */
function social(service: string, value: string): Social | null {
  const v = value.trim();
  if (!v) return null;
  const kind = socialKind(service) ?? socialKind(v);
  if (!kind) return { kind: 'web', value: v };
  const user = v.replace(/^https?:\/\/(www\.)?[^/]+\/(in\/|add\/)?@?/i, '').replace(/\/+$/, '');
  return { kind, value: kind === 'linkedin' || kind === 'facebook' ? (v.startsWith('http') ? v : user) : user.replace(/^@/, '') };
}

/* ---------------------------------------------------------------- birthdays */
/** → YYYY-MM-DD when the year is known, "--MM-DD" otherwise. Accepts 1990-05-12, 19900512, --0512, 1604-05-12 (Apple: no year). */
export function normBirthday(raw: string): string | undefined {
  const s = raw.trim().replace(/T.*$/, '');
  let m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s);
  if (m) return m[1] === '1604' || m[1] === '0000' ? `--${m[2]}-${m[3]}` : `${m[1]}-${m[2]}-${m[3]}`;
  m = /^--(\d{2})-?(\d{2})$/.exec(s);
  return m ? `--${m[1]}-${m[2]}` : undefined;
}
const MONTHS = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
export const birthdayText = (b: string) => { const m = /^--(\d{2})-(\d{2})$/.exec(b); return m ? `${Number(m[2])}. ${MONTHS[Number(m[1]) - 1]}` : b; };

/* ---------------------------------------------------------------- vCard */
const unescape = (v: string) => v.replace(/\\n/gi, '\n').replace(/\\([,;:\\])/g, '$1');
function qp(v: string): string {
  const bytes: number[] = [];
  const s = v.replace(/=\r?\n/g, '');
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /^[0-9A-F]{2}$/i.test(s.slice(i + 1, i + 3))) { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(...new TextEncoder().encode(s[i]));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
/** Splits on unescaped `sep`. */
const split = (v: string, sep: string) => v.split(new RegExp(`(?<!\\\\)${sep === ';' ? ';' : ','}`)).map(unescape);

type Prop = { group: string; name: string; params: Record<string, string[]>; value: string };
function lines(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out: string[] = [];
  for (const l of raw) {
    if (/^[ \t]/.test(l) && out.length) out[out.length - 1] += l.slice(1);
    else if (out.length && /=$/.test(out[out.length - 1]) && /QUOTED-PRINTABLE/i.test(out[out.length - 1])) out[out.length - 1] += '\n' + l; // soft line break
    else out.push(l);
  }
  return out;
}
function prop(line: string): Prop | null {
  const i = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (i < 0) return null;
  const head = line.slice(0, i), value = line.slice(i + 1);
  const [nameWithGroup, ...ps] = head.split(';');
  const dot = nameWithGroup.lastIndexOf('.');
  const params: Record<string, string[]> = {};
  for (const p of ps) {
    const [k, v] = p.includes('=') ? p.split(/=(.*)/s) : ['TYPE', p];
    const key = k.toUpperCase();
    params[key] = [...(params[key] ?? []), ...v.replace(/"/g, '').split(',').map((x) => x.trim())];
  }
  return { group: dot > 0 ? nameWithGroup.slice(0, dot).toLowerCase() : '', name: nameWithGroup.slice(dot + 1).toUpperCase(), params, value };
}

/** Every contact in a .vcf file (vCard 2.1, 3.0 and 4.0). */
export function parseVCards(text: string): Incoming[] {
  const out: Incoming[] = [];
  let cur: Prop[] | null = null;
  for (const l of lines(text)) {
    if (/^BEGIN:VCARD$/i.test(l.trim())) { cur = []; continue; }
    if (/^END:VCARD$/i.test(l.trim())) { if (cur) { const c = fromProps(cur); if (c) out.push(c); } cur = null; continue; }
    if (cur) { const p = prop(l); if (p) cur.push(p); }
  }
  return out;
}

function fromProps(props: Prop[]): Incoming | null {
  const val = (p: Prop) => (p.params.ENCODING?.some((x) => /quoted-printable/i.test(x)) ? qp(p.value) : p.value);
  const labelOf = (p: Prop) => {
    const ab = p.group && props.find((x) => x.group === p.group && x.name === 'X-ABLABEL');
    if (ab) return niceLabel(val(ab));
    const types = (p.params.TYPE ?? []).map((t) => niceLabel(t)).filter(Boolean);
    return types[0] ?? '';
  };
  const get = (name: string) => props.find((p) => p.name === name);
  const all = (name: string) => props.filter((p) => p.name === name);

  const n = get('N') ? split(val(get('N')!), ';') : [];
  const fn = get('FN') ? unescape(val(get('FN')!)).trim() : '';
  const org = get('ORG') ? split(val(get('ORG')!), ';').filter(Boolean).join(', ') : '';
  const title = get('TITLE') ? unescape(val(get('TITLE')!)).trim() : '';
  const nick = get('NICKNAME') ? unescape(val(get('NICKNAME')!)).trim() : '';
  const name = fn || [n[1], n[2], n[0]].filter((x) => x?.trim()).join(' ').trim() || nick || org;

  const phones = all('TEL').map((p) => ({ label: labelOf(p), value: unescape(val(p)).replace(/^tel:/i, '').trim() })).filter((x) => x.value);
  const emails = all('EMAIL').map((p) => ({ label: labelOf(p), value: unescape(val(p)).replace(/^mailto:/i, '').trim() })).filter((x) => x.value);
  const addresses = all('ADR').map((p) => {
    const [, , street, city, , postal, country] = split(val(p), ';').map((x) => x.trim());
    return { label: labelOf(p), value: [street?.replace(/\n/g, ', '), [postal, city].filter(Boolean).join(' '), country].filter(Boolean).join(', ') };
  }).filter((x) => x.value);
  const socials: Social[] = [];
  for (const p of all('X-SOCIALPROFILE')) {
    const s = social((p.params.TYPE ?? []).join(' '), p.params['X-USER']?.[0] ?? unescape(val(p)));
    if (s) socials.push(s);
  }
  const urls: string[] = [];
  for (const p of all('URL')) {
    const u = unescape(val(p)).trim();
    const s = socialKind(u) ? social('', u) : null;
    if (s) socials.push(s); else if (u) urls.push(u);
  }
  const bday = get('BDAY') ? normBirthday(val(get('BDAY')!)) : undefined;
  const note = get('NOTE') ? unescape(val(get('NOTE')!)).trim() : '';
  let photo: string | undefined;
  const ph = get('PHOTO');
  if (ph) {
    const v = val(ph).trim();
    if (/^data:image\//.test(v)) photo = v;
    else if (ph.params.ENCODING?.some((x) => /^b(ase64)?$/i.test(x)) || /^[A-Za-z0-9+/=\s]{100,}$/.test(v)) {
      const t = (ph.params.TYPE?.[0] ?? 'jpeg').toLowerCase().replace('jpg', 'jpeg');
      photo = `data:image/${t};base64,${v.replace(/\s+/g, '')}`;
    }
  }
  const uid = (get('X-ABUID') ?? get('UID')) ? unescape(val((get('X-ABUID') ?? get('UID'))!)).replace(/:ABPerson$/, '').trim() : '';
  if (!name && !phones.length && !emails.length) return null;
  return {
    uid: uid || `vcf:${(name + (emails[0]?.value ?? '') + (phones[0]?.value ?? '')).toLowerCase()}`,
    name: name || emails[0]?.value || phones[0]?.value || '', phones, emails, addresses,
    company: [org, title].filter(Boolean).join(' · ') || undefined, birthday: bday, socials, urls, notes: note || undefined, photo,
  };
}

/** The Mac app's own contacts → the same shape. */
export function fromMac(c: MacContact): Incoming | null {
  const name = [c.given, c.middle, c.family].filter(Boolean).join(' ').trim() || c.nickname || c.company;
  if (!name && !c.phones.length && !c.emails.length) return null;
  const socials: Social[] = [];
  for (const s of c.socials) { const x = social(s.label, s.value); if (x) socials.push(x); }
  const urls: string[] = [];
  for (const u of c.urls) { const x = socialKind(u.value) ? social('', u.value) : null; if (x) socials.push(x); else if (u.value) urls.push(u.value); }
  return {
    uid: c.id, name: name || c.emails[0]?.value || c.phones[0]?.value || '',
    phones: c.phones.map((p) => ({ label: niceLabel(p.label), value: p.value })), emails: c.emails.map((p) => ({ label: niceLabel(p.label), value: p.value })),
    addresses: c.addresses.map((p) => ({ label: niceLabel(p.label), value: p.value })),
    company: [c.company, c.title].filter(Boolean).join(' · ') || undefined, birthday: c.birthday ? normBirthday(c.birthday) : undefined,
    socials, urls, photo: c.photo || undefined,
  };
}

/* ---------------------------------------------------------------- matching and merging */
const digits = (s: string) => s.replace(/\D/g, '').slice(-8);
const low = (s?: string) => (s ?? '').trim().toLowerCase();
const IGNORED = 'setting-contacts-import';

export const ignoredUids = (e: SyncEngine) => new Set(((e.get(IGNORED) as { ignored?: string[] } | null)?.ignored) ?? []);
/** Remember that an imported contact was deleted on purpose, so the next import leaves it out. */
export function rememberDeleted(e: SyncEngine, uid?: string) {
  if (!uid) return;
  const s = ignoredUids(e); s.add(uid);
  e.set('setting', IGNORED, { ignored: [...s] });
}

/** Mobile numbers first, then the rest. */
const mobileFirst = (xs: Labeled[]) => [...xs].sort((a, b) => Number(/mobil|iphone/i.test(b.label)) - Number(/mobil|iphone/i.test(a.label)));

export type Planned = { c: Incoming; match?: Person; status: 'new' | 'update' | 'same'; ignored: boolean; adds: string[] };

function findMatch(people: Person[], c: Incoming): Person | undefined {
  const byUid = people.find((p) => p.macId && p.macId === c.uid);
  if (byUid) return byUid;
  const mails = new Set(c.emails.map((x) => low(x.value)));
  const phones = new Set(c.phones.map((x) => digits(x.value)).filter((d) => d.length >= 8));
  const known = (p: Person) => [p.email, ...(p.extra ?? []).map((x) => x.value)].filter(Boolean) as string[];
  return people.find((p) => known(p).some((v) => mails.has(low(v))))
    ?? people.find((p) => [p.phone, ...(p.extra ?? []).map((x) => x.value)].some((v) => v && phones.has(digits(v))))
    ?? (c.name ? people.find((p) => low(p.name) === low(c.name)) : undefined);
}

/** What importing `c` into `p` (or a new person) would set. Only empty fields are filled. */
export function merged(p: Partial<Person> | undefined, c: Incoming): Partial<Person> {
  const cur = p ?? {};
  const out: Partial<Person> = {};
  const phones = mobileFirst(c.phones), emails = c.emails;
  if (!cur.name?.trim() && c.name) out.name = c.name;
  // "Maria" → "Maria Tranberg": a first name alone is completed with the full name.
  else if (cur.name && !/\s/.test(cur.name.trim()) && low(c.name).startsWith(low(cur.name) + ' ')) out.name = c.name;
  if (!cur.phone && phones[0]) out.phone = phones[0].value;
  if (!cur.email && emails[0]) out.email = emails[0].value;
  if (!cur.company && c.company) out.company = c.company;
  if (!cur.address && c.addresses[0]) out.address = c.addresses[0].value;
  if (!cur.birthday && c.birthday && !c.birthday.startsWith('--')) out.birthday = c.birthday;
  if (!cur.notes?.trim() && c.notes) out.notes = c.notes;
  if (!cur.photo && c.photo) out.photo = c.photo;
  if (!cur.macId) out.macId = c.uid;

  const primary = new Set([cur.phone ?? out.phone, cur.email ?? out.email, cur.address ?? out.address].filter(Boolean).map((v) => low(v)));
  const extra = [...(cur.extra ?? [])];
  const has = (v: string) => primary.has(low(v)) || extra.some((x) => low(x.value) === low(v) || (digits(v).length >= 8 && digits(x.value) === digits(v)));
  const samePhone = (v: string) => digits(v).length >= 8 && [cur.phone ?? out.phone].some((x) => x && digits(x) === digits(v));
  for (const x of phones) if (!has(x.value) && !samePhone(x.value)) extra.push({ label: x.label || 'Telefon', value: x.value });
  for (const x of emails) if (!has(x.value)) extra.push({ label: x.label ? `Mail (${x.label.toLowerCase()})` : 'Mail', value: x.value });
  for (const x of c.addresses) if (!has(x.value)) extra.push({ label: x.label ? `Adresse (${x.label.toLowerCase()})` : 'Adresse', value: x.value });
  if (c.birthday?.startsWith('--') && !cur.birthday && !extra.some((x) => x.label === 'Fødselsdag')) extra.push({ label: 'Fødselsdag', value: birthdayText(c.birthday) });
  if (extra.length !== (cur.extra ?? []).length) out.extra = extra;

  const socials = [...(cur.socials ?? [])];
  for (const s of [...c.socials, ...c.urls.map((u) => ({ kind: 'web', value: u }))]) {
    if (!socials.some((x) => x.kind === s.kind && low(x.value) === low(s.value))) socials.push(s);
  }
  if (socials.length !== (cur.socials ?? []).length) out.socials = socials;
  return out;
}

const WHAT: Partial<Record<keyof Person, string>> = { phone: 'nummer', email: 'mail', company: 'arbejde', address: 'adresse', birthday: 'fødselsdag', notes: 'noter', photo: 'billede', extra: 'flere oplysninger', socials: 'profiler' };

/** Matches every incoming contact against the people already in CENTRA. */
export function plan(e: SyncEngine, incoming: Incoming[]): Planned[] {
  const people = e.list('person') as unknown as Person[];
  const ignored = ignoredUids(e);
  const seen = new Set<string>();
  const out: Planned[] = [];
  // Someone saved with only a first name ("Maria", from an udlæg) is the same person when exactly
  // one incoming contact has that first name and the saved one has no number or mail to compare.
  const first = (n: string) => low(n).split(/\s+/)[0];
  const firstCount = new Map<string, number>();
  for (const c of incoming) firstCount.set(first(c.name), (firstCount.get(first(c.name)) ?? 0) + 1);
  const taken = new Set(incoming.map((c) => findMatch(people, c)?.id).filter(Boolean));
  const byFirst = (c: Incoming) => firstCount.get(first(c.name)) === 1
    ? people.find((p) => !taken.has(p.id) && !p.phone && !p.email && !p.macId && low(p.name) === first(c.name) && !/\s/.test(p.name.trim()))
    : undefined;
  for (const c of incoming) {
    if (seen.has(c.uid)) continue;
    seen.add(c.uid);
    const match = findMatch(people, c) ?? byFirst(c);
    const m = merged(match, c);
    const adds = Object.keys(m).filter((k) => k !== 'macId' && k !== 'name').map((k) => WHAT[k as keyof Person]).filter(Boolean) as string[];
    out.push({ c, match, status: !match ? 'new' : adds.length ? 'update' : 'same', ignored: !match && ignored.has(c.uid), adds });
  }
  return out.sort((a, b) => a.c.name.localeCompare(b.c.name, 'da'));
}

/** Writes the chosen ones. Photos are shrunk by `shrink` (so the encrypted store stays small). */
export async function apply(e: SyncEngine, chosen: Planned[], shrink?: (dataUrl: string) => Promise<string>, onProgress?: (done: number, total: number) => void): Promise<{ created: number; updated: number }> {
  let created = 0, updated = 0, done = 0;
  const ignored = ignoredUids(e);
  for (const pl of chosen) {
    // Let the screen breathe (and show progress) every few contacts.
    if (done++ % 15 === 0) { onProgress?.(done - 1, chosen.length); await new Promise((r) => setTimeout(r, 0)); }
    const c = { ...pl.c };
    if (c.photo && shrink) { try { c.photo = await shrink(c.photo); } catch { c.photo = undefined; } }
    const current = pl.match ? (e.get(pl.match.id) as unknown as Person | null) ?? pl.match : undefined;
    const fields = merged(current, c);
    if (current) {
      if (Object.keys(fields).length) { e.set('person', current.id, fields as Record<string, unknown>); if (Object.keys(fields).some((k) => k !== 'macId')) updated++; }
    } else {
      e.create('person', { ...fields, name: fields.name ?? c.name, createdAt: new Date().toISOString() });
      created++;
    }
    ignored.delete(c.uid);
  }
  e.set('setting', IGNORED, { ignored: [...ignored] });
  return { created, updated };
}
