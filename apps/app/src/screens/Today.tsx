import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Aura } from '../ui/Logo.tsx';
import { useEngine, useList, useNow, useRoute, useNarrow, fmt, greeting } from '../state.tsx';
import { Avatar, Btn, Panel, Pill } from '../ui/primitives.tsx';
import { Icon, type IconName } from '../ui/Icon.tsx';
import { DayStrip, Progress } from '../ui/DayStrip.tsx';
import { useScreenEnter, gsap, Flip, reduced } from '../motion.ts';
import { goalStats, type Goal, type GoalUpdate } from '../goals.ts';
import { SuggestionRows, queueAssist } from './Assist.tsx';
import { dayOccurrences, type CalEvent } from '../calendar.ts';
import { calTypes, eventColor } from '../calTypes.ts';
import { balances, kr, monthSpend, perMonth, personName, type Expense, debts } from '../money.ts';
import { checkItems, toggleCheck } from '../notes.ts';
import { sorted, setDone, whenLabel, overdue, addReminder, type Reminder } from '../reminders.ts';
import { arrange, saveLayout, resetLayout, move, SIZE_SPAN, SIZE_NAME, type Size } from '../home.ts';
import { useToast } from '../ui/Shell.tsx';
import DecryptedText from '../bits/DecryptedText.jsx';

/* ---------------------------------------------------------------- the modules
   A new module for the front page: write its component and add one line here. It shows up by
   itself on both devices (or under "Tilføj", when `on` is false). */
type Module = { id: string; name: string; desc: string; icon: IconName; size: Size; on: boolean; C: ComponentType };
const MODULES: Module[] = [
  { id: 'day', name: 'Din dag', desc: 'Dagens aftaler på en tidslinje', icon: 'today', size: 'full', on: true, C: DayModule },
  { id: 'next', name: 'Næste', desc: 'Den næste aftale, med noter og mails til den', icon: 'clock', size: 'small', on: true, C: NextModule },
  { id: 'inbox', name: 'Venter på dit svar', desc: 'Mails der venter på dig', icon: 'inbox', size: 'large', on: true, C: InboxModule },
  { id: 'assist', name: 'Spørg Assist', desc: 'Skriv til Assist herfra, og se dens forslag', icon: 'assist', size: 'large', on: true, C: AssistModule },
  { id: 'notes', name: 'Seneste noter', desc: 'De noter, du sidst har skrevet i', icon: 'notes', size: 'small', on: true, C: NotesModule },
  { id: 'reminders', name: 'Husk', desc: 'Din huskeliste: kryds af, når det er gjort', icon: 'bell', size: 'small', on: true, C: RemindersModule },
  { id: 'checklist', name: 'Tjekliste', desc: 'Kryds af direkte herfra, fx på indkøbslisten', icon: 'check', size: 'small', on: true, C: ChecklistModule },
  { id: 'money', name: 'Penge', desc: 'Hvem skylder hvad, og hvad der går ud denne måned', icon: 'wallet', size: 'full', on: true, C: MoneyModule },
  { id: 'goals', name: 'Mål', desc: 'Dine mål, og om du er på sporet', icon: 'goals', size: 'full', on: true, C: GoalsModule },
  { id: 'photos', name: 'Seneste billeder', desc: 'Det, du sidst har gemt under Billeder', icon: 'camera', size: 'full', on: false, C: PhotosModule },
];

