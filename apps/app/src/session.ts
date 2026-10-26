/**
 * Signing in on one device: relay connection, account keys, local store and the sync engine.
 *
 * Security notes
 *  - The password only lives inside these functions. Argon2id turns it into `enc` (unwraps the
 *    account key, never leaves the device) and `auth` (proves the password to the server).
 *  - Keys live in memory only while the app is unlocked; locking reloads the page, which wipes them.
 *  - The cached account record is the wrapped (encrypted) form, so it is safe at rest; it lets the
 *    app open offline with the same password.
 */
import { ready, wipe, type KeyRing } from '@centra/crypto';
import {
  SyncEngine, WsRelay, IndexedDbStore, RelayError, createAccount, passwordSecrets, unlock, changePassword as rewrap,
  recoverWithCode, newRecovery, rotateContentKey, absorbKeys, normalizeUser, type AccountPublic, type DeviceRecord, type Prelogin,
} from '@centra/sync';
import { seedSampleData } from './seed.ts';

export const DEFAULT_USER = 'Tranberg';

export type Session = {
  engine: SyncEngine;
  relay: WsRelay;
  user: string;
  device: string;
  created: boolean;
  recoveryCode?: string;
  /** Re-checks the current password before a sensitive action and returns its auth value. */
  verify: (password: string) => string;
  changePassword: (current: string, next: string) => Promise<void>;
  newRecoveryCode: (current: string) => Promise<string>;
  logOutDevice: (id: string) => Promise<void>;
};

/** Relay address: baked in at build time (CI sets the Cloudflare relay), else the relay on this machine. */
export function relayUrl(): string {
  const built = import.meta.env.VITE_RELAY_URL as string | undefined;
  if (built) return built;
  const host = location.hostname;
  const lan = host && !['localhost', '127.0.0.1'].includes(host) && !host.endsWith('.localhost') && location.protocol === 'http:';
  return `ws://${lan ? host : 'localhost'}:8787`;
}

function deviceId(): string {
  let id = localStorage.getItem('centra.device');
  if (!id) {
    id = 'd' + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('centra.device', id);
  }
  return id;
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Linux';
  const installed = '__TAURI_INTERNALS__' in window || matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
  return `${os} · ${installed ? 'app' : 'browser'}`;
}

const cacheKey = (u: string) => `centra.account.${u}`;
const preKey = (u: string) => `centra.pre.${u}`;
const MESSAGES: Record<string, string> = {
  auth: 'Forkert brugernavn eller password.',
  'wrong-password': 'Forkert brugernavn eller password.',
  'not-allowed': 'Forkert brugernavn eller password.',
  exists: 'Kontoen findes allerede. Log ind i stedet.',
  'wrong-recovery-code': 'Gendannelsesnøglen passer ikke.',
  offline: 'Kan ikke nå CENTRA-serveren, og kontoen er ikke åbnet på denne enhed før.',
  timeout: 'Serveren svarer ikke. Prøv igen.',
  closed: 'Forbindelsen blev afbrudt. Prøv igen.',
};
export function explain(e: unknown): string {
  if (e instanceof RelayError && (e.code === 'locked' || (e.code === 'auth' && e.retryAfter))) {
    return `${e.code === 'auth' ? 'Forkert password. ' : ''}For mange forkerte forsøg. Prøv igen om ${e.retryAfter ?? 30} sekunder.`;
  }
  const code = e instanceof RelayError ? e.code : e instanceof Error ? e.message : String(e);
  return MESSAGES[code] ?? (e instanceof Error && !/^[a-z-]+$/.test(e.message) ? e.message : 'Noget gik galt. Prøv igen.');
}

export type Step = 'Forbinder' | 'Låser op' | 'Opretter konto' | 'Synkroniserer';
export type Lookup = { relay: WsRelay; pre: Prelogin & { offline?: boolean }; user: string };

/** Finds the account (online, or from this device's cache when offline). */
export async function lookUp(userInput: string): Promise<Lookup> {
  await ready();
  const user = normalizeUser(userInput);
  if (!user) throw new Error('auth');
  const relay = new WsRelay(relayUrl(), { user, device: deviceId(), name: deviceName(), platform: deviceName() });
  try {
    const pre = await relay.prelogin(3500);
    if (pre.exists) localStorage.setItem(preKey(user), JSON.stringify(pre));
    return { relay, pre, user };
  } catch {
    const cached = localStorage.getItem(preKey(user));
    if (cached) return { relay, pre: { ...JSON.parse(cached), offline: true }, user };
    relay.close();
    throw new Error('offline');
  }
}

