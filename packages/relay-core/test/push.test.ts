import { describe, it, expect, beforeAll } from 'vitest';
import { ready, randomId } from '@centra/crypto';
import { createAccount } from '@centra/sync';
import { RelayCore, MemoryUserStore, type Conn, type PushItem, type PushTarget } from '../src/index.ts';

beforeAll(ready);

function setup(withPush = true) {
  let t = 1_000_000;
  const store = new MemoryUserStore();
  const sent: { to: string[]; item: PushItem }[] = [];
  const wakes: (number | null)[] = [];
  let bad: string[] = [];
  const core = new RelayCore({ store: () => store, now: () => t, sleep: async () => {},
    push: withPush ? { send: async (targets: PushTarget[], item: PushItem) => { sent.push({ to: targets.map((x) => x.token), item }); return { bad }; }, wake: (_u, at) => wakes.push(at) } : undefined });
  const conn = () => { const c: Conn & { inbox: any[] } = { inbox: [], send: (m) => c.inbox.push(m), close: () => {} }; return c; };
  const ask = async (c: ReturnType<typeof conn>, frame: Record<string, unknown>) => { const rid = randomId(4); await core.handle(c, JSON.stringify({ ...frame, rid })); return c.inbox.find((m) => m.rid === rid); };
  return { core, store, sent, wakes, conn, ask, at: () => t, advance: (ms: number) => (t += ms), setBad: (b: string[]) => (bad = b) };
}
const tok = (n: string) => n.repeat(64).slice(0, 64);

describe('push', () => {
  it('sends the plan at its time to every phone, also with all apps closed', async () => {
    const { core, sent, wakes, conn, ask, at, advance } = setup();
    const a = createAccount('CentraTest-1710!', 'interactive');
    const mac = conn(), phone = conn();
    const w = await ask(mac, { type: 'register', user: 'tranberg', device: 'dmac0000000000001', name: 'Mac', platform: 'macos', account: a.account, auth: a.auth, recoveryAuth: a.recoveryAuth });
    expect(w.pushReady).toBe(true);
    await ask(phone, { type: 'login', user: 'tranberg', device: 'dphone00000000001', name: 'iPhone', platform: 'ios', auth: a.auth });
    expect((await ask(phone, { type: 'push-register', token: tok('a'), env: 'production' })).type).toBe('ack');
    // the Mac makes the plan (it has the same data); the phone gets it
    const r = await ask(mac, { type: 'push-schedule', items: [
      { id: 'rem:1', at: at() + 60_000, title: 'Husk', body: 'Levere udstyr tilbage til Sigge' },
      { id: 'ev:2', at: at() + 600_000, title: 'Om 15 min', body: 'Tandlæge' },
      { id: 'old', at: at() - 3_600_000, title: 'Husk', body: 'for længe siden' },
    ] });
    expect(r.count).toBe(2);
    expect(wakes.at(-1)).toBe(at() + 60_000);
    advance(60_000);
    expect(await core.fireDue('tranberg')).toBe(1);
    expect(sent).toEqual([{ to: [tok('a')], item: { id: 'rem:1', at: at(), title: 'Husk', body: 'Levere udstyr tilbage til Sigge' } }]);
    expect(wakes.at(-1)).toBe(at() + 540_000);
    // a new plan replaces the old one (the event was deleted)
    await ask(mac, { type: 'push-schedule', items: [] });
    expect(wakes.at(-1)).toBe(null);
    advance(600_000);
    expect(await core.fireDue('tranberg')).toBe(0);
    expect(sent).toHaveLength(1);
    // the token never goes out to other devices
    const devs = (await ask(mac, { type: 'push-now', title: 'Mail fra Sofie', body: 'Weekend i Aarhus?' }));
    expect(devs.sent).toBe(1);
    expect(JSON.stringify(mac.inbox)).not.toContain(tok('a'));
  });

  it('push-now goes to the other phones, not back to the sender; bad tokens are dropped', async () => {
    const { sent, conn, ask, store, setBad } = setup();
    const a = createAccount('CentraTest-1710!', 'interactive');
    const phone = conn();
    await ask(phone, { type: 'register', user: 'tranberg', device: 'dphone00000000001', name: 'iPhone', platform: 'ios', account: a.account, auth: a.auth, recoveryAuth: a.recoveryAuth });
    await ask(phone, { type: 'push-register', token: tok('b'), env: 'production' });
    expect((await ask(phone, { type: 'push-now', title: 'x', body: 'y' })).sent).toBe(0);
    const mac = conn();
    await ask(mac, { type: 'login', user: 'tranberg', device: 'dmac0000000000001', name: 'Mac', platform: 'macos', auth: a.auth });
    setBad([tok('b')]);
    await ask(mac, { type: 'push-now', title: 'x', body: 'y' });
    expect(sent).toHaveLength(1);
    expect((await store.getDevices()).find((d) => d.id === 'dphone00000000001')?.push).toBeUndefined();
  });

  it('rejects junk and needs a login; a relay without push says so', async () => {
    const { conn, ask } = setup();
    expect((await ask(conn(), { type: 'push-schedule', items: [] })).code).toBe('unauthenticated');
    const p = setup(false);
    const a = createAccount('CentraTest-1710!', 'interactive');
    const c = p.conn();
    const w = await p.ask(c, { type: 'register', user: 'tranberg', device: 'dmac0000000000001', name: 'Mac', platform: 'macos', account: a.account, auth: a.auth, recoveryAuth: a.recoveryAuth });
    expect(w.pushReady).toBe(false);
    expect((await p.ask(c, { type: 'push-register', token: 'not-hex', env: 'production' })).code).toBe('bad-request');
    expect((await p.ask(c, { type: 'push-schedule', items: [{ id: 'x', at: 1, title: 'a'.repeat(500), body: '' }] })).code).toBe('bad-request');
    expect((await p.ask(c, { type: 'push-schedule', items: [] })).pushReady).toBe(false);
  });
});
