import { useMemo, useRef, useState } from 'react';
import { useEngine, useList, useRoute, useNow, fmt } from '../state.tsx';
import { Btn } from '../ui/primitives.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Progress } from '../ui/DayStrip.tsx';
import { useToast } from '../ui/Shell.tsx';
import { useScreenEnter } from '../motion.ts';
import { goalStats, fmtN, type Goal, type GoalUpdate } from '../goals.ts';
import CountUp from '../bits/CountUp.jsx';
import ClickSpark from '../bits/ClickSpark.jsx';
import { SuggestionRows } from './Assist.tsx';

export function Goals() {
  const { route, go } = useRoute();
  const now = useNow();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'goals');
  const goals = useList<Goal>('goal', (a, b) => (a.order ?? 0) - (b.order ?? 0)) as unknown as Goal[];
  const updates = useList<GoalUpdate>('goalUpdate') as unknown as GoalUpdate[];
  const stats = useMemo(() => goals.map((g) => ({ g, s: goalStats(g, updates, now) })), [goals, updates, now]);
  const id = route.id ?? stats.find((x) => !x.s.onTrack)?.g.id ?? stats[0]?.g.id;
  const cur = stats.find((x) => x.g.id === id);
  const e = useEngine();
  const pending = useList('suggestion').filter((x: any) => x.status === 'pending').length;

  const section = (title: string, list: typeof stats) => list.length > 0 && (
    <>
      <div className="gsec">{title}</div>
      {list.map(({ g, s }) => (
        <button key={g.id} className={`gitem ${g.id === id ? 'is-selected' : ''}`} onClick={() => go({ screen: 'goals', id: g.id })}>
          <span className="gitem__t"><span className="strong ellipsis">{g.title}</span><span className="meta num">{s.due}</span></span>
          <Progress ratio={s.ratio} focus={!s.onTrack} small />
          <span className="meta num gitem__l">{s.label}</span>
        </button>
      ))}
    </>
  );

  return (
    <main className="goals" ref={ref}>
      <div className="glist" data-enter>
        <h1>Mål <span className="meta num">{goals.length}</span><Btn size="sm" icon="plus" onClick={() => go({ screen: 'goals', id: e.create('goal', { title: 'Nyt mål', kind: 'measure', unit: 'gange', target: 10, area: 'Privat', due: `${now.getFullYear()}-12-31`, order: goals.length + 1 }) })}>Nyt mål</Btn></h1>
        {section('Kræver handling', stats.filter((x) => !x.s.onTrack))}
        {section('På sporet', stats.filter((x) => x.s.onTrack))}
      </div>
      {cur ? <GoalDetail key={cur.g.id} g={cur.g} s={cur.s} /> : <div className="gdetail"><p className="muted pad">Ingen mål endnu. Lav et med knappen, eller fortæl Assist, hvad du gerne vil nå.</p></div>}
      <aside className="details" aria-label="Detaljer">
        {pending > 0 && <div className="dsec"><div className="dsec__title">Forslag fra Assist</div><SuggestionRows limit={2} /></div>}
        {cur?.g.event && <LinkedEvent id={cur.g.event} />}
        <div className="dsec"><div className="dsec__title">Med Assist</div><p className="muted small">Sig fx "Jeg løb 5 km i dag" eller "Sæt et mål om at spare 10.000 kr inden sommer", så opdaterer Assist dine mål. <button className="tag" onClick={() => go({ screen: 'assist' })}>Åbn Assist</button></p></div>
      </aside>
    </main>
  );
}

function LinkedEvent({ id }: { id: string }) {
  const e = useEngine();
  const ev = e.get(id) as any;
  if (!ev) return null;
  return <div className="dsec"><div className="dsec__title">Koblet til</div><div className="row"><Icon name="calendar" /><span className="row__body"><span>{ev.title}</span><span className="meta">{ev.recurring ? 'Gentages ' + ev.recurring : fmt.shortDate(ev.start)}</span></span></div></div>;
}

