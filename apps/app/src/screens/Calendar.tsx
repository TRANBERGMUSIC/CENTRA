import { useRef } from 'react';
import { useList, useNow, fmt } from '../state.tsx';
import { vars } from '../ui/primitives.tsx';
import { useScreenEnter } from '../motion.ts';

/** Step 2: a synced week agenda over local events. Google/Graph/CalDAV, drag-and-drop and "find tid" arrive in step 4. */
export function Calendar() {
  const now = useNow();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'calendar');
  const events = useList('event', (a, b) => a.start.localeCompare(b.start)) as any[];
  const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return d; });
  const H0 = 7, H1 = 23;
  const f = (d: Date) => Math.min(1, Math.max(0, (d.getHours() * 60 + d.getMinutes() - H0 * 60) / ((H1 - H0) * 60)));
  return (
    <main className="canvas" ref={ref}>
      <div className="titlerow" data-enter><div><h1>Uge {weekNo(now)}</h1><p>{fmt.dayLabel(days[0])} – {fmt.dayLabel(days[6]).toLowerCase()}. Kalenderkonti tilsluttes i trin 4.</p></div></div>
      <div className="week" data-enter>
        <div className="week__hours meta num">{Array.from({ length: (H1 - H0) / 2 + 1 }, (_, i) => H0 + i * 2).map((h) => <span key={h} style={vars({ '--at': (h - H0) / (H1 - H0) })}>{String(h).padStart(2, '0')}</span>)}</div>
        {days.map((d) => {
          const isToday = d.toDateString() === now.toDateString();
          const evs = events.filter((x) => new Date(x.start).toDateString() === d.toDateString());
          return (
            <div key={d.toISOString()} className={`week__day ${isToday ? 'is-today' : ''}`}>
              <div className="week__head"><span className="meta">{d.toLocaleDateString('da-DK', { weekday: 'short' })}</span><span className="num">{d.getDate()}</span></div>
              <div className="week__col">
                {evs.map((x) => (
                  <div key={x.id} className={`week__ev ${new Date(x.end) < now ? 'is-past' : ''} ${x.focus ? 'is-focusblock' : ''}`} style={vars({ '--start': f(new Date(x.start)), '--len': f(new Date(x.end)) - f(new Date(x.start)) })}>
                    <b>{x.title}</b><span className="num">{fmt.hm(x.start)}</span>
                  </div>
                ))}
                {isToday && <div className="week__now" style={vars({ '--at': f(now) })} />}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}

function weekNo(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
}
