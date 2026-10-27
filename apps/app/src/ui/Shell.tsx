import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon.tsx';
import { Wordmark } from './primitives.tsx';
import { useEngine, useList, useRoute, useSession, useSyncStatus, fmt, type Route } from '../state.tsx';
import { balances, ME } from '../money.ts';
import { gsap, useGSAP, reduced, ease, dur, useNavPill } from '../motion.ts';
import { Logo } from './Logo.tsx';
import { lock } from '../lock.ts';
import { queueAssist } from '../screens/Assist.tsx';
import { repeatLabel } from '../calendar.ts';

/* ---------------------------------------------------------------- notifications (see Notifications.tsx) */
export { useToast, NotificationHost as ToastHost } from './Notifications.tsx';

/* ---------------------------------------------------------------- navigation */
const NAV: [Route['screen'], IconName, string][] = [
  ['today', 'today', 'I dag'], ['notes', 'notes', 'Noter'], ['calendar', 'calendar', 'Kalender'],
  ['inbox', 'inbox', 'Indbakke'], ['goals', 'goals', 'Mål'], ['outlays', 'receipt', 'Udlæg'], ['expenses', 'wallet', 'Udgifter'],
  ['contacts', 'contacts', 'Kontakter'], ['assist', 'assist', 'Assist'],
];
const PHONE_TABS: Route['screen'][] = ['today', 'calendar', 'outlays', 'notes', 'assist'];

function useCounts() {
  const mails = useList('mail');
  const sugg = useList('suggestion');
  const goals = useList('goal');
  useList('outlay'); useList('payment');
  const e = useEngine();
  const owing = balances(e).filter((b) => b.left > 0).length;
  return {
    inbox: mails.filter((m: any) => m.needsReply && !m.archived).length,
    assist: sugg.filter((s: any) => s.status === 'pending').length,
    outlays: owing,
    goals: goals.length,
  } as Record<string, number>;
}

function SyncLine() {
  const { online, pending, last } = useSyncStatus();
  const { relay, sync } = useSession();
  if (!sync) return <div className="syncline"><span className="dot" />Gemt krypteret på denne computer</div>;
  const devices = relay.devices.filter((d) => !d.revoked).length;
  const text = !online ? `Offline · ${pending ? pending + ' venter' : 'alt gemt lokalt'}` : pending ? `Synkroniserer ${pending}` : `Synkroniseret ${last ? fmt.hm(new Date(last)) : ''} · ${devices} ${devices === 1 ? 'enhed' : 'enheder'}`;
  return <div className="syncline"><span className={`dot ${online ? '' : 'dot--off'}`} />{text}</div>;
}

export function Sidebar({ onSearch }: { onSearch: () => void }) {
  const { route, go } = useRoute();
  const counts = useCounts();
  const pinned = useList('note').filter((n: any) => n.pinned);
  const { user } = useSession();
  const navRef = useRef<HTMLElement>(null);
  useNavPill(navRef, route.screen);
  return (
    <aside className="sidebar" aria-label="Navigation">
      <button className="brand" onClick={() => go({ screen: 'today' })} aria-label="CENTRA, I dag">
        <Logo className="brand__icon" size={30} />
        <Wordmark />
      </button>
      <button className="searchbtn" onClick={onSearch}><Icon name="search" /><span>Søg eller spørg</span><span className="kbd">⌘K</span></button>
      <nav ref={navRef}>
        <span className="nav-pill" aria-hidden="true" />
        {NAV.map(([k, i, l]) => (
          <button key={k} className={`nav-item ${route.screen === k ? 'is-active' : ''}`} aria-current={route.screen === k ? 'page' : undefined} onClick={() => go({ screen: k })}>
            <Icon name={i} /><span>{l}</span>
            {counts[k] ? <span className={`count num ${k === 'inbox' ? 'is-due' : ''}`}>{counts[k]}</span> : null}
          </button>
        ))}
      </nav>
      {pinned.length > 0 && <div className="nav-group">Fastgjort</div>}
      {pinned.map((n: any) => (
        <button key={n.id} className="nav-sub" onClick={() => go({ screen: 'notes', id: n.id })}><Icon name="pin" size="sm" /><span>{n.title || 'Uden titel'}</span></button>
      ))}
      <div className="sidebar__foot">
        <SyncLine />
        <button className={`nav-sub ${route.screen === 'connections' ? 'is-active' : ''}`} onClick={() => go({ screen: 'connections' })}><Icon name="link" size="sm" /><span>Forbindelser</span></button>
        <button className={`nav-sub ${route.screen === 'settings' ? 'is-active' : ''}`} onClick={() => go({ screen: 'settings' })}><Icon name="settings" size="sm" /><span>Indstillinger</span></button>
        <div className="userrow"><span className="avatar avatar--me">{user.slice(0, 2).toUpperCase()}</span><div className="ellipsis">{user.charAt(0).toUpperCase() + user.slice(1)}<small>Krypteret · låser selv</small></div><button className="btn btn--text btn--sm push-right" onClick={() => lock()} aria-label="Lås CENTRA" title="Lås nu">Lås</button></div>
      </div>
    </aside>
  );
}

