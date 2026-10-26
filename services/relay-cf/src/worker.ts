/**
 * Cloudflare Worker entry: routes wss://…/u/<user> to that account's Durable Object.
 * Everything security-relevant happens in @centra/relay-core, shared with the Node relay.
 */
import { DurableObject } from 'cloudflare:workers';
import { RelayCore, normalizeUser, type Conn, type Device, type Envelope, type Guard, type StoredAccount, type UserStore } from '@centra/relay-core';

type Env = { ACCOUNTS: DurableObjectNamespace<Account>; ALLOWED_USERS?: string };

const SECURITY_HEADERS = {
  'content-type': 'text/plain; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/u\/([^/]+)$/);
    if (!m) return new Response('CENTRA relay. Kun krypterede data.', { headers: SECURITY_HEADERS });
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('websocket only', { status: 426, headers: SECURITY_HEADERS });
    const user = normalizeUser(decodeURIComponent(m[1]));
    if (!/^[a-z0-9_.-]{1,64}$/.test(user)) return new Response('bad account', { status: 400, headers: SECURITY_HEADERS });
    const stub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(user));
    const fwd = new Request(req, { headers: new Headers(req.headers) });
    fwd.headers.set('x-centra-user', user);
    return stub.fetch(fwd);
  },
};

/** One account: its log, its devices, its lock-out state, and its open connections. */
export class Account extends DurableObject<Env> {
  private core: RelayCore;
  private user: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const kv = ctx.storage;
    const store: UserStore = {
      getAccount: async () => (await kv.get<StoredAccount>('account')) ?? null,
      putAccount: (a) => kv.put('account', a),
      getDevices: async () => (await kv.get<Device[]>('devices')) ?? [],
      putDevices: (d) => kv.put('devices', d),
      getGuard: async () => (await kv.get<Guard>('guard')) ?? { failures: 0, lockedUntil: 0 },
      putGuard: (g) => kv.put('guard', g),
      append: async (envs) => {
        const accepted: Envelope[] = [];
        let seq = (await kv.get<number>('seq')) ?? 0;
        for (const e of envs) {
          if (await kv.get(`i:${e.id}`)) continue;
          seq++;
          const env = { ...e, seq };
          await kv.put({ [`e:${String(seq).padStart(12, '0')}`]: env, [`i:${e.id}`]: seq, seq });
          accepted.push(env);
        }
        return accepted;
      },
      list: async (after, limit) => {
        const map = await kv.list<Envelope>({ prefix: 'e:', start: `e:${String(after + 1).padStart(12, '0')}`, limit });
        return [...map.values()];
      },
    };
    const allowed = (env.ALLOWED_USERS ?? 'tranberg').split(',').map(normalizeUser).filter(Boolean);
    // This object only ever serves the account it is named after.
    this.core = new RelayCore({ allowedUsers: allowed, store: (u) => { if (!this.user || u !== this.user) throw new Error('wrong account'); return store; } });
  }

  async fetch(req: Request): Promise<Response> {
    this.user = req.headers.get('x-centra-user');
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const conn: Conn = {
      send: (m) => { try { server.send(JSON.stringify(m)); } catch {} },
      close: (code, reason) => { try { server.close(code, reason); } catch {} },
    };
    let queue = Promise.resolve();
    server.addEventListener('message', (ev) => {
      queue = queue.then(() => this.core.handle(conn, typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer)));
    });
    server.addEventListener('close', () => this.core.disconnect(conn));
    server.addEventListener('error', () => this.core.disconnect(conn));
    return new Response(null, { status: 101, webSocket: client });
  }
}
