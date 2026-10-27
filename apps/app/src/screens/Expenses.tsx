import { useMemo, useRef, useState } from 'react';
import { useEngine, useList, useRoute, fmt } from '../state.tsx';
import { Btn, Panel } from '../ui/primitives.tsx';
import { Icon } from '../ui/Icon.tsx';
import { useToast } from '../ui/Shell.tsx';
import { useScreenEnter } from '../motion.ts';
import { Donut, MonthBars, SLOTS } from '../ui/Charts.tsx';
import { CATEGORIES, INTERVALS, SERVICES, cancelLink, kr, monthSpend, parseKr, payDates, perMonth, serviceFor, type Expense, type Interval } from '../money.ts';
import CountUp from '../bits/CountUp.jsx';
import { queueAssist } from './Assist.tsx';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const slotOf = (c: string) => { const i = CATEGORIES.indexOf(c); return i >= 0 && i < SLOTS ? i : -1; };
const per = (x: Expense) => ({ month: '/md', quarter: '/kvt', halfyear: '/halvår', year: '/år', week: '/uge', once: '' })[x.interval];

/** Udgifter: what goes out every month, where it goes, what's coming, and where to cancel it. */
export function Expenses() {
  const e = useEngine();
  const { go } = useRoute();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'expenses');
  const list = useList('expense', (a, b) => perMonth(b as any) - perMonth(a as any) || (b.amount ?? 0) - (a.amount ?? 0)) as unknown as Expense[];
  useList('outlay');
  const [edit, setEdit] = useState<Expense | 'new' | null>(null);
  const [cat, setCat] = useState<string | null>(null);
  const now = new Date();

  const fixed = list.filter((x) => x.interval !== 'once' && x.active !== false);
  const monthly = fixed.reduce((s, x) => s + perMonth(x), 0);
  const subs = fixed.filter((x) => x.category === 'Abonnementer');
  const thisMonth = monthSpend(e, now.getFullYear(), now.getMonth());
  const thisTotal = thisMonth.reduce((s, x) => s + x.amount, 0);
  const paidSoFar = thisMonth.filter((x) => new Date(x.date + 'T12:00') <= now).reduce((s, x) => s + x.amount, 0);

  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of fixed) m.set(x.category || 'Andet', (m.get(x.category || 'Andet') ?? 0) + perMonth(x));
    const named = [...m.entries()].filter(([c]) => slotOf(c) >= 0).sort((a, b) => slotOf(a[0]) - slotOf(b[0])).map(([label, value]) => ({ label, value, slot: slotOf(label) }));
    const other = [...m.entries()].filter(([c]) => slotOf(c) < 0).reduce((s, [, v]) => s + v, 0);
    return other > 0 ? [...named, { label: 'Andet', value: other, slot: -1 }] : named;
  }, [fixed]);

  const bars = useMemo(() => Array.from({ length: 12 }, (_, k) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 6 + k, 1);
    const spend = monthSpend(e, d.getFullYear(), d.getMonth());
    const m = new Map<string, number>();
    for (const s of spend) { const c = slotOf(s.category) >= 0 ? s.category : 'Andet'; m.set(c, (m.get(c) ?? 0) + s.amount); }
    return { label: MONTHS[d.getMonth()], current: k === 6, future: k > 6, parts: [...m.entries()].sort((a, b) => (slotOf(a[0]) < 0 ? 99 : slotOf(a[0])) - (slotOf(b[0]) < 0 ? 99 : slotOf(b[0]))).map(([label, value]) => ({ label, value, slot: slotOf(label) })) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [list, e]);

  const soon = useMemo(() => {
    const to = new Date(now); to.setDate(to.getDate() + 31);
    return list.flatMap((x) => payDates(x, new Date(now.getFullYear(), now.getMonth(), now.getDate()), to).map((d) => ({ x, d }))).sort((a, b) => a.d.getTime() - b.d.getTime()).slice(0, 8);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  const shown = list.filter((x) => !cat || (cat === 'Andet' ? slotOf(x.category) < 0 : x.category === cat));

  return (
    <main className="canvas" ref={ref}>
      <div className="titlerow" data-enter>
        <div><h1>Udgifter</h1><p>{list.length ? `${fixed.length} faste udgifter. Klik på en kategori for at filtrere.` : 'Få overblik over hvad der går ud hver måned, og hvor du kan opsige det.'}</p></div>
        <div className="actions">
          <Btn icon="assist" onClick={() => { queueAssist('Gennemgå mine mails og find faste udgifter og abonnementer (kvitteringer, fornyelser, fakturaer). Vis dem, og spørg før du tilføjer dem til Udgifter.'); go({ screen: 'assist' }); }}>Find i mine mails</Btn>
          <Btn variant="primary" icon="plus" onClick={() => setEdit('new')}>Ny udgift</Btn>
        </div>
      </div>

      <div className="kpis" data-enter>
        <div className="kpi"><span className="meta">Faste udgifter pr. måned</span><b className="num"><CountUp to={monthly} from={0} duration={0.9} separator="." decimalSeparator="," trigger="mount" /> kr</b><span className="meta num">{kr(monthly * 12, { short: true })} om året</span></div>
        <div className="kpi"><span className="meta">{MONTHS[now.getMonth()].replace(/^./, (c) => c.toUpperCase())} i alt</span><b className="num"><CountUp to={thisTotal} from={0} duration={0.9} separator="." decimalSeparator="," trigger="mount" /> kr</b><span className="meta num">{kr(paidSoFar, { short: true })} betalt indtil nu</span></div>
        <div className="kpi"><span className="meta">Abonnementer</span><b className="num">{subs.length}</b><span className="meta num">{kr(subs.reduce((s, x) => s + perMonth(x), 0), { short: true })} pr. måned</span></div>
        <div className="kpi"><span className="meta">Næste betaling</span><b className="ellipsis">{soon[0] ? soon[0].x.name : '—'}</b><span className="meta num">{soon[0] ? `${fmt.shortDate(soon[0].d.toISOString())} · ${kr(soon[0].x.amount)}` : 'Ingen de næste 30 dage'}</span></div>
      </div>

      {list.length > 0 && (
        <div className="grid12">
          <Panel title="Hvor pengene går hen" className="span-5" count="pr. måned">
            {byCat.length ? <Donut data={byCat} center={kr(monthly, { short: true })} sub="pr. måned" /> : <p className="muted">Tilføj faste udgifter for at se fordelingen.</p>}
          </Panel>
          <Panel title="Måned for måned" className="span-7" count="6 måneder tilbage og 5 frem">
            <MonthBars bars={bars} />
          </Panel>
        </div>
      )}

      <div className="grid12">
        <Panel title="Alle udgifter" className="span-7" count={shown.length}>
          {byCat.length > 1 && <div className="acctpick">{[null, ...byCat.map((c) => c.label)].map((c) => <button key={c ?? 'all'} className={cat === c ? 'is-active' : ''} aria-pressed={cat === c} onClick={() => setCat(c)}>{c ?? 'Alle'}</button>)}</div>}
          {shown.length ? (
            <ul className="xlist">{shown.map((x) => (
              <li key={x.id} className={x.active === false ? 'is-off' : ''}>
                <i className="xdot" style={{ background: slotOf(x.category) >= 0 ? `var(--viz-${slotOf(x.category) + 1})` : 'var(--viz-other)' }} />
                <button className="row__body xname" onClick={() => setEdit(x)}><span className="strong ellipsis">{x.name}</span><span className="meta">{x.category}{x.interval === 'once' ? ` · ${fmt.shortDate(x.date)}` : ` · ${INTERVALS.find(([k]) => k === x.interval)?.[1].toLowerCase()}`}{x.active === false ? ' · stoppet' : ''}</span></button>
                <span className="num xamt">{kr(x.amount)}<span className="meta">{per(x)}</span></span>
                {x.interval !== 'once' && x.active !== false && <a className="btn btn--text btn--sm" href={cancelLink(x)} target="_blank" rel="noreferrer" title={x.cancelUrl || serviceFor(x.name) ? 'Gå til opsigelse' : 'Søg efter hvordan du opsiger'}>Opsig ↗</a>}
                <Btn size="sm" variant="text" icon="edit" aria-label={`Ret ${x.name}`} onClick={() => setEdit(x)} />
              </li>
            ))}</ul>
          ) : <p className="muted">Ingen udgifter endnu. Tilføj husleje, abonnementer, forsikringer, telefon og andre faste betalinger, eller lad Assist finde dem i dine mails.</p>}
        </Panel>
        <Panel title="De næste 30 dage" className="span-5" count={soon.length}>
          {soon.length ? <ul className="rows">{soon.map(({ x, d }, i) => (
            <li key={x.id + i} className="memrow"><span className="soondate num"><b>{d.getDate()}</b><span className="meta">{MONTHS[d.getMonth()]}</span></span><span className="row__body"><span className="ellipsis">{x.name}</span><span className="meta">{x.category}</span></span><span className="num">{kr(x.amount)}</span></li>
          ))}</ul> : <p className="muted">Intet planlagt.</p>}
        </Panel>
      </div>
      {edit && <ExpenseEditor x={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

function ExpenseEditor({ x, onClose }: { x: Expense | null; onClose: () => void }) {
  const e = useEngine();
  const toast = useToast();
  const [f, setF] = useState({ name: x?.name ?? '', amount: x ? String(x.amount).replace('.', ',') : '', interval: (x?.interval ?? 'month') as Interval, category: x?.category ?? 'Abonnementer', date: x?.date ?? new Date().toISOString().slice(0, 10), end: x?.end ?? '', cancelUrl: x?.cancelUrl ?? '', note: x?.note ?? '', active: x?.active !== false });
  const [err, setErr] = useState<string | null>(null);
  const svc = serviceFor(f.name);
  const set = (k: keyof typeof f) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((o) => ({ ...o, [k]: ev.target.type === 'checkbox' ? (ev.target as HTMLInputElement).checked : ev.target.value }));

  function save(ev: React.FormEvent) {
    ev.preventDefault();
    const amount = parseKr(f.amount);
    if (!f.name.trim()) return setErr('Giv udgiften et navn.');
    if (!Number.isFinite(amount) || amount <= 0) return setErr('Skriv et beløb, fx 129 eller 1.299,50.');
    const fields = { name: f.name.trim(), amount, interval: f.interval, category: f.category, date: f.date, end: f.end || '', cancelUrl: f.cancelUrl.trim(), note: f.note.trim(), active: f.active };
    if (x) { const { id: _i, type: _t, ...prev } = x as any; e.set('expense', x.id, fields); toast({ icon: 'wallet', text: `${fields.name} er gemt`, action: { label: 'Fortryd', run: () => e.set('expense', x.id, prev) } }); }
    else { const id = e.create('expense', fields); toast({ icon: 'wallet', text: `${fields.name} er tilføjet til Udgifter`, action: { label: 'Fortryd', run: () => e.remove('expense', id) } }); }
    onClose();
  }
  function remove() {
    if (!x) return;
    const { id: _i, type: _t, ...prev } = x as any;
    e.remove('expense', x.id);
    toast({ icon: 'wallet', text: `${x.name} er slettet`, action: { label: 'Fortryd', run: () => e.set('expense', x.id, { ...prev, _deleted: false }) } });
    onClose();
  }

  return (
    <div>
      <div className="scrim" onClick={onClose} />
      <form className="sheet" role="dialog" aria-label={x ? 'Ret udgift' : 'Ny udgift'} onSubmit={save}>
        <div className="sheet__body">
          <input className="gtitle" autoFocus list="services" value={f.name} placeholder="Navn, fx Netflix eller Husleje" aria-label="Navn"
            onChange={(ev) => { const v = ev.target.value; const s = serviceFor(v); setF((o) => ({ ...o, name: v, ...(s && !x ? { category: s.category } : {}) })); }} />
          <datalist id="services">{SERVICES.map((s) => <option key={s.name} value={s.name} />)}</datalist>
          <div className="gedit__grid">
            <label className="ufield"><span>Beløb (kr)</span><input inputMode="decimal" value={f.amount} onChange={set('amount')} placeholder="129" /></label>
            <label className="ufield"><span>Hvor tit</span><select value={f.interval} onChange={set('interval')}>{INTERVALS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="ufield"><span>Kategori</span><select value={f.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="ufield"><span>{f.interval === 'once' ? 'Dato' : 'Første betaling'}</span><input type="date" value={f.date} onChange={set('date')} /></label>
            {f.interval !== 'once' && <label className="ufield"><span>Slutter (valgfrit)</span><input type="date" value={f.end} onChange={set('end')} /></label>}
          </div>
          {f.interval !== 'once' && (
            <label className="ufield"><span>Link til opsigelse eller ændring</span><input value={f.cancelUrl} onChange={set('cancelUrl')} placeholder={svc ? svc.cancel : 'https://… (tom: CENTRA finder et)'} spellCheck={false} />
              <span className="meta">{f.cancelUrl ? 'Dit eget link bruges.' : svc ? `Kendt tjeneste: ${svc.name}. Link til opsigelse er sat.` : 'Uden link søger "Opsig" på nettet efter, hvordan du opsiger den.'}</span></label>
          )}
          <label className="ufield"><span>Note</span><input value={f.note} onChange={set('note')} placeholder="Fx kundenummer eller bindingsperiode" /></label>
          {x && x.interval !== 'once' && <label className="checkrow small"><input type="checkbox" checked={f.active} onChange={set('active')} />Aktiv (slå fra, når den er opsagt)</label>}
          {err && <p className="unlock__error" role="alert">{err}</p>}
          <div className="sheet__foot">
            {x && <Btn type="button" size="sm" variant="text" icon="x" onClick={remove}>Slet</Btn>}
            {x && x.interval !== 'once' && <a className="btn btn--text btn--sm" href={cancelLink({ name: f.name, cancelUrl: f.cancelUrl })} target="_blank" rel="noreferrer"><Icon name="link" size="sm" />Opsig</a>}
            <span className="push-right" />
            <Btn type="button" variant="text" onClick={onClose}>Annullér</Btn>
            <Btn type="submit" variant="primary">Gem</Btn>
          </div>
        </div>
      </form>
    </div>
  );
}
