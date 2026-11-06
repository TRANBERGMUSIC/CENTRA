/**
 * Company logos on mail in the inbox (Google, Netflix, your bank …). The phone or Mac asks the
 * company's own website for its icon once (logo.rs), shrinks it to a small picture and keeps it as a
 * synced record, so the other devices have it too without asking again. Private addresses (gmail,
 * icloud …) keep their initials, and so does mail flagged as scam or phishing.
 */
import { useEffect, useState } from 'react';
import type { SyncEngine } from '@centra/sync';
import { invoke } from './platform.ts';
import { mailAvailable } from './mail.ts';

const PRIVATE = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|aol|icloud|me|mac|gmx|protonmail|proton|pm|yandex|zoho|mail|email|post|jubii|webspeed|stofanet|youmail|tdcadsl|privat)\./i;
/** Two-part endings, where the company is one label further in (bbc.co.uk). */
const SECOND = /^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/i;
const FRESH_MS = 30 * 86400000, RETRY_MS = 7 * 86400000;

/** "accounts.google.com" → "google.com"; null for private mail services and odd addresses. */
export function logoDomain(email?: string): string | null {
  const d = String(email ?? '').split('@')[1]?.toLowerCase().trim().replace(/\.$/, '');
  if (!d || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return null;
  const parts = d.split('.');
  const site = parts.slice(SECOND.test(parts.slice(-2).join('.')) ? -3 : -2).join('.');
  return PRIVATE.test(site) ? null : site;
}

const keyOf = (domain: string) => `logo-${domain.replace(/[^a-z0-9-]/g, '_')}`;
const wanted = new Set<string>();
const queue: string[] = [];
let running = 0;

/** A picture made small and square (so a logo is a few kB, whatever the site gave). */
function shrink(src: string): Promise<string> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const size = 96;
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      if (!g || !img.naturalWidth) return rej(new Error('empty'));
      const s = Math.min(size / img.naturalWidth, size / img.naturalHeight);
      const w = img.naturalWidth * s, h = img.naturalHeight * s;
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      res(c.toDataURL('image/png'));
    };
    img.onerror = () => rej(new Error('bad image'));
    img.src = src;
  });
}

async function pump(e: SyncEngine) {
  while (running < 3 && queue.length) {
    const domain = queue.shift()!;
    running++;
    void (async () => {
      let data = '';
      try {
        const got = await invoke<{ mime: string; data: string } | null>('mail_logo', { domain });
        if (got?.data) data = await shrink(`data:${got.mime};base64,${got.data}`);
      } catch { /* no logo */ }
      e.set('logo', keyOf(domain), { domain, data, at: new Date().toISOString() });
      running--;
      void pump(e);
    })();
  }
}

/** The logo (a data: URL) for a mail's sender, or null to show initials. */
export function useLogo(e: SyncEngine, email: string | undefined, skip = false): string | null {
  const domain = skip ? null : logoDomain(email);
  const rec = domain ? (e.get(keyOf(domain)) as { data?: string; at?: string } | null) : null;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!domain) return;
    const off = e.on((ids) => { if (ids.has(keyOf(domain))) tick((n) => n + 1); });
    const age = rec?.at ? Date.now() - new Date(rec.at).getTime() : Infinity;
    const stale = !rec || (rec.data ? age > FRESH_MS : age > RETRY_MS);
    if (stale && mailAvailable() && !wanted.has(domain)) { wanted.add(domain); queue.push(domain); void pump(e); }
    return off;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);
  return rec?.data || null;
}
