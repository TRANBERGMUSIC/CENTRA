import type { Hlc } from './hlc.ts';

/**
 * What the server stores and relays. Everything about the content (entity id, type,
 * field names, values) lives inside `body`, which is ciphertext.
 */
export type Envelope = {
  /** Random id of this batch; lets every device ignore its own echo and duplicates. */
  id: string;
  /** Server-assigned, strictly increasing per account. Absent until the server accepts it. */
  seq?: number;
  device: string;
  keyId: string;
  /** sealJson(Change[]) */
  body: string;
};

/** Plaintext change, only ever seen on devices. */
export type Change =
  | { k: 'set'; e: string; t: string; f: string; v: unknown; h: Hlc }
  | { k: 'doc'; e: string; t: string; u: string /* base64 Yjs update */ };

export type FieldState = { v: unknown; h: Hlc };
export type EntityState = { t: string; f: Record<string, FieldState> };

export type Snapshot = {
  entities: Record<string, EntityState>;
  docs: Record<string, string>; // base64 Yjs state per document entity
  outbox: Envelope[];
  cursor: number;
  seen: string[];
  clock?: Hlc;
};

export interface Store {
  load(): Promise<Snapshot | null>;
  save(s: Snapshot): Promise<void>;
}

export interface Relay {
  push(envs: Envelope[]): Promise<void>;
  pull(after: number): Promise<Envelope[]>;
  subscribe(cb: (env: Envelope) => void): () => void;
  /** Called whenever the connection (re)opens, so the engine can flush and catch up. */
  onOpen(cb: () => void): () => void;
  readonly connected: boolean;
}
