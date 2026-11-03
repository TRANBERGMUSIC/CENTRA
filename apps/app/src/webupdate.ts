/**
 * Fast interface updates in the Mac app (see apps/desktop/src-tauri/src/webupdate.rs).
 *
 * A push that only changes the interface is built and signed in about a minute and published as
 * `web.tar.gz`. The app looks for it every 30 seconds (and when the window comes back), installs it in
 * the background, and switches to it with a reload once you have paused for a moment (on the lock
 * screen only while nothing has been typed), keeping you logged in.
 */
import type { Session } from './session.ts';

import { native as desktop, invoke } from './platform.ts';

/** Tells the Mac app this interface started fine, so it keeps it (otherwise it rolls back). */
export function markReady() {
  if (desktop) void invoke('web_ready').catch(() => {});
}

export type WebInfo = { native_api: number; embedded: number; active: number | null };
export const webInfo = () => (desktop ? invoke<WebInfo>('web_info').catch(() => null) : Promise.resolve(null));

const UPDATED = 'centra.webUpdated';
/** True once, right after a fast update was switched in. */
export function justUpdated() {
  const v = sessionStorage.getItem(UPDATED);
  sessionStorage.removeItem(UPDATED);
  return !!v;
}

/**
 * Watches for a new interface. `getSession` returns the open session (or null on the lock screen);
 * `onWaiting` is called when an update is installed but waits for you to pause.
 */
export function watchWebUpdates(getSession: () => Session | null, onWaiting: (apply: () => void) => void): () => void {
  if (!desktop) return () => {};
  let busy = false, installed = false, lastInput = Date.now(), told = false;

  const apply = async () => {
    const s = getSession();
    if (s) { try { await s.stash(); } catch { /* then you log in again after the reload */ } }
    sessionStorage.setItem(UPDATED, '1');
    location.reload();
  };
  const maybeApply = () => {
    if (!installed) return;
    const idle = Date.now() - lastInput > 8_000;
    const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement || (document.activeElement as HTMLElement | null)?.isContentEditable;
    if (document.hidden) return void apply();
    // The lock screen switches only while it is left alone: never while you type, have typed
    // something, or are being let in.
    if (!getSession()) {
      const started = !!document.querySelector('.unlock__stage') || Array.from(document.querySelectorAll<HTMLInputElement>('.unlock input[type=password], .unlock input[name=recovery]')).some((i) => i.value);
      if (idle && !typing && !started) apply();
      return;
    }
    if (idle && !typing) return void apply();
    if (!told) { told = true; onWaiting(() => void apply()); }
  };
  const check = async () => {
    if (busy || installed || document.hidden) return;
    busy = true;
    try { installed = !!(await invoke<number | null>('web_update_check')); } catch { /* offline: next minute */ }
    finally { busy = false; }
    maybeApply();
  };

  const input = () => { lastInput = Date.now(); };
  const focus = () => void check();
  ['pointerdown', 'keydown', 'wheel'].forEach((e) => addEventListener(e, input, { passive: true }));
  addEventListener('focus', focus);
  document.addEventListener('visibilitychange', focus);
  const poll = setInterval(check, 30_000);
  const idle = setInterval(maybeApply, 3_000);
  void check();
  return () => {
    clearInterval(poll); clearInterval(idle);
    ['pointerdown', 'keydown', 'wheel'].forEach((e) => removeEventListener(e, input));
    removeEventListener('focus', focus);
    document.removeEventListener('visibilitychange', focus);
  };
}