export function TabBar() {
  const { route, go } = useRoute();
  const counts = useCounts();
  return (
    <nav className="tabbar" aria-label="Faner">
      {NAV.filter(([k]) => PHONE_TABS.includes(k)).map(([k, i, l]) => (
        <button key={k} className={route.screen === k ? 'is-active' : ''} onClick={() => go({ screen: k })} aria-current={route.screen === k ? 'page' : undefined}>
          <Icon name={i} size="tab" />{l}
          {k === 'inbox' && counts.inbox ? <span className="badge num">{counts.inbox}</span> : null}
        </button>
      ))}
    </nav>
  );
}

/* ---------------------------------------------------------------- command palette (⌘K / ⌃K / pull-down) */
type Hit = { kind: string; icon: IconName; title: string; sub?: string; run: () => void };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { go } = useRoute();
  const { engine } = useSession();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const notes = useList('note'), mails = useList('mail'), events = useList('event'), goals = useList('goal'), persons = useList('person'), outlays = useList('outlay');
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const hits = useMemo<Hit[]>(() => {
    const t = q.trim().toLowerCase();
    const commands: Hit[] = [
      { kind: 'Kommando', icon: 'plus', title: 'Ny note', sub: '⌘N', run: () => go({ screen: 'notes', id: engine.create('note', { title: '', folder: 'Indbakke', tags: [], editedAt: new Date().toISOString() }) }) },
      { kind: 'Kommando', icon: 'receipt', title: 'Nyt udlæg', run: () => go({ screen: 'outlays', id: engine.create('outlay', { title: '', date: new Date().toISOString().slice(0, 10), people: [ME], items: [], countMine: true, createdAt: new Date().toISOString() }) }) },
      { kind: 'Kommando', icon: 'contacts', title: 'Ny kontakt', run: () => go({ screen: 'contacts', id: engine.create('person', { name: '', createdAt: new Date().toISOString() }) }) },
      { kind: 'Kommando', icon: 'wallet', title: 'Udgifter', run: () => go({ screen: 'expenses' }) },
      { kind: 'Kommando', icon: 'goals', title: 'Nyt mål', run: () => go({ screen: 'goals', id: engine.create('goal', { title: 'Nyt mål', kind: 'measure', unit: '', target: 10, area: 'Privat', order: 99 }) }) },
      { kind: 'Assist', icon: 'assist', title: q.trim() ? `Spørg Assist: ${q.trim()}` : 'Spørg Assist', run: () => { if (q.trim()) queueAssist(q.trim()); go({ screen: 'assist' }); } },
      { kind: 'Kommando', icon: 'settings', title: 'Skift tema', run: () => go({ screen: 'settings' }) },
      { kind: 'Kommando', icon: 'assist', title: 'Claude-forbrug', run: () => go({ screen: 'usage' }) },
      { kind: 'Kommando', icon: 'link', title: 'Forbind mail eller kalender', run: () => go({ screen: 'connections' }) },
    ];
    const content: Hit[] = [
      ...notes.map((n: any) => ({ kind: 'Note', icon: 'notes' as IconName, title: n.title || 'Uden titel', sub: n.folder, run: () => go({ screen: 'notes', id: n.id }), text: engine.doc(n.id).getText('body').toString() })),
      ...mails.map((m: any) => ({ kind: 'Mail', icon: 'inbox' as IconName, title: m.subject, sub: m.preview, run: () => go({ screen: 'inbox', id: m.id }) })),
      ...events.map((e: any) => ({ kind: 'Aftale', icon: 'calendar' as IconName, title: e.title, sub: `${e.repeat ? repeatLabel(e.repeat) : fmt.shortDate(e.start)} ${fmt.hm(e.start)}${e.place ? ' · ' + e.place : ''}`, run: () => go({ screen: 'calendar' }) })),
      ...persons.map((p: any) => ({ kind: 'Kontakt', icon: 'contacts' as IconName, title: p.name || 'Uden navn', sub: [p.relation, p.phone, p.email].filter(Boolean).join(' · '), run: () => go({ screen: 'contacts', id: p.id }), text: `${p.notes ?? ''} ${p.company ?? ''}` })),
      ...outlays.map((o: any) => ({ kind: 'Udlæg', icon: 'receipt' as IconName, title: o.title || 'Udlæg', sub: o.place, run: () => go({ screen: 'outlays', id: o.id }) })),
      ...goals.map((g: any) => ({ kind: 'Mål', icon: 'goals' as IconName, title: g.title, sub: g.area, run: () => go({ screen: 'goals', id: g.id }) })),
    ];
    if (!t) return [...commands, ...content.slice(0, 4)];
    const ask = commands.find((c) => c.kind === 'Assist')!;
    const found = [...commands.filter((c) => c !== ask), ...content].filter((h: any) => `${h.title} ${h.sub ?? ''} ${h.text ?? ''}`.toLowerCase().includes(t)).slice(0, 11);
    return [...found, ask];
  }, [q, notes, mails, events, goals, persons, outlays, engine, go]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { if (open) { setQ(''); setTimeout(() => input.current?.focus(), 0); } }, [open]);

  useGSAP(() => {
    if (!open || reduced()) return;
    gsap.timeline()
      .from('.scrim', { opacity: 0, duration: dur.quick })
      .from('.palette', { y: -12, scale: 0.98, opacity: 0, duration: dur.base, ease: ease.enter }, '<')
      .from('.palette li', { opacity: 0, y: 4, stagger: 0.015, duration: dur.quick }, '-=0.1');
  }, { dependencies: [open], scope: box });

  if (!open) return <div ref={box} />;
  const run = (h: Hit) => { onClose(); h.run(); };
  return (
    <div ref={box}>
      <div className="scrim" onClick={onClose} />
      <div className="palette" role="dialog" aria-label="Søg eller spørg">
        <div className="palette__field"><Icon name="search" />
          <input ref={input} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søg i noter, mails, kalender og mål, eller skriv en kommando"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === 'Enter' && hits[sel]) run(hits[sel]);
              if (e.key === 'Escape') onClose();
            }} />
          <span className="kbd">esc</span></div>
        <ul className="palette__list" role="listbox">
          {hits.map((h, i) => (
            <li key={h.kind + h.title + i} role="option" aria-selected={i === sel} className={i === sel ? 'is-active' : ''} onMouseEnter={() => setSel(i)} onClick={() => run(h)}>
              <Icon name={h.icon} /><span className="ellipsis"><span>{h.title}</span>{h.sub && <span className="meta"> · {h.sub}</span>}</span><span className="meta">{h.kind}</span>
            </li>
          ))}
          
        </ul>
      </div>
    </div>
  );
}
