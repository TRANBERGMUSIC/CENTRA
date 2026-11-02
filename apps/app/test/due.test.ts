import { describe, it, expect, beforeAll } from 'vitest';
import { ready, randomKey, KeyRing } from '@centra/crypto';
import { SyncEngine, MemoryHub, MemoryRelay, MemoryStore } from '@centra/sync';
import { dueItems, alarmTimes, alertLabel } from '../src/due.ts';
import { addAlarm, daysLabel } from '../src/alarms.ts';
import { addReminder } from '../src/reminders.ts';
import { runTool } from '../src/ai/tools.ts';
import { plan } from '../src/push.ts';

beforeAll(ready);
async function engine() {
  const e = new SyncEngine({ device: 'mac', keys: new KeyRing('k1', randomKey()), store: new MemoryStore(), relay: new MemoryRelay(new MemoryHub()), flushMs: 5 });
  await e.start();
  return e;
}
const at = (s: string) => new Date(s);

describe('det der skal give besked', () => {
  it('påmindelser, alarmer før aftaler (også faste) og vækkeure, sorteret', async () => {
    const e = await engine();
    const now = at('2026-11-02T08:00');
    addReminder(e, 'Levere udstyr tilbage til Sigge', at('2026-11-02T12:00'));
    e.create('event', { title: 'Tandlæge', start: at('2026-11-02T10:00').toISOString(), end: at('2026-11-02T11:00').toISOString(), alert: 15, place: 'Nørrebro' });
    e.create('event', { title: 'Uden besked', start: at('2026-11-02T09:00').toISOString(), end: at('2026-11-02T10:00').toISOString() });
    // tirsdage 06–16, en time før
    e.create('event', { title: 'Arbejde', start: at('2026-11-03T06:00').toISOString(), end: at('2026-11-03T16:00').toISOString(), alert: 60, repeat: { days: [2] } });
    addAlarm(e, '07:00', [1, 2, 3, 4, 5], 'Op');
    const items = dueItems(e, { days: 2, now });
    expect(items.map((x) => [x.kind, x.title, new Date(x.at).toTimeString().slice(0, 5)])).toEqual([
      ['event', 'Tandlæge', '09:45'], ['reminder', 'Husk', '12:00'], ['event', 'Arbejde', '05:00'], ['alarm', 'Op', '07:00'], ['alarm', 'Op', '07:00'],
    ]);
    expect(items[0].body).toBe('Om 15 min · 10.00 · Nørrebro');
    expect(items.every((x) => /^[A-Za-z0-9:._-]+$/.test(x.id) && x.id.length <= 64)).toBe(true);
    // the iPhone rings the alarm itself when it can: then it isn't pushed
    e.set('setting', 'setting-alarms', { native: true });
    expect(plan(e, now).some((x) => x.kind === 'alarm')).toBe(false);
  });
  it('vækkeure: hverdage, én gang, og navne på dagene', () => {
    const a = { id: 'a', type: 'alarm' as const, time: '06:30', days: [1, 2, 3, 4, 5], on: true };
    const t = alarmTimes(a, at('2026-11-06T07:00'), at('2026-11-10T00:00')); // fre efter 6.30 → man, ...
    expect(t.map((d) => d.toDateString())).toEqual([at('2026-11-09T06:30').toDateString()]);
    expect(alarmTimes({ ...a, days: [] }, at('2026-11-06T07:00'), at('2026-11-10T00:00')).map((d) => d.getDate())).toEqual([7]);
    expect([daysLabel([1, 2, 3, 4, 5]), daysLabel([0, 6]), daysLabel([]), daysLabel([1, 3, 0])]).toEqual(['Hverdage', 'Weekend', 'Én gang', 'man, ons, søn']);
    expect(alertLabel(15)).toBe('15 min før');
  });
  it('Assist: "giv mig besked 30 min før" og "væk mig kl 6.30 hverdage"', async () => {
    const e = await engine();
    const r = runTool(e, 'create_event', { title: 'Fly', date: '2026-11-20', start_time: '07:15', end_time: '10:05', alert_minutes: 30 }) as any;
    expect((e.get(r.result.id) as any).alert).toBe(30);
    const a = runTool(e, 'set_alarm', { time: '6.30', days: ['man', 'tir', 'ons', 'tor', 'fre'] }) as any;
    expect(e.get(a.result.id)).toMatchObject({ time: '06:30', days: [1, 2, 3, 4, 5], on: true });
    expect(a.action.label).toBe('Vækkeur 06.30 · Hverdage');
  });
});
