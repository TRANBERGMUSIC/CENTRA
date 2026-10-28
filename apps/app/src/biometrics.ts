/**
 * Unlock with Touch ID in the Mac app (apps/desktop/src-tauri/src/biometry). The account key sits in
 * the Mac's login keychain and is only read after the right finger; adding or removing a fingerprint
 * throws it away, so the password is needed again. Everything here is a no-op outside the Mac app.
 */
import { openWithKey, type Session } from './session.ts';

const desktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const invoke = async <T,>(cmd: string, args?: Record<string, unknown>) => (await import('@tauri-apps/api/core')).invoke<T>(cmd, args);
const flag = (user: string) => `centra.touchid.${user.trim().toLowerCase()}`;

export type BioKind = 'touchid' | 'faceid' | 'opticid' | 'none';
export const BIO_NAME: Record<BioKind, string> = { touchid: 'Touch ID', faceid: 'Face ID', opticid: 'Optic ID', none: 'Biometri' };

/** What this Mac has ("none" when there is no sensor, or no finger is set up). */
export async function bioKind(): Promise<BioKind> {
  if (!desktop) return 'none';
  try { return await invoke<BioKind>('bio_kind'); } catch { return 'none'; }
}

export const bioIsOn = (user: string) => { try { return localStorage.getItem(flag(user)) === '1'; } catch { return false; } };

export async function bioEnable(session: Session) {
  await session.enableBiometrics();
  localStorage.setItem(flag(session.user), '1');
}

export async function bioDisable(user: string) {
  localStorage.removeItem(flag(user));
  if (desktop) await invoke('bio_disable', { user: user.trim().toLowerCase() }).catch(() => {});
}

/** Plain-language reasons; null means "just show the password field" (you cancelled). */
export function bioProblem(code: string, name: string): string | null {
  switch (code) {
    case 'cancel': case 'fallback': return null;
    case 'failed': return `${name} genkendte ikke fingeren. Prøv igen, eller brug dit password.`;
    case 'lockout': return `${name} er låst efter for mange forsøg. Brug dit password.`;
    case 'changed': return `Fingeraftrykkene på Mac'en er ændret, så ${name} er slået fra for en sikkerheds skyld. Log ind med password, og slå det til igen under Indstillinger.`;
    case 'missing': return `${name}-nøglen findes ikke længere. Log ind med password, og slå ${name} til igen under Indstillinger.`;
    case 'not-enrolled': return `Der er ikke sat et fingeraftryk op på Mac'en. Gør det under Systemindstillinger → Touch ID og adgangskode.`;
    case 'unavailable': return `${name} er ikke tilgængelig lige nu (fx med låget lukket). Brug dit password.`;
    default: return `${name} virkede ikke (${code}). Brug dit password.`;
  }
}

/** Asks for the finger and opens the vault. Throws an Error whose message is the reason code. */
export async function bioUnlock(user: string): Promise<Session> {
  const u = user.trim().toLowerCase();
  let key: number[];
  try { key = await invoke<number[]>('bio_unlock', { user: u }); }
  catch (e) {
    const code = String((e as Error)?.message ?? e);
    if (code === 'changed' || code === 'missing') localStorage.removeItem(flag(user));
    throw new Error(code);
  }
  try { return await openWithKey(u, key); }
  catch { await bioDisable(user); throw new Error('missing'); }
}
