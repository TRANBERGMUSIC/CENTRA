import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { ready, randomKey, KeyRing } from '@centra/crypto';
import { SyncEngine, MemoryHub, MemoryRelay, MemoryStore } from '@centra/sync';
import { addReminder, setDone, reminders, whenLabel, toPlan, notifyId, overdue, type Reminder } from '../src/reminders.ts';
import { runTool, applyUndo, contextFor } from '../src/ai/tools.ts';

beforeAll(ready);
afterEach(() => vi.useRealTimers());
async function engine() {
  const e = new SyncEngine({ device: 'mac', keys: new KeyRing('k1', randomKey()), store: new MemoryStore(), relay: new MemoryRelay(new MemoryHub()), flushMs: 5 });
  await e.start();
  return e;
}

describe('huskelisten', () => {
  it('sorterer: med tid efter tid, så uden tid, klarede til sidst', async () => {
    const e = await engine();
    const a = addReminder(e, 'Ring til mor', new Date('2026-11-02T17:00'));
    const b = addReminder(e, 'Køb pære');
    const c = addReminder(e, 'Levere udstyr tilbage til Sigge', new Date('2026-11-01T12:00'));
    setDone(e, b, true);
    expect(reminders(e).map((r) => r.id)).toEqual([c, a, b]);
    expect(() => addReminder(e, '   ')).toThrow();
  });
  it('siger hvornår på dansk, og ved hvad der er overskredet', () => {
    const now = new Date('2026-11-01T10:00');
    expect(whenLabel(new Date('2026-11-01T12:00').toISOString(), now)).toBe('i dag kl. 12.00');
    expect(whenLabel(new Date('2026-11-02T09:30').toISOString(), now)).toBe('i morgen kl. 09.30');
    expect(whenLabel(new Date('2026-11-01T09:45').toISOString(), now)).toBe('for 15 min. siden');
    expect(overdue({ at: '2026-11-01T08:00:00Z', done: false } as Reminder, now)).toBe(true);
  });
  it('planlægger kun åbne med tid i fremtiden, med faste id-numre', async () => {
    const e = await engine();
    const now = new Date();
    const soon = addReminder(e, 'Snart', new Date(now.getTime() + 3600_000));
    addReminder(e, 'Før', new Date(now.getTime() - 3600_000));
    addReminder(e, 'Uden tid');
    const doneOne = addReminder(e, 'Klaret', new Date(now.getTime() + 7200_000)); setDone(e, doneOne, true);
    const plan = toPlan(reminders(e), now);
    expect(plan.map((p) => p.text)).toEqual(['Snart']);
    expect(plan[0].id).toBe(notifyId(soon));
    expect(notifyId(soon)).toBeGreaterThan(0);
    expect(notifyId(soon)).toBeLessThan(2 ** 31);
  });
  it('Assist: "husk mig på at levere udstyr tilbage til Sigge kl 12", kryds af, fortryd', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T09:00'));
    const e = await engine();
    const r = runTool(e, 'add_reminder', { text: 'Levere udstyr tilbage til Sigge', time: '12:00' }) as any;
    const rem = e.get(r.result.id) as unknown as Reminder;
    expect(new Date(rem.at!).getHours()).toBe(12);
    expect(new Date(rem.at!).getDate()).toBe(1);
    expect(r.action.label).toContain('i dag kl. 12.00');
    expect(contextFor(e)).toContain(`[${rem.id}] Levere udstyr tilbage til Sigge · i dag kl. 12.00`);
    // a time that has passed today means tomorrow
    const late = runTool(e, 'add_reminder', { text: 'Tag skraldet ud', time: '07:30' }) as any;
    expect(new Date((e.get(late.result.id) as any).at).getDate()).toBe(2);
    const c = runTool(e, 'complete_reminder', { id: rem.id }) as any;
    expect((e.get(rem.id) as any).done).toBe(true);
    applyUndo(e, c.action.undo);
    expect((e.get(rem.id) as any).done).toBe(false);
    applyUndo(e, r.action.undo);
    expect(e.get(rem.id)).toBeFalsy();
    // and the generic tools find it like everything else
    expect((runTool(e, 'find_items', { query: 'skraldet' }).result as any).items[0].kind).toBe('huskeliste-punkt');
  });
});
