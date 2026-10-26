/**
 * Local-only mode (no server yet). The sync engine runs exactly as with a server, it just never
 * connects; switching sync on later only means giving it a real relay. Everything written while
 * local stays in the outbox and is sent the first time a relay is connected.
 */
import { sealJson, openJson, type Bytes } from '@centra/crypto';
import type { Envelope, Relay, Snapshot, Store } from './types.ts';

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
 * Encrypts the whole local snapshot at rest (IndexedDB) with a key derived from the account key,
 * so the data on disk is unreadable without the password.
 */
export class EncryptedStore implements Store {
  constructor(private inner: Store, private key: Bytes) {}
  async load(): Promise<Snapshot | null> {
    const raw = (await this.inner.load()) as unknown as { v?: number; sealed?: string } | Snapshot | null;
    if (!raw) return null;
    if ((raw as any).v === 1 && (raw as any).sealed) return openJson<Snapshot>((raw as any).sealed, this.key, 'store:v1');
    return raw as Snapshot; // an older unencrypted snapshot: read once, written back encrypted
  }
  async save(s: Snapshot): Promise<void> {
    await this.inner.save({ v: 1, sealed: sealJson(s, this.key, 'store:v1') } as unknown as Snapshot);
  }
}
