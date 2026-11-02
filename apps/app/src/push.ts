/**
 * Push through the sync server (see packages/relay-core, "push").
 *
 *  - The iPhone asks iOS for its push token and registers it with the relay.
 *  - Every device that is online keeps the relay's plan up to date: what is due when (due.ts). They
 *    all hold the same data, so it doesn't matter which one sends it; the relay keeps the newest.
 *  - The relay sends each item through Apple at its time. A phone that is off gets it when it's back.
 *  - The iPhone plans locally only what the relay hasn't confirmed (made offline, or no push key yet),
 *    so nothing comes twice.
 *  - The Mac, running in the background, hands over new mail, LunchHub and watched mail (pushNow).
 *
 * The text of what is due goes to the relay (the user chose that), and is gone there once sent.
 */
import { WsRelay, type SyncEngine } from '@centra/sync';
import { ios, invoke } from './platform.ts';
import { dueItems, type DueItem } from './due.ts';

const ACKED = 'centra.push.acked';
const read = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? '') as T; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

/** The ids (with their time) the relay has in its plan right now, as far as this device knows. */
export const pushAcked = (): Set<string> => new Set(read<string[]>(ACKED, []));
const key = (x: { id: string; at: number }) => `${x.id}@${x.at}`;

let relayRef: WsRelay | null = null;
/** Something to show on the other devices now (the Mac found a new mail). Quietly nothing offline. */
export async function pushNow(title: string, body: string) {
  if (!relayRef?.connected || !relayRef.pushReady) return;
  try { await relayRef.pushNow(title.slice(0, 120), body.slice(0, 400)); } catch { /* fine */ }
}

/** Alarms ring as real iPhone alarms when the phone could set them (then they're left out of push). */
export const alarmsNative = (e: SyncEngine) => !!(e.get('setting-alarms') as { native?: boolean } | null)?.native;

/** The plan as the relay wants it. */
export function plan(e: SyncEngine, now = new Date()): DueItem[] {
  return dueItems(e, { days: 14, alarms: !alarmsNative(e), now }).slice(0, 300);
}

export function startPush(e: SyncEngine, relay: unknown): () => void {
  if (!(relay instanceof WsRelay)) return () => {};
  relayRef = relay;
  let alive = true, sent = '';

  // The iPhone's token (iOS answers a moment after asking, and it can change).
  const token = async () => {
    if (!ios) return;
    // iOS shows pushes only with permission for notifications (asked once).
    const granted = await invoke<boolean | null>('plugin:notification|is_permission_granted').catch(() => null);
    if (granted == null) await invoke('plugin:notification|request_permission').catch(() => {});
    await invoke('push_register').catch(() => {});
    for (let i = 0; i < 20 && alive; i++) {
      const t = await invoke<{ token: string; available: boolean }>('push_token').catch(() => null);
      if (!t?.available) return;
      if (t.token) { if (relay.connected) await relay.pushRegister(t.token).catch(() => {}); return; }
      await new Promise((r) => setTimeout(r, 1000));
    }
  };

  const send = async () => {
    if (!alive || !relay.connected) return;
    const items = plan(e).map(({ id, at, title, body }) => ({ id, at, title, body }));
    const sig = items.map((x) => `${key(x)}|${x.title}|${x.body}`).join('\n');
    if (sig === sent) return;
    try {
      const ready = await relay.pushSchedule(items);
      sent = sig;
      write(ACKED, ready ? items.map(key) : []);
    } catch { /* offline: next round */ }
  };

  let soon: ReturnType<typeof setTimeout> | undefined;
  const later = () => { clearTimeout(soon); soon = setTimeout(() => void send(), 1500); };
  const offOpen = relay.onOpen(() => { sent = ''; void token(); later(); });
  const offChange = e.on((ids) => { if ([...ids].some((id) => { const t = (e.get(id) as any)?.type; return !t || t === 'reminder' || t === 'event' || t === 'alarm' || id === 'setting-alarms'; })) later(); });
  // Times roll forward (repeating events, alarms): the plan is refreshed now and then.
  const every = setInterval(() => { sent = ''; void send(); }, 15 * 60_000);
  if (relay.connected) { void token(); later(); }
  return () => { alive = false; clearTimeout(soon); clearInterval(every); offOpen(); offChange(); if (relayRef === relay) relayRef = null; };
}
