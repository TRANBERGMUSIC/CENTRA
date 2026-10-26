/** Boots one signed-in device: relay connection, account keys, local store and the sync engine. */
import { ready, randomId } from '@centra/crypto';
import { SyncEngine, WsRelay, IndexedDbStore, createAccount, unlockAccount, type AccountKeys, type DeviceRecord } from '@centra/sync';
import { seedSampleData } from './seed.ts';

export type Session = {
  engine: SyncEngine;
  relay: WsRelay;
  user: string;
  email: string;
  device: string;
  created: boolean;
};

const RELAY_URL = (import.meta.env.VITE_RELAY_URL as string | undefined) ?? `ws://${location.hostname || 'localhost'}:8787`;

function deviceId(): string {
  let id = localStorage.getItem('centra.device');
  if (!id) {
    id = 'd' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('centra.device', id);
  }
  return id;
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Linux';
  const shell = '__TAURI_INTERNALS__' in window ? 'app' : (window as any).Capacitor?.isNativePlatform?.() ? 'app' : 'browser';
  return `${os} · ${shell}`;
}

/** Account id derived from the e-mail; the dev relay has no auth server (Supabase replaces this). */
async function userId(email: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()));
  return 'u' + [...new Uint8Array(h)].slice(0, 10).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signIn(email: string, passphrase: string, onStage: (s: string) => void): Promise<Session> {
  await ready();
  const user = await userId(email);
  const device = deviceId();
  onStage('Forbinder');
  const relay = new WsRelay(RELAY_URL, { user, device, name: deviceName(), platform: deviceName() });
  const cacheKey = `centra.account.${user}`;
  const cached = localStorage.getItem(cacheKey);
  // Online: the server's copy. Offline: the copy cached on this device (it is wrapped, so safe to keep).
  const record = await Promise.race([
    relay.ready().then(() => relay.account as AccountKeys | null),
    new Promise<AccountKeys | null | 'offline'>((r) => setTimeout(() => r(cached ? JSON.parse(cached) : 'offline'), 2500)),
  ]);
  // No server reachable and never opened here: start the account on this device. It is uploaded
  // (still wrapped) the first time the server is reachable, and every change written meanwhile follows.
  const offlineNew = record === 'offline';

  onStage('Låser op');
  await new Promise((r) => setTimeout(r, 30));
  let keys;
  let created = false;
  if (record && record !== 'offline') {
    try {
      keys = unlockAccount(passphrase, record).keys;
    } catch {
      relay.close();
      throw new Error('Forkert passphrase.');
    }
    localStorage.setItem(cacheKey, JSON.stringify(record));
  } else {
    const acc = createAccount(passphrase);
    keys = acc.keys;
    if (offlineNew) relay.onOpen(() => { if (!relay.account) relay.setAccount(acc.record); });
    else relay.setAccount(acc.record);
    localStorage.setItem(cacheKey, JSON.stringify(acc.record));
    created = true;
  }

  onStage('Synkroniserer');
  const engine = new SyncEngine({ device, keys, store: new IndexedDbStore(`${user}:${device}`), relay });
  await engine.start();
  if (created) seedSampleData(engine);
  localStorage.setItem('centra.lastEmail', email);
  return { engine, relay, user, email, device, created };
}

export type { DeviceRecord };
export const newId = () => randomId(12);