/** Logs in with the password (online or offline), or creates the account the very first time. */
export async function signIn({ relay, pre, user }: Lookup, password: string, onStep: (s: Step) => void): Promise<Session> {
  onStep('Låser op');
  await new Promise((r) => setTimeout(r, 20)); // let the UI paint before Argon2id blocks
  let account: AccountPublic, keys: KeyRing, ak: Uint8Array, created = false, recoveryCode: string | undefined;

  if (!pre.exists) {
    if (!pre.canRegister) throw new Error('not-allowed');
    onStep('Opretter konto');
    const a = createAccount(password);
    await relay.register(a.account, a.auth, a.recoveryAuth);
    ({ account, keys, ak, recoveryCode } = a);
    created = true;
  } else {
    const s = passwordSecrets(password, pre.kdf!);
    try {
      if (pre.offline) {
        const cached = localStorage.getItem(cacheKey(user));
        if (!cached) throw new Error('offline');
        account = JSON.parse(cached);
        ({ keys, ak } = unlock(account, s.enc)); // throws on a wrong password
        relay.loginWhenOnline(s.auth);
      } else {
        account = (await relay.login(s.auth)).account;
        ({ keys, ak } = unlock(account, s.enc));
      }
    } catch (e) {
      relay.close();
      throw e;
    } finally {
      wipe(s.enc);
    }
  }
  localStorage.setItem(cacheKey(user), JSON.stringify(account));
  localStorage.setItem('centra.lastUser', user);

  // Keys rotated on another device (after it logged a device out) arrive here.
  relay.onAccount = (a) => { account = a; absorbKeys(keys, a.keys, ak); localStorage.setItem(cacheKey(user), JSON.stringify(a)); };
  relay.onOpen(() => { if (relay.account) relay.onAccount?.(relay.account); });

  onStep('Synkroniserer');
  const device = deviceId();
  const engine = new SyncEngine({ device, keys, store: new IndexedDbStore(`${user}:${device}`), relay });
  await engine.start();
  if (created) seedSampleData(engine);

  const verify = (pw: string) => {
    const s = passwordSecrets(pw, account.kdf);
    try { unlock(account, s.enc); } catch { throw new Error('wrong-password'); } finally { wipe(s.enc); }
    return s.auth;
  };

  return {
    engine, relay, user, device, created, recoveryCode, verify,
    async changePassword(current, next) {
      const oldAuth = verify(current);
      const w = rewrap(ak, next);
      await relay.changePassword(oldAuth, w);
      account = { ...account, kdf: w.kdf, wrappedAK: w.wrappedAK };
      localStorage.setItem(cacheKey(user), JSON.stringify(account));
      localStorage.removeItem(preKey(user));
    },
    async newRecoveryCode(current) {
      const a = verify(current);
      const r = newRecovery(ak);
      await relay.setRecovery(a, r.recovery, r.recoveryAuth);
      account = { ...account, recovery: r.recovery };
      localStorage.setItem(cacheKey(user), JSON.stringify(account));
      return r.code;
    },
    async logOutDevice(id) {
      await relay.revoke(id);
      // Everything written from now on uses a key the removed device has never seen.
      await relay.addKeys(rotateContentKey(account, ak, keys));
    },
  };
}

/** Forgot the password: the recovery code proves ownership and sets a new one. Works on any device. */
export async function recover(userInput: string, code: string, newPassword: string, onStep: (s: Step) => void): Promise<void> {
  const { relay, pre, user } = await lookUp(userInput);
  try {
    if (pre.offline) throw new Error('offline');
    if (!pre.exists || !pre.recovery) throw new Error('wrong-recovery-code');
    onStep('Låser op');
    await new Promise((r) => setTimeout(r, 20));
    const r = recoverWithCode(pre.recovery, code, newPassword);
    await relay.recover(r.recoveryAuth, r.password);
    localStorage.removeItem(preKey(user));
    localStorage.removeItem(cacheKey(user));
  } finally {
    relay.close();
  }
}

export type { DeviceRecord };
