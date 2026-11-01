/**
 * A mail as plain text for Assist: the whole thing, also when the mail's text part is just a stub
 * ("Se denne mail i din browser") and the real content only is in the HTML (bookings, tickets,
 * receipts). Links are kept as "tekst (adresse)" so Assist can point to them.
 */

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", aelig: 'æ', oslash: 'ø', aring: 'å', AElig: 'Æ', Oslash: 'Ø', Aring: 'Å', euro: '€', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·', copy: '©', reg: '®', shy: '' };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, k: string) => {
  if (k[0] === '#') { const n = k[1].toLowerCase() === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return ENTITIES[k] ?? ENTITIES[k.toLowerCase()] ?? m;
});

export function htmlToText(html: string): string {
  let h = String(html ?? '');
  h = h.replace(/<!--[\s\S]*?-->/g, '').replace(/<(head|style|script|title|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, '');
  // Links: keep where they go, unless the text already is the address.
  h = h.replace(/<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, _q, d, s, b, inner: string) => {
    const href = decode(String(d ?? s ?? b ?? '')).trim();
    const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/^https?:/i.test(href)) return inner;
    const t = decode(text);
    return !t ? ` ${href} ` : t.includes(href) || href.includes(t.replace(/^https?:\/\//, '')) ? t : `${inner} (${href})`;
  });
  h = h.replace(/<img\b[^>]*?alt\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi, (_m, _q, d, s) => { const a = String(d ?? s ?? '').trim(); return a ? ` [${a}] ` : ' '; });
  h = h.replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section|article|header|footer|blockquote|ul|ol)\s*>/gi, '\n')
    .replace(/<(p|div|tr|h[1-6]|table|section|article|header|footer|blockquote|ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/t[dh]\s*>/gi, '\t')
    .replace(/<[^>]+>/g, '');
  return decode(h)
    .replace(/ /g, ' ')
    .split('\n').map((l) => l.replace(/[ \t]+/g, (w) => (w.includes('\t') ? ' · ' : ' ')).replace(/^( · )+|( · )+$/g, '').trim()).join('\n')
    .replace(/(\s*·\s*){2,}/g, ' · ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The fullest text there is for this mail: its text part, or the HTML turned into text if that says more. */
export function fullText(m: { body?: string; preview?: string; html?: string }, html?: string): string {
  const text = String(m.body ?? '').trim();
  const h = html ?? m.html ?? '';
  if (!h) return text || String(m.preview ?? '');
  const fromHtml = htmlToText(h);
  return fromHtml.length > text.length * 1.2 + 40 ? fromHtml : text || fromHtml;
}

/** HTML fetched again from the server for mails too big to keep (filled in before Assist reads them). */
export const fetchedHtml = new Map<string, string>();
