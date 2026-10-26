/**
 * WebSocket relay client for the CENTRA relay server (services/relay) — used in development,
 * self-hosting and tests. The production adapter for Supabase lives in supabase.ts and has the same shape.
 *
 * Protocol (JSON frames):
 *   → hello {user, device, name, platform, token}   ← welcome {account, devices}
 *   → push {rid, envs}                              ← ack {rid}
 *   → pull {rid, after}                             ← envs {rid, envs}
 *                                                   ← live {env}         (fan-out from other devices)
 *   → account {kdf, wrapped}                        ← devices {devices}
 *   → revoke {device}                               (server closes the revoked device with 4001)
 */
import type { Envelope, Relay } from './types.ts';

export type AccountRecord = { kdf: { salt: string; ops: number; mem: number }; wrapped: { keyId: string; sealed: string }[] };
export type DeviceRecord = { id: string; name: string; platform: string; lastSeen: number; revoked?: boolean; online?: boolean };
export type Hello = { user: string; device: string; name: string; platform: string; token?: string };

type Pending = { resolve: (v: any) => void; reject: (e: unknown) => void };

export class WsRelay implements Relay {
  private ws: WebSocket | null = null;
  private subs = new Set<(e: Envelope) => void>();
  private opens = new Set<() => void>();
  private pending = new Map<string, Pending>();
  private rid = 0;
  private closed = false;
  private retry = 250;
  connected = false;
  account: AccountRecord | null = null;
  devices: DeviceRecord[] = [];
  onDevices?: (d: DeviceRecord[]) => void;
  onRevoked?: () => void;
  private welcomed: Promise<void>;
  private resolveWelcome!: () => void;

  constructor(private url: string, private hello: Hello, private WS: typeof WebSocket = globalThis.WebSocket) {
    this.welcomed = new Promise((r) => (this.resolveWelcome = r));
    this.open();
  }

  /** Resolves after the first welcome frame (account + devices known). */
  ready() { return this.welcomed; }

  private open() {
    if (this.closed) return;
    const ws = new this.WS(this.url);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', ...this.hello }));
    ws.onmessage = (ev) => this.onFrame(JSON.parse(String(ev.data)));
    ws.onclose = (ev) => {
      this.connected = false;
      this.pending.forEach((p) => p.reject(new Error('closed')));
      this.pending.clear();
      if (ev.code === 4001) { this.closed = true; this.onRevoked?.(); return; }
      setTimeout(() => this.open(), this.retry);
      this.retry = Math.min(this.retry * 2, 8000);
    };
    ws.onerror = () => {};
  }

  private onFrame(m: any) {
    switch (m.type) {
      case 'welcome':
        this.account = m.account;
        this.devices = m.devices;
        this.connected = true;
        this.retry = 250;
        this.resolveWelcome();
        this.onDevices?.(this.devices);
        this.opens.forEach((o) => o());
        break;
      case 'live':
        this.subs.forEach((s) => s(m.env));
        break;
      case 'devices':
        this.devices = m.devices;
        this.onDevices?.(this.devices);
        break;
      case 'ack':
      case 'envs': {
        const p = this.pending.get(m.rid);
        this.pending.delete(m.rid);
        p?.resolve(m.envs ?? null);
        break;
      }
      case 'error': {
        const p = this.pending.get(m.rid);
        this.pending.delete(m.rid);
        p?.reject(new Error(m.message));
        break;
      }
    }
  }

  private call<T>(frame: Record<string, unknown>): Promise<T> {
    if (!this.connected || !this.ws) return Promise.reject(new Error('offline'));
    const rid = String(++this.rid);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(rid, { resolve, reject });
      this.ws!.send(JSON.stringify({ ...frame, rid }));
    });
  }

  async push(envs: Envelope[]) { await this.call({ type: 'push', envs }); }
  async pull(after: number) { return (await this.call<Envelope[]>({ type: 'pull', after })) ?? []; }
  subscribe(cb: (e: Envelope) => void) { this.subs.add(cb); return () => this.subs.delete(cb); }
  onOpen(cb: () => void) { this.opens.add(cb); return () => this.opens.delete(cb); }

  setAccount(a: AccountRecord) { this.account = a; this.ws?.send(JSON.stringify({ type: 'account', ...a })); }
  revoke(device: string) { this.ws?.send(JSON.stringify({ type: 'revoke', device })); }
  close() { this.closed = true; this.ws?.close(); }
}
