import { useEffect, useMemo, useRef, useState } from 'react';
import { useEngine, useList, useRoute, useNow, fmt } from '../state.tsx';
import { Btn } from '../ui/primitives.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Progress } from '../ui/DayStrip.tsx';
import { useToast } from '../ui/Shell.tsx';
import { useScreenEnter } from '../motion.ts';
import { goalStats, fmtN, KIND_NAMES, PERIOD_NAMES, type Goal, type GoalUpdate, type GoalKind, type Period } from '../goals.ts';
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

  const [area, setArea] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const areas = [...new Set(goals.map((g) => g.area || 'Privat'))].sort((a, b) => a.localeCompare(b, 'da'));
  const finished = (g: Goal, st: ReturnType<typeof goalStats>) => g.status === 'done' || ((g.kind === 'once' || g.kind === 'milestones' || g.kind === 'measure') && st.ratio >= 1);
  const shown = stats.filter((x) => !area || (x.g.area || 'Privat') === area);
  const live = shown.filter((x) => !finished(x.g, x.s) && x.g.status !== 'paused');
  const section = (title: string, list: typeof stats) => list.length > 0 && (
    <>
      {title && <div className="gsec">{title}</div>}
      {list.map(({ g, s }) => (
        <button key={g.id} className={`gitem ${g.id === id ? 'is-selected' : ''}`} onClick={() => go({ screen: 'goals', id: g.id })}>
          <span className="gitem__t"><span className={`strong ellipsis ${g.title ? '' : 'faint'}`}>{g.title || 'Uden navn'}</span><span className="meta num">{s.due}</span></span>
          <Progress ratio={s.ratio} focus={!s.onTrack} small />
          <span className="meta num gitem__l">{s.label}</span>
        </button>
      ))}
    </>
  );

  return (
    <main className="goals" ref={ref}>
      <div className="glist" data-enter>
        <h1>Mål <span className="meta num">{goals.length}</span><Btn size="sm" icon="plus" onClick={() => setCreating(true)}>Nyt mål</Btn></h1>
        {areas.length > 1 && <div className="ntags gareas">{[null, ...areas].map((a) => <button key={a ?? 'all'} className={`tag ${area === a ? 'is-active' : ''}`} onClick={() => setArea(a)}>{a ?? 'Alle'}</button>)}</div>}
        {section('Kræver handling', live.filter((x) => !x.s.onTrack))}
        {section('På sporet', live.filter((x) => x.s.onTrack))}
        {section('På pause', shown.filter((x) => x.g.status === 'paused' && !finished(x.g, x.s)))}
        {shown.some((x) => finished(x.g, x.s)) && <button className="gsec gsec--btn" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>Fuldført <span className="num">{shown.filter((x) => finished(x.g, x.s)).length}</span> <Icon name="chevron-down" size="sm" /></button>}
        {showDone && section('', shown.filter((x) => finished(x.g, x.s)))}
      </div>
      {cur ? <GoalDetail key={cur.g.id} g={cur.g} s={cur.s} /> : <div className="gdetail"><p className="muted pad">Ingen mål endnu. Lav et med knappen, eller fortæl Assist, hvad du gerne vil nå.</p></div>}
      <aside className="details" aria-label="Detaljer">
        {pending > 0 && <div className="dsec"><div className="dsec__title">Forslag fra Assist</div><SuggestionRows limit={2} /></div>}
        {cur?.g.event && <LinkedEvent id={cur.g.event} />}
        <div className="dsec"><div className="dsec__title">Med Assist</div><p className="muted small">Fortæl Assist om dine mål med dine egne ord: "Jeg vil løbe 5 km 10 gange i år", "Jeg skal have lavet hjemmesiden inden jul" eller "Spar 10.000 kr inden sommer". Sig "Jeg løb 5 km i dag", så holder Assist styr på resten. <button className="tag" onClick={() => go({ screen: 'assist' })}>Åbn Assist</button></p></div>
      </aside>
      {creating && <NewGoal onClose={() => setCreating(false)} onMade={(nid) => { setCreating(false); go({ screen: 'goals', id: nid }); }} />}
    </main>
  );
}

