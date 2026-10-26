import { describe, it, expect, beforeAll } from 'vitest';
import { ready, randomId } from '@centra/crypto';
import { createAccount, passwordSecrets, changePassword, recoverWithCode, newRecovery, type AccountPublic } from '@centra/sync';
import { RelayCore, MemoryUserStore, type Conn } from '../src/index.ts';

beforeAll(ready);

function setup() {
  let t = 1_000_000;
  const stores = new Map<string, MemoryUserStore>();
  const core = new RelayCore({ store: (u) => { let s = stores.get(u); if (!s) stores.set(u, (s = new MemoryUserStore())); return s; }, now: () => t, sleep: async () => {} });
  const conn = () => {
    const c: Conn & { inbox: any[]; closed?: number } = { inbox: [], send: (m) => c.inbox.push(m), close: (code) => { c.closed = code; } };
    return c;
  };
  const ask = async (c: ReturnType<typeof conn>, frame: Record<string, unknown>) => {
    const rid = randomId(4);
    await core.handle(c, JSON.stringify({ ...frame, rid }));
    return c.inbox.find((m) => m.rid === rid) ?? c.inbox.at(-1);
  };
  return { core, stores, conn, ask, advance: (ms: number) => (t += ms) };
}
const id = (device = 'd' + randomId(4)) => ({ user: 'Tranberg', device, name: 'Test', platform: 'test' });
const env = () => ({ id: randomId(12), keyId: 'kabcd', body: 'Y2lwaGVydGV4dA==' });

