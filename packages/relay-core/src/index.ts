/**
 * The CENTRA relay protocol, independent of where it runs (Node for development, a Cloudflare
 * Durable Object in production). It authenticates, stores and fans out ciphertext; it never holds a key.
 *
 * Security properties (see SECURITY.md):
 *  - Nothing but `prelogin` (which returns public KDF salts) works before authentication.
 *  - The server stores SHA-256(auth) only; auth is itself derived from the password with Argon2id.
 *  - Failed logins are throttled per account with an exponential lock (5 free tries, then 30 s, 60 s, … ≤ 1 h).
 *  - Only allow-listed usernames can be registered, and only once.
 *  - Every frame and field is size- and shape-checked; each connection is rate-limited.
 *  - A password change or a revoked device disconnects the other sessions.
 */

export type KdfParams = { salt: string; ops: number; mem: number };
export type WrappedKey = { keyId: string; sealed: string };
export type AccountPublic = { v: 2; kdf: KdfParams; wrappedAK: string; recovery: { kdf: KdfParams; wrappedAK: string }; keys: WrappedKey[] };
export type StoredAccount = { pub: AccountPublic; verifier: string; recoveryVerifier: string; created: number };
export type Envelope = { id: string; seq?: number; device: string; keyId: string; body: string };
export type Device = { id: string; name: string; platform: string; lastSeen: number; revoked?: boolean; online?: boolean };
export type Guard = { failures: number; lockedUntil: number };

export interface UserStore {
  getAccount(): Promise<StoredAccount | null>;
  putAccount(a: StoredAccount): Promise<void>;
  getDevices(): Promise<Device[]>;
  putDevices(d: Device[]): Promise<void>;
  getGuard(): Promise<Guard>;
  putGuard(g: Guard): Promise<void>;
  /** Assigns seq to new envelopes (ignoring ids already stored) and returns the accepted ones. */
  append(envs: Envelope[]): Promise<Envelope[]>;
  list(after: number, limit: number): Promise<Envelope[]>;
}

export interface Conn {
  send(msg: unknown): void;
  close(code: number, reason: string): void;
  user?: string;
  device?: string;
  authed?: boolean;
  bucket?: { tokens: number; at: number };
}

