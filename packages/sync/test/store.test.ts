/** The encrypted store on the device: item by item, only what changed, nothing readable on disk. */
import { describe, it, expect, beforeAll } from 'vitest';
import { ready, randomKey, KeyRing, utf8 } from '@centra/crypto';
import { SyncEngine, MemoryStore, MemoryKv, EncryptedStore, NullRelay, MemoryHub, MemoryRelay } from '../src/index.ts';

beforeAll(ready);
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

describe('encrypted store', () => {
  it('saves only what changed: typing in a note does not rewrite every mail', async () => {
    const key = randomKey(), keys = new KeyRing('k1', randomKey()), kv = new MemoryKv();
    const e = new SyncEngine({ device: 'mac', keys, store: new EncryptedStore(new MemoryStore(), key, kv), relay: new NullRelay(), flushMs: 1 });
    await e.start();
    for (let i = 0; i < 200; i++) e.create('mail', { subject: 'Mail ' + i, body: 'x'.repeat(5000) });
    const note = e.create('note', { title: 'Plan' });
    await e.persist();
    const before = new Map(kv.data);
    e.doc(note).getText('body').insert(0, 'Hej');
    await e.flush();
    await e.persist();
    const changed = [...kv.data].filter(([k, v]) => before.get(k) !== v).map(([k]) => k);
    // the note text, the meta record and the one outgoing envelope; never the mails
    expect(changed.length).toBeLessThanOrEqual(4);
    expect(changed.some((k) => k.startsWith('d'))).toBe(true);
    expect(changed.filter((k) => k.startsWith('e')).length).toBe(0);
  });

  it('opens again with the same data, and shows no ids, titles or text on disk', async () => {
    const key = randomKey(), keys = new KeyRing('k1', randomKey()), kv = new MemoryKv();
    const a = new SyncEngine({ device: 'mac', keys, store: new EncryptedStore(new MemoryStore(), key, kv), relay: new NullRelay(), flushMs: 1 });
    await a.start();
    const id = a.create('note', { title: 'Hemmelig plan' });
    a.doc(id).getText('body').insert(0, 'Jonas skylder 440');
    a.create('event', { title: 'Vagt', start: '2026-11-03T06:00' });
    a.remove('event', a.create('event', { title: 'Slettet' }));
    await a.flush(); await a.stop();
    const disk = [...kv.data].map(([k, v]) => k + utf8.decode(v)).join('');
    for (const plain of ['Hemmelig', 'Jonas', 'Vagt', id, 'note', 'event']) expect(disk).not.toContain(plain);

    const b = new SyncEngine({ device: 'mac', keys, store: new EncryptedStore(new MemoryStore(), key, kv), relay: new NullRelay(), flushMs: 1 });
    await b.start();
    expect(b.digest()).toBe(a.digest());
    expect(b.doc(id).getText('body').toString()).toBe('Jonas skylder 440');
    expect(b.pendingCount).toBe(a.pendingCount); // the outbox survives too, in order
  });

  it('refuses items that were swapped on disk', async () => {
    const key = randomKey(), keys = new KeyRing('k1', randomKey()), kv = new MemoryKv();
    const a = new SyncEngine({ device: 'mac', keys, store: new EncryptedStore(new MemoryStore(), key, kv), relay: new NullRelay(), flushMs: 1 });
    await a.start();
    a.create('note', { title: 'A' }); a.create('note', { title: 'B' });
    await a.stop();
    const [k1, k2] = [...kv.data.keys()].filter((k) => k.startsWith('e'));
    const v1 = kv.data.get(k1)!; kv.data.set(k1, kv.data.get(k2)!); kv.data.set(k2, v1);
    await expect(new EncryptedStore(new MemoryStore(), key, kv).load()).rejects.toThrow();
  });

  it('moves an older one-blob store over item by item, and removes the blob', async () => {
    const key = randomKey(), keys = new KeyRing('k1', randomKey());
    const old = new MemoryStore() as MemoryStore & { dropSnapshot?: () => Promise<void> };
    const a = new SyncEngine({ device: 'mac', keys, store: new EncryptedStore(old, key), relay: new NullRelay(), flushMs: 1 });
    await a.start();
    const id = a.create('note', { title: 'Fra før' });
    a.doc(id).getText('body').insert(0, 'gammel tekst');
    await a.flush(); await a.stop();
    expect(old.data).not.toBeNull();

    let dropped = false;
    old.dropSnapshot = async () => { dropped = true; old.data = null; };
    const kv = new MemoryKv();
    const b = new SyncEngine({ device: 'mac', keys, store: new EncryptedStore(old, key, kv), relay: new NullRelay(), flushMs: 1 });
    await b.start();
    await b.persist();
    expect(dropped).toBe(true);
    const c = new SyncEngine({ device: 'mac', keys, store: new EncryptedStore(old, key, kv), relay: new NullRelay(), flushMs: 1 });
    await c.start();
    expect(c.get(id)?.title).toBe('Fra før');
    expect(c.doc(id).getText('body').toString()).toBe('gammel tekst');
  });

  it('forgets sent envelopes on disk', async () => {
    const key = randomKey(), keys = new KeyRing('k1', randomKey()), kv = new MemoryKv();
    const hub = new MemoryHub(); const relay = new MemoryRelay(hub); relay.goOffline();
    const e = new SyncEngine({ device: 'mac', keys, store: new EncryptedStore(new MemoryStore(), key, kv), relay, flushMs: 1 });
    await e.start();
    e.create('note', { title: 'Offline' });
    await e.flush(); await e.persist();
    expect([...kv.data.keys()].filter((k) => k.startsWith('o')).length).toBe(1);
    relay.goOnline();
    await settle(100);
    await e.persist();
    expect([...kv.data.keys()].filter((k) => k.startsWith('o')).length).toBe(0);
  });

  it("keeps each type's list cached until that type changes", async () => {
    const e = new SyncEngine({ device: 'mac', keys: new KeyRing('k1', randomKey()), store: new MemoryStore(), relay: new NullRelay(), flushMs: 1 });
    await e.start();
    const a = e.create('note', { title: 'a' });
    const l1 = e.list('note');
    e.create('event', { title: 'x' });
    expect(e.list('note')).toEqual(l1);
    e.set('note', a, { title: 'b' });
    expect(e.list('note')[0].title).toBe('b');
    e.remove('note', a);
    expect(e.list('note')).toEqual([]);
    const l = e.list('event'); l.pop();
    expect(e.list('event').length).toBe(1); // callers can't change the cache
  });
});