function LinkedEvent({ id }: { id: string }) {
  const e = useEngine();
  const ev = e.get(id) as any;
  if (!ev) return null;
  return <div className="dsec"><div className="dsec__title">Koblet til</div><div className="row"><Icon name="calendar" /><span className="row__body"><span>{ev.title}</span><span className="meta">{ev.recurring ? 'Gentages ' + ev.recurring : fmt.shortDate(ev.start)}</span></span></div></div>;
}

/** Set when "Nyt mål" creates a goal, so its detail opens ready to be named. */
let fresh: string | null = null;

function GoalDetail({ g, s }: { g: Goal; s: ReturnType<typeof goalStats> }) {
  const e = useEngine();
  const toast = useToast();
  const { go } = useRoute();
  const [editing, setEditing] = useState(() => { const f = fresh === g.id; if (f) fresh = null; return f; });
  const [title, setTitle] = useState(g.title);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing || !g.title) { titleRef.current?.focus(); titleRef.current?.select(); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { if (document.activeElement !== titleRef.current) setTitle(g.title); }, [g.title]);
  const saveTitle = () => { const t = title.trim(); if (t !== g.title) e.set('goal', g.id, { title: t }); };
  function removeGoal() {
    const { id: _i, type: _t, ...fields } = g as any;
    e.remove('goal', g.id);
    go({ screen: 'goals' });
    toast({ text: `Målet "${g.title || 'Uden navn'}" er slettet`, action: { label: 'Fortryd', run: () => e.set('goal', g.id, { ...fields, _deleted: false }) } });
  }
  const [showAll, setShowAll] = useState(false);
  const [delta, setDelta] = useState('');
  const [text, setText] = useState('');
  const prev = useRef(s.value);
  const spark = useRef<{ spark: (x: number, y: number) => void }>(null);
  const from = prev.current;
  prev.current = s.value;

  function log(ev: React.FormEvent) {
    ev.preventDefault();
    const n = Number(delta.replace(',', '.')) || ((g.kind === 'count' || g.kind === 'habit') && !delta.trim() ? 1 : 0);
    if (g.kind !== 'milestones' && g.kind !== 'once' && !(n > 0) && !text.trim()) return;
    if ((g.kind === 'milestones' || g.kind === 'once') && !text.trim()) return;
    const id = e.create('goalUpdate', { goal: g.id, at: new Date().toISOString(), delta: g.kind === 'milestones' || g.kind === 'once' ? 0 : n || 0, text: text.trim(), src: 'Skrevet af dig' });
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
      <div className="ghead">
        <div className="meta">{g.area} · {KIND_NAMES[g.kind] ?? g.kind}{g.kind === 'count' && g.each ? ` · ${g.each}` : ''}{g.due ? ' · frist ' + new Date(g.due + 'T12:00').toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}{g.status === 'paused' ? ' · på pause' : ''}</div>
        <Btn size="sm" variant="text" icon="edit" aria-expanded={editing} onClick={() => setEditing((x) => !x)}>{editing ? 'Færdig' : 'Redigér'}</Btn>
      </div>
      <input ref={titleRef} className="gtitle" value={title} placeholder="Navngiv dit mål" aria-label="Målets navn"
        onChange={(x) => setTitle(x.target.value)} onBlur={saveTitle} onKeyDown={(x) => { if (x.key === 'Enter') { saveTitle(); x.currentTarget.blur(); } if (x.key === 'Escape') { setTitle(g.title); x.currentTarget.blur(); } }} />
      {editing && <GoalEdit g={g} onDelete={removeGoal} />}
      <div className="gfig">
        <b className="num"><CountUp key={g.id} from={from} to={s.value} duration={0.8} decimals={g.kind === 'measure' && s.value % 1 ? 1 : 0} separator="." decimalSeparator="," trigger="mount" /></b>
        <span className="muted num">{g.kind === 'measure' ? `af ${fmtN(g.target ?? 0)} ${g.unit ?? ''}` : g.kind === 'milestones' ? `af ${g.steps?.length} trin` : g.kind === 'count' ? `af ${fmtN(g.target ?? 0)} gange ${(s as any).window?.label ?? ''}` : g.kind === 'once' ? (s.value ? 'gjort' : (g.steps?.length ? `trin klaret af ${g.steps.length}` : 'ikke gjort endnu')) : `af ${g.perWeek} denne uge`}</span>
        <span className={`status push-right ${s.onTrack ? '' : 'is-due'}`}>{g.status === 'done' || s.ratio >= 1 && g.kind !== 'habit' && g.kind !== 'count' ? 'Fuldført' : g.status === 'paused' ? 'På pause' : s.onTrack ? 'På sporet' : 'Kræver handling'}</span>
      </div>
      <Progress ratio={s.ratio} focus={!s.onTrack} />
      <div className="prog__ends meta num"><span>0</span><span>{g.kind === 'measure' ? `${fmtN(g.target ?? 0)} ${g.unit}` : g.kind === 'milestones' || (g.kind === 'once' && g.steps?.length) ? `${g.steps?.length} trin` : g.kind === 'count' ? `${fmtN(g.target ?? 0)} gange` : g.kind === 'once' ? 'gjort' : `${g.perWeek} gange`}</span></div>
      <div className="gwhy">
        <label><span className="meta">Hvorfor</span><input defaultValue={g.why ?? ''} placeholder="Hvorfor betyder det noget for dig?" onBlur={(x) => x.target.value.trim() !== (g.why ?? '') && e.set('goal', g.id, { why: x.target.value.trim() })} /></label>
        <label><span className="meta">Næste skridt</span><input defaultValue={g.next ?? ''} placeholder="Det allerførste, du gør" onBlur={(x) => x.target.value.trim() !== (g.next ?? '') && e.set('goal', g.id, { next: x.target.value.trim() })} /></label>
      </div>
      <p className="gfinding">
        {g.kind === 'measure' && s.left > 0 && <><span className="strong num">{fmtN(s.left)} {g.unit} tilbage på {s.daysLeft} dage</span> kræver {fmt.num(s.needPerWeek ?? 0, 1)} {g.unit} om ugen.{s.pacePerWeek != null && <> Dit tempo i år er {fmt.num(s.pacePerWeek, 1)} {g.unit} om ugen.</>}</>}
        {g.kind === 'measure' && s.left === 0 && <span className="strong">Nået. Godt gået.</span>}
        {g.kind === 'milestones' && <><span className="strong num">{s.left} trin tilbage på {s.daysLeft} {s.daysLeft === 1 ? 'dag' : 'dage'}.</span>{!s.onTrack && ' Det næste er ' + (g.steps?.find(([, d]) => !d)?.[0] ?? '') + '.'}</>}
        {g.kind === 'habit' && <>Denne uge: <span className="strong num">{s.value} af {g.perWeek}</span>. {s.onTrack ? 'Du har holdt vanen de sidste fire uger.' : 'De sidste fire uger har været under målet.'}</>}
        {g.kind === 'count' && (s.left > 0 ? <><span className="strong num">{fmtN(s.left)} {s.left === 1 ? 'gang' : 'gange'} tilbage {(s as any).window?.label ?? ''}</span>{s.daysLeft ? `, ${s.daysLeft} dage at gøre det på` : ''}.{(s as any).expected != null && <> Efter planen burde du have nået {(s as any).expected} nu{s.onTrack ? ', så du er med.' : '.'}</>}</> : <span className="strong">Nået {(s as any).window?.label ?? ''}. Godt gået.</span>)}
        {g.kind === 'once' && (s.value ? <span className="strong">Gjort{g.doneAt ? ' ' + fmt.shortDate(g.doneAt) : ''}. Godt gået.</span> : <>{g.due ? <><span className="strong num">{s.daysLeft} {s.daysLeft === 1 ? 'dag' : 'dage'} til fristen.</span> </> : null}{g.next ? `Næste skridt: ${g.next}.` : 'Skriv det næste skridt ovenfor, så er det lettere at komme i gang.'}</>)}
      </p>
      <div className="gstatus">
        {g.kind === 'once' && !s.value && <Btn variant="primary" icon="check" onClick={() => { e.set('goal', g.id, { status: 'done', doneAt: new Date().toISOString() }); e.create('goalUpdate', { goal: g.id, at: new Date().toISOString(), delta: 1, text: 'Gjort', src: 'Skrevet af dig' }); toast({ text: `${g.title || 'Målet'} er gjort`, action: { label: 'Fortryd', run: () => e.set('goal', g.id, { status: 'active', doneAt: '' }) } }); }}>Markér som gjort</Btn>}
        {g.kind !== 'once' && g.status !== 'done' && <Btn size="sm" variant="text" icon="check" onClick={() => e.set('goal', g.id, { status: 'done', doneAt: new Date().toISOString() })}>Markér som fuldført</Btn>}
        {g.status === 'done' && <Btn size="sm" variant="text" onClick={() => e.set('goal', g.id, { status: 'active', doneAt: '' })}>Genåbn</Btn>}
        {g.status !== 'done' && <Btn size="sm" variant="text" onClick={() => e.set('goal', g.id, { status: g.status === 'paused' ? 'active' : 'paused' })}>{g.status === 'paused' ? 'Genoptag' : 'Sæt på pause'}</Btn>}
      </div>

      <div className="sparkhost">
        <ClickSpark ref={spark} sparkColor="#C9683A" sparkCount={10} sparkRadius={26} sparkSize={10} duration={450}>
          <form className="gupdate" onSubmit={log}>
            {g.kind !== 'milestones' && g.kind !== 'once' && <label className="field"><span>+</span><input inputMode="decimal" value={delta} onChange={(x) => setDelta(x.target.value)} placeholder={g.kind === 'habit' || g.kind === 'count' ? '1' : '0'} aria-label={`Antal ${g.unit ?? ''}`} /><span>{g.kind === 'habit' || g.kind === 'count' ? 'gang' : g.unit}</span></label>}
            <label className="field field--grow"><input value={text} onChange={(x) => setText(x.target.value)} placeholder="Skriv hvad der skete …" aria-label="Opdatering" /></label>
            <Btn type="submit" variant="primary">{g.kind === 'count' || g.kind === 'habit' ? (delta.trim() ? 'Log' : '+1 gang') : g.kind === 'once' || g.kind === 'milestones' ? 'Skriv note' : 'Log opdatering'}</Btn>
          </form>
        </ClickSpark>
      </div>

      {(g.kind === 'milestones' || (g.kind === 'once' && (g.steps?.length ?? 0) > 0)) && (
        <div className="glog"><div className="panel__head"><h3 className="panel__title">Trin</h3></div>
          <ul className="steps">{(g.steps ?? []).map(([t, d], i) => (
            <li key={t}><button className={`check ${d ? 'is-done' : ''}`} onClick={() => toggleStep(i)} aria-pressed={d}><span className="check__box">{d && <Icon name="check" size="sm" />}</span><span className="check__label">{t}</span></button></li>
          ))}</ul></div>
      )}

      {g.kind === 'measure' && g.start && <MonthChart values={monthly} target={(g.target ?? 0) / 12} unit={g.unit ?? ''} />}

      <div className="glog">
        <div className="panel__head"><h3 className="panel__title">Opdateringer</h3><span className="panel__count num">{s.mine.length}</span></div>
        <ul>{[...s.mine].reverse().slice(0, showAll ? undefined : 8).map((u) => <UpdateRow key={u.id} u={u} unit={g.kind === 'milestones' || g.kind === 'once' ? '' : g.kind === 'count' || g.kind === 'habit' ? 'gang' : g.unit ?? ''} />)}</ul>
        {s.mine.length > 8 && <button className="tag pad-top" onClick={() => setShowAll((x) => !x)}>{showAll ? 'Vis færre' : `Vis alle ${s.mine.length}`}</button>}
      </div>
    </div>
  );
}

