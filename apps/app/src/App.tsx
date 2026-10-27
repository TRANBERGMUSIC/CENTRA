import { useCallback, useEffect, useRef, useState } from 'react';
import { RouteProvider, SessionProvider, useEngine, type Route } from './state.tsx';
import { Sidebar, TabBar, CommandPalette, ToastHost, useToast } from './ui/Shell.tsx';
import { Today } from './screens/Today.tsx';
import { Notes } from './screens/Notes.tsx';
import { Inbox } from './screens/Inbox.tsx';
import { Goals } from './screens/Goals.tsx';
import { Calendar } from './screens/Calendar.tsx';
import { Assist } from './screens/Assist.tsx';
import { Settings, applyTheme, type Theme } from './screens/Settings.tsx';
import { Unlock, RecoveryCode } from './screens/Unlock.tsx';
import type { Session } from './session.ts';
import { useAutoLock, lock } from './lock.ts';
import { watchForUpdates } from './updater.ts';
import { Connections } from './screens/Connections.tsx';
import { Contacts } from './screens/Contacts.tsx';
import { Outlays } from './screens/Outlays.tsx';
import { Expenses } from './screens/Expenses.tsx';
import { UsageScreen } from './screens/Usage.tsx';
import { syncAll } from './mail.ts';
import { triageMails } from './ai/triage.ts';
import { syncFeeds } from './feeds.ts';
import { useAppMotion } from './motion.ts';
import { markReady, watchWebUpdates, justUpdated } from './webupdate.ts';
import { resumeAfterUpdate } from './session.ts';

