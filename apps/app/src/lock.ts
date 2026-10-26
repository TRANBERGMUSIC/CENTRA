/**
 * Auto-lock. Keys exist only in memory, so locking = reloading the app, which drops every key,
 * every decrypted note in memory and the relay session. Data at rest stays encrypted.
 *   - 15 minutes without interaction
 *   - 5 minutes in the background (app switched away, laptop lid closed)
 */
import { useEffect } from 'react';

const IDLE_MS = 15 * 60_000;
const HIDDEN_MS = 5 * 60_000;

export function lock(reason?: string) {
  if (reason) sessionStorage.setItem('centra.lockReason', reason);
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