describe('relay security', () => {
  it('serves nothing before login', async () => {
    const { conn, ask } = setup();
    const c = conn();
    expect((await ask(c, { type: 'pull', after: 0 })).code).toBe('unauthenticated');
    expect((await ask(c, { type: 'push', envs: [env()] })).code).toBe('unauthenticated');
  });

  it('registers only the allowed username, and only once', async () => {
    const { conn, ask } = setup();
    const a = createAccount('CentraTest-1710!', 'interactive');
    expect((await ask(conn(), { type: 'register', ...id(), user: 'mallory', account: a.account, auth: a.auth, recoveryAuth: a.recoveryAuth })).code).toBe('not-allowed');
    expect((await ask(conn(), { type: 'register', ...id(), account: a.account, auth: a.auth, recoveryAuth: a.recoveryAuth })).type).toBe('welcome');
    expect((await ask(conn(), { type: 'register', ...id(), account: a.account, auth: a.auth, recoveryAuth: a.recoveryAuth })).code).toBe('exists');
  });

  it('stores only a hash of the auth value, never the password or a key', async () => {
    const { conn, ask, stores } = setup();
    const a = createAccount('CentraTest-1710!', 'interactive');
    await ask(conn(), { type: 'register', ...id(), account: a.account, auth: a.auth, recoveryAuth: a.recoveryAuth });
    const raw = JSON.stringify(stores.get('tranberg')!.account);
    expect(raw).not.toContain('CentraTest');
    expect(raw).not.toContain(a.auth);
    expect(raw).not.toContain(a.recoveryCode.replace(/-/g, ''));
  });

  it('locks the account after 5 wrong passwords, with growing waits', async () => {
    const { conn, ask, advance } = setup();
    const a = createAccount('CentraTest-1710!', 'interactive');
    await ask(conn(), { type: 'register', ...id(), account: a.account, auth: a.auth, recoveryAuth: a.recoveryAuth });
    const wrong = passwordSecrets('gæt', a.account.kdf).auth;
    for (let i = 0; i < 4; i++) expect((await ask(conn(), { type: 'login', ...id(), auth: wrong })).code).toBe('auth');
    const fifth = await ask(conn(), { type: 'login', ...id(), auth: wrong });
    expect(fifth.retryAfter).toBe(30);
    expect((await ask(conn(), { type: 'login', ...id(), auth: a.auth })).code).toBe('locked'); // even the right password waits
    advance(31_000);
    expect((await ask(conn(), { type: 'login', ...id(), auth: wrong })).retryAfter).toBe(60);
    advance(61_000);
    expect((await ask(conn(), { type: 'login', ...id(), auth: a.auth })).type).toBe('welcome');
  });

  it('a password change logs other sessions out and only the new password works', async () => {
    const { conn, ask } = setup();
    const a = createAccount('gammelt-pw-1', 'interactive');
    const mac = conn(); const phone = conn();
    await ask(mac, { type: 'register', ...id('mac'), account: a.account, auth: a.auth, recoveryAuth: a.recoveryAuth });
    await ask(phone, { type: 'login', ...id('phone'), auth: a.auth });
    const next = changePassword(a.ak, 'nyt-pw-2', 'interactive');
    expect((await ask(mac, { type: 'password', oldAuth: passwordSecrets('forkert', a.account.kdf).auth, ...next })).code).toBe('auth');
    expect((await ask(mac, { type: 'password', oldAuth: a.auth, ...next })).type).toBe('ack');
    expect(phone.closed).toBe(4002);
    expect((await ask(conn(), { type: 'login', ...id('phone'), auth: a.auth })).code).toBe('auth');
    expect((await ask(conn(), { type: 'login', ...id('phone'), auth: next.auth })).type).toBe('welcome');
  });

  it('a forgotten password is reset with the recovery code, not without it', async () => {
    const { conn, ask, stores } = setup();
    const a = createAccount('glemt-pw-123', 'interactive');
    await ask(conn(), { type: 'register', ...id('mac'), account: a.account, auth: a.auth, recoveryAuth: a.recoveryAuth });
    const pub = stores.get('tranberg')!.account!.pub as AccountPublic;
    const fake = newRecovery(a.ak, 'interactive'); // a different, valid-looking recovery value
    const r = recoverWithCode(pub.recovery, a.recoveryCode, 'helt-nyt-pw', 'interactive');
    expect((await ask(conn(), { type: 'recover', ...id(), recoveryAuth: fake.recoveryAuth, ...r.password })).code).toBe('auth');
    expect((await ask(conn(), { type: 'recover', ...id(), recoveryAuth: r.recoveryAuth, ...r.password })).type).toBe('welcome');
    expect((await ask(conn(), { type: 'login', ...id(), auth: r.password.auth })).type).toBe('welcome');
  });

  it('a logged-out device cannot log in again', async () => {
    const { conn, ask } = setup();
    const a = createAccount('pw-pw-pw-pw', 'interactive');
    const mac = conn(); const old = conn();
    await ask(mac, { type: 'register', ...id('mac'), account: a.account, auth: a.auth, recoveryAuth: a.recoveryAuth });
    await ask(old, { type: 'login', ...id('old-ipad'), auth: a.auth });
    await ask(mac, { type: 'revoke', device: 'old-ipad' });
    expect(old.closed).toBe(4001);
    const again = conn();
    await ask(again, { type: 'login', ...id('old-ipad'), auth: a.auth });
    expect(again.closed).toBe(4001);
  });

  it('keys can be added but never replaced', async () => {
    const { conn, ask } = setup();
    const a = createAccount('pw-pw-pw-pw', 'interactive');
    const c = conn();
    await ask(c, { type: 'register', ...id(), account: a.account, auth: a.auth, recoveryAuth: a.recoveryAuth });
    const k0 = a.account.keys[0];
    expect((await ask(c, { type: 'keys', keys: [{ keyId: k0.keyId, sealed: 'AAAA' + k0.sealed.slice(4) }] })).code).toBe('bad-request');
    expect((await ask(c, { type: 'keys', keys: [k0, { keyId: 'k1234', sealed: k0.sealed }] })).type).toBe('ack');
  });

  it('rejects malformed and oversized input, and floods', async () => {
    const { conn, ask, core } = setup();
    const a = createAccount('pw-pw-pw-pw', 'interactive');
    const c = conn();
    await ask(c, { type: 'register', ...id(), account: a.account, auth: a.auth, recoveryAuth: a.recoveryAuth });
    expect((await ask(c, { type: 'push', envs: [{ ...env(), id: '../../etc' }] })).code).toBe('bad-envelopes');
    expect((await ask(c, { type: 'push', envs: [{ ...env(), body: '<script>' }] })).code).toBe('bad-envelopes');
    const big = conn();
    await core.handle(big, 'x'.repeat(4_000_001));
    expect(big.closed).toBe(1009);
    const flood = conn();
    for (let i = 0; i < 200; i++) await core.handle(flood, '{"type":"prelogin","user":"tranberg"}');
    expect(flood.closed).toBe(1008);
  });
});
