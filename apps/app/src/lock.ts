/**
 * Auto-lock. Keys exist only in memory, so locking = reloading the app, which drops every key,
 * every decrypted note in memory and the relay session. Data at rest stays encrypted.
 *   - after 15 minutes without interaction (or what you chose under Indstillinger: 5 min, 1 time, fra)
 *   - after 5 minutes in the background (app switched away, laptop lid closed), never longer than
 *     the time you chose; nothing at all when you turned it off
 * The choice belongs to each device (the Mac at home can stay open while the iPhone locks).
 *
 * The Mac in the background (the window closed, CENTRA still running for reminders, mail and push):
 * locking covers CENTRA instead (the veil) and Touch ID or the password opens it again. The keys stay
 * in memory for that, as they do while it's open; a forced lock (password changed elsewhere, this
 * device logged out) still reloads.
 */
import { useEffect } from 'react';
import { desktop } from './platform.ts';

const BG = 'centra.background';
/** The Mac keeps running with its window closed (on unless turned off under Indstillinger). */
export const backgroundOn = () => { try { return desktop && localStorage.getItem(BG) !== 'off'; } catch { return desktop; } };
export const setBackground = (on: boolean) => { try { localStorage.setItem(BG, on ? 'on' : 'off'); } catch { /* fine */ } };

const AUTO = 'centra.autolock';
/** Minutes without use before CENTRA locks itself on this device; 0 = never. */
export const AUTOLOCK_CHOICES: [number, string][] = [[5, 'Efter 5 min'], [15, 'Efter 15 min'], [60, 'Efter 1 time'], [0, 'Fra']];
export const autoLockMinutes = () => { try { const v = localStorage.getItem(AUTO); return v == null ? 15 : Math.max(0, Number(v) || 0); } catch { return 15; } };
export const setAutoLockMinutes = (m: number) => { try { localStorage.setItem(AUTO, String(m)); } catch { /* fine */ } dispatchEvent(new Event('centra-autolock')); };

export function lock(reason?: string, hard = false) {
  if (!hard && backgroundOn()) { window.dispatchEvent(new CustomEvent('centra-veil', { detail: reason ?? '' })); return; }
  try {
    if (reason) sessionStorage.setItem('centra.lockReason', reason);
    // Locked by hand: Face ID / Touch ID waits until you come back instead of opening it right away.
    else sessionStorage.setItem('centra.lockManual', '1');
  } catch { /* private mode */ }
  location.reload();
}

export function useAutoLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let stop = () => {};
    const start = () => {
      stop();
      const mins = autoLockMinutes();
      if (!mins) { stop = () => {}; return; }
      const idleMs = mins * 60_000, hiddenMs = Math.min(mins, 5) * 60_000;
      let last = Date.now();
      let hiddenAt: number | null = null;
      const bump = () => { last = Date.now(); };
      const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
      events.forEach((e) => addEventListener(e, bump, { passive: true }));
      const onVis = () => {
        if (document.hidden) hiddenAt = Date.now();
        else if (hiddenAt && Date.now() - hiddenAt > hiddenMs) lock('CENTRA blev låst, mens den lå i baggrunden.');
        else hiddenAt = null;
      };
      document.addEventListener('visibilitychange', onVis);
      const label = mins >= 60 ? `${mins / 60 === 1 ? 'en time' : `${mins / 60} timer`}` : `${mins} minutter`;
      const t = setInterval(() => { if (Date.now() - last > idleMs) lock(`CENTRA blev låst efter ${label} uden aktivitet.`); }, 30_000);
      stop = () => { events.forEach((e) => removeEventListener(e, bump)); document.removeEventListener('visibilitychange', onVis); clearInterval(t); };
    };
    start();
    addEventListener('centra-autolock', start);
    return () => { removeEventListener('centra-autolock', start); stop(); };
  }, [active]);
}