/** One logged update: fix the amount or the text, or delete it (with undo). */
function UpdateRow({ u, unit }: { u: GoalUpdate; unit: string }) {
  const e = useEngine();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [d, setD] = useState(String(u.delta ?? 0).replace('.', ','));
  const [t, setT] = useState(u.text ?? '');
  const remove = () => {
    const { id: _i, type: _t, ...f } = u as any;
    e.remove('goalUpdate', u.id);
    toast({ text: 'Opdatering slettet', action: { label: 'Fortryd', run: () => e.set('goalUpdate', u.id, { ...f, _deleted: false }) } });
  };
  if (edit) return (
    <li className="uedit">
      <form onSubmit={(x) => { x.preventDefault(); const n = Number(d.replace(',', '.')); e.set('goalUpdate', u.id, { delta: Number.isFinite(n) ? n : 0, text: t.trim(), src: (u.src ?? '') + (u.src?.includes('rettet') ? '' : ' · rettet') }); setEdit(false); }}>
        <span className="meta num">{fmt.ago(u.at)}</span>
        {unit !== '' || u.delta ? <input className="kvinput" inputMode="decimal" value={d} onChange={(x) => setD(x.target.value)} aria-label="Antal" /> : <span />}
        <input className="kvinput" value={t} onChange={(x) => setT(x.target.value)} placeholder="Tekst" aria-label="Tekst" autoFocus />
        <span className="uedit__btns"><Btn size="sm" type="submit">Gem</Btn><Btn size="sm" type="button" variant="text" onClick={() => setEdit(false)}>Annullér</Btn></span>
      </form>
    </li>
  );
  return (
    <li className="urow">
      <span className="meta num">{fmt.ago(u.at)}</span>
      <span className="strong num">{u.delta ? (u.delta > 0 ? '+' : '') + fmtN(u.delta) + ' ' + unit : '—'}</span>
      <span>{u.text && <>{u.text}<br /></>}<span className="meta">{u.src}</span></span>
      <span className="urow__btns">
        <Btn size="sm" variant="text" icon="edit" aria-label="Ret opdatering" onClick={() => setEdit(true)} />
        <Btn size="sm" variant="text" icon="x" aria-label="Slet opdatering" onClick={remove} />
      </span>
    </li>
  );
}

