/**
 * Reading Office and iWork files (they are zip archives of XML) for previews inside CENTRA.
 * Nothing in them runs: text is read out of the XML and pictures become blob: URLs.
 */
import { unzipSync, type Unzipped } from 'fflate';

/** At most this much unpacked (a zip bomb stops here instead of filling the memory). */
const MAX_UNZIPPED = 300_000_000;

export function unzip(data: Uint8Array): Unzipped {
  let total = 0;
  return unzipSync(data, {
    filter: (f) => {
      total += f.originalSize;
      if (total > MAX_UNZIPPED) throw new Error('Filen er for stor til at vise her');
      return true;
    },
  });
}

const dec = new TextDecoder();
export const text = (z: Unzipped, path: string) => (z[path] ? dec.decode(z[path]) : '');
export function xml(z: Unzipped, path: string): Document | null {
  const t = text(z, path);
  if (!t) return null;
  const d = new DOMParser().parseFromString(t, 'application/xml');
  return d.getElementsByTagName('parsererror').length ? null : d;
}

/** Children (any depth) by local name, so prefixes (a:, p:, c:) don't matter. */
export const all = (n: Element | Document | null | undefined, name: string): Element[] => (n ? Array.from(n.getElementsByTagNameNS('*', name)) : []);
export const first = (n: Element | Document | null | undefined, name: string): Element | null => (n ? n.getElementsByTagNameNS('*', name)[0] ?? null : null);
/** Direct children by local name. */
export const kids = (n: Element | null | undefined, name?: string): Element[] => (n ? Array.from(n.children).filter((c) => !name || c.localName === name) : []);
export const kid = (n: Element | null | undefined, name: string): Element | null => kids(n, name)[0] ?? null;
export const attr = (n: Element | null | undefined, name: string) => n?.getAttribute(name) ?? n?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', name.replace(/^r:/, '')) ?? null;

/** a/b/../c → a/c */
export function resolve(base: string, target: string) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const p of target.split('/')) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); }
  return parts.join('/');
}

/** The relationships of one part (word/_rels/document.xml.rels …): id → path in the zip. */
export function rels(z: Unzipped, part: string): Record<string, { target: string; type: string }> {
  const dir = part.split('/').slice(0, -1).join('/');
  const name = part.split('/').pop();
  const d = xml(z, `${dir ? dir + '/' : ''}_rels/${name}.rels`);
  const out: Record<string, { target: string; type: string }> = {};
  for (const r of all(d, 'Relationship')) {
    if (r.getAttribute('TargetMode') === 'External') continue;
    out[r.getAttribute('Id') ?? ''] = { target: resolve(part, r.getAttribute('Target') ?? ''), type: (r.getAttribute('Type') ?? '').split('/').pop() ?? '' };
  }
  return out;
}

const IMG: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', svg: 'image/svg+xml' };
/** A picture inside the archive as a blob: URL (null for formats a browser can't show, like EMF). */
export function image(z: Unzipped, path: string, urls: string[]): string | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const type = IMG[ext];
  if (!type || !z[path]) return null;
  const u = URL.createObjectURL(new Blob([z[path] as BlobPart], { type }));
  urls.push(u);
  return u;
}

/** Keynote, Pages and Numbers keep a picture of the first page inside the file. */
export function iworkPreview(z: Unzipped, urls: string[]): string | null {
  for (const p of ['preview.jpg', 'preview-web.jpg', 'QuickLook/Preview.jpg', 'QuickLook/Thumbnail.jpg', 'preview-micro.jpg']) {
    const u = image(z, p, urls);
    if (u) return u;
  }
  return null;
}

/** What a zip holds: names and sizes, folders first. */
export function listing(data: Uint8Array) {
  const z = unzip(data);
  return Object.entries(z).filter(([n]) => !n.startsWith('__MACOSX/') && !n.endsWith('/') && !n.split('/').pop()!.startsWith('.')).map(([name, d]) => ({ name, size: d.length })).sort((a, b) => a.name.localeCompare(b.name, 'da'));
}