export function Today({ firstOpen }: { firstOpen: boolean }) {
  const e = useEngine();
  const { go } = useRoute();
  const now = useNow();
  const toast = useToast();
  const narrow = useNarrow();
  const device = narrow ? 'phone' : 'desk';
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'today');
  const allEvents = useList('event') as unknown as CalEvent[];
  const mails = useList('mail') as any[];
  const dayAll = dayOccurrences(allEvents, now) as any[];
  const events = dayAll.filter((x) => !x.allDay);
  const allDay = dayAll.filter((x) => x.allDay);
  const next = events.find((x) => new Date(x.start) > now);
  const waiting = mails.filter((m) => m.needsReply && !m.archived).length;
  const finding = next
    ? `Næste: ${next.title} kl. ${fmt.hm(next.start)}.`
    : waiting ? `Dagens aftaler er overstået. ${waiting} ${waiting === 1 ? 'mail venter' : 'mails venter'} på dit svar.` : 'Dagens aftaler er overstået, og indbakken er tom.';
  const hello = `${greeting(now)}, Willads`;

  // The arrangement: from the saved layout while looking, a working copy while arranging.
  useList('setting');
  const saved = arrange(e, device, MODULES);
  const [editing, setEditing] = useState<typeof saved | null>(null);
  const items = editing ?? saved;
  const shown = items.filter((x) => !x.hidden);
  const hidden = items.filter((x) => x.hidden);
  const flip = useRef<ReturnType<typeof Flip.getState> | null>(null);
  const change = (next: typeof saved) => {
    if (!reduced()) flip.current = Flip.getState(ref.current!.querySelectorAll('.hw:not(.is-dragging)'));
    setEditing(next);
  };
  useLayoutEffect(() => {
    follow();
    if (!flip.current) return;
    Flip.from(flip.current, { duration: 0.32, ease: 'power3.out', absolute: false, targets: ref.current!.querySelectorAll('.hw:not(.is-dragging)') });
    flip.current = null;
  }, [editing]);
  const done = () => { if (editing) saveLayout(e, device, editing); setEditing(null); };

  // Dragging a module (Mac and iPhone, only while arranging): it follows the pointer, the others move aside.
  const drag = useRef<{ id: string; el: HTMLElement; gx: number; gy: number; tx: number; ty: number; raf: number; px: number; py: number } | null>(null);
  /** Keeps the dragged module under the pointer (also right after the others moved and its place in the page changed). */
  const follow = () => {
    const d = drag.current; if (!d) return;
    const r = d.el.getBoundingClientRect();
    const baseX = r.left - d.tx, baseY = r.top - d.ty;
    d.tx = d.px - d.gx - baseX; d.ty = d.py - d.gy - baseY;
    gsap.set(d.el, { x: narrow ? 0 : d.tx, y: d.ty });
  };
  const grab = (id: string) => (ev: React.PointerEvent) => {
    const el = (ev.currentTarget as HTMLElement).closest<HTMLElement>('.hw');
    if (!el || !editing) return;
    ev.preventDefault();
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    const r = el.getBoundingClientRect();
    drag.current = { id, el, gx: ev.clientX - r.left, gy: ev.clientY - r.top, tx: 0, ty: 0, raf: 0, px: ev.clientX, py: ev.clientY };
    el.classList.add('is-dragging');
    gsap.to(el, { scale: 1.02, duration: 0.18, ease: 'power2.out' });
    const scroll = () => {
      const d = drag.current; if (!d) return;
      const edge = 90, v = d.py < edge ? -(edge - d.py) / 6 : d.py > innerHeight - edge - 70 ? (d.py - (innerHeight - edge - 70)) / 6 : 0;
      if (v) { scrollBy(0, v); follow(); }
      d.raf = requestAnimationFrame(scroll);
    };
    drag.current.raf = requestAnimationFrame(scroll);
  };
  const dragMove = (ev: React.PointerEvent) => {
    const d = drag.current; if (!d || !editing) return;
    d.px = ev.clientX; d.py = ev.clientY;
    follow();
    // Where it would go: after every module whose place (without the slide animations) comes before
    // the pointer in reading order. Centres, not edges, so it doesn't flip back and forth.
    const others = [...ref.current!.querySelectorAll<HTMLElement>('.hw:not(.is-dragging)')];
    const before = others.filter((x) => {
      const b = x.getBoundingClientRect();
      const top = b.top - Number(gsap.getProperty(x, 'y')), left = b.left - Number(gsap.getProperty(x, 'x'));
      return narrow ? top + b.height / 2 < ev.clientY : ev.clientY > top + b.height || (ev.clientY >= top && ev.clientX > left + b.width / 2);
    }).length;
    const ids = others.map((x) => x.dataset.id!);
    ids.splice(before, 0, d.id);
    if (ids.join() === shown.map((x) => x.id).join()) return;
    change([...ids.map((id) => editing.find((x) => x.id === id)!), ...editing.filter((x) => x.hidden)]);
  };
  const drop = () => {
    const d = drag.current; if (!d) return;
    cancelAnimationFrame(d.raf);
    drag.current = null;
    gsap.to(d.el, { x: 0, y: 0, scale: 1, duration: 0.3, ease: 'power3.out', clearProps: 'transform', onComplete: () => d.el.classList.remove('is-dragging') });
  };

  return (
    <main className={`canvas canvas--today ${editing ? 'is-arranging' : ''}`} ref={ref}>
      <Aura className="aura--today" />
      <div className="titlerow" data-enter>
        <div>
          <h1>{firstOpen ? <DecryptedText text={hello} animateOn="view" sequential revealDirection="start" speed={28} maxIterations={8} characters="ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ" encryptedClassName="encrypted" /> : hello}</h1>
          <p>{fmt.dayLabel(now)}. {allDay.length ? allDay.map((x) => x.title).join(', ') + '. ' : ''}{finding}</p>
        </div>
        <div className="actions">
          {editing ? (<>
            <Btn variant="text" onClick={() => { resetLayout(e, device); setEditing(null); toast({ text: 'Forsiden er som fra start' }); }}>Nulstil</Btn>
            <Btn variant="primary" icon="check" onClick={done}>Færdig</Btn>
          </>) : (<>
            {!narrow && <Btn icon="plus" kbd="⌘N" onClick={() => go({ screen: 'notes', id: e.create('note', { title: '', folder: 'Indbakke', tags: [], editedAt: new Date().toISOString(), createdAt: new Date().toISOString() }) })}>Ny note</Btn>}
            <Btn icon="edit" onClick={() => setEditing(saved)}>Tilpas</Btn>
          </>)}
        </div>
      </div>

      <div className="grid12" onPointerMove={dragMove} onPointerUp={drop} onPointerCancel={drop}>
        {shown.map((it, i) => {
          const m = MODULES.find((x) => x.id === it.id)!;
          return (
            <div key={it.id} data-id={it.id} className={`hw ${narrow ? 'span-12' : SIZE_SPAN[it.size]} ${editing ? 'is-editing' : ''}`}>
              <m.C />
              {editing && (
                <div className="hw__tools">
                  <button className="hw__grip" onPointerDown={grab(it.id)} aria-label={`Flyt ${m.name}`} title="Træk for at flytte"><Icon name="menu" size="sm" /></button>
                  <span className="hw__name">{m.name}</span>
                  {!narrow && <div className="hw__sizes" role="radiogroup" aria-label="Størrelse">{(['small', 'large', 'full'] as Size[]).map((sz) => <button key={sz} role="radio" aria-checked={it.size === sz} className={it.size === sz ? 'is-on' : ''} onClick={() => change(editing.map((x) => (x.id === it.id ? { ...x, size: sz } : x)))}>{SIZE_NAME[sz]}</button>)}</div>}
                  <button className="hw__btn" aria-label="Flyt op" disabled={i === 0} onClick={() => change(move(editing, it.id, -1))}><span className="rot-90"><Icon name="chevron-left" size="sm" /></span></button>
                  <button className="hw__btn" aria-label="Flyt ned" disabled={i === shown.length - 1} onClick={() => change(move(editing, it.id, 1))}><span className="rot-270"><Icon name="chevron-left" size="sm" /></span></button>
                  <button className="hw__btn hw__hide" aria-label={`Skjul ${m.name}`} onClick={() => change(editing.map((x) => (x.id === it.id ? { ...x, hidden: true } : x)))}><Icon name="x" size="sm" /></button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editing && (
        <section className="hw__add" data-enter>
          <h2>Tilføj</h2>
          {hidden.length ? (
            <div className="hw__addlist">
              {hidden.map((it) => {
                const m = MODULES.find((x) => x.id === it.id)!;
                return (
                  <button key={it.id} className="hw__addrow" onClick={() => change([...editing.filter((x) => x.id !== it.id && !x.hidden), { ...it, hidden: false }, ...editing.filter((x) => x.id !== it.id && x.hidden)])}>
                    <span className="hw__addic"><Icon name={m.icon} size="sm" /></span>
                    <span className="hw__addt"><b>{m.name}</b><span className="meta">{m.desc}</span></span>
                    <span className="hw__plus"><Icon name="plus" size="sm" /></span>
                  </button>
                );
              })}
            </div>
          ) : <p className="meta">Alle moduler er på forsiden.</p>}
        </section>
      )}
    </main>
  );
}

/* ---------------------------------------------------------------- module: the day */
function DayModule() {
  const e = useEngine();
  const { go } = useRoute();
  const now = useNow();
  const allEvents = useList('event') as unknown as CalEvent[];
  const events = (dayOccurrences(allEvents, now) as any[]).filter((x) => !x.allDay);
  const typeList = useList('calcat');
  const types = useMemo(() => calTypes(e), [e, typeList]);
  const next = events.find((x) => new Date(x.start) > now);
  const focusMins = events.filter((x) => x.focus).reduce((s, x) => s + (new Date(x.end).getTime() - new Date(x.start).getTime()) / 60000, 0);
  return (
    <Panel title="Din dag" count={`${events.length} aftaler${focusMins ? ' · ' + fmt.dur(focusMins) + ' fokustid' : ''}`} link="Åbn kalender" onLink={() => go({ screen: 'calendar' })}>
      <DayStrip events={events.map((x) => ({ ...x, color: eventColor(types, x as any) }))} now={now} nextId={next?.id} />
    </Panel>
  );
}

/* ---------------------------------------------------------------- module: next */
function NextModule() {
  const e = useEngine();
  const { go } = useRoute();
  const now = useNow();
  const allEvents = useList('event') as unknown as CalEvent[];
  const events = (dayOccurrences(allEvents, now) as any[]).filter((x) => !x.allDay);
  const next = events.find((x) => new Date(x.start) > now);
  const minsToNext = next ? Math.round((new Date(next.start).getTime() - now.getTime()) / 60000) : 0;
  return (
    <section className="panel focuscard" data-enter aria-labelledby="h-next">
      <div className="panel__head"><h2 id="h-next" className="panel__title">Næste</h2>{next && <Pill tone="focus">om {fmt.dur(minsToNext)}</Pill>}</div>
      {next ? (
        <>
          <div className="nextname">{next.title}</div>
          <div className="muted num">{fmt.hm(next.start)}–{fmt.hm(next.end)}{next.place ? ' · ' + next.place : ''}{next.with ? ' · ' + next.with : ''}</div>
          <ul className="rows linked">
            {next.notesPreview && <li><button className="row" onClick={() => go({ screen: 'calendar' })}><Icon name="notes" /><span className="row__body ellipsis">{next.notesPreview}</span></button></li>}
            {next.note && <li><button className="row" onClick={() => go({ screen: 'notes', id: next.note })}><Icon name="notes" /><span className="row__body ellipsis">{e.get(next.note)?.title as string}</span></button></li>}
            {next.mail && <li><button className="row" onClick={() => go({ screen: 'inbox', id: next.mail })}><Icon name="inbox" /><span className="row__body ellipsis">{(e.get(next.mail) as any)?.subject}</span></button></li>}
          </ul>
          {next.link && <a className="btn btn--primary" href={next.link} target="_blank" rel="noreferrer"><Icon name="video" />Deltag</a>}
        </>
      ) : (
        <p className="muted">Ingen flere aftaler i dag. I morgen starter med {events.length ? 'dine faste rutiner' : 'en tom kalender'}.</p>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- module: mail waiting for you */
function InboxModule() {
  const { go } = useRoute();
  const now = useNow();
  const people = Object.fromEntries(useList('person').map((p: any) => [p.id, p]));
  const mails = useList('mail', (a, b) => b.at.localeCompare(a.at)) as any[];
  const needsReply = mails.filter((m) => m.needsReply && !m.archived);
  return (
    <Panel title="Venter på dit svar" count={needsReply.length} link="Åbn indbakke" onLink={() => go({ screen: 'inbox' })}>
      {needsReply.length ? (
        <ul className="rows">
          {needsReply.slice(0, 3).map((m) => {
            const p = people[m.from] ?? { name: m.fromName || m.from, initials: '?', hue: 150 };
            return (
              <li key={m.id}>
                <button className="row" onClick={() => go({ screen: 'inbox', id: m.id })}>
                  <Avatar initials={p.initials} hue={p.hue} />
                  <span className="row__body">
                    <span className="row__line"><span className="strong ellipsis">{p.name}</span><span className="meta num row__trail">{fmt.ago(m.at, now)}</span></span>
                    <span className="row__line"><span className="ellipsis">{m.subject}</span></span>
                    <span className="row__line meta"><span>{m.acctName ?? m.acct}</span>{m.draft && <Pill tone="calm" icon="assist">Udkast klar</Pill>}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : <p className="muted">{mails.length ? 'Ingen mails venter på svar.' : 'Ingen mail endnu.'}</p>}
    </Panel>
  );
}

/* ---------------------------------------------------------------- module: Assist */
function AssistModule() {
  const { go } = useRoute();
  const sugg = useList('suggestion').filter((s: any) => s.status === 'pending');
  return (
    <Panel title="Spørg Assist" link="Åbn Assist" onLink={() => go({ screen: 'assist' })}>
      <AskBar />
      {sugg.length > 0 && <div className="pad-top"><SuggestionRows limit={3} /></div>}
    </Panel>
  );
}

/* ---------------------------------------------------------------- module: recent notes */
function NotesModule() {
  const { go } = useRoute();
  const now = useNow();
  const notes = useList('note', (a, b) => (b.editedAt ?? '').localeCompare(a.editedAt ?? '')) as any[];
  return (
    <Panel title="Seneste noter" link="Alle noter" onLink={() => go({ screen: 'notes' })}>
      {!notes.length && <p className="muted">Ingen noter endnu.</p>}
      <ul className="rows">
        {notes.slice(0, 4).map((n) => (
          <li key={n.id}>
            <button className="row" onClick={() => go({ screen: 'notes', id: n.id })}>
              <Icon name={n.auto ? 'calendar' : 'notes'} />
              <span className="row__body">
                <span className="row__line"><span className="strong ellipsis">{n.title || 'Uden titel'}</span><span className="meta num row__trail">{n.editedAt ? fmt.clock(n.editedAt, now) : ''}</span></span>
                <span className="row__line meta"><span className="ellipsis">{n.folder}{n.auto ? ' · oprettet til et møde' : ''}</span></span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ---------------------------------------------------------------- module: the huskeliste */
function RemindersModule() {
  const e = useEngine();
  const { go } = useRoute();
  const now = useNow();
  const toast = useToast();
  const list = sorted(useList('reminder') as unknown as Reminder[]);
  const open = list.filter((r) => !r.done);
  const [text, setText] = useState('');
  const late = open.filter((r) => overdue(r, now)).length;
  return (
    <Panel title="Husk" count={open.length ? (late ? `${late} nu` : String(open.length)) : undefined} link="Huskeliste" onLink={() => go({ screen: 'reminders' })}>
      <ul className="hl hl--mini">
        {open.slice(0, 6).map((r) => (
          <li key={r.id} className={`hl__row ${overdue(r, now) ? 'is-late' : ''}`}>
            <button className="hl__check" onClick={() => { setDone(e, r.id, true); toast({ text: `Klaret: ${r.text}`, action: { label: 'Fortryd', run: () => setDone(e, r.id, false) } }); }} aria-label={`Klaret: ${r.text}`}><Icon name="check" size="sm" /></button>
            <button className="hl__body" onClick={() => go({ screen: 'reminders' })}>
              <span className="hl__text">{r.text}</span>
              {r.at && <span className="hl__at"><Icon name="bell" size="sm" />{whenLabel(r.at, now)}</span>}
            </button>
          </li>
        ))}
      </ul>
      {open.length > 6 && <button className="tag" onClick={() => go({ screen: 'reminders' })}>{open.length - 6} mere</button>}
      {!open.length && <p className="muted">Intet at huske.</p>}
      <form className="hl__quick" onSubmit={(x) => { x.preventDefault(); if (text.trim()) { addReminder(e, text); setText(''); } }}>
        <input value={text} onChange={(x) => setText(x.target.value)} placeholder="Tilføj …" aria-label="Tilføj til huskelisten" enterKeyHint="done" />
      </form>
    </Panel>
  );
}

/* ---------------------------------------------------------------- module: a checklist to tick off */
function ChecklistModule() {
  const e = useEngine();
  const { go } = useRoute();
  const notes = useList('note', (a, b) => (b.editedAt ?? '').localeCompare(a.editedAt ?? '')) as any[];
  const [, bump] = useState(0);
  const lists = notes.filter((n) => checkItems(e.doc(n.id).getText('body').toString()).length);
  const pick = (e.get('setting-home-checklist') as any)?.note as string | undefined;
  const note = lists.find((n) => n.id === pick) ?? lists[0];
  const text = note ? e.doc(note.id).getText('body') : null;
  // Ticks from another device (or the note itself) show up here at once.
  useEffect(() => {
    if (!text) return;
    const on = () => bump((x) => x + 1);
    text.observe(on);
    return () => text.unobserve(on);
  }, [text]);
  const items = text ? checkItems(text.toString()) : [];
  const open = items.filter((x) => !x.done);
  return (
    <Panel title="Tjekliste" count={items.length ? `${items.length - open.length} af ${items.length}` : undefined} link={note ? 'Åbn' : undefined} onLink={() => note && go({ screen: 'notes', id: note.id })}
      aside={lists.length > 1 ? <select className="mselect hw__pick" value={note?.id} onChange={(x) => e.set('setting', 'setting-home-checklist', { note: x.target.value })} aria-label="Vælg tjekliste">{lists.map((n) => <option key={n.id} value={n.id}>{n.title || 'Uden titel'}</option>)}</select> : undefined}>
      {!note ? <p className="muted">Ingen tjeklister endnu.</p> : (
        <>
          {note && lists.length === 1 && <p className="meta">{note.title || 'Uden titel'}</p>}
          <ul className="hcheck">
            {items.slice(0, 10).map((it) => (
              <li key={it.at}>
                <button className={`hcheck__row ${it.done ? 'is-done' : ''}`} onClick={() => { toggleCheck(text!, it.at); e.set('note', note.id, { editedAt: new Date().toISOString() }); }} aria-pressed={it.done}>
                  <span className={`cm-check ${it.done ? 'is-on' : ''}`} aria-hidden="true" /><span>{it.text || '…'}</span>
                </button>
              </li>
            ))}
          </ul>
          {items.length > 10 && <button className="tag" onClick={() => go({ screen: 'notes', id: note.id })}>{items.length - 10} mere</button>}
          {!open.length && <p className="meta">Alt er krydset af.</p>}
        </>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------- module: goals */
function GoalsModule() {
  const { go } = useRoute();
  const now = useNow();
  const goals = useList<Goal>('goal', (a, b) => (a.order ?? 0) - (b.order ?? 0)) as unknown as Goal[];
  const updates = useList<GoalUpdate>('goalUpdate') as unknown as GoalUpdate[];
  const stats = useMemo(() => goals.map((g) => ({ g, s: goalStats(g, updates, now) })), [goals, updates, now]);
  const onTrack = stats.filter((x) => x.s.onTrack).length;
  return (
    <Panel title="Mål" count={`${onTrack} af ${goals.length} på sporet`} link="Alle mål" onLink={() => go({ screen: 'goals' })}>
      {!goals.length && <p className="muted">Ingen mål endnu.</p>}
      <ul className="rows">
        {stats.map(({ g, s }) => (
          <li key={g.id}>
            <button className="goalrow" onClick={() => go({ screen: 'goals', id: g.id })}>
              <span className="row__body"><span className="strong ellipsis">{g.title || 'Uden navn'}</span><span className="meta">{g.area} · {g.kind === 'habit' ? 'vane' : 'frist ' + s.due}</span></span>
              <span className="goalrow__bar"><Progress ratio={s.ratio} focus={!s.onTrack} small /><span className="meta num">{s.label}</span></span>
              <span className={`status ${s.onTrack ? '' : 'is-due'}`}>{s.onTrack ? 'På sporet' : 'Kræver handling'}</span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ---------------------------------------------------------------- module: recent photos */
function PhotosModule() {
  const { go } = useRoute();
  const photos = useList('photo', (a, b) => (b.at ?? '').localeCompare(a.at ?? '')) as any[];
  return (
    <Panel title="Seneste billeder" count={photos.length} link="Alle billeder" onLink={() => go({ screen: 'photos' })}>
      {!photos.length ? <p className="muted">Ingen billeder endnu.</p> : (
        <div className="hphotos">{photos.slice(0, 6).map((p) => <button key={p.id} onClick={() => go({ screen: 'photos', id: p.id })} title={p.title}><img src={p.thumb || p.image} alt={p.title} loading="lazy" /></button>)}</div>
      )}
    </Panel>
  );
}

/** Money module (see MoneyPanel). */
function MoneyModule() { return <MoneyPanel />; }

/** One line to Assist from the start page; the conversation continues on the Assist screen. */
function AskBar() {
  const { go } = useRoute();
  const memory = useList('memory');
  const [t, setT] = useState('');
  return (
    <>
      <form className="askbar pad-top" onSubmit={(ev) => { ev.preventDefault(); if (!t.trim()) return; queueAssist(t.trim()); go({ screen: 'assist' }); }}>
        <input value={t} onChange={(ev) => setT(ev.target.value)} placeholder="Spørg eller bed om noget …" aria-label="Skriv til Assist" />
        <Btn type="submit" variant="primary" icon="send" aria-label="Send" disabled={!t.trim()} />
      </form>
    </>
  );
}

/** Money at a glance: who owes you, and what goes out this month. */
function MoneyPanel() {
  const e = useEngine();
  const { go } = useRoute();
  useList('outlay'); useList('payment'); useList('person');
  const xs = useList('expense') as unknown as Expense[];
  const owing = balances(e).filter((b) => b.left > 0);
  const iOweList = debts(e).filter((b) => b.left > 0);
  const now = new Date();
  const spend = monthSpend(e, now.getFullYear(), now.getMonth());
  const upcoming = spend.filter((x) => new Date(x.date + 'T12:00') >= new Date(now.getFullYear(), now.getMonth(), now.getDate()) && x.source === 'expense').slice(0, 3);
  return (
    <Panel title="Penge" link="Udgifter" onLink={() => go({ screen: 'expenses' })}>
      <div className="moneyrow">
        <button className="kpi kpi--btn" onClick={() => go({ screen: 'outlays' })}><span className="meta">Folk skylder dig</span><b className="num">{kr(owing.reduce((s, b) => s + b.left, 0), { short: true })}</b><span className="meta ellipsis">{owing.slice(0, 3).map((b) => personName(e, b.person).split(' ')[0]).join(', ') || 'Ingen'}{iOweList.length ? ` · du skylder ${kr(iOweList.reduce((s, b) => s + b.left, 0), { short: true })}` : ''}</span></button>
        <button className="kpi kpi--btn" onClick={() => go({ screen: 'expenses' })}><span className="meta">Udgifter denne måned</span><b className="num">{kr(spend.reduce((s, x) => s + x.amount, 0), { short: true })}</b><span className="meta">{kr(xs.reduce((s, x) => s + perMonth(x), 0), { short: true })} faste pr. måned</span></button>
        <div className="kpi"><span className="meta">Kommer snart</span>{upcoming.length ? upcoming.map((u) => <span key={u.ref + u.date} className="row__line small"><span className="ellipsis">{u.name}</span><span className="num row__trail">{fmt.shortDate(u.date)} · {kr(u.amount, { short: true })}</span></span>) : <span className="meta">Intet resten af måneden</span>}</div>
      </div>
    </Panel>
  );
}
