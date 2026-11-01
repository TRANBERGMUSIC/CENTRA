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
import { ready, wipe, subKey, sealJson, openJson, type KeyRing } from '@centra/crypto';
import { OS, native, invoke } from './platform.ts';
import {
  SyncEngine, WsRelay, NullRelay, IndexedDbStore, EncryptedStore, RelayError, createAccount, passwordSecrets, unlock, changePassword as rewrap,
  recoverWithCode, newRecovery, rotateContentKey, absorbKeys, normalizeUser, unlockWithAk, type AccountPublic, type DeviceRecord, type Prelogin,
} from '@centra/sync';

export const DEFAULT_USER = 'Tranberg';

/**
 * Sync between the Mac and the iPhone through the relay (Cloudflare). Builds get VITE_SYNC=on when
 * a relay exists; without one CENTRA runs fully on this computer, encrypted, with the same engine.
 */
export const SYNC = import.meta.env.VITE_SYNC === 'on' && !!import.meta.env.VITE_RELAY_URL;

/**
 * Where a brand-new account may be made. With sync on, only on the Mac: the Mac holds the data, so
 * a phone that got there first would otherwise create an empty account the Mac then can't use.
 */
export const canCreateHere = () => !SYNC || OS === 'macos';
type AnyRelay = WsRelay | NullRelay;

