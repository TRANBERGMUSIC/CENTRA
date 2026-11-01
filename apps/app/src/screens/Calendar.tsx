import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { occurrences, type CalEvent } from '../calendar.ts';
import { Btn, vars } from '../ui/primitives.tsx';
import { useEngine, useList, useNow, useNarrow, fmt } from '../state.tsx';
import { useScreenEnter, slideIn, gsap, reduced } from '../motion.ts';
import { Icon } from '../ui/Icon.tsx';
import { EventEditor } from '../ui/EventEditor.tsx';
import { calTypes, eventColor, type CalType } from '../calTypes.ts';

type Open = null | { event?: CalEvent; occurrence?: CalEvent; start?: Date };
const DAY = 86400000;
const startOf = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mondayOf = (d: Date) => addDays(startOf(d), -((d.getDay() + 6) % 7));
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const isAllDay = (x: CalEvent) => !!(x as { allDay?: boolean }).allDay;

/**
 * Side by side when events overlap: each event gets a lane and the number of lanes in its group,
 * so two meetings at 10.00 sit next to each other instead of on top of each other.
 */
export function lanes(evs: CalEvent[]): Map<string, { lane: number; of: number }> {
  const out = new Map<string, { lane: number; of: number }>();
  const sorted = [...evs].sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
  let group: CalEvent[] = [], ends: number[] = [], groupEnd = 0;
  const close = () => { for (const e of group) out.get(e.id)!.of = ends.length; group = []; ends = []; };
  for (const e of sorted) {
    const s = new Date(e.start).getTime(), en = Math.max(new Date(e.end).getTime(), s + 15 * 60000);
    if (group.length && s >= groupEnd) close();
    let lane = ends.findIndex((t) => t <= s);
    if (lane < 0) { lane = ends.length; ends.push(en); } else ends[lane] = en;
    out.set(e.id, { lane, of: 1 });
    group.push(e);
    groupEnd = Math.max(groupEnd, en);
  }
  close();
  return out;
}

/** The calendar: a week on the Mac, a day with the week above it on the iPhone. */
export function Calendar() {
  const narrow = useNarrow();
  const all = useList('event') as unknown as CalEvent[];
  const e = useEngine();
  const typeList = useList('calcat');
  const types = useMemo(() => calTypes(e), [e, typeList]);
  const [open, setOpen] = useState<Open>(null);
  const edit = (x: CalEvent) => setOpen({ event: all.find((y) => y.id === (x.sourceId ?? x.id)), occurrence: x });
  return (
    <>
      {narrow ? <DayView all={all} types={types} onEdit={edit} onNew={(start) => setOpen({ start })} /> : <WeekView all={all} types={types} onEdit={edit} onNew={(start) => setOpen({ start })} />}
      {open && <EventEditor event={open.event} occurrence={open.occurrence} defaultStart={open.start} onClose={() => setOpen(null)} />}
    </>
  );
}

type ViewProps = { all: CalEvent[]; types: CalType[]; onEdit: (x: CalEvent) => void; onNew: (start: Date) => void };
const nextHour = (now: Date) => { const d = new Date(now); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; };

