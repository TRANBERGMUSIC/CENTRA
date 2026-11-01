/**
 * Browser persistence (web, Tauri WebViews on Mac and iPhone).
 *
 *  kv         one encrypted item per record, note text and outgoing envelope, keyed
 *             "<account:device>|<item>" (see EncryptedStore). Saves write only what changed.
 *  snapshots  the older format: one blob per account+device. Read once, then removed.
 */
import type { KvStore, Snapshot, Store } from './types.ts';

let opened: Promise<IDBDatabase> | null = null;
function database(name: string): Promise<IDBDatabase> {
  if (opened) return opened;
  opened = new Promise((res, rej) => {
    const r = indexedDB.open(name, 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots');
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => { db.close(); opened = null; };
      res(db);
    };
    r.onerror = () => { opened = null; rej(r.error); };
  });
  return opened;
}

const done = (tx: IDBTransaction) => new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });

export class IndexedDbStore implements Store, KvStore {
  constructor(private key: string, private dbName = 'centra') {}
  private db() { return database(this.dbName); }

  /* ---------------------------------------------------------- older one-blob format */
  async load(): Promise<Snapshot | null> {
    const db = await this.db();
    return new Promise((res, rej) => {
      const q = db.transaction('snapshots').objectStore('snapshots').get(this.key);
      q.onsuccess = () => res((q.result as Snapshot) ?? null);
      q.onerror = () => rej(q.error);
    });
  }
  async save(s: Snapshot): Promise<void> {
    const db = await this.db();
    const tx = db.transaction('snapshots', 'readwrite');
    tx.objectStore('snapshots').put(s, this.key);
    return done(tx);
  }
  async dropSnapshot(): Promise<void> {
    const db = await this.db();
    const tx = db.transaction('snapshots', 'readwrite');
    tx.objectStore('snapshots').delete(this.key);
    return done(tx);
  }

  /* ---------------------------------------------------------- item by item */
  async all(prefix: string): Promise<Map<string, Uint8Array>> {
    const db = await this.db();
    const base = this.key + '|';
    const range = IDBKeyRange.bound(base + prefix, base + prefix + '￿');
    return new Promise((res, rej) => {
      const store = db.transaction('kv').objectStore('kv');
      const keys = store.getAllKeys(range), vals = store.getAll(range);
      vals.onsuccess = () => {
        const out = new Map<string, Uint8Array>();
        (keys.result as string[]).forEach((k, i) => out.set(k.slice(base.length), new Uint8Array(vals.result[i] as ArrayBuffer)));
        res(out);
      };
      vals.onerror = () => rej(vals.error);
    });
  }
  async write(puts: Map<string, Uint8Array>, dels: string[]): Promise<void> {
    const db = await this.db();
    const tx = db.transaction('kv', 'readwrite');
    const s = tx.objectStore('kv');
    const base = this.key + '|';
    for (const k of dels) s.delete(base + k);
    for (const [k, v] of puts) s.put(v.buffer.byteLength === v.byteLength ? v.buffer : v.slice().buffer, base + k);
    return done(tx);
  }
}