function GoalDetail({ g, s }: { g: Goal; s: ReturnType<typeof goalStats> }) {
  const e = useEngine();
  const toast = useToast();
  const [delta, setDelta] = useState('');
  const [text, setText] = useState('');
  const prev = useRef(s.value);
  const spark = useRef<{ spark: (x: number, y: number) => void }>(null);
  const from = prev.current;
  prev.current = s.value;

  function log(ev: React.FormEvent) {
    ev.preventDefault();
    const n = Number(delta.replace(',', '.'));
    if (g.kind !== 'milestones' && !(n > 0) && !text.trim()) return;
    const id = e.create('goalUpdate', { goal: g.id, at: new Date().toISOString(), delta: g.kind === 'milestones' ? 0 : n || 0, text: text.trim(), src: 'Skrevet af dig' });
    const btn = (ev.target as HTMLFormElement).querySelector('button[type=submit]')!.getBoundingClientRect();
    const host = (ev.target as HTMLElement).closest('.sparkhost')!.getBoundingClientRect();
    spark.current?.spark(btn.left - host.left + btn.width / 2, btn.top - host.top + btn.height / 2);
    setDelta(''); setText('');
    toast({ text: 'Opdatering logget', action: { label: 'Fortryd', run: () => e.remove('goalUpdate', id) } });
  }

  function toggleStep(i: number) {
    const steps = (g.steps ?? []).map(([t, d], j) => [t, j === i ? !d : d] as [string, boolean]);
    e.set('goal', g.id, { steps });
    e.create('goalUpdate', { goal: g.id, at: new Date().toISOString(), delta: 0, text: `${steps[i][1] ? 'Færdig' : 'Genåbnet'}: ${steps[i][0]}`, src: 'Skrevet af dig' });
  }

  const monthly = useMemo(() => {
    const arr = Array(12).fill(0);
    for (const u of s.mine) if (new Date(u.at).getFullYear() === new Date().getFullYear()) arr[new Date(u.at).getMonth()] += u.delta;
    return arr;
  }, [s.mine]);

  return (
    <div className="gdetail">
      <div className="meta">{g.area} · {g.kind === 'measure' ? 'tal-mål' : g.kind === 'milestones' ? 'milepæle' : 'vane'}{g.due ? ' · frist ' + s.due : ''}</div>
      <h2>{g.title}</h2>
      <div className="gfig">
        <b className="num"><CountUp key={g.id} from={from} to={s.value} duration={0.8} decimals={g.kind === 'measure' && s.value % 1 ? 1 : 0} separator="." decimalSeparator="," trigger="mount" /></b>
        <span className="muted num">{g.kind === 'measure' ? `af ${fmtN(g.target ?? 0)} ${g.unit ?? ''}` : g.kind === 'milestones' ? `af ${g.steps?.length} trin` : `af ${g.perWeek} denne uge`}</span>
        <span className={`status push-right ${s.onTrack ? '' : 'is-due'}`}>{s.onTrack ? 'På sporet' : 'Kræver handling'}</span>
      </div>
      <Progress ratio={s.ratio} focus={!s.onTrack} />
      <div className="prog__ends meta num"><span>0</span><span>{g.kind === 'measure' ? `${fmtN(g.target ?? 0)} ${g.unit}` : g.kind === 'milestones' ? `${g.steps?.length} trin` : `${g.perWeek} gange`}</span></div>
      <p className="gfinding">
        {g.kind === 'measure' && s.left > 0 && <><span className="strong num">{fmtN(s.left)} {g.unit} tilbage på {s.daysLeft} dage</span> kræver {fmt.num(s.needPerWeek ?? 0, 1)} {g.unit} om ugen.{s.pacePerWeek != null && <> Dit tempo i år er {fmt.num(s.pacePerWeek, 1)} {g.unit} om ugen.</>}</>}
        {g.kind === 'measure' && s.left === 0 && <span className="strong">Nået. Godt gået.</span>}
        {g.kind === 'milestones' && <><span className="strong num">{s.left} trin tilbage på {s.daysLeft} {s.daysLeft === 1 ? 'dag' : 'dage'}.</span>{!s.onTrack && ' Det næste er ' + (g.steps?.find(([, d]) => !d)?.[0] ?? '') + '.'}</>}
        {g.kind === 'habit' && <>Denne uge: <span className="strong num">{s.value} af {g.perWeek}</span>. {s.onTrack ? 'Du har holdt vanen de sidste fire uger.' : 'De sidste fire uger har været under målet.'}</>}
      </p>

      <div className="sparkhost">
        <ClickSpark ref={spark} sparkColor="#C9683A" sparkCount={10} sparkRadius={26} sparkSize={10} duration={450}>
          <form className="gupdate" onSubmit={log}>
            {g.kind !== 'milestones' && <label className="field"><span>+</span><input inputMode="decimal" value={delta} onChange={(x) => setDelta(x.target.value)} placeholder={g.kind === 'habit' ? '1' : '0'} aria-label={`Antal ${g.unit ?? ''}`} /><span>{g.kind === 'habit' ? 'gang' : g.unit}</span></label>}
            <label className="field field--grow"><input value={text} onChange={(x) => setText(x.target.value)} placeholder="Skriv hvad der skete …" aria-label="Opdatering" /></label>
            <Btn type="submit" variant="primary">Log opdatering</Btn>
          </form>
        </ClickSpark>
      </div>

      {g.kind === 'milestones' && (
        <div className="glog"><div className="panel__head"><h3 className="panel__title">Trin</h3></div>
          <ul className="steps">{(g.steps ?? []).map(([t, d], i) => (
            <li key={t}><button className={`check ${d ? 'is-done' : ''}`} onClick={() => toggleStep(i)} aria-pressed={d}><span className="check__box">{d && <Icon name="check" size="sm" />}</span><span className="check__label">{t}</span></button></li>
          ))}</ul></div>
      )}

      {g.kind === 'measure' && g.start && <MonthChart values={monthly} target={(g.target ?? 0) / 12} unit={g.unit ?? ''} />}

      <div className="glog">
        <div className="panel__head"><h3 className="panel__title">Opdateringer</h3><span className="panel__count num">{s.mine.length}</span></div>
        <ul>{[...s.mine].reverse().slice(0, 8).map((u) => (
          <li key={u.id}><span className="meta num">{fmt.ago(u.at)}</span><span className="strong num">{u.delta ? '+' + fmtN(u.delta) + ' ' + (g.unit ?? '') : '—'}</span><span>{u.text && <>{u.text}<br /></>}<span className="meta">{u.src}</span></span></li>
        ))}</ul>
      </div>
    </div>
  );
}

