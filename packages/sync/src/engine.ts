/**
 * The sync engine. Local-first: every write lands in local state and the outbox first;
 * the network is only ever asked to catch up.
 *
 *  - Records (events, goals, settings, note metadata…): last-writer-wins *per field*,
 *    ordered by hybrid logical clocks, so edits to different fields on two devices both survive.
 *  - Documents (note bodies): Yjs CRDT, so two devices typing in the same note merge character by character.
 *  - Everything that leaves the device is sealed with the account's content key.
 */
import * as Y from 'yjs';
import { b64, sealJson, openJson, randomId, type KeyRing } from '@centra/crypto';
import { Clock, type Hlc } from './hlc.ts';
import type { Change, Envelope, EntityState, Relay, Snapshot, Store } from './types.ts';

export type EngineOptions = {
  device: string;
  keys: KeyRing;
  store: Store;
  relay: Relay;
  now?: () => number;
  /** Batch window for outgoing changes. */
  flushMs?: number;
};

export type Record_ = { id: string; type: string } & Record<string, unknown>;
type Listener = (ids: Set<string>, origin: 'local' | 'remote') => void;

const REMOTE = Symbol('remote');
const DELETED = '_deleted';

export class SyncEngine {
  readonly device: string;
  private clock: Clock;
  private entities = new Map<string, EntityState>();
  private docs = new Map<string, Y.Doc>();
  private docTypes = new Map<string, string>();
  private outbox: Envelope[] = [];
  private pending: Change[] = [];
  private seen = new Set<string>();
  private cursor = 0;
  private listeners = new Set<Listener>();
  private unsub: Array<() => void> = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pushing = false;
  private started = false;
  /** Time each remote envelope was applied, keyed by envelope id (used by latency tests and the sync indicator). */
  readonly appliedAt = new Map<string, number>();
  lastSyncedAt: number | null = null;

  constructor(private o: EngineOptions) {
    this.device = o.device;
    this.clock = new Clock(o.device, o.now);
  }

  /* ------------------------------------------------------------------ lifecycle */

  async start(): Promise<void> {
    const snap = await this.o.store.load();
    if (snap) this.restore(snap);
    this.unsub.push(this.o.relay.subscribe((env) => this.receive([env])));
    this.unsub.push(this.o.relay.onOpen(() => void this.catchUp()));
    this.started = true;
    if (this.o.relay.connected) await this.catchUp();
  }

  async stop(): Promise<void> {
    this.unsub.forEach((u) => u());
    this.unsub = [];
    await this.flush();
    await this.persist();
    this.started = false;
  }

  /** Pull everything after our cursor, then push the outbox. */
  async catchUp(): Promise<void> {
    const envs = await this.o.relay.pull(this.cursor);
    this.receive(envs);
    await this.pushOutbox();
  }

  /* ------------------------------------------------------------------ records (LWW per field) */

  create(type: string, fields: Record<string, unknown>, id = randomId(12)): string {
    this.set(type, id, fields);
    return id;
  }

  set(type: string, id: string, fields: Record<string, unknown>): void {
    const changes: Change[] = Object.entries(fields).map(([f, v]) => ({ k: 'set', e: id, t: type, f, v, h: this.clock.tick() }));
    changes.forEach((c) => this.applyLocal(c));
    this.enqueue(changes, new Set([id]));
  }

  remove(type: string, id: string): void {
    this.set(type, id, { [DELETED]: true });
  }

  get(id: string): Record_ | null {
    const e = this.entities.get(id);
    if (!e || e.f[DELETED]?.v === true) return null;
    const out: Record_ = { id, type: e.t };
    for (const [k, fs] of Object.entries(e.f)) if (k !== DELETED) out[k] = fs.v;
    return out;
  }

  list(type: string): Record_[] {
    const out: Record_[] = [];
    for (const [id, e] of this.entities) if (e.t === type) {
      const r = this.get(id);
      if (r) out.push(r);
    }
    return out;
  }

  /** The HLC that last wrote a field; useful for "edited on iPhone 08.58". */
  fieldClock(id: string, field: string): Hlc | undefined {
    return this.entities.get(id)?.f[field]?.h;
  }

  /* ------------------------------------------------------------------ documents (Yjs) */

  doc(id: string, type = 'note'): Y.Doc {
    let d = this.docs.get(id);
    if (!d) {
      d = new Y.Doc();
      this.attachDoc(id, type, d);
    }
    return d;
  }

