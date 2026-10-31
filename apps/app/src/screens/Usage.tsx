import { useMemo, useRef, useState } from 'react';
import { useEngine, useList, useRoute } from '../state.tsx';
import { Btn, Panel } from '../ui/primitives.tsx';
import { Progress } from '../ui/DayStrip.tsx';
import { Donut, MonthBars } from '../ui/Charts.tsx';
import { useScreenEnter } from '../motion.ts';
import { aiSettings, saveAiSettings, CLAUDE_MODELS } from '../ai/agent.ts';
import { FEATURES, MODEL_NAMES, MODEL_ORDER, type Feature, type UsageRow, type LogEntry } from '../ai/usage.ts';
import { kr } from '../money.ts';
import CountUp from '../bits/CountUp.jsx';

/** Model slot colours: Haiku green, Sonnet blue, Opus violet (fixed, so a model keeps its colour). */
const MODEL_SLOT: Record<string, number> = { 'claude-haiku-5-5': 2, 'claude-sonnet-5-5': 0, 'claude-opus-5-5': 5 };
const FEATURE_SLOT: Record<Feature, number> = { chat: 0, kvittering: 3, udlaeg: 4, mailsortering: 2, test: 5, andet: -1 };
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
        <div className="kpi"><span className="meta">Sparet denne måned</span><b className="num">{kr(saved)}</b><span className="meta">ved Haiku og cache, i forhold til alt på Sonnet</span></div>
        <div className="kpi"><span className="meta">Fra cache</span><b className="num">{Math.round(cacheShare * 100)} %</b><span className="meta">af det, Claude læste, kom fra cache (koster 5 % af prisen)</span></div>
      </div>

      <div className="grid12">
        <Panel title="Model og budget" className="span-12">
          <div className="kv"><span>Model<span className="meta block">Automatisk bruger altid Haiku, den billigste. Vil du have et grundigere svar, så tryk Svar grundigere under svaret (Sonnet).</span></span>
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
          <p className="meta pad-top">Haiku koster omkring en tyvendedel af Sonnet. Sonnet bruges kun, når du selv beder om det. <Btn size="sm" variant="text" onClick={() => go({ screen: 'assist' })}>Åbn Assist</Btn></p>
        </Panel>
        <ClaudeSpend />
      </div>
    </main>
  );
}

/* ================================================================ the log: what Claude was used for */
const smallKr = (dkk: number) => (dkk < 0.995 ? `${(dkk * 100).toLocaleString('da-DK', { maximumFractionDigits: dkk * 100 < 10 ? 1 : 0 })} øre` : kr(dkk));
const usdText = (usd: number) => `$${usd.toLocaleString('en-US', { minimumFractionDigits: usd < 0.01 ? 4 : 3, maximumFractionDigits: usd < 0.01 ? 4 : 3 })}`;
const LOG_FILTERS: [string, string, Feature[] | null][] = [['all', 'Alt', null], ['chat', 'Assist', ['chat']], ['money', 'Kvitteringer og udlæg', ['kvittering', 'udlaeg']], ['mail', 'Mail', ['mailsortering']]];

/**
 * Claude-forbrug as a section in Udgifter: this month in kroner and dollars, and a log of every use
 * (what you asked or what CENTRA did, which model, tokens, price).
 */
