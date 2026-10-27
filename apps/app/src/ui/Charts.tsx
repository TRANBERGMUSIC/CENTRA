import { useRef, useState } from 'react';
import { kr } from '../money.ts';
import { gsap, useGSAP, reduced } from '../motion.ts';

/**
 * Small SVG charts for money. Categorical colours follow the category (fixed slot order, validated
 * for colour-blind separation against the dark and light surfaces); text always uses text colours.
 */
export const SLOTS = 6;
export const slotVar = (i: number) => (i >= 0 && i < SLOTS ? `var(--viz-${i + 1})` : 'var(--viz-other)');

type Slice = { label: string; value: number; slot: number };

/** Donut: share of the monthly total per category. Hover or focus a slice to read it. */
export function Donut({ data, center, sub }: { data: Slice[]; center: string; sub: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const sum = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = 80, W = 22, C = 2 * Math.PI * R, GAP = data.length > 1 ? 2 : 0;
  let acc = 0;
  useGSAP(() => {
    if (reduced()) return;
    // Only on first view: replaying a from-tween on changing data would freeze segments mid-way.
    gsap.fromTo(ref.current, { rotate: -30, opacity: 0, transformOrigin: '50% 50%' }, { rotate: 0, opacity: 1, duration: 0.8, ease: 'power3.out', clearProps: 'all' });
  }, { scope: ref, dependencies: [] });
  const h = hover !== null ? data[hover] : null;
  return (
    <div className="donut">
      <svg ref={ref} viewBox="0 0 200 200" role="img" aria-label={`Fordeling: ${data.map((d) => `${d.label} ${kr(d.value, { short: true })}`).join(', ')}`}>
        <circle cx="100" cy="100" r={R} fill="none" stroke="var(--c-raised)" strokeWidth={W} />
        {data.map((d, i) => {
          const len = Math.max(0, (d.value / sum) * C - GAP);
          const off = -acc; acc += (d.value / sum) * C;
          return <circle key={d.label} className={`donut__seg ${hover === i ? 'is-hover' : ''}`} cx="100" cy="100" r={R} fill="none" stroke={slotVar(d.slot)} strokeWidth={hover === i ? W + 6 : W}
            strokeDasharray={`${len} ${C - len}`} strokeDashoffset={off} transform="rotate(-90 100 100)" tabIndex={0}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}><title>{d.label}: {kr(d.value)}</title></circle>;
        })}
        <text x="100" y="96" textAnchor="middle" className="donut__big">{h ? kr(h.value, { short: true }) : center}</text>
        <text x="100" y="118" textAnchor="middle" className="donut__sub">{h ? `${h.label} · ${Math.round((h.value / sum) * 100)} %` : sub}</text>
      </svg>
      <ul className="legend">{data.map((d, i) => (
        <li key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className={hover === i ? 'is-hover' : ''}>
          <i style={{ background: slotVar(d.slot) }} /><span className="ellipsis" title={d.label}>{d.label}</span><span className="num">{kr(d.value, { short: true })} <span className="meta">{Math.round((d.value / sum) * 100)}%</span></span>
        </li>
      ))}</ul>
    </div>
  );
}

type Bar = { label: string; parts: { label: string; value: number; slot: number }[]; future?: boolean; current?: boolean };

/** Stacked months: what was (or will be) paid each month, by category. Future months are lighter. */
export function MonthBars({ bars, onPick }: { bars: Bar[]; onPick?: (i: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const totals = bars.map((b) => b.parts.reduce((s, p) => s + p.value, 0));
  const top = niceMax(Math.max(1, ...totals));
  const W = 640, H = 200, n = bars.length, slot = W / n, bw = Math.min(34, slot * 0.6);
  const y = (v: number) => H - (v / top) * H;
  useGSAP(() => {
    if (reduced()) return;
    gsap.fromTo(ref.current!.querySelectorAll('.mbar'), { scaleY: 0, transformOrigin: '50% 100%' }, { scaleY: 1, duration: 0.7, ease: 'power3.out', stagger: 0.03, clearProps: 'transform' });
  }, { scope: ref, dependencies: [] });
  const ticks = [0, top / 2, top];
  return (
    <div className="mbars">
      <svg ref={ref} viewBox={`-44 -16 ${W + 52} ${H + 40}`} role="img" aria-label={`Udgifter pr. måned: ${bars.map((b, i) => `${b.label} ${kr(totals[i], { short: true })}`).join(', ')}`}>
        {ticks.map((t) => <g key={t}><line className="grid" x1={0} x2={W} y1={y(t)} y2={y(t)} /><text x={-8} y={y(t) + 4} textAnchor="end">{t >= 1000 ? `${Math.round(t / 100) / 10}k` : Math.round(t)}</text></g>)}
        {bars.map((b, i) => {
          let acc = 0;
          const x = i * slot + (slot - bw) / 2;
          return (
            <g key={b.label} className={`mbar ${b.future ? 'is-future' : ''} ${hover === i ? 'is-hover' : ''}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onPick?.(i)}>
              <rect className="hit" x={i * slot} y={0} width={slot} height={H} />
              {b.parts.filter((p) => p.value > 0).map((p, k, arr) => {
                const h = (p.value / top) * H;
                const r = <rect key={p.label} x={x} y={y(acc + p.value) + (k < arr.length - 1 ? 0 : 0)} width={bw} height={Math.max(0, h - (k > 0 ? 2 : 0))} rx={k === arr.length - 1 ? 4 : 0} fill={slotVar(p.slot)} />;
                acc += p.value;
                return r;
              })}
              <text x={i * slot + slot / 2} y={H + 18} textAnchor="middle" className={b.current ? 'is-now' : ''}>{b.label}</text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="tip" style={{ left: `${((hover + 0.5) / n) * 100}%` }}>
          <b>{bars[hover].label}{bars[hover].future ? ' · forventet' : ''}</b>
          <span className="num">{kr(totals[hover])}</span>
          {bars[hover].parts.filter((p) => p.value > 0).sort((a, b) => b.value - a.value).slice(0, 5).map((p) => <span key={p.label} className="tip__row"><i style={{ background: slotVar(p.slot) }} />{p.label}<span className="num">{kr(p.value, { short: true })}</span></span>)}
        </div>
      )}
    </div>
  );
}

function niceMax(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
