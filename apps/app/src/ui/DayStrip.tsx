import { useRef } from 'react';
import { fmt } from '../state.tsx';
import { vars } from './primitives.tsx';
import { gsap, useGSAP, reduced, dur } from '../motion.ts';

type Ev = { id: string; title: string; place?: string; start: string; end: string; focus?: boolean };
const H0 = 7, H1 = 23;

const minsOf = (d: Date) => d.getHours() * 60 + d.getMinutes();
const frac = (mins: number) => Math.min(1, Math.max(0, (mins - H0 * 60) / ((H1 - H0) * 60)));

/** The signature element: the day from 07 to 23, with now and the next thing "in the light". */
export function DayStrip({ events, now, nextId }: { events: Ev[]; now: Date; nextId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const nowF = frac(minsOf(now));
  const next = events.find((e) => e.id === nextId);

  // The now-line glides to its new minute instead of jumping.
  useGSAP(() => {
    const line = ref.current?.querySelector('.daystrip__now');
    if (!line) return;
    gsap.to(line, { left: `${nowF * 100}%`, duration: reduced() ? 0 : dur.slow * 2, ease: 'power1.inOut' });
  }, { dependencies: [nowF], scope: ref });

  return (
    <div className="daystrip" ref={ref} role="img" aria-label={`Dagen fra 07 til 23 med ${events.length} aftaler. Klokken er ${fmt.hm(now)}.`}>
      <div className="daystrip__track">
        {next && <div className="daystrip__callout num" style={vars({ '--at': frac(minsOf(new Date(next.start))) })}>{next.title} · {fmt.hm(next.start)}</div>}
        {events.map((e) => {
          const s = minsOf(new Date(e.start)), en = minsOf(new Date(e.end));
          const state = new Date(e.end) <= now ? 'is-past' : e.id === nextId ? 'is-next' : e.focus ? 'is-focusblock' : '';
          return (
            <div key={e.id} className={`daystrip__ev ${state} ${en - s < 60 ? 'is-narrow' : ''}`} style={vars({ '--start': frac(s), '--len': frac(en) - frac(s) })} title={`${e.title} ${fmt.hm(e.start)}–${fmt.hm(e.end)}`}>
              <b>{e.title}</b><span className="num">{fmt.hm(e.start)}{e.place ? ' · ' + e.place : ''}</span>
            </div>
          );
        })}
        <div className="daystrip__now" style={{ left: `${nowF * 100}%` }} />
      </div>
      <div className="daystrip__ticks meta num">
        {[7, 9, 11, 13, 15, 17, 19, 21, 23].map((h) => <span key={h} style={vars({ '--at': frac(h * 60) })}>{String(h).padStart(2, '0')}</span>)}
      </div>
    </div>
  );
}

/** A progress bar whose fill is the true ratio; GSAP tweens it when the value changes. */
export function Progress({ ratio, focus, small }: { ratio: number; focus?: boolean; small?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const fill = ref.current!.firstElementChild!;
    gsap.to(fill, { scaleX: Math.min(1, Math.max(0, ratio)), duration: reduced() ? 0 : 0.6, ease: 'power3.out' });
  }, { dependencies: [ratio], scope: ref });
  return <div ref={ref} className={`prog ${small ? 'prog--sm' : ''} ${focus ? 'is-focus' : ''}`} role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}><i /></div>;
}
