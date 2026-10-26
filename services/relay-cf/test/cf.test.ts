// Runs the protocol against a live Cloudflare relay (local `wrangler dev` or deployed):
//   CF_RELAY_URL=ws://127.0.0.1:8788 npx vitest run services/relay-cf
import { describe, it, expect, beforeAll } from 'vitest';
import WebSocket from 'ws';
import { ready } from '@centra/crypto';
import { SyncEngine, WsRelay, MemoryStore, createAccount, passwordSecrets, unlock, changePassword } from '@centra/sync';

const URL = process.env.CF_RELAY_URL;
const user = 'tranberg';
const PW = 'CentraTest-' + Math.random().toString(36).slice(2, 8);

describe.skipIf(!URL)('Cloudflare relay', () => {
  beforeAll(ready);
  const relay = (device: string) => new WsRelay(URL!, { user, device, name: device, platform: 'test' }, WebSocket as any);

  it('registers once, syncs live, enforces passwords and lock-out', async () => {
    const r0 = relay('setup');
    const pre = await r0.prelogin();
    let pw = PW;
    if (!pre.exists) {
      const a = createAccount(PW, 'interactive');
      await r0.register(a.account, a.auth, a.recoveryAuth);
    } else pw = process.env.CF_RELAY_PASSWORD ?? PW;
    r0.close();

    async function dev(name: string) {
      const r = relay(name);
      const p = await r.prelogin();
      const s = passwordSecrets(pw, p.kdf!);
      const { account } = await r.login(s.auth);
      const e = new SyncEngine({ device: name, keys: unlock(account, s.enc).keys, store: new MemoryStore(), relay: r, flushMs: 0 });
      await e.start();
      return { e, r, s, account, ak: unlock(account, s.enc).ak };
    }
    const phone = await dev('phone');
    const mac = await dev('mac');
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      let id = '';
      const got = new Promise<void>((res) => { const off = mac.e.on((ids, o) => { if (o === 'remote' && ids.has(id)) { off(); res(); } }); });
      id = phone.e.create('note', { title: 'cf ' + i });
      await got;
      times.push(performance.now() - t0);
    }
    console.log('cloudflare latency ms', times.map((t) => t.toFixed(0)).join(' '));
    expect(Math.max(...times)).toBeLessThan(2000);

    const bad = relay('x');
    const p = await bad.prelogin();
    await expect(bad.login(passwordSecrets('forkert', p.kdf!).auth)).rejects.toMatchObject({ code: 'auth' });
    bad.close();

    // Password change through the Durable Object, then back.
    const next = changePassword(mac.ak, pw + '-ny', 'interactive');
    const kicked = new Promise<number>((r) => (phone.r.onClosedByServer = r));
    await mac.r.changePassword(mac.s.auth, next);
    expect(await kicked).toBe(4002);
    mac.r.close();
  });
});
