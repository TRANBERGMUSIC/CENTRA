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

  if (!session) {
    const notice = sessionStorage.getItem('centra.lockReason') ?? undefined;
    sessionStorage.removeItem('centra.lockReason');
    return <Unlock notice={notice} onReady={(s) => {
      s.relay.onClosedByServer = (code) => lock(code === 4001 ? 'Denne enhed er logget ud fra en anden enhed.' : 'Dit password er skiftet på en anden enhed. Log ind med det nye.');
      if (s.recoveryCode) setShowCode(s.recoveryCode);
      setSession(s);
    }} />;
  }
  if (showCode) return <RecoveryCode code={showCode} onDone={() => { setShowCode(null); session.recoveryCode = undefined; }} />;
  return (
    <SessionProvider value={session}>
      <ToastHost>
        <Shell theme={theme} setTheme={setTheme} firstOpen />
      </ToastHost>
    </SessionProvider>
  );
}

function Shell({ theme, setTheme, firstOpen }: { theme: Theme; setTheme: (t: Theme) => void; firstOpen: boolean }) {
  const [route, setRoute] = useState<Route>(readRoute);
  const [palette, setPalette] = useState(false);
  const e = useEngine();
  const toast = useToast();
  const opened = useRef(firstOpen);
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
  useEffect(() => watchForUpdates((u) => toast({ text: `CENTRA ${u.version} er hentet og klar`, sticky: true, action: { label: 'Genstart nu', run: () => void u.install() } })), [toast]);

  const screen = {
    today: <Today firstOpen={opened.current} />, notes: <Notes />, inbox: <Inbox />, goals: <Goals />,
    calendar: <Calendar />, assist: <Assist />, settings: <Settings theme={theme} setTheme={setTheme} />,
  }[route.screen] ?? <Today firstOpen={false} />;

  return (
    <RouteProvider value={{ route, go }}>
      <div className="app">
        <Sidebar onSearch={() => setPalette(true)} />
        <button className="pull" onClick={() => setPalette(true)}>Søg eller spørg</button>
        {screen}
        <TabBar />
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </RouteProvider>
  );
}
