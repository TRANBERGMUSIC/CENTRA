/**
 * CENTRA relay — the development / self-host twin of the Supabase backend.
 * It stores and fans out *ciphertext only*: it never has a key and cannot read a single note or mail.
 *
 *   PORT=8787 DATA=./data RELAY_TOKEN=… node server.ts
 */
import { WebSocketServer, type WebSocket } from 'ws';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

type Envelope = { id: string; seq?: number; device: string; keyId: string; body: string };
type Device = { id: string; name: string; platform: string; lastSeen: number; revoked?: boolean };
type Account = { kdf: unknown; wrapped: unknown[] } | null;
type User = { log: Envelope[]; ids: Set<string>; account: Account; devices: Map<string, Device>; sockets: Map<WebSocket, string> };

const PORT = Number(process.env.PORT ?? 8787);
const DATA = process.env.DATA ?? join(import.meta.dirname, 'data');
const TOKEN = process.env.RELAY_TOKEN;
const PERSIST = process.env.PERSIST !== '0';
mkdirSync(DATA, { recursive: true });

const users = new Map<string, User>();
const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '');
const dir = (u: string) => join(DATA, safe(u));

function user(id: string): User {
  let u = users.get(id);
  if (u) return u;
  const d = dir(id);
  const log: Envelope[] = [];
  let account: Account = null;
  const devices = new Map<string, Device>();
  if (PERSIST && existsSync(d)) {
    if (existsSync(join(d, 'log.jsonl'))) for (const l of readFileSync(join(d, 'log.jsonl'), 'utf8').split('\n')) if (l) log.push(JSON.parse(l));
    if (existsSync(join(d, 'account.json'))) account = JSON.parse(readFileSync(join(d, 'account.json'), 'utf8'));
    if (existsSync(join(d, 'devices.json'))) for (const x of JSON.parse(readFileSync(join(d, 'devices.json'), 'utf8'))) devices.set(x.id, x);
  }
  u = { log, ids: new Set(log.map((e) => e.id)), account, devices, sockets: new Map() };
  users.set(id, u);
  return u;
}
function save(id: string, u: User, what: 'account' | 'devices') {
  if (!PERSIST) return;
  mkdirSync(dir(id), { recursive: true });
  if (what === 'account') writeFileSync(join(dir(id), 'account.json'), JSON.stringify(u.account));
  else writeFileSync(join(dir(id), 'devices.json'), JSON.stringify([...u.devices.values()]));
}
const deviceList = (u: User) => [...u.devices.values()].map((d) => ({ ...d, online: [...u.sockets.values()].includes(d.id) }));
const broadcastDevices = (u: User) => { const m = JSON.stringify({ type: 'devices', devices: deviceList(u) }); for (const s of u.sockets.keys()) s.send(m); };

const wss = new WebSocketServer({ port: PORT });
wss.on('connection', (ws) => {
  let uid: string | null = null;
  let did: string | null = null;
  ws.on('message', (raw) => {
    let m: any;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.type === 'hello') {
      if (TOKEN && m.token !== TOKEN) return ws.close(4003, 'bad token');
      uid = String(m.user); did = String(m.device);
      const u = user(uid);
      const existing = u.devices.get(did);
      if (existing?.revoked) return ws.close(4001, 'device logged out');
      u.devices.set(did, { id: did, name: m.name ?? 'Enhed', platform: m.platform ?? 'web', lastSeen: Date.now() });
      u.sockets.set(ws, did);
      save(uid, u, 'devices');
      ws.send(JSON.stringify({ type: 'welcome', account: u.account, devices: deviceList(u) }));
      broadcastDevices(u);
      return;
    }
    if (!uid || !did) return;
    const u = user(uid);
    const dev = u.devices.get(did)!;
    dev.lastSeen = Date.now();
    switch (m.type) {
      case 'push': {
        const accepted: Envelope[] = [];
        for (const e of m.envs as Envelope[]) {
          if (u.ids.has(e.id)) continue;
          const env: Envelope = { id: String(e.id), device: did, keyId: String(e.keyId), body: String(e.body), seq: u.log.length + 1 };
          u.log.push(env); u.ids.add(env.id); accepted.push(env);
          if (PERSIST) { mkdirSync(dir(uid), { recursive: true }); appendFileSync(join(dir(uid), 'log.jsonl'), JSON.stringify(env) + '\n'); }
        }
        ws.send(JSON.stringify({ type: 'ack', rid: m.rid }));
        for (const [s, sd] of u.sockets) if (s !== ws) for (const env of accepted) s.send(JSON.stringify({ type: 'live', env }));
        // the sender still needs the seq numbers to advance its cursor
        for (const env of accepted) ws.send(JSON.stringify({ type: 'live', env }));
        break;
      }
      case 'pull':
        ws.send(JSON.stringify({ type: 'envs', rid: m.rid, envs: u.log.filter((e) => (e.seq ?? 0) > Number(m.after ?? 0)) }));
        break;
      case 'account':
        if (!u.account) { u.account = { kdf: m.kdf, wrapped: m.wrapped }; }
        else u.account.wrapped = m.wrapped; // key rotation appends wrapped keys
        save(uid, u, 'account');
        break;
      case 'revoke': {
        const target = u.devices.get(String(m.device));
        if (target && target.id !== did) {
          target.revoked = true;
          save(uid, u, 'devices');
          for (const [s, sd] of u.sockets) if (sd === target.id) s.close(4001, 'device logged out');
          broadcastDevices(u);
        }
        break;
      }
    }
  });
  ws.on('close', () => { if (uid) { const u = user(uid); u.sockets.delete(ws); broadcastDevices(u); } });
});
console.log(`CENTRA relay on ws://localhost:${PORT} · data in ${DATA}${PERSIST ? '' : ' (memory only)'}`);
export { wss };
