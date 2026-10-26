import { describe, it, expect, beforeAll } from 'vitest';
import { ready, randomKey, KeyRing, randomId } from '@centra/crypto';
import { SyncEngine, MemoryHub, MemoryRelay, MemoryStore, Clock, createAccount, passwordSecrets, unlock, changePassword, recoverWithCode, rotateContentKey } from '../src/index.ts';

beforeAll(ready);
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

function account() { return new KeyRing('k1', randomKey()); }
async function device(hub: MemoryHub, keys: KeyRing, name: string, store = new MemoryStore()) {
  const relay = new MemoryRelay(hub);
  const e = new SyncEngine({ device: name, keys, store, relay, flushMs: 5 });
  await e.start();
  return { e, relay, store };
}

describe('hybrid logical clock', () => {
  it('is monotonic even when the wall clock stands still or goes back', () => {
    let t = 1000;
    const c = new Clock('a', () => t);
    const a = c.tick(); const b = c.tick(); t = 900; const d = c.tick();
    expect(a < b && b < d).toBe(true);
  });
  it('orders after a remote timestamp from a device with a fast clock', () => {
    const fast = new Clock('fast', () => 5000);
    const slow = new Clock('slow', () => 1000);
    const r = fast.tick();
    slow.receive(r);
    expect(slow.tick() > r).toBe(true);
  });
});

