import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon.tsx';
import { Wordmark } from './primitives.tsx';
import { useEngine, useList, useRoute, useSession, useSyncStatus, fmt, type Route } from '../state.tsx';
import { balances, debts, kr, ME } from '../money.ts';
import { gsap, useGSAP, reduced, ease, dur, useNavPill } from '../motion.ts';
import { Logo } from './Logo.tsx';
import { lock } from '../lock.ts';
import { queueAssist } from '../screens/Assist.tsx';
import { repeatLabel, occurrences } from '../calendar.ts';

/* ---------------------------------------------------------------- notifications (see Notifications.tsx) */
export { useToast, NotificationHost as ToastHost } from './Notifications.tsx';

/* ---------------------------------------------------------------- navigation */
/**
 * Everything in CENTRA, in categories. The Mac's sidebar and the iPhone's menu are both drawn from
 * this list, so a new part (or a whole new category, like a bigger Økonomi) goes in one place.
 * Assist stays outside the menu: one tap away on both.
 */
type NavItem = [Route['screen'], IconName, string];
export const SECTIONS: { title: string; items: NavItem[] }[] = [
  { title: 'Overblik', items: [['today', 'today', 'I dag'], ['calendar', 'calendar', 'Kalender'], ['reminders', 'bell', 'Huskeliste']] },
  { title: 'Kommunikation', items: [['inbox', 'inbox', 'Indbakke'], ['contacts', 'contacts', 'Kontakter']] },
  { title: 'Noter og mål', items: [['notes', 'notes', 'Noter'], ['goals', 'goals', 'Mål'], ['photos', 'camera', 'Billeder']] },
  { title: 'Økonomi', items: [['outlays', 'receipt', 'Udlæg'], ['expenses', 'wallet', 'Udgifter'], ['usage', 'hash', 'Claude-forbrug']] },
  { title: 'System', items: [['connections', 'link', 'Forbindelser'], ['settings', 'settings', 'Indstillinger']] },
];
const ALL: NavItem[] = [...SECTIONS.flatMap((x) => x.items), ['assist', 'assist', 'Assist']];
export const screenName = (k: Route['screen']) => ALL.find((x) => x[0] === k)?.[2] ?? 'CENTRA';

