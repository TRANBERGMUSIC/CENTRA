/**
 * The first upload when sync is switched on, and big data (photos): the outbox is compacted to the
 * current state, envelopes and pushes stay inside the relay's size limits, and catch-up reads the
 * relay page by page.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ready, randomKey, KeyRing } from '@centra/crypto';
import { SyncEngine, MemoryHub, MemoryRelay, MemoryStore, NullRelay, chunkChanges, ENVELOPE_JSON_MAX, type Envelope } from '../src/index.ts';

beforeAll(ready);
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const photo = (kb: number) => 'data:image/jpeg;base64,' + 'A'.repeat(kb * 1000);

/** A relay that remembers every push and pages its answers like the real one (3 MB). */
class PagedRelay extends MemoryRelay {
  pushes: Envelope[][] = [];
  pulls = 0;
  constructor(private h: MemoryHub) { super(h); }
  override async push(envs: Envelope[]) { this.pushes.push(envs); return super.push(envs); }
  override async pull(after: number) {
    this.pulls++;
    const out: Envelope[] = []; let bytes = 0;
    for (const e of this.h.log.filter((x) => (x.seq ?? 0) > after)) {
      if (out.length && bytes + e.body.length > 3_000_000) break;
      out.push(e); bytes += e.body.length;
    }
    return out;
  }
}

describe('first upload', () => {
  it('sends the current state, not every change ever made, and another device gets all of it', async () => {
    const keys = new KeyRing('k1', randomKey());
    const store = new MemoryStore();
    // Months of local-only use: many edits of the same records, a note typed letter by letter, a deletion.
    const local = new SyncEngine({ device: 'mac', keys, store, relay: new NullRelay(), flushMs: 1 });
    await local.start();
    const ids: string[] = [];
    for (let i = 0; i < 40; i++) ids.push(local.create('event', { title: `Vagt ${i}`, start: `2026-10-${(i % 28) + 1}` }));
    for (let r = 0; r < 20; r++) for (const id of ids.slice(0, 10)) local.set('event', id, { title: `Vagt ændret ${r}` });
    const note = local.create('note', { title: 'Plan' });
    const text = local.doc(note).getText('body');
    for (const ch of 'Husk at ringe til Jonas om pant') { text.insert(text.length, ch); await local.flush(); }
    local.remove('event', ids[39]);
    await local.flush();
    await local.stop();
    const before = (await store.load())!.outbox.length;
    expect(before).toBeGreaterThan(30);

    // Sync switched on: the same store opens against a server.
    const hub = new MemoryHub();
    const relay = new PagedRelay(hub);
    const mac = new SyncEngine({ device: 'mac', keys, store, relay, flushMs: 1 });
    await mac.start({ compact: true });
    await settle();
    expect(mac.pendingCount).toBe(0);
    expect(hub.log.length).toBeLessThan(5);

    const phone = new SyncEngine({ device: 'iphone', keys, store: new MemoryStore(), relay: new MemoryRelay(hub), flushMs: 1 });
    await phone.start();
    // Same visible state (the deleted record isn't sent at all, so the phone has no tombstone for it).
    const visible = (d: string) => JSON.stringify({ ...JSON.parse(d), ents: JSON.parse(d).ents.filter((x: [string, unknown]) => x[1] !== null) });
    expect(visible(phone.digest())).toBe(visible(mac.digest()));
    expect(phone.get(ids[0])?.title).toBe('Vagt ændret 19');
    expect(phone.get(ids[39])).toBeNull();
    expect(phone.doc(note).getText('body').toString()).toBe('Husk at ringe til Jonas om pant');
  });

  it('keeps every envelope and every push inside the relay limits, also with many photos', async () => {
    const keys = new KeyRing('k1', randomKey());
    const store = new MemoryStore();
    const local = new SyncEngine({ device: 'mac', keys, store, relay: new NullRelay(), flushMs: 1 });
    await local.start();
    for (let i = 0; i < 24; i++) local.create('photo', { title: `Billede ${i}`, image: photo(450), thumb: photo(20) });
    await local.flush();
    await local.stop();

    const hub = new MemoryHub();
    const relay = new PagedRelay(hub);
    const mac = new SyncEngine({ device: 'mac', keys, store, relay, flushMs: 1 });
    await mac.start({ compact: true });
    await settle();
    expect(mac.pendingCount).toBe(0);
    expect(hub.log.every((e) => e.body.length <= 1_500_000)).toBe(true);
    expect(relay.pushes.length).toBeGreaterThan(1);
    expect(relay.pushes.every((b) => b.reduce((s, e) => s + e.body.length, 0) <= 2_000_000 || b.length === 1)).toBe(true);

    // A new phone reads it in pages of ~3 MB and ends up with everything.
    const phoneRelay = new PagedRelay(hub);
    const phone = new SyncEngine({ device: 'iphone', keys, store: new MemoryStore(), relay: phoneRelay, flushMs: 1 });
    await phone.start();
    expect(phoneRelay.pulls).toBeGreaterThan(2);
    expect(phone.list('photo').length).toBe(24);
    expect(phone.digest()).toBe(mac.digest());
  });

  it('splits a big local write (a photo plus more) into envelopes the relay accepts', async () => {
    const hub = new MemoryHub();
    const keys = new KeyRing('k1', randomKey());
    const relay = new PagedRelay(hub);
    const e = new SyncEngine({ device: 'iphone', keys, store: new MemoryStore(), relay, flushMs: 1 });
    await e.start();
    e.create('photo', { image: photo(600), thumb: photo(30) });
    e.create('photo', { image: photo(600), thumb: photo(30) });
    await settle();
    expect(hub.log.length).toBeGreaterThanOrEqual(2);
    expect(hub.log.every((x) => x.body.length <= 1_500_000)).toBe(true);
  });

  it('does not let one refused envelope hold back the rest', async () => {
    const hub = new MemoryHub();
    const keys = new KeyRing('k1', randomKey());
    const relay = new MemoryRelay(hub);
    const real = relay.push.bind(relay);
    relay.push = async (envs: Envelope[]) => {
      if (envs.some((x) => x.body.length > 400_000)) throw Object.assign(new Error('bad-envelopes'), { code: 'bad-envelopes' });
      return real(envs);
    };
    const e = new SyncEngine({ device: 'mac', keys, store: new MemoryStore(), relay, flushMs: 1 });
    await e.start();
    e.create('photo', { image: photo(500) });
    await e.flush();
    e.create('note', { title: 'Efter billedet' });
    await settle();
    expect(e.pendingCount).toBe(0);
    expect(e.refused.length).toBe(1);
    const other = new SyncEngine({ device: 'x', keys, store: new MemoryStore(), relay: new MemoryRelay(hub), flushMs: 1 });
    await other.start();
    expect(other.list('note').map((n) => n.title)).toEqual(['Efter billedet']);
  });

  it('chunks by size and never splits a single change', () => {
    const big = { k: 'set' as const, e: 'a', t: 'photo', f: 'image', v: 'x'.repeat(ENVELOPE_JSON_MAX + 10), h: '1' as any };
    const small = { k: 'set' as const, e: 'b', t: 'note', f: 'title', v: 'hej', h: '2' as any };
    const groups = chunkChanges([small, big, small]);
    expect(groups.length).toBe(3);
    expect(groups[1]).toEqual([big]);
    expect(chunkChanges([small, small]).length).toBe(1);
  });
});
