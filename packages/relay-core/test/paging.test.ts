import { describe, it, expect, beforeAll } from 'vitest';
import { ready, randomId } from '@centra/crypto';
import { createAccount } from '@centra/sync';
import { RelayCore, MemoryUserStore, type Conn } from '../src/index.ts';

beforeAll(ready);

describe('relay pull', () => {
  it('answers a few MB at a time, so a phone can read a big account page by page', async () => {
    const stores = new Map<string, MemoryUserStore>();
    const core = new RelayCore({ store: (u) => { let s = stores.get(u); if (!s) stores.set(u, (s = new MemoryUserStore())); return s; }, sleep: async () => {} });
    const c: Conn & { inbox: any[] } = { inbox: [], send: (m) => c.inbox.push(m), close: () => {} };
    const ask = async (frame: Record<string, unknown>) => { const rid = randomId(4); await core.handle(c, JSON.stringify({ ...frame, rid })); return c.inbox.find((m) => m.rid === rid); };
    const a = createAccount('CentraTest-1710!', 'interactive');
    expect((await ask({ type: 'register', user: 'Tranberg', device: 'dmac', name: 'Mac', platform: 'test', account: a.account, auth: a.auth, recoveryAuth: a.recoveryAuth })).type).toBe('welcome');
    const body = 'A'.repeat(900_000);
    for (let i = 0; i < 4; i++) expect((await ask({ type: 'push', envs: [{ id: randomId(12), keyId: 'kabcd', body }, { id: randomId(12), keyId: 'kabcd', body }] })).type).toBe('ack');
    const got: any[] = [];
    let after = 0, pages = 0, more = true;
    while (more) {
      const r = await ask({ type: 'pull', after });
      pages++;
      expect(r.envs.reduce((s: number, e: any) => s + e.body.length, 0)).toBeLessThanOrEqual(3_000_000);
      got.push(...r.envs);
      more = r.more; after = r.envs.at(-1)?.seq ?? after;
    }
    expect(got.length).toBe(8);
    expect(pages).toBe(3);
    expect(got.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