const readRoute = (): Route => {
  const [screen, id] = location.hash.replace(/^#\/?/, '').split('/');
  return { screen: (screen || 'today') as Route['screen'], id: id || undefined };
};

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [showCode, setShowCode] = useState<string | null>(null);
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem('centra.theme') as Theme) ?? 'dark');
  const setTheme = (t: Theme) => { setThemeState(t); localStorage.setItem('centra.theme', t); applyTheme(t); };
  useEffect(() => applyTheme(theme), [theme]);
  useAutoLock(!!session);
  // On the lock screen nothing is open, so a new version installs right away.
  useEffect(() => (session ? undefined : watchForUpdates((u) => void u.install())), [session]);
  // Fast interface updates: this interface started fine; look for a newer one every minute.
  const sessionRef = useRef<Session | null>(null); sessionRef.current = session;
  const [waiting, setWaiting] = useState<(() => void) | null>(null);
  useEffect(() => { markReady(); return watchWebUpdates(() => sessionRef.current, (apply) => setWaiting(() => apply)); }, []);
  // Right after such an update the vault opens again by itself (the Mac app held the key for the reload).
  const [resuming, setResuming] = useState(() => '__TAURI_INTERNALS__' in window);
  const [updated] = useState(justUpdated);
  useEffect(() => {
    if (!resuming) return;
    void resumeAfterUpdate().then((s) => { if (s) open(s); setResuming(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const open = (s: Session) => {
    s.relay.onClosedByServer = (code) => lock(code === 4001 ? 'Denne enhed er logget ud fra en anden enhed.' : 'Dit password er skiftet på en anden enhed. Log ind med det nye.');
    if (s.recoveryCode) setShowCode(s.recoveryCode);
    setSession(s);
  };

  if (resuming && !session) return <main className="unlock" aria-busy="true" />;
  if (!session) {
    const notice = sessionStorage.getItem('centra.lockReason') ?? undefined;
    sessionStorage.removeItem('centra.lockReason');
    return <Unlock notice={notice} onReady={open} />;
  }
  if (showCode) return <RecoveryCode code={showCode} onDone={() => { setShowCode(null); session.recoveryCode = undefined; }} />;
  return (
    <SessionProvider value={session}>
      <ToastHost>
        <Shell theme={theme} setTheme={setTheme} firstOpen={!updated} />
        <UpdateNotes updated={updated} waiting={waiting} />
      </ToastHost>
    </SessionProvider>
  );
}

/** "CENTRA er opdateret" after a fast update, or "ny version klar" while you are busy. */
function UpdateNotes({ updated, waiting }: { updated: boolean; waiting: (() => void) | null }) {
  const toast = useToast();
  useEffect(() => { if (updated) toast({ icon: 'sun', title: 'CENTRA er opdateret', text: 'Den nye version kører nu.' }); }, [updated, toast]);
  useEffect(() => { if (waiting) toast({ icon: 'sun', title: 'Ny version klar', text: 'Den skifter ind, så snart du holder en kort pause.', sticky: true, action: { label: 'Skift nu', run: waiting } }); }, [waiting, toast]);
  return null;
}

function Shell({ theme, setTheme, firstOpen }: { theme: Theme; setTheme: (t: Theme) => void; firstOpen: boolean }) {
  const [route, setRoute] = useState<Route>(readRoute);
  const [palette, setPalette] = useState(false);
  const e = useEngine();
  const toast = useToast();
  const opened = useRef(firstOpen);
  const appRef = useRef<HTMLDivElement>(null);
  useAppMotion(appRef);
  const go = useCallback((r: Route) => { opened.current = false; location.hash = `/${r.screen}${r.id ? '/' + r.id : ''}`; }, []);

  useEffect(() => { const f = () => setRoute(readRoute()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const mod = ev.metaKey || ev.ctrlKey;
      if (mod && ev.key.toLowerCase() === 'k') { ev.preventDefault(); setPalette((p) => !p); }
      if (mod && ev.key.toLowerCase() === 'n') { ev.preventDefault(); go({ screen: 'notes', id: e.create('note', { title: '', folder: 'Indbakke', tags: [], editedAt: new Date().toISOString() }) }); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [e, go]);
  // Pull down at the top of the phone screen opens search.
  useEffect(() => {
    let y0: number | null = null;
    const start = (t: TouchEvent) => { y0 = scrollY <= 0 ? t.touches[0].clientY : null; };
    const end = (t: TouchEvent) => { if (y0 !== null && t.changedTouches[0].clientY - y0 > 90) setPalette(true); y0 = null; };
    addEventListener('touchstart', start, { passive: true }); addEventListener('touchend', end);
    return () => { removeEventListener('touchstart', start); removeEventListener('touchend', end); };
  }, []);
  // In the Mac app, web links, mailto:, tel: and sms: open in the right app instead of nowhere.
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    const click = (ev: MouseEvent) => {
      const a = (ev.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || !/^(https?|mailto|tel|sms):/i.test(a.href)) return;
      ev.preventDefault();
      void import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(a.href)).catch(() => toast({ text: 'Linket kunne ikke åbnes' }));
    };
    document.addEventListener('click', click);
    return () => document.removeEventListener('click', click);
  }, [toast]);
  // Mail every 5 minutes, calendars every 15, and both when the window comes back.
  useEffect(() => {
    let last = 0, lastFeeds = 0, alive = true;
    const run = async (force = false) => {
      if (!alive || (!force && Date.now() - last < 120_000)) return;
      last = Date.now();
      const r = await syncAll(e);
      if (r.added.length) void triageMails(e, r.added);
      for (const h of r.hits) toast({ person: { name: h.mail.fromName || h.mail.fromEmail }, title: `Mail fra ${h.mail.fromName || h.mail.fromEmail}`, text: `${h.mail.subject} · du bad Assist holde øje med "${h.watch.description}"`, sticky: true, action: { label: 'Åbn', run: () => go({ screen: 'inbox', id: h.mail.id }) } });
      if (Date.now() - lastFeeds > 14 * 60_000) { lastFeeds = Date.now(); await syncFeeds(e); }
    };
    void run(true);
    const t = setInterval(() => void run(true), 5 * 60_000);
    const vis = () => { if (!document.hidden) void run(); };
    document.addEventListener('visibilitychange', vis);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [e, toast, go]);
  useEffect(() => watchForUpdates((u) => toast({ text: `CENTRA ${u.version} er hentet og klar`, sticky: true, action: { label: 'Genstart nu', run: () => void u.install() } })), [toast]);

  const screen = {
    today: <Today firstOpen={opened.current} />, notes: <Notes />, inbox: <Inbox />, goals: <Goals />,
    calendar: <Calendar />, assist: <Assist />, settings: <Settings theme={theme} setTheme={setTheme} />, connections: <Connections />,
    contacts: <Contacts />, outlays: <Outlays />, expenses: <Expenses />, usage: <UsageScreen />,
  }[route.screen] ?? <Today firstOpen={false} />;

  return (
    <RouteProvider value={{ route, go }}>
      <div className="app" ref={appRef}>
        <Sidebar onSearch={() => setPalette(true)} />
        <button className="pull" onClick={() => setPalette(true)}>Søg eller spørg</button>
        {screen}
        <TabBar />
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </RouteProvider>
  );
}
