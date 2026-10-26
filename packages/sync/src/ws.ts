/**
 * WebSocket client for the CENTRA relay (Node relay in development, Cloudflare in production).
 * Nothing is served before the account is authenticated; the auth value is password-derived and
 * held in memory only while the app is unlocked, so a reconnect can log in again silently.
 */
import type { Envelope, Relay } from './types.ts';
import type { AccountPublic } from './account.ts';

export type DeviceRecord = { id: string; name: string; platform: string; lastSeen: number; revoked?: boolean; online?: boolean };
export type Prelogin = { exists: boolean; kdf?: AccountPublic['kdf']; recovery?: AccountPublic['recovery']; canRegister: boolean };
export type Identity = { user: string; device: string; name: string; platform: string };
export class RelayError extends Error {
  constructor(public code: string, public retryAfter?: number) { super(code); }
}

type Pending = { resolve: (v: any) => void; reject: (e: unknown) => void };
type LoginFrame = { type: 'login' | 'register' | 'recover' } & Record<string, unknown>;

export class WsRelay implements Relay {
  private ws: WebSocket | null = null;
  private subs = new Set<(e: Envelope) => void>();
  private opens = new Set<() => void>();
  private pending = new Map<string, Pending>();
  private rid = 0;
  private closed = false;
  private retry = 250;
  private socketOpen: Promise<void>;
  private resolveOpen!: () => void;
  /** How to log back in after a reconnect (a plain login with the in-memory auth value). */
  private relogin: LoginFrame | null = null;
  connected = false;
  account: AccountPublic | null = null;
  devices: DeviceRecord[] = [];
  onDevices?: (d: DeviceRecord[]) => void;
  onAccount?: (a: AccountPublic) => void;
  /** 4001 = this device was logged out, 4002 = the password changed elsewhere. */
  onClosedByServer?: (code: 4001 | 4002) => void;

  constructor(private url: string, private id: Identity, private WS: typeof WebSocket = globalThis.WebSocket) {
    this.socketOpen = new Promise((r) => (this.resolveOpen = r));
    this.open();
  }

  private open() {
    if (this.closed) return;
    const ws = new this.WS(`${this.url.replace(/\/$/, '')}/u/${encodeURIComponent(this.id.user)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 250;
      this.resolveOpen();
      if (this.relogin) ws.send(JSON.stringify({ ...this.relogin, type: 'login', rid: 'relogin' }));
    };
    ws.onmessage = (ev) => this.onFrame(JSON.parse(String(ev.data)));
    ws.onclose = (ev) => {
      this.connected = false;
      this.pending.forEach((p) => p.reject(new RelayError('closed')));
      this.pending.clear();
      if (ev.code === 4001 || ev.code === 4002) { this.closed = true; this.onClosedByServer?.(ev.code); return; }
      this.socketOpen = new Promise((r) => (this.resolveOpen = r));
      setTimeout(() => this.open(), this.retry);
      this.retry = Math.min(this.retry * 2, 10_000);
    };
    ws.onerror = () => {};
  }

  private onFrame(m: any) {
    if (m.rid && this.pending.has(m.rid)) {
      const p = this.pending.get(m.rid)!;
      this.pending.delete(m.rid);
      if (m.type === 'error') p.reject(new RelayError(m.code, m.retryAfter));
      else p.resolve(m);
      if (m.type !== 'welcome') return;
    }
    switch (m.type) {
      case 'welcome':
        this.account = m.account;
        this.devices = m.devices;
        this.connected = true;
        this.onDevices?.(this.devices);
        this.opens.forEach((o) => o());
        break;
      case 'live': this.subs.forEach((s) => s(m.env)); break;
      case 'devices': this.devices = m.devices; this.onDevices?.(this.devices); break;
      case 'account': this.account = m.account; this.onAccount?.(m.account); break;
      case 'error': if (m.rid === 'relogin') this.onClosedByServer?.(4002); break;
    }
  }

  private async raw<T = any>(frame: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
    await Promise.race([this.socketOpen, new Promise((_, r) => setTimeout(() => r(new RelayError('offline')), timeoutMs))]);
    const rid = String(++this.rid);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(rid, { resolve, reject });
      this.ws!.send(JSON.stringify({ ...frame, rid }));
      setTimeout(() => { if (this.pending.delete(rid)) reject(new RelayError('timeout')); }, timeoutMs);
    });
  }
  private call<T = any>(frame: Record<string, unknown>): Promise<T> {
    if (!this.connected) return Promise.reject(new RelayError('offline'));
    return this.raw<T>(frame);
  }

  /* ---------------------------------------------------- account */
  prelogin(timeoutMs = 4000): Promise<Prelogin> { return this.raw({ type: 'prelogin', user: this.id.user }, timeoutMs); }
  async login(auth: string) { return this.enter({ type: 'login', auth }); }
  async register(account: AccountPublic, auth: string, recoveryAuth: string) { await this.enter({ type: 'register', account, auth, recoveryAuth }); this.relogin = { type: 'login', ...this.id, auth }; }
  async recover(recoveryAuth: string, pw: { kdf: unknown; wrappedAK: string; auth: string }) {
    await this.enter({ type: 'recover', recoveryAuth, kdf: pw.kdf, wrappedAK: pw.wrappedAK, auth: pw.auth });
    this.relogin = { type: 'login', ...this.id, auth: pw.auth };
  }
  /** Remember the auth value so the relay can log in when it comes online (offline unlock). */
  loginWhenOnline(auth: string) {
    this.relogin = { type: 'login', ...this.id, auth };
    if (this.ws?.readyState === 1 && !this.connected) this.ws.send(JSON.stringify({ ...this.relogin, rid: 'relogin' }));
  }
  private async enter(frame: LoginFrame) {
    const m = await this.raw({ ...this.id, ...frame });
    if (frame.type === 'login') this.relogin = { type: 'login', ...this.id, auth: frame.auth };
    return m as { account: AccountPublic; devices: DeviceRecord[] };
  }
  async changePassword(oldAuth: string, next: { kdf: unknown; wrappedAK: string; auth: string }) {
    await this.call({ type: 'password', oldAuth, kdf: next.kdf, wrappedAK: next.wrappedAK, auth: next.auth });
    this.relogin = { type: 'login', ...this.id, auth: next.auth };
  }
  setRecovery(auth: string, recovery: AccountPublic['recovery'], recoveryAuth: string) { return this.call({ type: 'recovery', auth, recovery, recoveryAuth }); }
  addKeys(keys: AccountPublic['keys']) { return this.call({ type: 'keys', keys }); }
  revoke(device: string) { return this.call({ type: 'revoke', device }); }

  /* ---------------------------------------------------- Relay (sync engine) */
  async push(envs: Envelope[]) { await this.call({ type: 'push', envs }); }
  async pull(after: number) { return ((await this.call<{ envs: Envelope[] }>({ type: 'pull', after })).envs) ?? []; }
  subscribe(cb: (e: Envelope) => void) { this.subs.add(cb); return () => this.subs.delete(cb); }
  onOpen(cb: () => void) { this.opens.add(cb); return () => this.opens.delete(cb); }

  close() { this.closed = true; this.relogin = null; this.ws?.close(); }
}
