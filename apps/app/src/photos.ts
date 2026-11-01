/**
 * Billeder: photos and screenshots you save in CENTRA (a sweater you might buy, a receipt, a page of
 * information, a whiteboard). Each one is read by AI when it's added: a title, a description with
 * colours and brands, tags, and all the text in it. So Assist can find it again ("trøjen jeg tog et
 * billede af i forgårs") and use what's in it ("gem informationerne fra billedet i går").
 * Stored encrypted like everything else: a ~1600 px JPEG and a small thumbnail.
 */
import type { SyncEngine } from '@centra/sync';

export type Photo = {
  id: string; at: string; takenAt?: string; title: string; description: string; tags: string[]; text: string; kind: string;
  image: string; thumb: string; source?: 'upload' | 'assist'; analyzed?: boolean; note?: string; name?: string;
};
export const KINDS = ['tøj', 'produkt', 'dokument', 'kvittering', 'skærmbillede', 'seddel', 'mad', 'sted', 'person', 'andet'];

export type Analysis = { title: string; description: string; tags: string[]; text: string; kind: string };

export function cleanAnalysis(r: Partial<Analysis>): Analysis {
  return {
    title: String(r.title ?? '').trim().slice(0, 80) || 'Billede',
    description: String(r.description ?? '').trim().slice(0, 1200),
    tags: [...new Set((Array.isArray(r.tags) ? r.tags : []).map((t) => String(t).trim().toLowerCase().replace(/^#/, '')).filter(Boolean))].slice(0, 15),
    text: String(r.text ?? '').trim().slice(0, 8000),
    kind: KINDS.includes(String(r.kind ?? '').toLowerCase()) ? String(r.kind).toLowerCase() : 'andet',
  };
}

/** Stores a photo (already read, or to be read). Returns its id. */
export function storePhoto(e: SyncEngine, p: { image: string; thumb: string; name?: string; takenAt?: string; source?: Photo['source']; analysis?: Partial<Analysis>; note?: string }): string {
  const a = p.analysis ? cleanAnalysis(p.analysis) : null;
  return e.create('photo', {
    at: new Date().toISOString(), takenAt: p.takenAt ?? '', name: p.name ?? '', image: p.image, thumb: p.thumb, source: p.source ?? 'upload', note: p.note ?? '',
    ...(a ? { ...a, analyzed: true } : { title: (p.name ?? '').replace(/\.(jpe?g|png|heic|webp|gif)$/i, '') || 'Billede', description: '', tags: [], text: '', kind: 'andet', analyzed: false }),
  });
}

const DAY = 86400000;
/** Search by words (title, description, tags, text, kind) and/or a date range. Best matches first. */
export function searchPhotos(e: SyncEngine, query: string, opts: { from?: string; to?: string; limit?: number } = {}): Photo[] {
  const words = query.toLowerCase().split(/[\s,]+/).map((w) => w.replace(/[^\p{L}\p{N}-]/gu, '')).filter((w) => w.length > 1);
  const from = opts.from ? new Date(opts.from + 'T00:00').getTime() : -Infinity;
  const to = opts.to ? new Date(opts.to + 'T23:59:59').getTime() : Infinity;
  const all = (e.list('photo') as unknown as Photo[]).filter((p) => { const t = new Date(p.takenAt || p.at).getTime(); return t >= from && t <= to; });
  const scored = all.map((p) => {
    const hay = { title: p.title.toLowerCase(), tags: (p.tags ?? []).join(' '), desc: (p.description ?? '').toLowerCase(), text: (p.text ?? '').toLowerCase(), kind: p.kind ?? '' };
    let score = 0;
    for (const w of words) {
      const stem = w.length > 4 ? w.slice(0, -1) : w; // trøjen → trøje, billeder → billede
      if (hay.title.includes(stem)) score += 4;
      if (hay.tags.includes(stem)) score += 3;
      if (hay.kind.includes(stem)) score += 2;
      if (hay.desc.includes(stem)) score += 2;
      if (hay.text.includes(stem)) score += 1;
    }
    return { p, score };
  });
  return scored.filter((x) => !words.length || x.score > 0).sort((a, b) => b.score - a.score || (b.p.takenAt || b.p.at).localeCompare(a.p.takenAt || a.p.at)).slice(0, opts.limit ?? 50).map((x) => x.p);
}

export const photoDay = (p: Photo) => new Date(p.takenAt || p.at);
export const daysAgo = (p: Photo, now = new Date()) => Math.floor((new Date(now.toDateString()).getTime() - new Date(photoDay(p).toDateString()).getTime()) / DAY);