export type Session = {
  engine: SyncEngine;
  relay: AnyRelay;
  sync: boolean;
  user: string;
  device: string;
  created: boolean;
  recoveryCode?: string;
  /** Re-checks the current password before a sensitive action and returns its auth value. */
  verify: (password: string) => string;
  changePassword: (current: string, next: string) => Promise<void>;
  newRecoveryCode: (current: string) => Promise<string>;
  logOutDevice: (id: string) => Promise<void>;
  /** Hands the open account key to the Mac app for one reload (an update), so you stay logged in. */
  stash: () => Promise<boolean>;
  /** Turns on Touch ID unlock: confirms the finger and keeps the account key in the Mac's keychain. */
  enableBiometrics: () => Promise<void>;
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
  const installed = native || matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
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
  'mac-first': 'Din konto er ikke lagt op på serveren endnu. Åbn CENTRA på din Mac og log ind dér først. Så kommer dine data op, og du kan logge ind her.',
  'other-account': 'Serveren har en anden CENTRA-konto end den, dine data på denne enhed er låst med. Intet er ændret eller slettet.',
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
/** `migrate`: the server has no account yet, but this device has one from before sync: it goes up as it is. */
export type Lookup = { relay: AnyRelay; pre: Prelogin & { offline?: boolean }; user: string; migrate?: boolean };

/** Finds the account (online, or from this device's cache when offline). */
export async function lookUp(userInput: string): Promise<Lookup> {
  await ready();
  const user = normalizeUser(userInput);
  if (!user) throw new Error('auth');
  if (!SYNC) {
    const cached = localStorage.getItem(preKey(user));
    const pre = cached ? { ...JSON.parse(cached), exists: true, offline: true } : { exists: false, canRegister: user === normalizeUser(DEFAULT_USER), offline: true };
    return { relay: new NullRelay(), pre, user };
  }
  const relay = new WsRelay(relayUrl(), { user, device: deviceId(), name: deviceName(), platform: deviceName() });
  try {
    const pre = await relay.prelogin(3500);
    if (pre.exists) localStorage.setItem(preKey(user), JSON.stringify(pre));
    const migrate = !pre.exists && pre.canRegister && !!localStorage.getItem(cacheKey(user));
    return { relay, pre, user, migrate };
  } catch {
    const cached = localStorage.getItem(preKey(user));
    if (cached) return { relay, pre: { ...JSON.parse(cached), offline: true }, user };
    relay.close();
    throw new Error('offline');
  }
}

/** Logs in with the password (online or offline), or creates the account the very first time. */
export async function signIn({ relay, pre, user, migrate }: Lookup, password: string, onStep: (s: Step) => void): Promise<Session> {
  onStep('Låser op');
  await new Promise((r) => setTimeout(r, 20)); // let the UI paint before Argon2id blocks
  let account: AccountPublic, keys: KeyRing, ak: Uint8Array, created = false, recoveryCode: string | undefined, auth: string;

  if (migrate && relay instanceof WsRelay) {
    // First time with sync: this device's account (made before there was a server) is registered on
    // the server exactly as it is, so the same password and the data already here keep working.
    // The server needs proof of a recovery key, and the old one only exists on paper: a new one is
    // made (and shown once); the old one stops working.
    account = JSON.parse(localStorage.getItem(cacheKey(user))!);
    const s = passwordSecrets(password, account.kdf);
    try {
      localGuard.check();
      try { ({ keys, ak } = unlock(account, s.enc)); } catch (e) { localGuard.fail(); throw e; }
      localGuard.reset();
    } catch (e) { relay.close(); throw e; } finally { wipe(s.enc); }
    onStep('Opretter konto');
    const r = newRecovery(ak);
    account = { ...account, recovery: r.recovery };
    try { await relay.register(account, s.auth, r.recoveryAuth); } catch (e) { relay.close(); throw e; }
    recoveryCode = r.code;
    auth = s.auth;
    onStep('Synkroniserer');
    return openSession(relay, user, account, keys, ak, false, recoveryCode, auth, true);
  }

  if (!pre.exists) {
    if (!pre.canRegister) throw new Error('not-allowed');
    if (!canCreateHere()) throw new Error('mac-first');
    onStep('Opretter konto');
    const a = createAccount(password);
    if (relay instanceof WsRelay) await relay.register(a.account, a.auth, a.recoveryAuth);
    ({ account, keys, ak, recoveryCode } = a);
    auth = a.auth;
    created = true;
  } else {
    const s = passwordSecrets(password, pre.kdf!);
    try {
      if (pre.offline || relay instanceof NullRelay) {
        const cached = localStorage.getItem(cacheKey(user));
        if (!cached) throw new Error('offline');
        account = JSON.parse(cached);
        localGuard.check();
        try { ({ keys, ak } = unlock(account, s.enc)); } catch (e) { localGuard.fail(); throw e; } // throws on a wrong password
        localGuard.reset();
        if (relay instanceof WsRelay) relay.loginWhenOnline(s.auth);
      } else {
        account = (await (relay as WsRelay).login(s.auth)).account;
        ({ keys, ak } = unlock(account, s.enc));
        sameAccount(user, account);
      }
      auth = s.auth;
    } catch (e) {
      relay.close();
      throw e;
    } finally {
      wipe(s.enc);
    }
  }
  onStep('Synkroniserer');
  return openSession(relay, user, account, keys, ak, created, recoveryCode, auth);
}

/**
 * The server's account must be the one this device's data was written with. (It can only differ if
 * another device made a new account before this one went up: then the data here stays untouched.)
 */
function sameAccount(user: string, server: AccountPublic) {
  const cached = localStorage.getItem(cacheKey(user));
  if (!cached) return;
  const mine = (JSON.parse(cached) as AccountPublic).keys?.[0]?.keyId;
  if (mine && server.keys?.[0]?.keyId && mine !== server.keys[0].keyId) throw new Error('other-account');
}

/**
 * The server login value, kept encrypted under the account key, so an unlock with Touch ID / Face ID
 * or after an update (which opens the account key without the password) can log in to sync too.
 * It proves the password to the server but cannot decrypt anything, and it only opens with the key.
 */
const authKey = (u: string) => `centra.auth.${u}`;
function keepAuth(user: string, ak: Uint8Array, auth: string) {
  const k = subKey(ak, 'auth/v1');
  try { localStorage.setItem(authKey(user), sealJson({ auth }, k, `auth:${user}`)); } finally { wipe(k); }
}
function keptAuth(user: string, ak: Uint8Array): string | null {
  const sealed = localStorage.getItem(authKey(user));
  if (!sealed) return null;
  const k = subKey(ak, 'auth/v1');
  try { return openJson<{ auth: string }>(sealed, k, `auth:${user}`).auth; } catch { return null; } finally { wipe(k); }
}

/** Everything after the keys are open: local store, sync engine and the session's actions. */
async function openSession(relay: AnyRelay, user: string, account: AccountPublic, keys: KeyRing, ak: Uint8Array, created: boolean, recoveryCode?: string, auth?: string, firstUpload = false): Promise<Session> {
  const remember = () => {
    localStorage.setItem(cacheKey(user), JSON.stringify(account));
    localStorage.setItem(preKey(user), JSON.stringify({ exists: true, kdf: account.kdf, recovery: account.recovery, canRegister: false }));
  };
  remember();
  if (auth && SYNC) keepAuth(user, ak, auth);
  localStorage.setItem('centra.lastUser', user);

  // Keys rotated on another device (after it logged a device out) arrive here.
  relay.onAccount = (a: unknown) => { account = a as AccountPublic; absorbKeys(keys, account.keys, ak); remember(); };
  relay.onOpen(() => { if (relay.account) relay.onAccount?.(relay.account); });
  const storeKey = subKey(ak, 'store/v1');

  const device = deviceId();
  const disk = new IndexedDbStore(`${user}:${device}`);
  const engine = new SyncEngine({ device, keys, store: new EncryptedStore(disk, storeKey, disk), relay });
  await engine.start({ compact: firstUpload });
  purgeSampleData(engine);
  keepInSync(engine, relay);

  const verify = (pw: string) => {
    const s = passwordSecrets(pw, account.kdf);
    try { unlock(account, s.enc); } catch { throw new Error('wrong-password'); } finally { wipe(s.enc); }
    return s.auth;
  };

  return {
    engine, relay, sync: SYNC, user, device, created, recoveryCode, verify,
    async changePassword(current, next) {
      const oldAuth = verify(current);
      const w = rewrap(ak, next);
      if (relay instanceof WsRelay) await relay.changePassword(oldAuth, w);
      account = { ...account, kdf: w.kdf, wrappedAK: w.wrappedAK };
      remember();
      if (SYNC) keepAuth(user, ak, w.auth);
    },
    async newRecoveryCode(current) {
      const a = verify(current);
      const r = newRecovery(ak);
      if (relay instanceof WsRelay) await relay.setRecovery(a, r.recovery, r.recoveryAuth);
      account = { ...account, recovery: r.recovery };
      remember();
      return r.code;
    },
    async enableBiometrics() {
      await invoke('bio_enable', { user, key: Array.from(ak) });
    },
    async stash() {
      if (!native) return false;
      await invoke('session_stash', { user, key: Array.from(ak) });
      return true;
    },
    async logOutDevice(id) {
      if (!(relay instanceof WsRelay)) return;
      await relay.revoke(id);
      // Everything written from now on uses a key the removed device has never seen.
      await relay.addKeys(rotateContentKey(account, ak, keys));
    },
  };
}

/**
 * Opens the vault from an account key that is already open elsewhere: handed back by the Mac app
 * after an update reload, or released by Touch ID from the keychain. Throws if the key does not fit.
 */
export async function openWithKey(userIn: string, raw: number[] | Uint8Array): Promise<Session> {
  const ak = new Uint8Array(raw);
  const look = await lookUp(userIn);
  const cached = localStorage.getItem(cacheKey(look.user));
  if (!cached) { wipe(ak); throw new Error('offline'); }
  let account = JSON.parse(cached) as AccountPublic;
  let { keys } = unlockWithAk(account, ak); // throws if the key does not fit this account
  if (look.relay instanceof WsRelay) {
    // Sync needs the server login too: the kept login value, opened with this key.
    const auth = keptAuth(look.user, ak);
    // No kept login yet (the first time with sync): the password is needed once.
    if (!auth || look.migrate) { look.relay.close(); wipe(ak); throw new Error('need-password'); }
    if (look.pre.offline) look.relay.loginWhenOnline(auth);
    else {
      try { account = (await look.relay.login(auth)).account; } catch (e) { look.relay.close(); wipe(ak); throw e; }
      sameAccount(look.user, account);
      ({ keys } = unlockWithAk(account, ak));
    }
  }
  return openSession(look.relay, look.user, account, keys, ak, false);
}

/** After an update reloads the window: the Mac app hands back the key it held (in memory, at most a minute). */
export async function resumeAfterUpdate(): Promise<Session | null> {
  if (!native) return null;
  try {
    const got = await invoke<[string, number[]] | null>('session_take');
    return got ? await openWithKey(got[0], got[1]) : null;
  } catch {
    return null;
  }
}

/** Forgot the password: the recovery code proves ownership and sets a new one. Works on any device. */
export async function recover(userInput: string, code: string, newPassword: string, onStep: (s: Step) => void): Promise<void> {
  const { relay, pre, user } = await lookUp(userInput);
  try {
    if (pre.offline && SYNC) throw new Error('offline');
    if (!pre.exists || !pre.recovery) throw new Error('wrong-recovery-code');
    onStep('Låser op');
    await new Promise((r) => setTimeout(r, 20));
    localGuard.check();
    let r;
    try { r = recoverWithCode(pre.recovery, code, newPassword); } catch (e) { localGuard.fail(); throw e; }
    localGuard.reset();
    if (relay instanceof WsRelay) {
      await relay.recover(r.recoveryAuth, r.password);
      localStorage.removeItem(preKey(user));
      localStorage.removeItem(cacheKey(user));
    } else {
      const cached: AccountPublic = JSON.parse(localStorage.getItem(cacheKey(user))!);
      const next = { ...cached, kdf: r.password.kdf, wrappedAK: r.password.wrappedAK };
      localStorage.setItem(cacheKey(user), JSON.stringify(next));
      localStorage.setItem(preKey(user), JSON.stringify({ exists: true, kdf: next.kdf, recovery: next.recovery, canRegister: false }));
    }
  } finally {
    relay.close();
  }
}

export type { DeviceRecord };

/**
 * Lock-out for local (no-server) logins, mirroring the server: 5 free tries, then 30 s, 60 s, …
 * Argon2id already makes each guess slow; this stops someone sitting at the Mac from trying many.
 */
const localGuard = {
  get(): { f: number; until: number } { try { return JSON.parse(localStorage.getItem('centra.guard') ?? '') ; } catch { return { f: 0, until: 0 }; } },
  check() {
    const g = this.get();
    if (g.until > Date.now()) throw new RelayError('locked', Math.ceil((g.until - Date.now()) / 1000));
  },
  fail() {
    const g = this.get();
    const f = g.f + 1;
    const until = f >= 5 ? Date.now() + Math.min(3_600_000, 30_000 * 2 ** (f - 5)) : 0;
    localStorage.setItem('centra.guard', JSON.stringify({ f, until }));
    if (until) throw new RelayError('auth', Math.ceil((until - Date.now()) / 1000));
  },
  reset() { localStorage.removeItem('centra.guard'); },
};

/**
 * Live while the app is open, also on a phone that was put away: when the app comes back to the
 * front (or the network returns) the connection is checked at once and anything missed is fetched;
 * while it is open it asks once a minute as a safety net. Unsaved changes are written when it goes
 * to the background, where iOS may stop it at any time.
 */
function keepInSync(engine: SyncEngine, relay: AnyRelay) {
  const save = () => { if (document.visibilityState === 'hidden') void engine.persist().catch(() => {}); };
  document.addEventListener('visibilitychange', save);
  addEventListener('pagehide', () => void engine.persist().catch(() => {}));
  if (!(relay instanceof WsRelay)) return;
  const wake = () => {
    if (document.visibilityState !== 'visible') return;
    relay.resume();
    if (relay.connected) void engine.catchUp().catch(() => {});
  };
  document.addEventListener('visibilitychange', wake);
  addEventListener('focus', wake);
  addEventListener('online', wake);
  addEventListener('pageshow', wake);
  setInterval(() => { if (document.visibilityState === 'visible' && relay.connected) void engine.catchUp().catch(() => {}); }, 60_000);
}

/** Earlier test builds filled a new account with invented sample content; it is removed for good on unlock. */
function purgeSampleData(e: SyncEngine) {
  for (const t of ['note', 'event', 'mail', 'goal', 'goalUpdate', 'memory', 'suggestion', 'person', 'rule']) {
    for (const r of e.list(t)) if ((r as { sample?: boolean }).sample) e.remove(t, r.id);
  }
}
