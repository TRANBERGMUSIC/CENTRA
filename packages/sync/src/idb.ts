/** Browser persistence (web, Tauri and Capacitor WebViews). One snapshot record per account+device. */
import type { Snapshot, Store } from './types.ts';

export class IndexedDbStore implements Store {
  constructor(private key: string, private dbName = 'centra') {}
  private db(): Promise<IDBDatabase> {
    return new Promise((res, rej) => {
      const r = indexedDB.open(this.dbName, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('snapshots');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
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
    return new Promise((res, rej) => {
      const tx = db.transaction('snapshots', 'readwrite');
      tx.objectStore('snapshots').put(s, this.key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
}
