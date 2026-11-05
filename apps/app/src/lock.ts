/**
 * Auto-lock. Keys exist only in memory, so locking = reloading the app, which drops every key,
 * every decrypted note in memory and the relay session. Data at rest stays encrypted.
 *   - 15 minutes without interaction
 *   - 5 minutes in the background (app switched away, laptop lid closed)
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

const IDLE_MS = 15 * 60_000;
const HIDDEN_MS = 5 * 60_000;

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
    let last = Date.now();
    let hiddenAt: number | null = null;
    const bump = () => { last = Date.now(); };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => addEventListener(e, bump, { passive: true }));
    const onVis = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > HIDDEN_MS) lock('CENTRA blev låst, mens den lå i baggrunden.');
      else hiddenAt = null;
    };
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(() => { if (Date.now() - last > IDLE_MS) lock('CENTRA blev låst efter 15 minutter uden aktivitet.'); }, 30_000);
    return () => { events.forEach((e) => removeEventListener(e, bump)); document.removeEventListener('visibilitychange', onVis); clearInterval(t); };
  }, [active]);
}
