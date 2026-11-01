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
import type { Change, Envelope, EntityState, Relay, Snapshot, Store, StoreChanges } from './types.ts';

export type EngineOptions = {
  device: string;
  keys: KeyRing;
  store: Store;
  relay: Relay;
  now?: () => number;
  /** Batch window for outgoing changes. */
  flushMs?: number;
};

/**
 * Size limits that keep every frame well inside what the relay accepts (an envelope body may be
 * 1.5 MB of base64, a frame 4 MB): changes are sealed in envelopes of at most ~700 kB of JSON, and
 * pushed in batches of at most ~2 MB.
 */
export const ENVELOPE_JSON_MAX = 700_000;
const PUSH_BYTES_MAX = 2_000_000;
const PUSH_COUNT_MAX = 400;

/** Splits changes into groups whose JSON stays under `max` (a single bigger change gets its own group). */
export function chunkChanges(changes: Change[], max = ENVELOPE_JSON_MAX): Change[][] {
  const out: Change[][] = [];
  let cur: Change[] = [], size = 2;
  for (const c of changes) {
    const s = JSON.stringify(c).length + 1;
    if (cur.length && size + s > max) { out.push(cur); cur = []; size = 2; }
    cur.push(c); size += s;
  }
  if (cur.length) out.push(cur);
  return out;
}

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
  private saving: Promise<void> = Promise.resolve();
  /** What changed since the last save (the store writes only these). */
  private dirtyEntities = new Set<string>();
  private dirtyDocs = new Set<string>();
  private savedOutbox = new Set<string>();
  /** Ids per type, and each type's list as last built (rebuilt only when that type changes). */
  private byType = new Map<string, Set<string>>();
  private listCache = new Map<string, Record_[]>();
  private typeVersions = new Map<string, number>();
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

  /**
   * `compact`: the first time this device's data goes to a server (it ran without one before), the
   * outbox holds every change ever made. It is replaced by the current state, with the same clocks,
   * so the upload is as small as the data itself.
   */
  async start(opts: { compact?: boolean } = {}): Promise<void> {
    const snap = await this.o.store.load();
    if (snap) this.restore(snap);
    if (opts.compact) this.compactOutbox();
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

  /** Pull everything after our cursor (page by page, the relay sends a few MB at a time), then push the outbox. */
  async catchUp(): Promise<void> {
    // Asked again while one runs (wake-up, reconnect and timer at once): share the running one.
    if (this.catching) return this.catching;
    this.catching = this.pullAll().finally(() => { this.catching = null; });
    return this.catching;
  }
  private catching: Promise<void> | null = null;

  private async pullAll(): Promise<void> {
    for (let page = 0; page < 100_000; page++) {
      const before = this.cursor;
      const envs = await this.o.relay.pull(this.cursor);
      this.receive(envs);
      if (!envs.length || this.cursor === before) break;
    }
    await this.pushOutbox();
  }

  /** Replaces the outbox with the current state (see start). Deleted records are left out. */
  compactOutbox(): void {
    const changes: Change[] = [];
    const gone = new Set<string>();
    for (const [id, e] of this.entities) {
      if (e.f[DELETED]?.v === true) { gone.add(id); continue; }
      for (const [f, fs] of Object.entries(e.f)) changes.push({ k: 'set', e: id, t: e.t, f, v: fs.v, h: fs.h });
    }
    for (const [id, d] of this.docs) {
      if (gone.has(id)) continue;
      changes.push({ k: 'doc', e: id, t: this.docTypes.get(id) ?? 'note', u: b64.encode(Y.encodeStateAsUpdate(d)) });
    }
    this.outbox = [];
    this.pending = [];
    for (const group of chunkChanges(changes)) this.outbox.push(this.seal(group));
    this.scheduleSave();
  }

  private seal(changes: Change[]): Envelope {
    const id = randomId(12);
    const keyId = this.o.keys.current;
    this.seen.add(id);
    return { id, device: this.device, keyId, body: sealJson(changes, this.o.keys.get(keyId), `env:${id}`) };
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

  /** Grows whenever a record of this type changes (lets the interface skip work when it didn't). */
  typeVersion(type: string): number {
    return this.typeVersions.get(type) ?? 0;
  }

  /** Every live record of a type. Built once per change of that type, so calling it often is cheap. */
  list(type: string): Record_[] {
    let l = this.listCache.get(type);
    if (!l) {
      l = [];
      for (const id of this.byType.get(type) ?? []) { const r = this.get(id); if (r) l.push(r); }
      this.listCache.set(type, l);
    }
    return l.slice();
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
      this.dirtyDocs.add(id);
      if (origin === REMOTE) return;
      // Typing in a note: sent and saved, but nothing else on screen needs to redraw for it.
      this.enqueue([{ k: 'doc', e: id, t: type, u: b64.encode(update) }], new Set([id]), true);
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
      this.indexType(c.e, c.t);
    }
    const cur = e.f[c.f];
    if (cur && cur.h >= c.h) return false;
    e.f[c.f] = { v: c.v, h: c.h };
    this.dirtyEntities.add(c.e);
    this.listCache.delete(e.t);
    this.typeVersions.set(e.t, (this.typeVersions.get(e.t) ?? 0) + 1);
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

  private enqueue(changes: Change[], ids: Set<string>, quiet = false) {
    this.pending.push(...changes);
    if (!quiet) this.emit(ids, 'local');
    this.scheduleSave();
    if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush(), this.o.flushMs ?? 30);
  }

  /** Seal pending changes into one envelope and try to push. */
  async flush(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.pending.length) {
      for (const group of chunkChanges(this.pending)) this.outbox.push(this.seal(group));
      this.pending = [];
      this.scheduleSave();
    }
    await this.pushOutbox();
  }

  /** Envelopes the relay refused on their own (too big or malformed); kept here so the outbox never jams. */
  readonly refused: Envelope[] = [];

  private nextBatch(): Envelope[] {
    const batch: Envelope[] = [];
    let bytes = 0;
    for (const e of this.outbox) {
      if (batch.length && (bytes + e.body.length > PUSH_BYTES_MAX || batch.length >= PUSH_COUNT_MAX)) break;
      batch.push(e); bytes += e.body.length;
    }
    return batch;
  }

  private sent(batch: Envelope[]) {
    const ids = new Set(batch.map((e) => e.id));
    this.outbox = this.outbox.filter((e) => !ids.has(e.id));
    this.lastSyncedAt = Date.now();
    this.scheduleSave();
  }

  private async pushOutbox() {
    if (!this.started || this.pushing || !this.outbox.length || !this.o.relay.connected) return;
    this.pushing = true;
    let retry = false;
    try {
      while (this.outbox.length && this.o.relay.connected) {
        const batch = this.nextBatch();
        try {
          await this.o.relay.push(batch);
          this.sent(batch);
        } catch (err) {
          if ((err as { code?: string })?.code !== 'bad-envelopes') throw err;
          // One bad envelope must not hold the rest back: send them one by one, set the refused aside.
          for (const env of batch) {
            try { await this.o.relay.push([env]); }
            catch (e) { if ((e as { code?: string })?.code !== 'bad-envelopes') throw e; this.refused.push(env); }
            this.sent([env]);
          }
        }
      }
    } catch {
      retry = true; // stays in the outbox; retried shortly, on the next flush or on reconnect
    } finally {
      this.pushing = false;
    }
    if (retry && this.outbox.length && this.o.relay.connected) setTimeout(() => void this.pushOutbox(), 500);
  }

  /* ------------------------------------------------------------------ persistence */

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => void this.persist(), 300);
  }

  /** Saves what changed (or everything, for a store without incremental saves). Saves never overlap. */
  async persist(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const run = this.saving.then(() => this.writeStore());
    this.saving = run.catch(() => {});
    return run;
  }

  private async writeStore(): Promise<void> {
    const store = this.o.store;
    if (!store.saveChanges) return store.save(this.snapshot());
    const c: StoreChanges = { entities: {}, docs: {}, outbox: {}, meta: { cursor: this.cursor, seen: [...this.seen].slice(-5000), clock: this.clock.tick() } };
    const ents = [...this.dirtyEntities], docs = [...this.dirtyDocs];
    this.dirtyEntities.clear(); this.dirtyDocs.clear();
    for (const id of ents) c.entities[id] = this.entities.get(id) ?? null;
    for (const id of docs) { const d = this.docs.get(id); c.docs[id] = d ? this.docTypes.get(id) + '|' + b64.encode(Y.encodeStateAsUpdate(d)) : null; }
    const now = new Set(this.outbox.map((e) => e.id));
    for (const e of this.outbox) if (!this.savedOutbox.has(e.id)) c.outbox[e.id] = e;
    for (const id of this.savedOutbox) if (!now.has(id)) c.outbox[id] = null;
    try {
      await store.saveChanges(c);
      this.savedOutbox = now;
    } catch (err) {
      ents.forEach((id) => this.dirtyEntities.add(id)); docs.forEach((id) => this.dirtyDocs.add(id)); // try again next time
      throw err;
    }
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
    for (const [id, e] of this.entities) this.indexType(id, e.t);
    if (this.o.store.needsFull) { this.entities.forEach((_, id) => this.dirtyEntities.add(id)); this.docs.forEach((_, id) => this.dirtyDocs.add(id)); }
    else this.outbox.forEach((e) => this.savedOutbox.add(e.id));
  }

  private indexType(id: string, type: string) {
    let set = this.byType.get(type);
    if (!set) this.byType.set(type, (set = new Set()));
    set.add(id);
  }

  /** Stable digest of the visible state; equal on every converged replica. */
  digest(): string {
    const ents = [...this.entities.keys()].sort().map((id) => [id, this.get(id)]);
    const docs = [...this.docs.keys()].sort().map((id) => [id, this.docs.get(id)!.getText('body').toString()]);
    return JSON.stringify({ ents, docs });
  }
}
