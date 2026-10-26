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
import { Unlock } from './screens/Unlock.tsx';
import { signIn, type Session } from './session.ts';
import { watchForUpdates } from './updater.ts';
import { gsap, reduced } from './motion.ts';

const readRoute = (): Route => {
  const [screen, id] = location.hash.replace(/^#\/?/, '').split('/');
  return { screen: (screen || 'today') as Route['screen'], id: id || undefined };
};

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem('centra.theme') as Theme) ?? 'dark');
  const setTheme = (t: Theme) => { setThemeState(t); localStorage.setItem('centra.theme', t); applyTheme(t); };
  useEffect(() => applyTheme(theme), [theme]);

  if (!session) {
    return <Unlock onUnlock={async (email, pass, stage) => {
      const s = await signIn(email, pass, stage);
      s.relay.onRevoked = () => { alert('Denne enhed er logget ud fra en anden enhed.'); location.reload(); };
      if (!reduced()) await gsap.to('.unlock__card', { opacity: 0, y: -8, duration: 0.2 });
      setSession(s);
    }} />;
  }
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
  useEffect(() => watchForUpdates((u) => toast({ text: `CENTRA ${u.version} er klar`, action: { label: 'Genstart', run: () => void u.install() } })), [toast]);

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
