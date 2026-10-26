/**
 * Hybrid logical clock. Orders edits across devices even when their wall clocks disagree.
 * Encoded so that plain string comparison gives the total order:
 *   "<wall ms, 15 digits>:<counter, 5 digits>:<node id>"
 */
export type Hlc = string;

export class Clock {
  private wall = 0;
  private counter = 0;
  constructor(readonly node: string, private now: () => number = Date.now) {}

  tick(): Hlc {
    const t = this.now();
    if (t > this.wall) {
      this.wall = t;
      this.counter = 0;
    } else {
      this.counter++;
    }
    return encode(this.wall, this.counter, this.node);
  }

  /** Merge a remote timestamp so the next local tick is ordered after it. */
  receive(remote: Hlc): void {
    const r = decode(remote);
    const t = this.now();
    if (t > this.wall && t > r.wall) {
      this.wall = t;
      this.counter = 0;
    } else if (r.wall > this.wall) {
      this.wall = r.wall;
      this.counter = r.counter + 1;
    } else if (r.wall === this.wall) {
      this.counter = Math.max(this.counter, r.counter) + 1;
    } else {
      this.counter++;
    }
  }
}

export const encode = (wall: number, counter: number, node: string): Hlc =>
  `${String(wall).padStart(15, '0')}:${String(counter).padStart(5, '0')}:${node}`;

export function decode(h: Hlc): { wall: number; counter: number; node: string } {
  const [w, c, ...n] = h.split(':');
  return { wall: Number(w), counter: Number(c), node: n.join(':') };
}
