import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { ready } from '@centra/crypto';
import { SyncEngine, WsRelay, MemoryStore, createAccount, passwordSecrets, unlock, RelayError } from '@centra/sync';

let wss: { close: () => void };
const PORT = 18000 + Math.floor(Math.random() * 1000);
const URL = `ws://localhost:${PORT}`;
let account: ReturnType<typeof createAccount>;

beforeAll(async () => {
  await ready();
  process.env.PORT = String(PORT);
  process.env.PERSIST = '0';
  ({ wss } = await import('../server.ts'));
  account = createAccount('CentraTest-1710!', 'interactive');
  const r = new WsRelay(URL, { user: 'Tranberg', device: 'setup', name: 'setup', platform: 'test' }, WebSocket as any);
  await r.register(account.account, account.auth, account.recoveryAuth);
  r.close();
});
afterAll(() => wss.close());

async function dev(name: string) {
  const relay = new WsRelay(URL, { user: 'Tranberg', device: name, name, platform: 'test' }, WebSocket as any);
  const pre = await relay.prelogin();
  const { enc, auth } = passwordSecrets('CentraTest-1710!', pre.kdf!);
  const { account: acc } = await relay.login(auth);
  const { keys } = unlock(acc, enc);
  const e = new SyncEngine({ device: name, keys, store: new MemoryStore(), relay, flushMs: 0 });
  await e.start();
  return { e, relay };
}

describe('realtime over the relay', () => {
  it('a note created on the phone is on the computer within 2 s (p95 of 30)', async () => {
    const phone = await dev('iphone');
    const mac = await dev('macbook');
    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      let id = '';
      const got = new Promise<void>((res) => { const off = mac.e.on((ids, o) => { if (o === 'remote' && ids.has(id)) { off(); res(); } }); });
      id = phone.e.create('note', { title: `Hurtignote ${i}` });
      await got;
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    console.log(`latency p50 ${times[15].toFixed(1)} ms · p95 ${times[28].toFixed(1)} ms`);
    expect(times[28]).toBeLessThan(2000);
    phone.relay.close(); mac.relay.close();
  });

  it('refuses a wrong password over the wire', async () => {
    const r = new WsRelay(URL, { user: 'Tranberg', device: 'x', name: 'x', platform: 'test' }, WebSocket as any);
    const pre = await r.prelogin();
    await expect(r.login(passwordSecrets('forkert', pre.kdf!).auth)).rejects.toMatchObject({ code: 'auth' });
    r.close();
  });

  it('a logged-out device is disconnected', async () => {
    const mac = await dev('mac2');
    const old = await dev('old-ipad');
    const closed = new Promise<number>((r) => (old.relay.onClosedByServer = r));
    await mac.relay.revoke('old-ipad');
    expect(await closed).toBe(4001);
    mac.relay.close();
  });
});