function MonthChart({ values, target, unit }: { values: number[]; target: number; unit: string }) {
  const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const cur = new Date().getMonth();
  const max = Math.max(60, Math.ceil(Math.max(...values, target) / 20) * 20);
  const W = 640, H = 160, bw = 34, gap = (W - 12 * bw) / 11;
  const y = (v: number) => H - (v / max) * H;
  const ticks = [0, max / 3, (2 * max) / 3, max].map((v) => Math.round(v));
  return (
    <div className="gchart">
      <div className="panel__head"><h3 className="panel__title">{unit} pr. måned</h3><span className="panel__count">{new Date().getFullYear()}</span></div>
      <svg viewBox={`-30 -14 ${W + 40} ${H + 36}`} role="img" aria-label={`${unit} pr. måned i år`}>
        {ticks.map((v) => <g key={v}><line className="grid" x1={0} x2={W} y1={y(v)} y2={y(v)} /><text x={-8} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
        {months.map((m, i) => { const x = i * (bw + gap); return <g key={m}>{i <= cur && values[i] > 0 && <rect className={`bar ${i === cur ? 'is-now' : ''}`} x={x} y={y(values[i])} width={bw} height={H - y(values[i])} />}<text x={x + bw / 2} y={H + 20} textAnchor="middle">{m}</text></g>; })}
        <line className="ref" x1={0} x2={W} y1={y(target)} y2={y(target)} />
        <text x={W} y={y(target) - 6} textAnchor="end">{fmt.num(target, 1)} {unit}/md når målet</text>
      </svg>
    </div>
  );
}
