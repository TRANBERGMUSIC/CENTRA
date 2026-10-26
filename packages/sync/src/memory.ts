/** In-memory store and relay hub — used by tests and by the in-browser demo mode. */
import type { Envelope, Relay, Snapshot, Store } from './types.ts';

export class MemoryStore implements Store {
  data: Snapshot | null = null;
  async load() { return this.data ? structuredClone(this.data) : null; }
  async save(s: Snapshot) { this.data = structuredClone(s); }
}

/** One account's server log. Assigns seq, fans out to every connected client. */
export class MemoryHub {
  log: Envelope[] = [];
  private clients = new Set<MemoryRelay>();
  constructor(public latencyMs = 0) {}
  connect(r: MemoryRelay) { this.clients.add(r); }
  async accept(envs: Envelope[]): Promise<Envelope[]> {
    const accepted: Envelope[] = [];
    for (const e of envs) {
      if (this.log.some((x) => x.id === e.id)) continue;
      const withSeq = { ...e, seq: this.log.length + 1 };
      this.log.push(withSeq);
      accepted.push(withSeq);
    }
    for (const c of this.clients) for (const e of accepted) c.deliver(e);
    return accepted;
  }
}

export class MemoryRelay implements Relay {
  private subs = new Set<(e: Envelope) => void>();
  private opens = new Set<() => void>();
  connected = true;
  /** Envelopes held back while offline or to simulate reordering. */
  private held: Envelope[] = [];
  holdIncoming = false;
  constructor(private hub: MemoryHub) { hub.connect(this); }

  private wait() { return new Promise((r) => setTimeout(r, this.hub.latencyMs)); }
  async push(envs: Envelope[]) {
    if (!this.connected) throw new Error('offline');
    await this.wait();
    await this.hub.accept(envs);
  }
  async pull(after: number) {
    if (!this.connected) return [];
    await this.wait();
    return this.hub.log.filter((e) => (e.seq ?? 0) > after);
  }
  subscribe(cb: (e: Envelope) => void) { this.subs.add(cb); return () => this.subs.delete(cb); }
  onOpen(cb: () => void) { this.opens.add(cb); return () => this.opens.delete(cb); }
  deliver(e: Envelope) {
    if (!this.connected || this.holdIncoming) { if (this.connected) this.held.push(e); return; }
    setTimeout(() => this.subs.forEach((s) => s(e)), this.hub.latencyMs);
  }
  /** Release held envelopes in a given order (default: shuffled). */
  release(order: 'shuffle' | 'fifo' = 'shuffle') {
    const list = order === 'shuffle' ? this.held.sort(() => Math.random() - 0.5) : this.held;
    this.held = [];
    this.holdIncoming = false;
    list.forEach((e) => this.subs.forEach((s) => s(e)));
  }
  goOffline() { this.connected = false; }
  goOnline() { this.connected = true; this.opens.forEach((o) => o()); }
}