describe('sync engine', () => {
  it('delivers a record created on one device to another', async () => {
    const hub = new MemoryHub(); const keys = account();
    const phone = await device(hub, keys, 'iphone');
    const mac = await device(hub, keys, 'mac');
    const id = phone.e.create('note', { title: 'Hurtignote fra låseskærmen' });
    await settle();
    expect(mac.e.get(id)?.title).toBe('Hurtignote fra låseskærmen');
  });

  it('keeps edits to different fields made offline on two devices (LWW per field)', async () => {
    const hub = new MemoryHub(); const keys = account();
    const a = await device(hub, keys, 'a'); const b = await device(hub, keys, 'b');
    const id = a.e.create('event', { title: 'Frokost', start: '12.00' });
    await settle();
    a.relay.goOffline(); b.relay.goOffline();
    a.e.set('event', id, { title: 'Frokost med Sofie' });
    b.e.set('event', id, { start: '12.30' });
    await settle();
    a.relay.goOnline(); b.relay.goOnline();
    await settle(150);
    for (const d of [a, b]) expect(d.e.get(id)).toMatchObject({ title: 'Frokost med Sofie', start: '12.30' });
  });

  it('resolves concurrent edits of the same field identically everywhere', async () => {
    const hub = new MemoryHub(); const keys = account();
    const a = await device(hub, keys, 'a'); const b = await device(hub, keys, 'b');
    const id = a.e.create('goal', { title: 'Løb 500 km' });
    await settle();
    a.relay.goOffline(); b.relay.goOffline();
    a.e.set('goal', id, { title: 'Løb 500 km i 2026' });
    b.e.set('goal', id, { title: 'Løb 520 km' });
    a.relay.goOnline(); b.relay.goOnline();
    await settle(150);
    expect(a.e.get(id)?.title).toBe(b.e.get(id)?.title);
  });

  it('merges two devices typing in the same note without losing text (Yjs)', async () => {
    const hub = new MemoryHub(); const keys = account();
    const a = await device(hub, keys, 'a'); const b = await device(hub, keys, 'b');
    const id = a.e.create('note', { title: 'Lysplan' });
    a.e.doc(id).getText('body').insert(0, 'Rig: ');
    await settle();
    a.relay.goOffline(); b.relay.goOffline();
    a.e.doc(id).getText('body').insert(5, '6 movingheads. ');
    b.e.doc(id).getText('body').insert(5, 'laser fra sidst. ');
    a.relay.goOnline(); b.relay.goOnline();
    await settle(150);
    const ta = a.e.doc(id).getText('body').toString();
    expect(ta).toBe(b.e.doc(id).getText('body').toString());
    expect(ta).toContain('6 movingheads.');
    expect(ta).toContain('laser fra sidst.');
  });

  it('converges with 5 devices, random offline periods and shuffled delivery (fuzz, 20 rounds)', async () => {
    for (let round = 0; round < 20; round++) {
      const hub = new MemoryHub(); const keys = account();
      const ds = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((n) => device(hub, keys, n)));
      const ids = [ds[0].e.create('note', { title: 'x' }), ds[0].e.create('goal', { title: 'y', value: 0 })];
      await settle(30);
      for (let step = 0; step < 40; step++) {
        const d = ds[Math.floor(Math.random() * ds.length)];
        const r = Math.random();
        if (r < 0.1) d.relay.goOffline();
        else if (r < 0.2) d.relay.goOnline();
        else if (r < 0.3) d.relay.holdIncoming = true;
        else if (r < 0.55) d.e.set('goal', ids[1], { value: Math.floor(Math.random() * 500), title: randomId(2) });
        else if (r < 0.65) d.e.create('note', { title: randomId(2) });
        else {
          const t = d.e.doc(ids[0]).getText('body');
          t.insert(Math.floor(Math.random() * (t.length + 1)), randomId(1));
        }
      }
      for (const d of ds) { d.relay.goOnline(); d.relay.release('shuffle'); }
      await settle(120);
      for (const d of ds) await d.e.catchUp();
      await settle(120);
      const digests = new Set(ds.map((d) => d.e.digest()));
      expect(digests.size, `round ${round}`).toBe(1);
    }
  });

  it('survives a restart: outbox written offline is sent after relaunch', async () => {
    const hub = new MemoryHub(); const keys = account();
    const a = await device(hub, keys, 'a');
    const b = await device(hub, keys, 'b');
    a.relay.goOffline();
    const id = a.e.create('note', { title: 'Skrevet i flyet' });
    await a.e.stop();
    const a2 = await device(hub, keys, 'a', a.store);
    await settle(100);
    expect(a2.e.get(id)?.title).toBe('Skrevet i flyet');
    expect(b.e.get(id)?.title).toBe('Skrevet i flyet');
  });

  it('the server log holds ciphertext only', async () => {
    const hub = new MemoryHub(); const keys = account();
    const a = await device(hub, keys, 'a');
    const id = a.e.create('mail', { subject: 'Faktura 2026-118 fra Nordlyd ApS' });
    a.e.doc(id).getText('body').insert(0, 'Betalingsfrist 2. november');
    await settle();
    const raw = JSON.stringify(hub.log);
    for (const word of ['Faktura', 'Nordlyd', 'Betalingsfrist', 'subject', 'mail', id]) expect(raw).not.toContain(word);
  });

  it('a second device unlocks the account with the same password, and only with it', () => {
    const { account, keys } = createAccount('CentraTest-1710!', 'interactive');
    const { enc } = passwordSecrets('CentraTest-1710!', account.kdf);
    expect(unlock(account, enc).keys.get(keys.current)).toEqual(keys.get(keys.current));
    expect(() => unlock(account, passwordSecrets('forkert', account.kdf).enc)).toThrow('wrong-password');
  });

  it('changes the password without touching the data keys, and recovers with the recovery code', () => {
    const { account, keys, ak, recoveryCode } = createAccount('gammelt-password', 'interactive');
    const next = changePassword(ak, 'nyt-password-2026', 'interactive');
    const acc2 = { ...account, kdf: next.kdf, wrappedAK: next.wrappedAK };
    expect(() => unlock(acc2, passwordSecrets('gammelt-password', acc2.kdf).enc)).toThrow();
    expect(unlock(acc2, passwordSecrets('nyt-password-2026', acc2.kdf).enc).keys.get(keys.current)).toEqual(keys.get(keys.current));
    expect(() => recoverWithCode(acc2.recovery, 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE', 'x', 'interactive')).toThrow('wrong-recovery-code');
    const r = recoverWithCode(acc2.recovery, recoveryCode.toLowerCase(), 'tredje-password', 'interactive');
    const acc3 = { ...acc2, kdf: r.password.kdf, wrappedAK: r.password.wrappedAK };
    expect(unlock(acc3, passwordSecrets('tredje-password', acc3.kdf).enc).keys.get(keys.current)).toEqual(keys.get(keys.current));
  });

  it('rotating adds a key; old data stays readable', () => {
    const { account, keys, ak } = createAccount('pw-pw-pw-pw', 'interactive');
    const first = keys.current;
    const wrapped = rotateContentKey(account, ak, keys);
    expect(wrapped).toHaveLength(2);
    expect(keys.current).not.toBe(first);
    expect(() => keys.get(first)).not.toThrow();
  });
});