export function ClaudeSpend() {
  const e = useEngine();
  const { go } = useRoute();
  const log = useList('usagelog', (a, b) => (b.at ?? '').localeCompare(a.at ?? '')) as unknown as LogEntry[];
  const rows = useList('usage') as unknown as UsageRow[];
  useList('setting');
  const rate = aiSettings(e).usdDkk || 6.9;
  const [filter, setFilter] = useState('all');
  const [shown, setShown] = useState(12);
  const [open, setOpen] = useState<string | null>(null);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const mRows = rows.filter((r) => r.day.startsWith(month));
  const monthUsd = mRows.reduce((s, r) => s + r.usd, 0);
  const monthTok = mRows.reduce((s, r) => s + r.input + r.cacheWrite + r.cacheRead + r.output, 0);
  const monthCalls = mRows.reduce((s, r) => s + r.calls, 0);
  const lastMonth = (() => { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; return rows.filter((r) => r.day.startsWith(k)).reduce((s, r) => s + r.usd, 0); })();
  const kinds = LOG_FILTERS.find(([k]) => k === filter)?.[2];
  const list = log.filter((x) => !kinds || kinds.includes(x.feature));
  const day = (iso: string) => { const d = new Date(iso); const t = d.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }); return d.toDateString() === now.toDateString() ? `I dag ${t}` : `${d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })} ${t}`; };

  return (
    <Panel title="Claude (AI)" className="span-12 cspend" count={`${now.toLocaleDateString('da-DK', { month: 'long' })}`} aside={<Btn size="sm" variant="text" className="push-right" onClick={() => go({ screen: 'usage' })}>Detaljer og budget</Btn>}>
      <div className="cspend__sum">
        <div><span className="meta">Denne måned</span><b className="num">{kr(monthUsd * rate)}</b><span className="meta num">{usdText(monthUsd)} · 1 $ = {rate.toLocaleString('da-DK')} kr</span></div>
        <div><span className="meta">Tokens</span><b className="num">{fmtTok(monthTok)}</b><span className="meta num">{monthCalls} kald til Claude</span></div>
        <div><span className="meta">Sidste måned</span><b className="num">{kr(lastMonth * rate)}</b><span className="meta num">{usdText(lastMonth)}</span></div>
      </div>
      <div className="cspend__head">
        <div className="mfilter" role="radiogroup" aria-label="Vis">
          {LOG_FILTERS.map(([k, l]) => <button key={k} role="radio" aria-checked={filter === k} className={filter === k ? 'is-active' : ''} onClick={() => { setFilter(k); setShown(12); }}>{l}</button>)}
        </div>
      </div>
      {list.length ? (
        <ul className="clog">
          {list.slice(0, shown).map((x) => {
            const tokIn = x.input + x.cacheWrite + x.cacheRead;
            return (
              <li key={x.id} className={open === x.id ? 'is-open' : ''}>
                <button type="button" className="clog__row" aria-expanded={open === x.id} onClick={() => setOpen(open === x.id ? null : x.id)}>
                  <i className="xdot" style={{ background: `var(--viz-${MODEL_SLOT[x.model] !== undefined ? MODEL_SLOT[x.model] + 1 : 6})` }} />
                  <span className="clog__what"><span className="ellipsis">{x.label || FEATURES[x.feature]}</span>
                    <span className="meta ellipsis">{day(x.at)} · {MODEL_NAMES[x.model] ?? x.model} · {FEATURES[x.feature] ?? x.feature} · {fmtTok(tokIn + x.output)} tokens</span></span>
                  <span className="clog__price num"><b>{smallKr(x.usd * rate)}</b><span className="meta">{usdText(x.usd)}</span></span>
                </button>
                {open === x.id && (
                  <div className="clog__more">
                    {x.detail && <p className="small">Gjorde: {x.detail}</p>}
                    <dl className="clog__tok num">
                      <div><dt>Ind</dt><dd>{x.input.toLocaleString('da-DK')}</dd></div>
                      <div><dt>Fra cache</dt><dd>{x.cacheRead.toLocaleString('da-DK')}</dd></div>
                      <div><dt>Til cache</dt><dd>{x.cacheWrite.toLocaleString('da-DK')}</dd></div>
                      <div><dt>Ud</dt><dd>{x.output.toLocaleString('da-DK')}</dd></div>
                      <div><dt>Kald</dt><dd>{x.calls}</dd></div>
                    </dl>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : <p className="muted">{log.length ? 'Intet af den slags endnu.' : 'Intet brugt endnu. Hver gang CENTRA bruger Claude (Assist, kvitteringer, udlæg, mailsortering), kommer det på listen her med pris.'}</p>}
      {list.length > shown && <Btn size="sm" variant="text" onClick={() => setShown((n) => n + 30)}>Vis flere ({list.length - shown})</Btn>}
      <p className="meta">Beregnet ud fra Anthropics listepriser. Den officielle regning står på din konto hos Anthropic.</p>
    </Panel>
  );
}
