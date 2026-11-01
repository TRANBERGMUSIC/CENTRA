/**
 * Where this interface runs. The same web build runs in the Mac app, the iPhone app and a browser.
 *
 *  native  inside the CENTRA app (Tauri): mail, LunchHub and calendars go through Rust
 *  OS      set by the app before the page loads (window.__CENTRA_OS); older Mac builds don't set
 *          it, and only Mac builds existed before, so a native app without it is a Mac
 *  desktop the Mac (or Windows) app: in-app browser with VPN, app updates, Touch ID, Contacts
 */
type OsName = 'macos' | 'ios' | 'windows' | 'linux' | 'android' | 'web';
const w = (typeof window !== 'undefined' ? window : {}) as { __TAURI_INTERNALS__?: unknown; __CENTRA_OS?: string };

export const native = '__TAURI_INTERNALS__' in w;
export const OS: OsName = native ? ((w.__CENTRA_OS as OsName) || 'macos') : 'web';
export const ios = OS === 'ios';
export const mobileApp = OS === 'ios' || OS === 'android';
export const desktop = native && !mobileApp;

/** Checked at call time (tests set it up after import). */
export const isNative = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Calls the app's Rust side. Errors come back as plain text (Rust sends strings). */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  try { return await core.invoke<T>(cmd, args); } catch (e) { throw new Error(typeof e === 'string' ? e : (e as Error)?.message ?? String(e)); }
}
