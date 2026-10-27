import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Record_, SyncEngine } from '@centra/sync';
import type { Session } from './session.ts';

const Ctx = createContext<Session | null>(null);
export const SessionProvider = Ctx.Provider;
export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('no session');
  return s;
}
export const useEngine = (): SyncEngine => useSession().engine;

/** Re-renders whenever anything in the engine changes (local or remote). Cheap at personal-data scale. */
function useVersion(e: SyncEngine): number {
  const [store] = useState(() => {
    let v = 0;
    return {
      subscribe: (cb: () => void) => e.on(() => { v++; cb(); }),
      get: () => v,
    };
  });
  return useSyncExternalStore(store.subscribe, store.get);
}

export function useList<T = Record_>(type: string, sort?: (a: any, b: any) => number): (T & Record_)[] {
  const e = useEngine();
  const v = useVersion(e);
  return useMemo(() => {
    const l = e.list(type) as (T & Record_)[];
    return sort ? l.sort(sort) : l;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e, v, type]);
}

export function useRecord<T = Record_>(id: string | null | undefined): (T & Record_) | null {
  const e = useEngine();
  const v = useVersion(e);
  return useMemo(() => (id ? (e.get(id) as (T & Record_) | null) : null), [e, v, id]);
}

/** Sync status for the sidebar line: last sync time, pending changes, connection. */
export function useSyncStatus() {
  const { engine, relay } = useSession();
  useVersion(engine);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return { online: relay.connected, pending: engine.pendingCount, last: engine.lastSyncedAt };
}

/** Wall clock, ticking each minute (drives the now-line and relative times). */
export function useNow(intervalMs = 30000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/* ---------------------------------------------------------------- routing */
export type Route = { screen: 'today' | 'notes' | 'calendar' | 'inbox' | 'goals' | 'assist' | 'settings' | 'connections' | 'contacts' | 'outlays' | 'expenses' | 'usage'; id?: string };
const RouteCtx = createContext<{ route: Route; go: (r: Route) => void } | null>(null);
export const RouteProvider = RouteCtx.Provider;
export function useRoute() {
  const r = useContext(RouteCtx);
  if (!r) throw new Error('no router');
  return r;
}

/* ---------------------------------------------------------------- formatting */
const pad = (n: number) => String(n).padStart(2, '0');
export const fmt = {
  hm: (iso: string | Date) => { const d = new Date(iso); return `${pad(d.getHours())}.${pad(d.getMinutes())}`; },
  dur: (mins: number) => (mins >= 60 ? `${Math.floor(mins / 60)} t${mins % 60 ? ' ' + (mins % 60) + ' m' : ''}` : `${Math.round(mins)} min`),
  num: (n: number, d = 0) => n.toLocaleString('da-DK', { minimumFractionDigits: d, maximumFractionDigits: d }),
  dayLabel: (d: Date) => d.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase()),
  shortDate: (iso: string) => new Date(iso).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' }),
  /** "9 min", "1 t", "I går 16.42", "Fre 23. okt" */
  ago(iso: string, now = new Date()) {
    const d = new Date(iso);
    const mins = Math.round((now.getTime() - d.getTime()) / 60000);
    if (mins < 1) return 'Nu';
    if (mins < 60) return `${mins} min`;
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return `${Math.floor(mins / 60)} t`;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return `I går ${fmt.hm(d)}`;
    return d.toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/^./, (c) => c.toUpperCase()).replace('.', '');
  },
  clock(iso: string, now = new Date()) {
    const d = new Date(iso);
    if (d.toDateString() === now.toDateString()) return fmt.hm(d);
    return fmt.ago(iso, now).replace(/ \d\d\.\d\d$/, '');
  },
};

export const greeting = (d: Date) => (d.getHours() < 5 ? 'God nat' : d.getHours() < 10 ? 'God morgen' : d.getHours() < 17 ? 'God eftermiddag' : 'God aften');