/** Everything about a goal except its progress: kind, target, unit, steps, deadline, area. */
function GoalEdit({ g, onDelete }: { g: Goal; onDelete: () => void }) {
  const e = useEngine();
  const set = (f: Partial<Goal>) => e.set('goal', g.id, f as Record<string, unknown>);
  const [step, setStep] = useState('');
  const steps = g.steps ?? [];
  const numIn = (v: string) => { const n = Number(v.replace(',', '.')); return n > 0 ? n : undefined; };
  return (
    <div className="gedit">
      <div className="segmented" role="radiogroup" aria-label="Type">
        {(['once', 'milestones', 'count', 'measure', 'habit'] as GoalKind[]).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={g.kind === k} className={g.kind === k ? 'is-active' : ''}
            onClick={() => set({ kind: k, ...(k === 'habit' && !g.perWeek ? { perWeek: 2 } : {}), ...(k === 'milestones' && !g.steps ? { steps: [] } : {}), ...(k === 'count' && !g.target ? { target: 10, period: 'year' } : {}) })}>{KIND_NAMES[k]}</button>
        ))}
      </div>
      <div className="gedit__grid">
        {g.kind === 'measure' && <>
          <label className="ufield"><span>Mål</span><input inputMode="decimal" defaultValue={g.target ?? ''} onBlur={(x) => { const n = numIn(x.target.value); if (n) set({ target: n }); }} placeholder="fx 300" /></label>
          <label className="ufield"><span>Enhed</span><input defaultValue={g.unit ?? ''} onBlur={(x) => set({ unit: x.target.value.trim() })} placeholder="fx km, kr, bøger" /></label>
        </>}
        {g.kind === 'count' && <>
          <label className="ufield"><span>Hvor mange gange</span><input inputMode="numeric" defaultValue={g.target ?? ''} onBlur={(x) => { const n = numIn(x.target.value); if (n) set({ target: Math.round(n) }); }} placeholder="fx 10" /></label>
          <label className="ufield"><span>Hvad er én gang</span><input defaultValue={g.each ?? ''} onBlur={(x) => set({ each: x.target.value.trim() })} placeholder="fx løbe 5 km" /></label>
          <label className="ufield"><span>Pr.</span><select value={g.period ?? 'total'} onChange={(x) => set({ period: x.target.value as Period })}>{(['year', 'month', 'week', 'total'] as Period[]).map((p) => <option key={p} value={p}>{p === 'total' ? 'I alt (inden fristen)' : PERIOD_NAMES[p].replace(/^om /, '').replace(/^./, (c) => c.toUpperCase())}</option>)}</select></label>
        </>}
        {g.kind === 'habit' && <label className="ufield"><span>Gange om ugen</span><input inputMode="numeric" defaultValue={g.perWeek ?? 1} onBlur={(x) => { const n = numIn(x.target.value); if (n) set({ perWeek: Math.round(n) }); }} /></label>}
        {g.kind !== 'habit' && <label className="ufield"><span>Frist</span><input type="date" defaultValue={g.due ?? ''} onChange={(x) => set({ due: x.target.value || undefined })} /></label>}
        <label className="ufield"><span>Område</span><input list="goal-areas" defaultValue={g.area ?? ''} onBlur={(x) => set({ area: x.target.value.trim() || 'Privat' })} /></label>
        <datalist id="goal-areas">{['Privat', 'Arbejde', 'Sundhed', 'Økonomi', 'Projekter', 'Familie'].map((a) => <option key={a} value={a} />)}</datalist>
      </div>
      {(g.kind === 'milestones' || g.kind === 'once') && (
        <div className="gedit__steps">{g.kind === 'once' && <span className="meta">Trin (valgfrit): del opgaven op, hvis den er stor.</span>}
          <ul className="rows">{steps.map(([t, d], i) => (
            <li key={i} className="memrow"><span className="row__body"><span className={d ? 'faint' : ''}>{t}</span></span>
              <Btn size="sm" variant="text" icon="x" aria-label={`Fjern ${t}`} onClick={() => set({ steps: steps.filter((_, j) => j !== i) })} /></li>
          ))}</ul>
          <form className="askbar" onSubmit={(x) => { x.preventDefault(); if (step.trim()) { set({ steps: [...steps, [step.trim(), false]] }); setStep(''); } }}>
            <input value={step} onChange={(x) => setStep(x.target.value)} placeholder="Nyt trin …" aria-label="Nyt trin" />
            <Btn type="submit" icon="plus" disabled={!step.trim()}>Tilføj</Btn>
          </form>
        </div>
      )}
      <div className="gedit__foot"><Btn size="sm" variant="text" icon="x" onClick={onDelete}>Slet mål</Btn></div>
    </div>
  );
}