function useCounts() {
  const mails = useList('mail');
  const sugg = useList('suggestion');
  const goals = useList('goal');
  useList('outlay'); useList('payment');
  const e = useEngine();
  const owing = balances(e).filter((b) => b.left > 0).length + debts(e).filter((b) => b.left > 0).length;
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
        {[{ title: '', items: [['assist', 'assist', 'Assist'] as NavItem] }, ...SECTIONS.filter((x) => x.title !== 'System')].map((sec) => (
          <div key={sec.title || 'assist'} className="nav-sec">
            {sec.title && <div className="nav-group">{sec.title}</div>}
            {sec.items.map(([k, i, l]) => (
              <button key={k} className={`nav-item ${route.screen === k ? 'is-active' : ''}`} aria-current={route.screen === k ? 'page' : undefined} onClick={() => go({ screen: k })}>
                <Icon name={i} /><span>{l}</span>
                {counts[k] ? <span className={`count num ${k === 'inbox' ? 'is-due' : ''}`}>{counts[k]}</span> : null}
              </button>
            ))}
          </div>
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

/**
 * The iPhone's bar: Menu (with where you are) and Assist. The menu is a sheet with every part of
 * CENTRA in its category; it comes up from the bottom and follows your finger back down.
 */
export function TabBar({ onSearch }: { onSearch: () => void }) {
  const { route, go } = useRoute();
  const counts = useCounts();
  const [open, setOpen] = useState(false);
  const total = counts.inbox + counts.outlays;
  useEffect(() => setOpen(false), [route.screen, route.id]);
  return (
    <>
      <nav className="mbar" aria-label="Navigation">
        <button className="mbar__menu" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
          <Icon name="menu" size="tab" />
          <span className="mbar__where">{screenName(route.screen)}</span>
          {total > 0 && <span className="badge num">{total}</span>}
        </button>
        <button className={`mbar__assist ${route.screen === 'assist' ? 'is-active' : ''}`} onClick={() => go({ screen: 'assist' })} aria-label="Assist">
          <Icon name="assist" size="tab" />
          {counts.assist ? <span className="badge num">{counts.assist}</span> : null}
        </button>
      </nav>
      {open && <MenuSheet counts={counts} onClose={() => setOpen(false)} onSearch={onSearch} />}
    </>
  );
}

/** Each category's colour in the menu (from the brand's light: amber, flare, rose, violet). */
const TONE: Record<string, string> = { Overblik: 'amber', Kommunikation: 'violet', 'Noter og mål': 'amber', Økonomi: 'rose', System: 'mist' };

/**
 * The iPhone's menu: you and the search at the top, today and the calendar as two cards, then every
 * other part of CENTRA in its category, each with a line of what's going on there.
 */
function MenuSheet({ counts, onClose, onSearch }: { counts: Record<string, number>; onClose: () => void; onSearch: () => void }) {
  const { route, go } = useRoute();
  const { user } = useSession();
  const e = useEngine();
  const now = new Date();
  const events = useList('event') as any[];
  const reminderList = useList('reminder');
  const notes = useList('note'), persons = useList('person'), photos = useList('photo'), goals = useList('goal'), accts = useList('mailacct'), costs = useList('expense');
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  const today = occurrences(events, day0, new Date(day0.getTime() + 86400000));
  const next = today.find((x) => new Date(x.end) > now);
  const owed = balances(e).reduce((a, b) => a + Math.max(0, b.left), 0), owe = debts(e).reduce((a, b) => a + Math.max(0, b.left), 0);
  const info: Partial<Record<Route['screen'], string>> = {
    inbox: counts.inbox ? `${counts.inbox} venter på svar` : 'Intet venter',
    contacts: `${persons.length} ${persons.length === 1 ? 'kontakt' : 'kontakter'}`,
    notes: `${notes.length} ${notes.length === 1 ? 'note' : 'noter'}`,
    goals: goals.length ? `${goals.length} ${goals.length === 1 ? 'mål' : 'mål'}` : 'Ingen endnu',
    photos: `${photos.length} ${photos.length === 1 ? 'billede' : 'billeder'}`,
    outlays: owed || owe ? [owed && `Til gode ${kr(owed, { short: true })}`, owe && `skylder ${kr(owe, { short: true })}`].filter(Boolean).join(' · ') : 'Alt er gjort op',
    expenses: costs.length ? `${costs.length} faste udgifter` : 'Ingen endnu',
    reminders: (() => { const open = (reminderList as any[]).filter((r) => !r.done); const late = open.filter((r) => r.at && new Date(r.at) <= now).length; return open.length ? `${open.length} at huske${late ? ` · ${late} nu` : ''}` : 'Intet at huske'; })(),
    connections: accts.length ? `${accts.length} ${accts.length === 1 ? 'konto' : 'konti'}` : 'Mail og kalender',
  };

  const box = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const close = (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    const done = () => { onClose(); then?.(); };
    if (reduced()) return done();
    gsap.timeline({ onComplete: done })
      .to(sheet.current, { yPercent: 100, duration: 0.26, ease: 'power3.in' })
      .to(box.current!.querySelector('.scrim'), { opacity: 0, duration: 0.22 }, '<');
  };
  const open = (k: Route['screen']) => { go({ screen: k }); close(); };
  useGSAP(() => {
    if (reduced()) return;
    gsap.timeline()
      .from('.scrim', { opacity: 0, duration: 0.22 })
      .from(sheet.current, { yPercent: 100, duration: 0.5, ease: 'expo.out' }, '<')
      .from('.mmenu [data-in]', { y: 16, opacity: 0, duration: 0.42, ease: 'power3.out', stagger: 0.035, clearProps: 'transform,opacity' }, 0.06);
  }, { scope: box });
  useEffect(() => {
    const k = (ev: KeyboardEvent) => ev.key === 'Escape' && close();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Drag the sheet down to close it: it follows the finger; let go past a quarter, or flick.
  const drag = useRef<{ y: number; t: number } | null>(null);
  const onStart = (ev: React.TouchEvent) => { if ((sheet.current?.scrollTop ?? 0) <= 0) drag.current = { y: ev.touches[0].clientY, t: performance.now() }; };
  const onMove = (ev: React.TouchEvent) => { const d = drag.current; if (d) gsap.set(sheet.current, { y: Math.max(0, ev.touches[0].clientY - d.y) }); };
  const onEnd = (ev: React.TouchEvent) => {
    const d = drag.current; drag.current = null; if (!d) return;
    const dy = ev.changedTouches[0].clientY - d.y, v = dy / Math.max(1, performance.now() - d.t);
    if (dy > (sheet.current?.offsetHeight ?? 400) / 4 || v > 0.5) close();
    else gsap.to(sheet.current, { y: 0, duration: 0.45, ease: 'back.out(1.3)' });
  };
  const name = user.charAt(0).toUpperCase() + user.slice(1);
  return (
    <div ref={box}>
      <div className="scrim" onClick={() => close()} />
      <div className="mmenu" ref={sheet} role="dialog" aria-label="Menu" onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}>
        <div className="mmenu__grab" aria-hidden="true" />
        <div className="mmenu__me" data-in>
          <span className="mmenu__avatar" aria-hidden="true">{user.slice(0, 1).toUpperCase()}</span>
          <div className="mmenu__who"><b>{name}</b><SyncLine /></div>
          <button className="mmenu__lock" onClick={() => lock()} aria-label="Lås CENTRA">Lås</button>
        </div>
        <button className="mmenu__search" data-in onClick={() => close(onSearch)}><Icon name="search" size="sm" /><span>Søg i alt, eller spørg</span></button>
        <div className="mmenu__cards" data-in>
          <button className={`mcard mcard--today ${route.screen === 'today' ? 'is-active' : ''}`} onClick={() => open('today')}>
            <span className="mcard__ic"><Icon name="today" /></span>
            <span className="mcard__k">I dag</span>
            <span className="mcard__v">{now.toLocaleDateString('da-DK', { weekday: 'long' }).replace(/^./, (c) => c.toUpperCase())} {now.getDate()}.</span>
          </button>
          <button className={`mcard mcard--cal ${route.screen === 'calendar' ? 'is-active' : ''}`} onClick={() => open('calendar')}>
            <span className="mcard__ic"><Icon name="calendar" /></span>
            <span className="mcard__k">Kalender</span>
            <span className="mcard__v">{next ? `${fmt.hm(next.start)} ${next.title}` : today.length ? 'Dagen er overstået' : 'Ingen aftaler i dag'}</span>
          </button>
        </div>
        {SECTIONS.map((sec) => ({ ...sec, items: sec.items.filter(([k]) => k !== 'today' && k !== 'calendar') })).filter((sec) => sec.items.length).map((sec) => (
          <section key={sec.title} className={`mgroup mgroup--${TONE[sec.title] ?? 'mist'}`} data-in>
            {sec.title !== 'Overblik' && <h2>{sec.title}</h2>}
            <div className="mgroup__list">
              {sec.items.map(([k, i, l]) => (
                <button key={k} className={`mrow2 ${route.screen === k ? 'is-active' : ''}`} onClick={() => open(k)} aria-current={route.screen === k ? 'page' : undefined}>
                  <span className="mrow2__ic"><Icon name={i} size="sm" /></span>
                  <span className="mrow2__t"><span>{l}</span>{info[k] && <span className="mrow2__s">{info[k]}</span>}</span>
                  {k === 'inbox' && counts.inbox ? <span className="mrow2__badge num">{counts.inbox}</span> : null}
                  <span className="mrow2__go" aria-hidden="true"><Icon name="chevron-right" size="sm" /></span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- command palette (⌘K / ⌃K / the search button) */
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
    if (!open) return []; // closed: nothing to search (it would read every note on every change)
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
  }, [open, q, notes, mails, events, goals, persons, outlays, engine, go]);

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
