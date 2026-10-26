import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { ready, randomKey, KeyRing } from '@centra/crypto';
import { SyncEngine, WsRelay, MemoryStore } from '@centra/sync';

let wss: { close: () => void };
const PORT = 18000 + Math.floor(Math.random() * 1000);

beforeAll(async () => {
  await ready();
  process.env.PORT = String(PORT);
  process.env.PERSIST = '0';
  ({ wss } = await import('../server.ts'));
});
afterAll(() => wss.close());

async function dev(name: string, keys: KeyRing) {
  const relay = new WsRelay(`ws://localhost:${PORT}`, { user: 'willads', device: name, name, platform: 'test' }, WebSocket as any);
  await relay.ready();
  const e = new SyncEngine({ device: name, keys, store: new MemoryStore(), relay, flushMs: 0 });
  await e.start();
  return { e, relay };
}

describe('realtime over the relay', () => {
  it('a note created on the phone is on the computer within 2 s (p95 of 30)', async () => {
    const keys = new KeyRing('k1', randomKey());
    const phone = await dev('iphone', keys);
    const mac = await dev('macbook', keys);
    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      const got = new Promise<void>((res) => { const off = mac.e.on((ids, o) => { if (o === 'remote' && ids.has(id)) { off(); res(); } }); });
      const id = phone.e.create('note', { title: `Hurtignote ${i}` });
      await got;
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p50 = times[15], p95 = times[28];
    console.log(`latency p50 ${p50.toFixed(1)} ms · p95 ${p95.toFixed(1)} ms`);
    expect(p95).toBeLessThan(2000);
    phone.relay.close(); mac.relay.close();
  });

  it('a logged-out device is disconnected and cannot reconnect', async () => {
    const keys = new KeyRing('k1', randomKey());
    const mac = await dev('mac2', keys);
    const old = await dev('old-ipad', keys);
    const revoked = new Promise<void>((r) => (old.relay.onRevoked = r));
    mac.relay.revoke('old-ipad');
    await revoked;
    const again = new WsRelay(`ws://localhost:${PORT}`, { user: 'willads', device: 'old-ipad', name: 'x', platform: 'test' }, WebSocket as any);
    const r2 = new Promise<string>((r) => { again.onRevoked = () => r('revoked'); setTimeout(() => r('timeout'), 1500); });
    expect(await r2).toBe('revoked');
    mac.relay.close();
  });
});
