import { useMemo, useRef } from 'react';
import { useEngine, useList, useRoute } from '../state.tsx';
import { Btn, Panel } from '../ui/primitives.tsx';
import { Progress } from '../ui/DayStrip.tsx';
import { Donut, MonthBars } from '../ui/Charts.tsx';
import { useScreenEnter } from '../motion.ts';
import { aiSettings, saveAiSettings, CLAUDE_MODELS } from '../ai/agent.ts';
import { FEATURES, MODEL_NAMES, MODEL_ORDER, type Feature, type UsageRow } from '../ai/usage.ts';
import { kr } from '../money.ts';
import CountUp from '../bits/CountUp.jsx';

/** Model slot colours: Haiku green, Sonnet blue, Opus violet (fixed, so a model keeps its colour). */
const MODEL_SLOT: Record<string, number> = { 'claude-haiku-5-5': 2, 'claude-sonnet-5-5': 0, 'claude-opus-5-5': 5 };
const FEATURE_SLOT: Record<Feature, number> = { chat: 0, kvittering: 3, mailsortering: 2, test: 5, andet: -1 };
const fmtTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('da-DK', { maximumFractionDigits: 1 })} mio.` : n >= 1000 ? `${Math.round(n / 1000).toLocaleString('da-DK')}k` : String(n));

/** Claude-forbrug: what Assist has cost, per day, model and feature, and what routing and caching saved. */
export function UsageScreen() {
  const e = useEngine();
  const { go } = useRoute();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'usage');
  const rows = useList('usage') as unknown as UsageRow[];
  useList('setting');
  const s = aiSettings(e);
  const rate = s.usdDkk || 6.9;
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const today = `${month}-${String(now.getDate()).padStart(2, '0')}`;
  const mRows = rows.filter((r) => r.day.startsWith(month));
  const sum = (rs: UsageRow[], k: keyof UsageRow) => rs.reduce((a, r) => a + (r[k] as number), 0);
  const monthDkk = sum(mRows, 'usd') * rate;
  const todayDkk = sum(rows.filter((r) => r.day === today), 'usd') * rate;
  const saved = Math.max(0, sum(mRows, 'baseline') - sum(mRows, 'usd')) * rate;
  const dayOfMonth = now.getDate(), daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const forecast = dayOfMonth ? (monthDkk / dayOfMonth) * daysInMonth : 0;
  const cacheShare = (() => { const read = sum(mRows, 'cacheRead'), all = read + sum(mRows, 'input') + sum(mRows, 'cacheWrite'); return all ? read / all : 0; })();

  const bars = useMemo(() => Array.from({ length: 30 }, (_, k) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29 + k);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const rs = rows.filter((r) => r.day === key);
    return { label: k % 5 === 4 || k === 29 ? String(d.getDate()) : '', current: k === 29, parts: MODEL_ORDER.map((m) => ({ label: MODEL_NAMES[m], value: sum(rs.filter((r) => r.model === m), 'usd') * rate, slot: MODEL_SLOT[m] })) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, rate]);

  const byFeature = (Object.keys(FEATURES) as Feature[]).map((f) => ({ label: FEATURES[f], value: sum(mRows.filter((r) => r.feature === f), 'usd') * rate, slot: FEATURE_SLOT[f] })).filter((x) => x.value > 0);
  const byModel = MODEL_ORDER.map((m) => { const rs = mRows.filter((r) => r.model === m); return { m, calls: sum(rs, 'calls'), input: sum(rs, 'input') + sum(rs, 'cacheWrite') + sum(rs, 'cacheRead'), output: sum(rs, 'output'), dkk: sum(rs, 'usd') * rate }; });
  const budget = s.budgetDkk || 0;

  return (
    <main className="canvas" ref={ref}>
      <div className="titlerow" data-enter>
        <div><h1>Claude-forbrug</h1><p>Beregnet ud fra Anthropics listepriser i kroner (1 $ = {rate.toLocaleString('da-DK')} kr). Den officielle regning står på din konto hos Anthropic.</p></div>
        <div className="actions"><a className="btn btn--secondary" href="https://console.anthropic.com/" target="_blank" rel="noreferrer">Åbn Anthropic-kontoen ↗</a></div>
      </div>

      <div className="kpis" data-enter>
        <div className="kpi"><span className="meta">{now.toLocaleDateString('da-DK', { month: 'long' }).replace(/^./, (c) => c.toUpperCase())} indtil nu</span><b className="num"><CountUp to={monthDkk} from={0} decimals={2} duration={0.9} separator="." decimalSeparator="," trigger="mount" /> kr</b><span className="meta num">Forventet hele måneden: {kr(forecast)}</span></div>
        <div className="kpi"><span className="meta">I dag</span><b className="num">{kr(todayDkk)}</b><span className="meta num">{sum(rows.filter((r) => r.day === today), 'calls')} kald</span></div>
        <div className="kpi"><span className="meta">Sparet denne måned</span><b className="num">{kr(saved)}</b><span className="meta">ved automatisk modelvalg og cache, i forhold til alt på Sonnet</span></div>
        <div className="kpi"><span className="meta">Fra cache</span><b className="num">{Math.round(cacheShare * 100)} %</b><span className="meta">af det, Claude læste, kom fra cache (koster 5 % af prisen)</span></div>
      </div>

      <div className="grid12">
        <Panel title="Model og budget" className="span-12">
          <div className="kv"><span>Model<span className="meta block">Automatisk vælger Haiku til korte kommandoer, Opus til planlægning og analyse, og Sonnet til resten. Mailsortering bruger altid Haiku.</span></span>
            <select className="kvinput" value={s.modelMode || 'auto'} onChange={(x) => saveAiSettings(e, { modelMode: x.target.value })} aria-label="Model">{CLAUDE_MODELS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></div>
          <div className="kv"><span>Månedligt budget (kr)<span className="meta block">Når det er brugt, svarer Assist kun med Haiku resten af måneden. 0 = intet loft.</span></span>
            <input className="kvinput num" inputMode="numeric" defaultValue={budget || ''} placeholder="0" onBlur={(x) => saveAiSettings(e, { budgetDkk: Math.max(0, Number(x.target.value.replace(',', '.')) || 0) })} aria-label="Budget i kroner" /></div>
          {budget > 0 && <div className="budgetbar"><Progress ratio={monthDkk / budget} focus={monthDkk > budget * 0.8} /><span className="meta num">{kr(monthDkk)} af {kr(budget, { short: true })}{monthDkk >= budget ? ' · budgettet er brugt, Assist bruger Haiku' : ''}</span></div>}
          <div className="kv"><span>Kurs (kr pr. dollar)</span><input className="kvinput num" inputMode="decimal" defaultValue={String(rate).replace('.', ',')} onBlur={(x) => { const v = Number(x.target.value.replace(',', '.')); if (v > 0) saveAiSettings(e, { usdDkk: v }); }} aria-label="Kurs" /></div>
        </Panel>

        <Panel title="Pr. dag" className="span-7" count="seneste 30 dage">
          {rows.length ? <><MonthBars bars={bars} /><ul className="legend legend--row">{MODEL_ORDER.map((m) => <li key={m}><i style={{ background: `var(--viz-${MODEL_SLOT[m] + 1})` }} /><span>{MODEL_NAMES[m]}</span></li>)}</ul></> : <p className="muted">Intet forbrug endnu. Det dukker op her, så snart du bruger Assist.</p>}
        </Panel>
        <Panel title="Hvad pengene går til" className="span-5" count="denne måned">
          {byFeature.length ? <Donut data={byFeature} center={kr(monthDkk)} sub="denne måned" /> : <p className="muted">Intet endnu.</p>}
        </Panel>

        <Panel title="Pr. model" className="span-12" count="denne måned">
          <table className="utable">
            <thead><tr><th>Model</th><th className="num">Kald</th><th className="num">Tokens ind</th><th className="num">Tokens ud</th><th className="num">Pris</th><th className="num">Pr. 1 mio. ind / ud</th></tr></thead>
            <tbody>{byModel.map((r) => (
              <tr key={r.m}><td><i className="xdot" style={{ background: `var(--viz-${MODEL_SLOT[r.m] + 1})` }} />{MODEL_NAMES[r.m]}</td><td className="num">{r.calls}</td><td className="num">{fmtTok(r.input)}</td><td className="num">{fmtTok(r.output)}</td><td className="num">{kr(r.dkk)}</td>
                <td className="num meta">{r.m.includes('haiku') ? '0,10 / 0,50 $' : r.m.includes('sonnet') ? '2 / 10 $' : '4 / 20 $'}</td></tr>
            ))}</tbody>
          </table>
          <p className="meta pad-top">Tip: korte, præcise beskeder til Assist bliver klaret af Haiku, som koster omkring en tyvendedel af Sonnet. <Btn size="sm" variant="text" onClick={() => go({ screen: 'assist' })}>Åbn Assist</Btn></p>
        </Panel>
      </div>
    </main>
  );
}