export type RelayOptions = {
  store: (user: string) => UserStore;
  /** Usernames that may be registered (normalised). Default: tranberg. */
  allowedUsers?: string[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const LIMITS = { frame: 4_000_000, body: 1_500_000, envsPerPush: 500, pull: 2000, msgsPerSecond: 40, burst: 120 };
const FREE_TRIES = 5;

export const normalizeUser = (u: unknown) => (typeof u === 'string' ? u.trim().toLowerCase() : '');

async function sha256hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ---------------------------------------------------------------- validation */
const isStr = (v: unknown, max: number, re?: RegExp): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && (!re || re.test(v));
const B64 = /^[A-Za-z0-9+/=_-]+$/;
const isKdf = (k: any): k is KdfParams => k && isStr(k.salt, 64, B64) && Number.isInteger(k.ops) && k.ops >= 2 && k.ops <= 20 && Number.isInteger(k.mem) && k.mem >= 64 * 1024 * 1024 / 4 && k.mem <= 1024 * 1024 * 1024;
const isWrapped = (w: any): w is WrappedKey => w && isStr(w.keyId, 20, /^k[0-9a-f]{2,16}$/) && isStr(w.sealed, 400, B64);
function isAccount(a: any): a is AccountPublic {
  return a && a.v === 2 && isKdf(a.kdf) && isStr(a.wrappedAK, 400, B64) && a.recovery && isKdf(a.recovery.kdf) && isStr(a.recovery.wrappedAK, 400, B64)
    && Array.isArray(a.keys) && a.keys.length >= 1 && a.keys.length <= 256 && a.keys.every(isWrapped);
}
const isAuth = (v: unknown): v is string => isStr(v, 64, B64);
const isEnv = (e: any): e is Envelope => e && isStr(e.id, 64, /^[0-9a-f]{8,64}$/) && isStr(e.keyId, 20, /^k[0-9a-f]{2,16}$/) && isStr(e.body, LIMITS.body, B64);
const cleanName = (s: unknown, fallback: string) => (typeof s === 'string' ? s.replace(/[^\p{L}\p{N} ·._()-]/gu, '').slice(0, 60) : '') || fallback;

/* ---------------------------------------------------------------- core */
export class RelayCore {
  private conns = new Map<string, Set<Conn>>();
  private allowed: Set<string>;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;

  private o: RelayOptions;
  constructor(o: RelayOptions) {
    this.o = o;
    this.allowed = new Set((o.allowedUsers ?? ['tranberg']).map(normalizeUser));
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async handle(conn: Conn, raw: string): Promise<void> {
    if (raw.length > LIMITS.frame) return conn.close(1009, 'frame too large');
    if (!this.allow(conn)) return conn.close(1008, 'rate limited');
    let m: any;
    try { m = JSON.parse(raw); } catch { return conn.close(1007, 'bad json'); }
    if (!m || typeof m.type !== 'string') return;
    const rid = typeof m.rid === 'string' && m.rid.length < 20 ? m.rid : undefined;
    const err = (code: string, extra: Record<string, unknown> = {}) => conn.send({ type: 'error', rid, code, ...extra });

    try {
      if (!conn.authed) {
        switch (m.type) {
          case 'prelogin': return await this.prelogin(conn, m, rid);
          case 'register': return await this.register(conn, m, err);
          case 'login': return await this.login(conn, m, err);
          case 'recover': return await this.recover(conn, m, err);
          default: return err('unauthenticated');
        }
      }
      const store = this.o.store(conn.user!);
      switch (m.type) {
        case 'push': {
          if (!Array.isArray(m.envs) || m.envs.length > LIMITS.envsPerPush || !m.envs.every(isEnv)) return err('bad-envelopes');
          const accepted = await store.append(m.envs.map((e: Envelope) => ({ id: e.id, keyId: e.keyId, body: e.body, device: conn.device! })));
          conn.send({ type: 'ack', rid });
          for (const c of this.peers(conn.user!)) for (const env of accepted) c.send({ type: 'live', env });
          await this.touch(conn);
          return;
        }
        case 'pull': {
          const after = Number.isSafeInteger(m.after) && m.after >= 0 ? m.after : 0;
          return conn.send({ type: 'envs', rid, envs: await store.list(after, LIMITS.pull) });
        }
        case 'password': {
          const acc = await store.getAccount();
          if (!acc || !isAuth(m.oldAuth) || !isAuth(m.auth) || !isKdf(m.kdf) || !isStr(m.wrappedAK, 400, B64)) return err('bad-request');
          if (!(await this.checkAuth(store, acc.verifier, m.oldAuth))) return err('auth');
          acc.pub = { ...acc.pub, kdf: m.kdf, wrappedAK: m.wrappedAK };
          acc.verifier = await sha256hex(m.auth);
          await store.putAccount(acc);
          conn.send({ type: 'ack', rid });
          for (const c of this.peers(conn.user!)) if (c !== conn) c.close(4002, 'password changed');
          return;
        }
        case 'recovery': {
          const acc = await store.getAccount();
          if (!acc || !isAuth(m.auth) || !isAuth(m.recoveryAuth) || !m.recovery || !isKdf(m.recovery.kdf) || !isStr(m.recovery.wrappedAK, 400, B64)) return err('bad-request');
          if (!(await this.checkAuth(store, acc.verifier, m.auth))) return err('auth');
          acc.pub = { ...acc.pub, recovery: { kdf: m.recovery.kdf, wrappedAK: m.recovery.wrappedAK } };
          acc.recoveryVerifier = await sha256hex(m.recoveryAuth);
          await store.putAccount(acc);
          return conn.send({ type: 'ack', rid });
        }
        case 'keys': {
          const acc = await store.getAccount();
          if (!acc || !Array.isArray(m.keys) || m.keys.length > 256 || !m.keys.every(isWrapped)) return err('bad-request');
          // Keys may only be added, never removed or replaced, so old data stays readable.
          const known = new Map(acc.pub.keys.map((k) => [k.keyId, k.sealed]));
          for (const k of m.keys as WrappedKey[]) if (known.has(k.keyId) && known.get(k.keyId) !== k.sealed) return err('bad-request');
          const added = (m.keys as WrappedKey[]).filter((k) => !known.has(k.keyId));
          acc.pub = { ...acc.pub, keys: [...acc.pub.keys, ...added] };
          await store.putAccount(acc);
          conn.send({ type: 'ack', rid });
          for (const c of this.peers(conn.user!)) c.send({ type: 'account', account: acc.pub });
          return;
        }
        case 'revoke': {
          if (!isStr(m.device, 40)) return err('bad-request');
          const devices = await store.getDevices();
          const t = devices.find((d) => d.id === m.device);
          if (t && t.id !== conn.device) {
            t.revoked = true;
            await store.putDevices(devices);
            for (const c of this.peers(conn.user!)) if (c.device === t.id) c.close(4001, 'device logged out');
            await this.broadcastDevices(conn.user!);
          }
          return conn.send({ type: 'ack', rid });
        }
        default:
          return err('unknown');
      }
    } catch (e) {
      return err('server');
    }
  }

  disconnect(conn: Conn) {
    if (!conn.user) return;
    this.conns.get(conn.user)?.delete(conn);
    void this.broadcastDevices(conn.user).catch(() => {});
  }

  /* -------------------------------------------------- auth */

  private async prelogin(conn: Conn, m: any, rid?: string) {
    const user = normalizeUser(m.user);
    if (!isStr(user, 64)) return conn.send({ type: 'prelogin', rid, exists: false, canRegister: false });
    const acc = await this.o.store(user).getAccount();
    // The recovery-wrapped account key is public on purpose: it is sealed under a 125-bit random
    // recovery code stretched with Argon2id, so it lets a brand-new device recover, and nothing else.
    conn.send({ type: 'prelogin', rid, exists: !!acc, kdf: acc?.pub.kdf, recovery: acc?.pub.recovery, canRegister: !acc && this.allowed.has(user) });
  }

  private async register(conn: Conn, m: any, err: (c: string, x?: Record<string, unknown>) => void) {
    const user = normalizeUser(m.user);
    if (!this.allowed.has(user)) return err('not-allowed');
    if (!isAccount(m.account) || !isAuth(m.auth) || !isAuth(m.recoveryAuth) || !isStr(m.device, 40)) return err('bad-request');
    const store = this.o.store(user);
    if (await store.getAccount()) return err('exists');
    await store.putAccount({ pub: m.account, verifier: await sha256hex(m.auth), recoveryVerifier: await sha256hex(m.recoveryAuth), created: this.now() });
    await this.admit(conn, user, m, store);
  }

  private async login(conn: Conn, m: any, err: (c: string, x?: Record<string, unknown>) => void) {
    const user = normalizeUser(m.user);
    if (!isAuth(m.auth) || !isStr(m.device, 40)) return err('bad-request');
    const store = this.o.store(user);
    const locked = await this.lockedFor(store);
    if (locked) return err('locked', { retryAfter: locked });
    const acc = await store.getAccount();
    if (!acc || !(await this.checkAuth(store, acc.verifier, m.auth))) {
      const after = await this.lockedFor(store);
      return err('auth', after ? { retryAfter: after } : {});
    }
    await this.admit(conn, user, m, store);
  }

  private async recover(conn: Conn, m: any, err: (c: string, x?: Record<string, unknown>) => void) {
    const user = normalizeUser(m.user);
    if (!isAuth(m.recoveryAuth) || !isAuth(m.auth) || !isKdf(m.kdf) || !isStr(m.wrappedAK, 400, B64) || !isStr(m.device, 40)) return err('bad-request');
    const store = this.o.store(user);
    const locked = await this.lockedFor(store);
    if (locked) return err('locked', { retryAfter: locked });
    const acc = await store.getAccount();
    if (!acc || !(await this.checkAuth(store, acc.recoveryVerifier, m.recoveryAuth))) return err('auth');
    acc.pub = { ...acc.pub, kdf: m.kdf, wrappedAK: m.wrappedAK };
    acc.verifier = await sha256hex(m.auth);
    await store.putAccount(acc);
    for (const c of this.peers(user)) c.close(4002, 'password changed');
    await this.admit(conn, user, m, store);
  }

  /** Verifies and updates the lock-out counter. */
  private async checkAuth(store: UserStore, verifier: string, auth: string): Promise<boolean> {
    const ok = safeEqual(await sha256hex(auth), verifier);
    const g = await store.getGuard();
    if (ok) {
      if (g.failures) await store.putGuard({ failures: 0, lockedUntil: 0 });
      return true;
    }
    const failures = g.failures + 1;
    const lockedUntil = failures >= FREE_TRIES ? this.now() + Math.min(3_600_000, 30_000 * 2 ** (failures - FREE_TRIES)) : 0;
    await store.putGuard({ failures, lockedUntil });
    await this.sleep(300);
    return false;
  }

  private async lockedFor(store: UserStore): Promise<number> {
    const g = await store.getGuard();
    return g.lockedUntil > this.now() ? Math.ceil((g.lockedUntil - this.now()) / 1000) : 0;
  }

  private async admit(conn: Conn, user: string, m: any, store: UserStore) {
    const devices = await store.getDevices();
    const existing = devices.find((d) => d.id === m.device);
    if (existing?.revoked) return conn.close(4001, 'device logged out');
    const dev: Device = { id: m.device, name: cleanName(m.name, 'Enhed'), platform: cleanName(m.platform, 'web'), lastSeen: this.now() };
    const next = existing ? devices.map((d) => (d.id === dev.id ? dev : d)) : [...devices, dev];
    await store.putDevices(next.slice(-50));
    conn.user = user;
    conn.device = m.device;
    conn.authed = true;
    let set = this.conns.get(user);
    if (!set) this.conns.set(user, (set = new Set()));
    set.add(conn);
    const acc = (await store.getAccount())!;
    conn.send({ type: 'welcome', rid: typeof m.rid === 'string' ? m.rid.slice(0, 20) : undefined, account: acc.pub, devices: this.withOnline(user, next) });
    await this.broadcastDevices(user);
  }

  /* -------------------------------------------------- helpers */

  private peers(user: string): Conn[] {
    return [...(this.conns.get(user) ?? [])];
  }
  private withOnline(user: string, devices: Device[]): Device[] {
    const online = new Set(this.peers(user).map((c) => c.device));
    return devices.map((d) => ({ ...d, online: online.has(d.id) }));
  }
  private async broadcastDevices(user: string) {
    const devices = this.withOnline(user, await this.o.store(user).getDevices());
    for (const c of this.peers(user)) c.send({ type: 'devices', devices });
  }
  private async touch(conn: Conn) {
    const store = this.o.store(conn.user!);
    const devices = await store.getDevices();
    const d = devices.find((x) => x.id === conn.device);
    if (d && this.now() - d.lastSeen > 60_000) { d.lastSeen = this.now(); await store.putDevices(devices); }
  }
  private allow(conn: Conn): boolean {
    const t = this.now();
    const b = (conn.bucket ??= { tokens: LIMITS.burst, at: t });
    b.tokens = Math.min(LIMITS.burst, b.tokens + ((t - b.at) / 1000) * LIMITS.msgsPerSecond);
    b.at = t;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}

/** In-memory store (tests and the Node relay's cache). */
export class MemoryUserStore implements UserStore {
  account: StoredAccount | null = null;
  devices: Device[] = [];
  guard: Guard = { failures: 0, lockedUntil: 0 };
  log: Envelope[] = [];
  ids = new Set<string>();
  async getAccount() { return this.account ? structuredClone(this.account) : null; }
  async putAccount(a: StoredAccount) { this.account = structuredClone(a); }
  async getDevices() { return structuredClone(this.devices); }
  async putDevices(d: Device[]) { this.devices = structuredClone(d); }
  async getGuard() { return { ...this.guard }; }
  async putGuard(g: Guard) { this.guard = { ...g }; }
  async append(envs: Envelope[]) {
    const out: Envelope[] = [];
    for (const e of envs) {
      if (this.ids.has(e.id)) continue;
      const env = { ...e, seq: this.log.length + 1 };
      this.log.push(env); this.ids.add(e.id); out.push(env);
    }
    return out;
  }
  async list(after: number, limit: number) { return this.log.filter((e) => (e.seq ?? 0) > after).slice(0, limit); }
}
