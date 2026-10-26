/**
 * Subscribed calendars (Google, iCloud, Outlook via their secret iCal address). Read-only:
 * events are refreshed every 15 minutes and marked with the feed they came from.
 */
import type { SyncEngine } from '@centra/sync';
import { parseIcs } from './ics.ts';
const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type CalFeed = { id: string; name: string; url: string; lastSync?: string; lastError?: string; count?: number; enabled?: boolean };

export const FEED_GUIDES: [string, string][] = [
  ['Google Kalender', 'Åbn calendar.google.com på computeren → tandhjulet → Indstillinger → vælg kalenderen til venstre → "Integrer kalender" → kopiér "Hemmelig adresse i iCal-format".'],
  ['iCloud', 'Åbn Kalender på Mac → højreklik på kalenderen → Del kalender → slå "Offentlig kalender" til → kopiér adressen (webcal://…).'],
  ['Outlook', 'Åbn outlook.com → Indstillinger → Kalender → Delte kalendere → "Udgiv en kalender" → vælg kalender og "Kan se alle detaljer" → kopiér ICS-linket.'],
];

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

async function download(url: string): Promise<string> {
  if (isDesktop()) {
    const { invoke } = await import('@tauri-apps/api/core');
    try { return await invoke<string>('fetch_calendar', { url }); } catch (e) { throw new Error(typeof e === 'string' ? e : String(e)); }
  }
  const r = await fetch(url.replace(/^webcal:/, 'https:'));
  if (!r.ok) throw new Error(`Kalenderen svarede ${r.status}`);
  return r.text();
}

export async function syncFeed(e: SyncEngine, f: CalFeed): Promise<number> {
  try {
    const text = await download(f.url);
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Adressen gav ikke en kalender. Tjek at det er iCal-adressen (.ics).');
    const now = new Date();
    const from = new Date(now); from.setDate(from.getDate() - 60);
    const to = new Date(now); to.setFullYear(to.getFullYear() + 1);
    const evs = parseIcs(text, from, to);
    const keep = new Set<string>();
    for (const x of evs) {
      const id = `f-${f.id}-${hash(x.uid)}`;
      keep.add(id);
      const fields = { title: x.title, start: x.start, end: x.end, allDay: x.allDay, place: x.place ?? '', feed: f.id, cal: f.name };
      const cur = e.get(id) as Record<string, unknown> | null;
      if (!cur || Object.entries(fields).some(([k, v]) => cur[k] !== v)) e.set('event', id, fields);
    }
    for (const ev of e.list('event')) if ((ev as any).feed === f.id && !keep.has(ev.id)) e.remove('event', ev.id);
    e.set('calfeed', f.id, { lastSync: now.toISOString(), lastError: '', count: evs.length });
    return evs.length;
  } catch (err) {
    e.set('calfeed', f.id, { lastSync: new Date().toISOString(), lastError: (err as Error).message });
    throw err;
  }
}

export async function syncFeeds(e: SyncEngine) {
  const errors: string[] = [];
  for (const f of e.list('calfeed') as unknown as CalFeed[]) {
    if (f.enabled === false) continue;
    try { await syncFeed(e, f); } catch (x) { errors.push(`${f.name}: ${(x as Error).message}`); }
  }
  return errors;
}

/** Removes a feed and every event it brought in. */
export function removeFeed(e: SyncEngine, id: string) {
  for (const ev of e.list('event')) if ((ev as any).feed === id) e.remove('event', ev.id);
  e.remove('calfeed', id);
}
