import { useRef, useState } from 'react';
import { occurrences, type CalEvent } from '../calendar.ts';
import { Btn } from '../ui/primitives.tsx';
import { useList, useNow, fmt } from '../state.tsx';
import { vars } from '../ui/primitives.tsx';
import { useScreenEnter } from '../motion.ts';
import { Icon } from '../ui/Icon.tsx';
import { EventEditor } from '../ui/EventEditor.tsx';

/** The week: your own events, weekly repeats and subscribed calendars. Click an event to change or delete it. */
export function Calendar() {
  const now = useNow();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'calendar');
  const [week, setWeek] = useState(0);
  const [open, setOpen] = useState<null | { event?: CalEvent; occurrence?: CalEvent; start?: Date }>(null);
  const all = useList('event') as unknown as CalEvent[];
  const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + week * 7);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return d; });
  const events = occurrences(all, new Date(monday.getTime() - 86400000 * 30), new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7));
  const H0 = 5, H1 = 23;
  const f = (d: Date) => Math.min(1, Math.max(0, (d.getHours() * 60 + d.getMinutes() - H0 * 60) / ((H1 - H0) * 60)));
  return (
    <main className="canvas" ref={ref}>
      <div className="titlerow" data-enter><div><h1>Uge {weekNo(monday)}</h1><p>{fmt.dayLabel(days[0])} – {fmt.dayLabel(days[6]).toLowerCase()}. {all.length ? 'Klik på en aftale for at rette den, dobbeltklik i en dag for at oprette.' : 'Tom endnu. Opret en aftale, tilknyt din Google- eller iCloud-kalender under Forbindelser, eller fortæl Assist om din arbejdstid.'}</p></div>
        <div className="actions">
          <Btn size="sm" icon="plus" onClick={() => { const d = new Date(now); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); setOpen({ start: d }); }}>Ny aftale</Btn>
          <Btn size="sm" variant="text" icon="chevron-left" aria-label="Forrige uge" onClick={() => setWeek((w) => w - 1)} />
          <Btn size="sm" onClick={() => setWeek(0)} disabled={week === 0}>Denne uge</Btn>
          <Btn size="sm" variant="text" aria-label="Næste uge" onClick={() => setWeek((w) => w + 1)}><span className="flip-x"><Icon name="chevron-left" size="sm" /></span></Btn>
        </div></div>
      <div className="week" data-enter>
        <div className="week__hours meta num">{Array.from({ length: (H1 - H0) / 2 + 1 }, (_, i) => H0 + i * 2).map((h) => <span key={h} style={vars({ '--at': (h - H0) / (H1 - H0) })}>{String(h).padStart(2, '0')}</span>)}</div>
        {days.map((d) => {
          const isToday = d.toDateString() === now.toDateString();
          const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
          const evs = events.filter((x) => !(x as any).allDay && new Date(x.start).toDateString() === d.toDateString());
          const allDay = events.filter((x) => (x as any).allDay && new Date(x.start) < dayEnd && new Date(x.end) > d);
          return (
            <div key={d.toISOString()} className={`week__day ${isToday ? 'is-today' : ''}`}>
              <div className="week__head"><span className="meta">{d.toLocaleDateString('da-DK', { weekday: 'short' })}</span><span className="num">{d.getDate()}</span>
                {allDay.length > 0 && <div className="week__allday">{allDay.map((x) => <button key={x.id} title={x.title} onClick={() => setOpen({ event: all.find((y) => y.id === (x.sourceId ?? x.id)), occurrence: x })}>{x.title}</button>)}</div>}
              </div>
              <div className="week__col" onDoubleClick={(ev) => {
                if (ev.target !== ev.currentTarget) return;
                const r = ev.currentTarget.getBoundingClientRect();
                const mins = H0 * 60 + Math.round((((ev.clientY - r.top) / r.height) * (H1 - H0) * 60) / 30) * 30;
                const st = new Date(d); st.setHours(0, mins, 0, 0); setOpen({ start: st });
              }}>
                {evs.map((x) => (
                  <button key={x.id} className={`week__ev ${new Date(x.end) < now ? 'is-past' : ''} ${x.focus ? 'is-focusblock' : ''} ${(x as any).feed ? 'is-feed' : ''}`} style={vars({ '--start': f(new Date(x.start)), '--len': f(new Date(x.end)) - f(new Date(x.start)) })}
                    onClick={() => setOpen({ event: all.find((y) => y.id === (x.sourceId ?? x.id)), occurrence: x })} aria-label={`${x.title} ${fmt.hm(x.start)}–${fmt.hm(x.end)}. Redigér`}>
                    <b>{x.title}</b><span className="num">{fmt.hm(x.start)}–{fmt.hm(x.end)}</span>
                  </button>
                ))}
                {isToday && <div className="week__now" style={vars({ '--at': f(now) })} />}
              </div>
            </div>
          );
        })}
      </div>
      {open && <EventEditor event={open.event} occurrence={open.occurrence} defaultStart={open.start} onClose={() => setOpen(null)} />}
    </main>
  );
}

function weekNo(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
}