const EXAMPLES: Record<GoalKind, string> = { once: 'Få lavet hjemmesiden · Søge nyt job · Male stuen', milestones: 'Bygge SmartLink · Flytte · Planlægge rejsen', count: 'Løbe 5 km 10 gange i år · 2 koncerter om måneden', measure: 'Spare 10.000 kr · Løbe 300 km · Læse 12 bøger', habit: 'Træne 3 gange om ugen · Meditere 5 gange om ugen' };

/** A new goal: name it, pick what kind it is, fill in the few numbers that kind needs. */
function NewGoal({ onClose, onMade }: { onClose: () => void; onMade: (id: string) => void }) {
  const e = useEngine();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<GoalKind>('once');
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('');
  const [each, setEach] = useState('');
  const [period, setPeriod] = useState<Period>('year');
  const [due, setDue] = useState('');
  const [area, setArea] = useState('Privat');
  function make(ev: React.FormEvent) {
    ev.preventDefault();
    if (!title.trim()) return;
    const n = Number(target.replace(',', '.'));
    const f: Record<string, unknown> = { title: title.trim(), kind, area, start: new Date().toISOString().slice(0, 10), order: e.list('goal').length + 1, status: 'active' };
    if (due) f.due = due;
    if (kind === 'measure') { f.target = n > 0 ? n : 1; f.unit = unit.trim(); }
    if (kind === 'count') { f.target = n > 0 ? Math.round(n) : 10; f.each = each.trim(); f.period = period; }
    if (kind === 'habit') f.perWeek = n > 0 ? Math.round(n) : 3;
    if (kind === 'milestones') f.steps = [];
    onMade(e.create('goal', f));
  }
  return (
    <div>
      <div className="scrim" onClick={onClose} />
      <form className="sheet newgoal" role="dialog" aria-label="Nyt mål" onSubmit={make}>
        <div className="sheet__body">
          <h2>Nyt mål</h2>
          <input className="gtitle" autoFocus value={title} onChange={(x) => setTitle(x.target.value)} placeholder="Hvad vil du nå?" aria-label="Målets navn" />
          <div className="gkinds" role="radiogroup" aria-label="Slags mål">
            {(['once', 'milestones', 'count', 'measure', 'habit'] as GoalKind[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={`gkind ${kind === k ? 'is-active' : ''}`} onClick={() => setKind(k)}>
                <b>{KIND_NAMES[k]}</b><span className="meta">{EXAMPLES[k]}</span>
              </button>
            ))}
          </div>
          <div className="gedit__grid">
            {kind === 'count' && <>
              <label className="ufield"><span>Hvor mange gange</span><input inputMode="numeric" value={target} onChange={(x) => setTarget(x.target.value)} placeholder="10" /></label>
              <label className="ufield"><span>Hvad er én gang</span><input value={each} onChange={(x) => setEach(x.target.value)} placeholder="løbe 5 km" /></label>
              <label className="ufield"><span>Pr.</span><select value={period} onChange={(x) => setPeriod(x.target.value as Period)}><option value="year">År</option><option value="month">Måned</option><option value="week">Uge</option><option value="total">I alt (inden fristen)</option></select></label>
            </>}
            {kind === 'measure' && <>
              <label className="ufield"><span>Mål</span><input inputMode="decimal" value={target} onChange={(x) => setTarget(x.target.value)} placeholder="10.000" /></label>
              <label className="ufield"><span>Enhed</span><input value={unit} onChange={(x) => setUnit(x.target.value)} placeholder="kr, km, bøger" /></label>
            </>}
            {kind === 'habit' && <label className="ufield"><span>Gange om ugen</span><input inputMode="numeric" value={target} onChange={(x) => setTarget(x.target.value)} placeholder="3" /></label>}
            {(kind !== 'habit' && !(kind === 'count' && period !== 'total')) && <label className="ufield"><span>Frist (valgfri)</span><input type="date" value={due} onChange={(x) => setDue(x.target.value)} /></label>}
            <label className="ufield"><span>Område</span><input list="goal-areas-new" value={area} onChange={(x) => setArea(x.target.value)} /></label>
            <datalist id="goal-areas-new">{['Privat', 'Arbejde', 'Sundhed', 'Økonomi', 'Projekter', 'Familie', 'Musik'].map((a) => <option key={a} value={a} />)}</datalist>
          </div>
          <p className="meta">Du kan også bare fortælle Assist om målet med dine egne ord, så sætter den det op.</p>
          <div className="sheet__foot"><span className="push-right" /><Btn type="button" variant="text" onClick={onClose}>Annullér</Btn><Btn type="submit" variant="primary" disabled={!title.trim()}>Lav målet</Btn></div>
        </div>
      </form>
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