/* ---------------------------------------------------------------- Mac: the week */
function WeekView({ all, types, onEdit, onNew }: ViewProps) {
  const now = useNow();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'calendar');
  const [week, setWeek] = useState(0);
  // Another week slides in from the side you went to.
  const lastWeek = useRef(week);
  useLayoutEffect(() => {
    const dir = Math.sign(week - lastWeek.current);
    lastWeek.current = week;
    if (dir) slideIn(ref.current?.querySelectorAll('.week__day, .titlerow h1, .titlerow p') ?? [], dir, 36, 0.36);
  }, [week]);
  const monday = addDays(mondayOf(now), week * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const events = useMemo(() => occurrences(all, new Date(monday.getTime() - DAY * 30), addDays(monday, 7)), [all, monday.getTime()]);
  const H0 = 5, H1 = 24;

  // Two fingers sideways on the trackpad (or a finger on a touch screen), anywhere on the week: the
  // week follows, and past a point the next or previous one slides in, like the Mac's Calendar.
  const grid = useRef<HTMLDivElement>(null);
  const swipe = useRef({ dx: 0, lock: 0, timer: 0 as unknown as ReturnType<typeof setTimeout> });
  const follow = (dx: number) => { if (!reduced() && grid.current) gsap.set(grid.current.querySelectorAll('.week__day'), { x: dx * 0.5, opacity: 1 - Math.min(0.35, Math.abs(dx) / 900) }); };
  const settle = () => { if (grid.current) gsap.to(grid.current.querySelectorAll('.week__day'), { x: 0, opacity: 1, duration: 0.4, ease: 'back.out(1.3)', clearProps: 'transform,opacity' }); };
  const go = (dir: 1 | -1) => { if (grid.current) gsap.set(grid.current.querySelectorAll('.week__day'), { clearProps: 'transform,opacity' }); setWeek((w) => w + dir); };
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (Math.abs(ev.deltaX) <= Math.abs(ev.deltaY) || ev.ctrlKey) return;
      ev.preventDefault();
      const sw = swipe.current;
      if (performance.now() < sw.lock) return; // the trackpad's glide after a swipe that already went
      sw.dx -= ev.deltaX;
      clearTimeout(sw.timer);
      if (Math.abs(sw.dx) > 140) { const dir = sw.dx < 0 ? 1 : -1; sw.dx = 0; sw.lock = performance.now() + 450; go(dir); return; }
      follow(sw.dx);
      sw.timer = setTimeout(() => { sw.dx = 0; settle(); }, 140);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const touch = useRef<{ x: number; y: number; t: number; side?: boolean } | null>(null);
  const onTouchStart = (ev: React.TouchEvent) => { const p = ev.touches[0]; touch.current = { x: p.clientX, y: p.clientY, t: performance.now() }; };
  const onTouchMove = (ev: React.TouchEvent) => {
    const t = touch.current, p = ev.touches[0];
    if (!t) return;
    const dx = p.clientX - t.x, dy = p.clientY - t.y;
    if (t.side === undefined && Math.hypot(dx, dy) > 10) t.side = Math.abs(dx) > Math.abs(dy) * 1.2;
    if (t.side) follow(dx);
  };
  const onTouchEnd = (ev: React.TouchEvent) => {
    const t = touch.current, p = ev.changedTouches[0];
    touch.current = null;
    if (!t?.side) return;
    const dx = p.clientX - t.x, v = dx / Math.max(1, performance.now() - t.t);
    if (Math.abs(dx) > 120 || Math.abs(v) > 0.45) go(dx < 0 ? 1 : -1); else settle();
  };
  const f = (d: Date, day: Date) => Math.min(1, Math.max(0, ((d.getTime() - day.getTime()) / 60000 - H0 * 60) / ((H1 - H0) * 60)));
  return (
    <main className="canvas" ref={ref}>
      <div className="titlerow" data-enter><div><h1>Uge {weekNo(monday)}</h1><p>{fmt.dayLabel(days[0])} – {fmt.dayLabel(days[6]).toLowerCase()}</p></div>
        <div className="actions">
          <Btn size="sm" icon="plus" onClick={() => onNew(nextHour(now))}>Ny aftale</Btn>
          <Btn size="sm" variant="text" icon="chevron-left" aria-label="Forrige uge" onClick={() => setWeek((w) => w - 1)} />
          <Btn size="sm" onClick={() => setWeek(0)} disabled={week === 0}>Denne uge</Btn>
          <Btn size="sm" variant="text" aria-label="Næste uge" onClick={() => setWeek((w) => w + 1)}><span className="flip-x"><Icon name="chevron-left" size="sm" /></span></Btn>
        </div></div>
      <div className="week" data-enter ref={grid} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
        <div className="week__hours meta num">{Array.from({ length: Math.floor((H1 - H0) / 2) + 1 }, (_, i) => H0 + i * 2).map((h) => <span key={h} style={vars({ '--at': (h - H0) / (H1 - H0) })}>{String(h).padStart(2, '0')}</span>)}</div>
        {days.map((d) => {
          const isToday = sameDay(d, now);
          const dayEnd = addDays(d, 1);
          const evs = events.filter((x) => !isAllDay(x) && new Date(x.start) < dayEnd && new Date(x.end) > d);
          const allDay = events.filter((x) => isAllDay(x) && new Date(x.start) < dayEnd && new Date(x.end) > d);
          const lane = lanes(evs);
          return (
            <div key={d.toISOString()} className={`week__day ${isToday ? 'is-today' : ''}`}>
              <div className="week__head"><span className="meta">{d.toLocaleDateString('da-DK', { weekday: 'short' }).replace('.', '')}</span><span className="num">{d.getDate()}</span></div>
              {allDay.length > 0 && <div className="week__allday">{allDay.map((x) => <button key={x.id} title={x.title} style={vars({ '--ev': eventColor(types, x as any) })} onClick={() => onEdit(x)}>{x.title}</button>)}</div>}
              <div className="week__col" onDoubleClick={(ev) => {
                if (ev.target !== ev.currentTarget) return;
                const r = ev.currentTarget.getBoundingClientRect();
                const mins = H0 * 60 + Math.round((((ev.clientY - r.top) / r.height) * (H1 - H0) * 60) / 30) * 30;
                const st = new Date(d); st.setHours(0, mins, 0, 0); onNew(st);
              }}>
                {evs.map((x) => {
                  const s = f(new Date(x.start), d), l = lane.get(x.id)!;
                  return (
                    <button key={x.id} className={`week__ev ${new Date(x.end) < now ? 'is-past' : ''} ${x.focus ? 'is-focusblock' : ''} ${(x as any).feed ? 'is-feed' : ''}`}
                      style={vars({ '--start': s, '--len': Math.max(0.02, f(new Date(x.end), d) - s), '--lane': l.lane, '--of': l.of, '--ev': eventColor(types, x as any) })}
                      onClick={() => onEdit(x)} aria-label={`${x.title} ${fmt.hm(x.start)}–${fmt.hm(x.end)}. Redigér`}>
                      <b>{x.title}</b><span className="num">{fmt.hm(x.start)}–{fmt.hm(x.end)}</span>
                    </button>
                  );
                })}
                {isToday && <div className="week__now" style={vars({ '--at': f(now, d) })} />}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}

/* ---------------------------------------------------------------- iPhone: the day, the week above it */
const HOUR = 56; // px per hour on the phone

function DayView({ all, types, onEdit, onNew }: ViewProps) {
  const now = useNow();
  const ref = useRef<HTMLElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  useScreenEnter(ref, 'calendar');
  const [sel, setSelRaw] = useState(() => startOf(new Date()));
  const dirRef = useRef(0);
  const setSel = (next: Date | ((d: Date) => Date)) => setSelRaw((d) => {
    const n = typeof next === 'function' ? next(d) : next;
    dirRef.current = Math.sign(n.getTime() - d.getTime());
    return n;
  });
  const monday = mondayOf(sel);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const weekEvents = useMemo(() => occurrences(all, new Date(monday.getTime() - DAY * 30), addDays(monday, 7)), [all, monday.getTime()]);
  const end = addDays(sel, 1);
  const inDay = weekEvents.filter((x) => new Date(x.start) < end && new Date(x.end) > sel);
  const timed = inDay.filter((x) => !isAllDay(x));
  const allDay = inDay.filter(isAllDay);
  const lane = lanes(timed);
  const busy = (d: Date) => weekEvents.some((x) => new Date(x.start) < addDays(d, 1) && new Date(x.end) > d);
  const y = (d: Date) => Math.min(24, Math.max(0, (d.getTime() - sel.getTime()) / 3600000)) * HOUR;

  // Opens at the time that matters: now on today, else the day's first event, else 08.
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const first = timed[0] ? new Date(timed[0].start) : null;
    const at = sameDay(sel, now) ? y(now) - 2 * HOUR : first ? y(first) - HOUR : 8 * HOUR;
    // The day and the week stay at the top (sticky); the hours scroll under them.
    const top = el.getBoundingClientRect().top + scrollY + Math.max(0, at) - (head.current?.offsetHeight ?? 0) - 24;
    scrollTo({ top: Math.max(0, top), behavior: 'instant' as ScrollBehavior });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.getTime()]);

  // Swipe sideways for the day before or after. The day follows the finger; let go past a third of
  // the way (or with a flick) and the next day slides in, otherwise it springs back.
  // Anywhere on the day (the hours, the events, the label) swipes days; on the week strip it swipes weeks.
  const touch = useRef<{ x: number; y: number; t: number; side?: boolean; strip: boolean } | null>(null);
  const moving = () => (touch.current?.strip ? Array.from(week.current?.querySelectorAll('.calm__d') ?? []) : [grid.current]).filter(Boolean) as Element[];
  const onTouchStart = (ev: React.TouchEvent) => {
    if ((ev.target as HTMLElement).closest('.calm__actions, .calm__nav')) return;
    const p = ev.touches[0];
    touch.current = { x: p.clientX, y: p.clientY, t: performance.now(), strip: !!(ev.target as HTMLElement).closest('.calm__week') };
  };
  const onTouchMove = (ev: React.TouchEvent) => {
    const t = touch.current, p = ev.touches[0];
    if (!t) return;
    const dx = p.clientX - t.x, dy = p.clientY - t.y;
    if (t.side === undefined && Math.hypot(dx, dy) > 10) t.side = Math.abs(dx) > Math.abs(dy) * 1.2;
    if (!t.side || reduced()) return;
    gsap.set(moving(), { x: t.strip ? dx * 0.6 : dx, opacity: 1 - Math.min(0.5, Math.abs(dx) / 700) });
  };
  const onTouchEnd = (ev: React.TouchEvent) => {
    const t = touch.current, p = ev.changedTouches[0];
    if (!t?.side) { touch.current = null; return; }
    const els = moving();
    touch.current = null;
    const dx = p.clientX - t.x, v = dx / Math.max(1, performance.now() - t.t);
    const step = t.strip ? 7 : 1;
    if (Math.abs(dx) > innerWidth / (t.strip ? 4 : 3) || Math.abs(v) > 0.45) {
      const dir = dx < 0 ? 1 : -1;
      if (reduced() || t.strip) { gsap.set(els, { clearProps: 'transform,opacity' }); setSel((d) => addDays(d, dir * step)); return; }
      gsap.to(els, { x: -dir * innerWidth * 0.6, opacity: 0, duration: 0.16, ease: 'power2.in', onComplete: () => setSel((d) => addDays(d, dir)) });
    } else gsap.to(els, { x: 0, opacity: 1, duration: 0.45, ease: 'back.out(1.4)', clearProps: 'transform,opacity' });
  };

  // A new day slides in from the side you went to; a new week's days follow; the circle glides.
  const week = useRef<HTMLDivElement>(null);
  const lastMonday = useRef(monday.getTime());
  useLayoutEffect(() => {
    const dir = dirRef.current;
    dirRef.current = 0;
    if (dir) slideIn([grid.current, ref.current?.querySelector('.calm__label'), ref.current?.querySelector('.calm__allday')].filter(Boolean) as Element[], dir, 56, 0.4);
    const weekChanged = lastMonday.current !== monday.getTime();
    // The circle goes where the day's number sits in the layout (not where an animation has it right now).
    const box = week.current, pill = box?.querySelector<HTMLElement>('.calm__pill'), b = box?.querySelector<HTMLElement>('.calm__d.is-sel b');
    if (box && pill && b) {
      let x = 0, y = 0;
      for (let n: HTMLElement | null = b; n && n !== box; n = n.offsetParent as HTMLElement | null) { x += n.offsetLeft; y += n.offsetTop; }
      const to = { x, y, opacity: 1 };
      pill.classList.toggle('is-today', sameDay(sel, new Date()));
      if (weekChanged && pill.dataset.on && !reduced()) {
        // A new week's numbers slide in; the circle waits at its place and fades in as they arrive.
        gsap.killTweensOf(pill); gsap.set(pill, { x, y, opacity: 0 }); gsap.to(pill, { opacity: 1, duration: 0.2, delay: 0.24, ease: 'power2.out' });
      } else if (!pill.dataset.on || reduced() || weekChanged) { gsap.killTweensOf(pill); gsap.set(pill, to); pill.dataset.on = '1'; }
      else gsap.to(pill, { ...to, duration: 0.42, ease: 'expo.out', overwrite: true });
    }
    if (weekChanged) {
      const wdir = Math.sign(monday.getTime() - lastMonday.current);
      lastMonday.current = monday.getTime();
      if (!reduced()) gsap.fromTo(week.current!.querySelectorAll('.calm__d'), { x: wdir * 24, opacity: 0 }, { x: 0, opacity: 1, duration: 0.34, ease: 'expo.out', stagger: wdir * 0.018, clearProps: 'transform,opacity' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.getTime()]);

  const label = sameDay(sel, now) ? 'I dag' : sameDay(sel, addDays(now, 1)) ? 'I morgen' : sameDay(sel, addDays(now, -1)) ? 'I går' : '';
  return (
    <main className="canvas calm" ref={ref} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      <div className="calm__head" ref={head}>
      <div className="calm__top" data-enter>
        <h1>{sel.toLocaleDateString('da-DK', { month: 'long' }).replace(/^./, (c) => c.toUpperCase())} <span className="calm__year">{sel.getFullYear()}</span></h1>
        <div className="calm__actions">
          {!sameDay(sel, now) && <Btn size="sm" onClick={() => setSel(startOf(new Date()))}>I dag</Btn>}
          <Btn size="sm" variant="primary" icon="plus" aria-label="Ny aftale" onClick={() => { const s = sameDay(sel, now) ? nextHour(now) : new Date(sel.getTime() + 9 * 3600000); onNew(s); }} />
        </div>
      </div>
      <div className="calm__week" data-enter role="tablist" aria-label={`Uge ${weekNo(monday)}`} ref={week}>
        <span className="calm__pill" aria-hidden="true" />
        <button className="calm__nav" aria-label="Forrige uge" onClick={() => setSel((d) => addDays(d, -7))}><Icon name="chevron-left" size="sm" /></button>
        {days.map((d) => (
          <button key={d.getTime()} role="tab" aria-selected={sameDay(d, sel)} className={`calm__d ${sameDay(d, sel) ? 'is-sel' : ''} ${sameDay(d, now) ? 'is-today' : ''}`} onClick={() => setSel(d)}>
            <span>{d.toLocaleDateString('da-DK', { weekday: 'narrow' })}</span>
            <b className="num">{d.getDate()}</b>
            <i className={busy(d) ? 'is-on' : ''} />
          </button>
        ))}
        <button className="calm__nav" aria-label="Næste uge" onClick={() => setSel((d) => addDays(d, 7))}><span className="flip-x"><Icon name="chevron-left" size="sm" /></span></button>
      </div>
      <p className="calm__label">{label ? <b>{label}</b> : null}{label ? ' · ' : ''}{fmt.dayLabel(sel)}<span className="meta"> · {timed.length + allDay.length ? `${timed.length + allDay.length} ${timed.length + allDay.length === 1 ? 'aftale' : 'aftaler'}` : 'ingen aftaler'}</span></p>
      {allDay.length > 0 && <div className="calm__allday">{allDay.map((x) => <button key={x.id} style={vars({ '--ev': eventColor(types, x as any) })} onClick={() => onEdit(x)}>{x.title}</button>)}</div>}
      </div>
      <div className="calm__grid" ref={grid} style={vars({ '--hour': HOUR + 'px' })}
        onClick={(ev) => {
          if (!(ev.target as HTMLElement).classList.contains('calm__slots')) return;
          const r = (ev.target as HTMLElement).getBoundingClientRect();
          const mins = Math.floor(((ev.clientY - r.top) / HOUR) * 2) * 30;
          onNew(new Date(sel.getTime() + mins * 60000));
        }}>
        {Array.from({ length: 25 }, (_, h) => <span key={h} className="calm__h num" style={vars({ '--at': h })}>{h < 24 ? String(h).padStart(2, '0') : ''}</span>)}
        <div className="calm__slots" aria-label="Tryk for at oprette en aftale" />
        {timed.map((x) => {
          const s = new Date(x.start), e = new Date(x.end), l = lane.get(x.id)!;
          const h = Math.max(24, y(e) - y(s) - 2);
          return (
            <button key={x.id} className={`calm__ev ${e < now ? 'is-past' : ''} ${(x as any).feed ? 'is-feed' : ''} ${h < 40 ? 'is-short' : ''}`} style={vars({ '--top': y(s) + 'px', '--h': h + 'px', '--lane': l.lane, '--of': l.of, '--ev': eventColor(types, x as any) })}
              onClick={() => onEdit(x)} aria-label={`${x.title} ${fmt.hm(x.start)}–${fmt.hm(x.end)}. Redigér`}>
              <b style={vars({ '--lines': Math.max(1, Math.floor((h - 26) / 18)) })}>{x.title}</b><span className="num">{fmt.hm(x.start)}–{fmt.hm(x.end)}{x.place ? ' · ' + x.place : ''}</span>
            </button>
          );
        })}
        {sameDay(sel, now) && <div className="calm__now" style={vars({ '--top': y(now) + 'px' })}><span className="num">{fmt.hm(now)}</span></div>}
      </div>
      <div className="calm__more">
        <button onClick={() => { setSel((d) => addDays(d, -1)); }}><Icon name="chevron-left" size="sm" />{dayName(addDays(sel, -1), now)}</button>
        <button onClick={() => { setSel((d) => addDays(d, 1)); }}>{dayName(addDays(sel, 1), now)}<span className="flip-x"><Icon name="chevron-left" size="sm" /></span></button>
      </div>
    </main>
  );
}

/** "I morgen", "I går" or "Tirsdag 3. nov." for the buttons under the day. */
function dayName(d: Date, now: Date) {
  if (sameDay(d, addDays(now, 1))) return 'I morgen';
  if (sameDay(d, addDays(now, -1))) return 'I går';
  if (sameDay(d, now)) return 'I dag';
  return d.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'short' }).replace(/^./, (c) => c.toUpperCase());
}

function weekNo(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
}