  private attachDoc(id: string, type: string, d: Y.Doc) {
    this.docs.set(id, d);
    this.docTypes.set(id, type);
    d.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;
      this.enqueue([{ k: 'doc', e: id, t: type, u: b64.encode(update) }], new Set([id]));
    });
  }

  /* ------------------------------------------------------------------ events */

  on(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(ids: Set<string>, origin: 'local' | 'remote') {
    if (ids.size) this.listeners.forEach((l) => l(ids, origin));
  }

  get pendingCount(): number {
    return this.outbox.length + (this.pending.length ? 1 : 0);
  }

  /* ------------------------------------------------------------------ apply */

  private applyLocal(c: Change) {
    if (c.k === 'set') this.applySet(c);
  }

  /** Returns true when the change altered state. */
  private applySet(c: Extract<Change, { k: 'set' }>): boolean {
    let e = this.entities.get(c.e);
    if (!e) {
      e = { t: c.t, f: {} };
      this.entities.set(c.e, e);
    }
    const cur = e.f[c.f];
    if (cur && cur.h >= c.h) return false;
    e.f[c.f] = { v: c.v, h: c.h };
    return true;
  }

  private applyRemote(c: Change): boolean {
    if (c.k === 'set') {
      this.clock.receive(c.h);
      return this.applySet(c);
    }
    const d = this.doc(c.e, c.t);
    Y.applyUpdate(d, b64.decode(c.u), REMOTE);
    return true;
  }

  private receive(envs: Envelope[]) {
    const touched = new Set<string>();
    const sorted = [...envs].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    for (const env of sorted) {
      if (env.seq && env.seq > this.cursor) this.cursor = env.seq;
      if (this.seen.has(env.id)) continue;
      this.seen.add(env.id);
      let changes: Change[];
      try {
        changes = openJson<Change[]>(env.body, this.o.keys.get(env.keyId), `env:${env.id}`);
      } catch {
        continue; // not ours to read (rotated away or tampered) — never crash the loop
      }
      for (const c of changes) if (this.applyRemote(c)) touched.add(c.e);
      this.appliedAt.set(env.id, performance.now());
    }
    if (envs.length) {
      this.lastSyncedAt = Date.now();
      this.scheduleSave();
    }
    this.emit(touched, 'remote');
  }

  /* ------------------------------------------------------------------ outbound */

  private enqueue(changes: Change[], ids: Set<string>) {
    this.pending.push(...changes);
    this.emit(ids, 'local');
    this.scheduleSave();
    if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush(), this.o.flushMs ?? 30);
  }

  /** Seal pending changes into one envelope and try to push. */
  async flush(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.pending.length) {
      const id = randomId(12);
      const keyId = this.o.keys.current;
      const env: Envelope = { id, device: this.device, keyId, body: sealJson(this.pending, this.o.keys.get(keyId), `env:${id}`) };
      this.pending = [];
      this.seen.add(id);
      this.outbox.push(env);
      this.scheduleSave();
    }
    await this.pushOutbox();
  }

  private async pushOutbox() {
    if (!this.started || this.pushing || !this.outbox.length || !this.o.relay.connected) return;
    this.pushing = true;
    try {
      const batch = [...this.outbox];
      await this.o.relay.push(batch);
      const sent = new Set(batch.map((e) => e.id));
      this.outbox = this.outbox.filter((e) => !sent.has(e.id));
      this.lastSyncedAt = Date.now();
      this.scheduleSave();
    } catch {
      // stays in the outbox; retried on the next flush or reconnect
    } finally {
      this.pushing = false;
    }
    if (this.outbox.length && this.o.relay.connected) setTimeout(() => void this.pushOutbox(), 500);
  }

  /* ------------------------------------------------------------------ persistence */

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => void this.persist(), 150);
  }

  async persist(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.o.store.save(this.snapshot());
  }

  snapshot(): Snapshot {
    const docs: Record<string, string> = {};
    for (const [id, d] of this.docs) docs[id] = this.docTypes.get(id) + '|' + b64.encode(Y.encodeStateAsUpdate(d));
    return {
      entities: Object.fromEntries(this.entities),
      docs,
      outbox: [...this.outbox],
      cursor: this.cursor,
      seen: [...this.seen].slice(-5000),
      clock: this.clock.tick(),
    };
  }

  private restore(s: Snapshot) {
    this.entities = new Map(Object.entries(s.entities));
    for (const [id, packed] of Object.entries(s.docs)) {
      const [type, state] = packed.split('|');
      const d = new Y.Doc();
      Y.applyUpdate(d, b64.decode(state), REMOTE);
      this.attachDoc(id, type, d);
    }
    this.outbox = s.outbox;
    this.cursor = s.cursor;
    this.seen = new Set(s.seen);
    if (s.clock) this.clock.receive(s.clock);
  }

  /** Stable digest of the visible state; equal on every converged replica. */
  digest(): string {
    const ents = [...this.entities.keys()].sort().map((id) => [id, this.get(id)]);
    const docs = [...this.docs.keys()].sort().map((id) => [id, this.docs.get(id)!.getText('body').toString()]);
    return JSON.stringify({ ents, docs });
  }
}
