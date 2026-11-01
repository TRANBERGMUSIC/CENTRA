/**
 * Unlock with Touch ID on the Mac and Face ID on the iPhone (apps/desktop/src-tauri/src/biometry).
 * The account key sits in the keychain and is only read after the right finger or face; adding or
 * removing one throws it away, so the password is needed again. A no-op outside the app.
 */
import { openWithKey, type Session } from './session.ts';
import { RelayError } from '@centra/sync';

import { native as desktop, invoke } from './platform.ts';
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
    case 'failed': return `${name} genkendte dig ikke. Prøv igen, eller brug dit password.`;
    case 'lockout': return `${name} er låst efter for mange forsøg. Brug dit password.`;
    case 'changed': return `${name} er ændret på enheden (et nyt fingeraftryk eller ansigt), så det er slået fra for en sikkerheds skyld. Log ind med password, og slå det til igen under Indstillinger.`;
    case 'missing': return `${name}-nøglen findes ikke længere. Log ind med password, og slå ${name} til igen under Indstillinger.`;
    case 'not-enrolled': return `${name} er ikke sat op på enheden endnu. Gør det i enhedens indstillinger.`;
    case 'unavailable': return `${name} er ikke tilgængelig lige nu (fx med låget lukket). Brug dit password.`;
    case 'need-password': return `Første gang med sync skal du logge ind med dit password. Derefter virker ${name} igen.`;
    case 'relay': return `Kunne ikke nå sync-serveren. Prøv igen, eller brug dit password.`;
    case 'relay-auth': return `Dit password er skiftet på en anden enhed. Log ind med det nye. ${name} virker igen bagefter.`;
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
  catch (e) {
    // The sync server didn't answer, or wants the password once: the finger and the key are still fine.
    if (e instanceof RelayError) throw new Error(e.code === 'auth' ? 'relay-auth' : 'relay');
    if ((e as Error)?.message === 'need-password') throw e;
    await bioDisable(user);
    throw new Error('missing');
  }
}
