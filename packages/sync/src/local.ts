/**
 * Local-only mode (no server yet). The sync engine runs exactly as with a server, it just never
 * connects; switching sync on later only means giving it a real relay. Everything written while
 * local stays in the outbox and is sent the first time a relay is connected.
 */
import { sealJson, openJson, seal, open, utf8, subKey, blindName, type Bytes } from '@centra/crypto';
import type { EntityState, Envelope, KvStore, Relay, Snapshot, Store, StoreChanges, StoreMeta } from './types.ts';

export class NullRelay implements Relay {
  readonly connected = false;
  devices: { id: string; name: string; platform: string; lastSeen: number; online?: boolean; revoked?: boolean }[] = [];
  account = null;
  onDevices?: (d: NullRelay['devices']) => void;
  onAccount?: (a: unknown) => void;
  onClosedByServer?: (code: 4001 | 4002) => void;
  async push(_: Envelope[]): Promise<void> { throw new Error('offline'); }
  async pull(_: number): Promise<Envelope[]> { return []; }
  subscribe() { return () => {}; }
  onOpen() { return () => {}; }
  close() {}
}

/**
 * Encrypts what is stored on this device (IndexedDB), with a key derived from the account key, so
 * the data on disk is unreadable without the password.
 *
 * With a key/value store underneath (the apps), every record, note text and outgoing envelope is
 * its own encrypted item, and a save writes only what changed: typing in a note re-encrypts that
 * note, not every mail and photo. Item names are keyed hashes of the ids, so not even which ids
 * exist shows on disk; each item is bound to its name (AEAD associated data), so items can't be
 * swapped. Without one (tests) the whole snapshot is one encrypted blob, as before.
 */
export class EncryptedStore implements Store {
  needsFull = false;
  saveChanges?: (c: StoreChanges) => Promise<void>;
  private names: Bytes;
  /** Keeps the outbox in the order it was written. */
  private q = Date.now();

  constructor(private inner: Store, private key: Bytes, private kv?: KvStore) {
    this.names = subKey(key, 'store/names');
    if (kv) this.saveChanges = (c) => this.writeChanges(kv, c);
  }

  private sealItem(slot: string, v: unknown) { return seal(utf8.encode(JSON.stringify(v)), this.key, 'item:' + slot); }
  private openItem<T>(slot: string, b: Uint8Array): T { return JSON.parse(utf8.decode(open(b, this.key, 'item:' + slot))) as T; }
  private slot(kind: 'e' | 'd', id: string) { return kind + blindName(this.names, id); }

  async load(): Promise<Snapshot | null> {
    if (this.kv) {
      const items = await this.kv.all('');
      const meta = items.get('m');
      if (meta) {
        const m = this.openItem<StoreMeta>('m', meta);
        const snap: Snapshot = { entities: {}, docs: {}, outbox: [], cursor: m.cursor, seen: m.seen, clock: m.clock };
        const outbox: { q: number; e: Envelope }[] = [];
        for (const [k, v] of items) {
          if (k[0] === 'e') { const x = this.openItem<{ i: string; s: EntityState }>(k, v); snap.entities[x.i] = x.s; }
          else if (k[0] === 'd') { const x = this.openItem<{ i: string; p: string }>(k, v); snap.docs[x.i] = x.p; }
          else if (k[0] === 'o') outbox.push(this.openItem<{ q: number; e: Envelope }>(k, v));
        }
        outbox.sort((a, b) => a.q - b.q);
        snap.outbox = outbox.map((x) => x.e);
        this.q = Math.max(this.q, outbox.at(-1)?.q ?? 0);
        return snap;
      }
    }
    const legacy = await this.loadLegacy();
    // An older device kept everything in one blob: write it out item by item once.
    if (this.kv && legacy) this.needsFull = true;
    return legacy;
  }

  private async loadLegacy(): Promise<Snapshot | null> {
    const raw = (await this.inner.load()) as unknown as { v?: number; sealed?: string } | Snapshot | null;
    if (!raw) return null;
    if ((raw as any).v === 1 && (raw as any).sealed) return openJson<Snapshot>((raw as any).sealed, this.key, 'store:v1');
    return raw as Snapshot; // an older unencrypted snapshot: read once, written back encrypted
  }

  async save(s: Snapshot): Promise<void> {
    if (this.kv) {
      const c: StoreChanges = { entities: { ...s.entities }, docs: { ...s.docs }, outbox: {}, meta: { cursor: s.cursor, seen: s.seen, clock: s.clock } };
      s.outbox.forEach((e) => (c.outbox[e.id] = e));
      return this.writeChanges(this.kv, c);
    }
    await this.inner.save({ v: 1, sealed: sealJson(s, this.key, 'store:v1') } as unknown as Snapshot);
  }

  private async writeChanges(kv: KvStore, c: StoreChanges) {
    const puts = new Map<string, Uint8Array>(), dels: string[] = [];
    for (const [id, st] of Object.entries(c.entities)) { const k = this.slot('e', id); if (st) puts.set(k, this.sealItem(k, { i: id, s: st })); else dels.push(k); }
    for (const [id, p] of Object.entries(c.docs)) { const k = this.slot('d', id); if (p) puts.set(k, this.sealItem(k, { i: id, p })); else dels.push(k); }
    for (const [id, env] of Object.entries(c.outbox)) { const k = 'o' + id; if (env) puts.set(k, this.sealItem(k, { q: ++this.q, e: env })); else dels.push(k); }
    puts.set('m', this.sealItem('m', c.meta));
    await kv.write(puts, dels);
    if (this.needsFull) {
      this.needsFull = false;
      await (this.inner as { dropSnapshot?: () => Promise<void> }).dropSnapshot?.(); // the old blob, now written out item by item
    }
  }
}

/** A key/value store in memory, for tests. */
export class MemoryKv implements KvStore {
  data = new Map<string, Uint8Array>();
  writes = 0;
  async all(prefix: string) { return new Map([...this.data].filter(([k]) => k.startsWith(prefix))); }
  async write(puts: Map<string, Uint8Array>, dels: string[]) { this.writes++; for (const d of dels) this.data.delete(d); for (const [k, v] of puts) this.data.set(k, v); }
}
