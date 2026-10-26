/**
 * CENTRA relay for development and self-hosting (the production twin runs on Cloudflare, see
 * services/relay-cf). Same protocol, same core: it authenticates, stores and fans out ciphertext only.
 *
 *   PORT=8787 DATA=./data ALLOWED_USERS=tranberg node server.ts
 */
import { WebSocketServer, type WebSocket } from 'ws';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { RelayCore, MemoryUserStore, normalizeUser, type Conn, type Device, type Envelope, type Guard, type StoredAccount, type UserStore } from '@centra/relay-core';

const PORT = Number(process.env.PORT ?? 8787);
const DATA = process.env.DATA ?? join(import.meta.dirname, 'data');
const PERSIST = process.env.PERSIST !== '0';
const ALLOWED = (process.env.ALLOWED_USERS ?? 'tranberg').split(',').map(normalizeUser).filter(Boolean);
if (PERSIST) mkdirSync(DATA, { recursive: true, mode: 0o700 });

/** Memory store that writes through to files (one folder per account, owner-only permissions). */
class FileUserStore extends MemoryUserStore implements UserStore {
  private dir: string;
  constructor(dir: string) {
    super();
    this.dir = dir;
    if (!PERSIST || !existsSync(dir)) return;
    const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : null);
    const a = read('account.json'); if (a) this.account = JSON.parse(a);
    const d = read('devices.json'); if (d) this.devices = JSON.parse(d);
    const g = read('guard.json'); if (g) this.guard = JSON.parse(g);
    const l = read('log.jsonl'); if (l) for (const line of l.split('\n')) if (line) { const e = JSON.parse(line); this.log.push(e); this.ids.add(e.id); }
  }
  private write(f: string, v: unknown) { if (PERSIST) { mkdirSync(this.dir, { recursive: true, mode: 0o700 }); writeFileSync(join(this.dir, f), JSON.stringify(v), { mode: 0o600 }); } }
  async putAccount(a: StoredAccount) { await super.putAccount(a); this.write('account.json', a); }
  async putDevices(d: Device[]) { await super.putDevices(d); this.write('devices.json', d); }
  async putGuard(g: Guard) { await super.putGuard(g); this.write('guard.json', g); }
  async append(envs: Envelope[]) {
    const acc = await super.append(envs);
    if (PERSIST && acc.length) { mkdirSync(this.dir, { recursive: true, mode: 0o700 }); appendFileSync(join(this.dir, 'log.jsonl'), acc.map((e) => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 }); }
    return acc;
  }
}

const stores = new Map<string, FileUserStore>();
const store = (user: string) => {
  const safe = user.replace(/[^a-z0-9_-]/g, '');
  if (!safe) throw new Error('bad user');
  let s = stores.get(safe);
  if (!s) stores.set(safe, (s = new FileUserStore(join(DATA, safe))));
  return s;
};

const core = new RelayCore({ store, allowedUsers: ALLOWED });
const wss = new WebSocketServer({ port: PORT, maxPayload: 4_000_000 });

wss.on('connection', (ws: WebSocket, req) => {
  const routeUser = normalizeUser(decodeURIComponent((req.url ?? '').match(/^\/u\/([^/?#]+)/)?.[1] ?? ''));
  const conn: Conn = {
    send: (m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m)),
    close: (code, reason) => ws.close(code, reason),
  };
  let queue = Promise.resolve();
  ws.on('message', (raw) => {
    // One message at a time per connection, so a login completes before the next frame is read.
    queue = queue.then(async () => {
      const text = String(raw);
      // The account in the URL and in the frame must agree (mirrors the per-account Durable Object).
      try { const u = normalizeUser(JSON.parse(text).user); if (u && routeUser && u !== routeUser) return ws.close(1008, 'wrong account'); } catch {}
      await core.handle(conn, text);
    });
  });
  ws.on('close', () => core.disconnect(conn));
});

console.log(`CENTRA relay on ws://localhost:${PORT} · ${PERSIST ? 'data in ' + DATA : 'memory only'} · accounts allowed: ${ALLOWED.join(', ')}`);
export { wss };
