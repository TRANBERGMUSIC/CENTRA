/**
 * Vækkeure: a time, the weekdays it repeats on (none = once), a name, on or off. On the iPhone they
 * become real alarms (AlarmKit: they ring on silent and with CENTRA closed); if the phone can't
 * (before iOS 26, or no permission) they come as push notifications instead (due.ts / push.ts).
 */
import type { SyncEngine } from '@centra/sync';
import { ios, invoke } from './platform.ts';
import type { Alarm } from './due.ts';

export type { Alarm };

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16)));

export function addAlarm(e: SyncEngine, time: string, days: number[] = [], label = ''): string {
  if (!/^\d{1,2}:\d{2}$/.test(time)) throw new Error('Ukendt tidspunkt');
  const [h, m] = time.split(':').map(Number);
  if (h > 23 || m > 59) throw new Error('Ukendt tidspunkt');
  return e.create('alarm', { time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, days: [...new Set(days)].filter((d) => d >= 0 && d <= 6).sort(), label: label.trim().slice(0, 60), on: true, uuid: uuid() });
}

export const alarms = (e: SyncEngine) => (e.list('alarm') as unknown as (Alarm & { uuid?: string })[]).sort((a, b) => a.time.localeCompare(b.time));

const DAY = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'];
export function daysLabel(days: number[]) {
  const d = [...days].sort();
  if (!d.length) return 'Én gang';
  if (d.length === 7) return 'Hver dag';
  if (d.join() === '1,2,3,4,5') return 'Hverdage';
  if (d.join() === '0,6') return 'Weekend';
  return [...d.filter((x) => x > 0), ...d.filter((x) => x === 0)].map((x) => DAY[x]).join(', ');
}

/** iPhone: keeps the phone's alarms the same as the list, here and from the other devices. */
export function startAlarms(e: SyncEngine): () => void {
  if (!ios) return () => {};
  let sig = '', alive = true;
  const sync = async () => {
    if (!alive) return;
    const list = alarms(e).map((a) => {
      const [hour, minute] = a.time.split(':').map(Number);
      return { id: a.uuid ?? '', hour, minute, days: a.days ?? [], label: a.label || 'Vækkeur', on: !!a.on };
    }).filter((a) => a.id);
    const s = JSON.stringify(list);
    if (s === sig) return;
    sig = s;
    const r = await invoke<string>('alarms_sync', { json: s }).catch(() => 'unavailable');
    // Ask how it went once AlarmKit has had a moment (it asks for permission the first time).
    if (r === 'ok') await new Promise((res) => setTimeout(res, 2500));
    const st = r === 'ok' ? await invoke<string>('alarms_status').catch(() => 'unavailable') : 'unavailable';
    const native = st === 'ok';
    if (!!(e.get('setting-alarms') as any)?.native !== native) e.set('setting', 'setting-alarms', { native, status: st });
  };
  let soon: ReturnType<typeof setTimeout> | undefined;
  const off = e.on((ids) => { if ([...ids].some((id) => { const t = (e.get(id) as any)?.type; return !t || t === 'alarm'; })) { clearTimeout(soon); soon = setTimeout(() => void sync(), 600); } });
  void sync();
  return () => { alive = false; clearTimeout(soon); off(); };
}
