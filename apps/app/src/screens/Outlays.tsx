import { useRef, useState } from 'react';
import { useEngine, useList, useRecord, useRoute, fmt } from '../state.tsx';
import { Btn, Pill } from '../ui/primitives.tsx';
import { Icon } from '../ui/Icon.tsx';
import { useToast } from '../ui/Shell.tsx';
import { useScreenEnter } from '../motion.ts';
import { Progress } from '../ui/DayStrip.tsx';
import { ME, kr, parseKr, shares, owed, total, balances, isOpen, payBack, parseItemLines, findOrCreatePerson, personName, CATEGORIES, type Outlay, type Payment, type Person, type Item } from '../money.ts';
import { readReceipt, shrinkImage } from '../ai/receipt.ts';
import { aiReady, aiSettings } from '../ai/agent.ts';
import { Avatar } from './Contacts.tsx';
import CountUp from '../bits/CountUp.jsx';

const rid = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toISOString().slice(0, 10);

/** Udlæg: what you paid for others, who owes what, and what has been paid back. */
export function Outlays() {
  const e = useEngine();
  const { route, go } = useRoute();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'outlays');
  const outlays = useList('outlay', (a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.createdAt ?? '').localeCompare(a.createdAt ?? '')) as unknown as Outlay[];
  const pays = useList('payment') as unknown as Payment[];
  useList('person');
  const bal = balances(e).filter((b) => b.left > 0);
  const owedTotal = bal.reduce((s, b) => s + b.left, 0);
  // An udlæg only counts as paid once it has an amount, someone besides you, and nothing left to pay.
  // Until then (just created, no items or people yet) it stays under Aktive, so it never vanishes.
  const settled = (o: Outlay) => total(o) > 0 && (o.people ?? []).some((p) => p !== ME) && !isOpen(o, pays);
  const active = outlays.filter((o) => !settled(o));
  const done = outlays.filter(settled);
  const [showDone, setShowDone] = useState(false);
  // The detail pane shows one udlæg (its own list of items), one person (everything they owe), or
  // with nothing chosen, the overview of who owes you what.
  const who = route.id?.startsWith('who:') ? route.id.slice(4) : null;
  const id = who ? undefined : route.id;
  const create = () => go({ screen: 'outlays', id: e.create('outlay', { title: '', date: today(), people: [ME], items: [], countMine: true, createdAt: new Date().toISOString() }) });
  const max = Math.max(1, ...bal.map((b) => b.left));

  const row = (o: Outlay) => {
    const ow = owed(o, pays);
    const left = ow.reduce((s, w) => s + w.left, 0), share = ow.reduce((s, w) => s + w.share, 0);
    return (
      <button key={o.id} className={`orow ${o.id === id ? 'is-selected' : ''}`} onClick={() => go({ screen: 'outlays', id: o.id })}>
        <span className="row__line"><span className="strong ellipsis">{o.title || 'Nyt udlæg'}</span><span className="num row__trail">{kr(total(o))}</span></span>
        <span className="row__line meta"><span className="ellipsis">{fmt.shortDate(o.date)} · {(o.people ?? []).filter((p) => p !== ME).map((p) => personName(e, p).split(' ')[0]).join(', ') || 'ingen personer endnu'}</span>{left > 0 && <span className="row__trail ow">mangler {kr(left)}</span>}</span>
        {share > 0 && <Progress ratio={(share - left) / share} small />}
      </button>
    );
  };

  return (
    <main className={`split ${route.id ? 'has-open' : ''}`} ref={ref}>
      <div className="split__list" data-enter>
        <div className="nlist__head"><h1>Udlæg</h1><Btn size="sm" icon="plus" onClick={create}>Nyt udlæg</Btn></div>
        <section className="owecard" aria-label="Skyldes dig">
          <div className="meta">Folk skylder dig</div>
          <div className="owecard__sum num"><CountUp key={owedTotal} to={owedTotal} from={0} duration={0.8} decimals={owedTotal % 1 ? 2 : 0} separator="." decimalSeparator="," trigger="mount" /> kr</div>
          {bal.length ? <ul className="owebars">{bal.map((b) => {
            const p = e.get(b.person) as unknown as Person | null;
            return (
              <li key={b.person}><button className={who === b.person ? 'is-selected' : ''} onClick={() => go({ screen: 'outlays', id: 'who:' + b.person })}>
                {p && <Avatar p={p} />}<span className="ellipsis">{p?.name ?? 'Ukendt'}</span><span className="num">{kr(b.left)}</span>
                <span className="owebars__bar" style={{ ['--w' as any]: b.left / max }} />
              </button></li>
            );
          })}</ul> : <p className="meta">Ingen skylder dig noget lige nu.</p>}
        </section>
        <div className="gsec">Aktive <span className="num">{active.length}</span></div>
        {active.map(row)}
        {!outlays.length && <p className="muted pad">Lagde du ud for nogen? Tag et billede af kvitteringen eller skriv, hvad der blev købt. Så regner CENTRA ud, hvem der skylder hvad.</p>}
        {done.length > 0 && <button className="gsec gsec--btn" onClick={() => setShowDone((x) => !x)} aria-expanded={showDone}>Betalt <span className="num">{done.length}</span> <Icon name="chevron-down" size="sm" /></button>}
        {showDone && done.map(row)}
      </div>
      {id ? <OutlayDetail key={id} id={id} /> : who ? <PersonDebt key={who} person={who} /> : <Overview />}
    </main>
  );
}

function OutlayDetail({ id }: { id: string }) {
  const e = useEngine();
  const { go } = useRoute();
  const toast = useToast();
  const o = useRecord<Outlay>(id);
  const pays = (useList('payment') as unknown as Payment[]).filter((p) => p.outlay === id).sort((a, b) => b.at.localeCompare(a.at));
  const contacts = useList('person', (a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'da')) as unknown as Person[];
  useList('setting');
  const file = useRef<HTMLInputElement>(null);
  const [who, setWho] = useState('');
  const [text, setText] = useState('');
  const [reading, setReading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [payFor, setPayFor] = useState<string | null>(null);
  const [payAmt, setPayAmt] = useState('');
  const [assign, setAssign] = useState<string | null>(null);
  if (!o) return <div className="split__detail" />;
  const set = (f: Partial<Outlay>) => e.set('outlay', id, f as Record<string, unknown>);
  const items = o.items ?? [];
  const people = o.people ?? [ME];
  const sh = shares(o);
  const ow = owed(o, pays);
  const sum = total(o);
  const ai = aiReady(aiSettings(e));

  const setItems = (next: Item[]) => set({ items: next });
  const addPerson = (name: string) => {
    if (!name.trim()) return;
    const { id: pid, created } = findOrCreatePerson(e, name);
    if (people.includes(pid)) return;
    set({ people: [...people, pid], items: items.map((it) => (it.who?.length && it.who.length === people.length ? { ...it, who: [...it.who, pid] } : it)) });
    if (created) toast({ person: { name: name.trim() }, text: `${name.trim()} er gemt som kontakt`, action: { label: 'Åbn', run: () => go({ screen: 'contacts', id: pid }) } });
    setWho('');
  };
  const removePerson = (pid: string) => set({ people: people.filter((p) => p !== pid), items: items.map((it) => ({ ...it, who: (it.who ?? []).filter((w) => w !== pid) })) });

  async function fromReceipt(input: { image?: string; text?: string }) {
    setReading(true);
    try {
      const simple = input.text ? parseItemLines(input.text) : [];
      const r = !input.image && simple.length && simple.length === input.text!.split('\n').filter((l) => l.trim()).length ? { items: simple } as Awaited<ReturnType<typeof readReceipt>> : await readReceipt(e, input);
      if (!r.items.length) throw new Error('Kunne ikke finde nogen varer. Prøv et skarpere billede, eller skriv dem.');
      const add = r.items.map((i) => ({ id: rid(), name: i.name, amount: i.amount, who: [] as string[] }));
      set({ items: [...items, ...add], ...(r.store && !o!.place ? { place: r.store } : {}), ...(r.date ? { date: r.date } : {}), ...(!o!.title ? { title: r.store ? `Indkøb hos ${r.store}` : add.length === 1 ? add[0].name : 'Udlæg' } : {}) });
      const got = add.reduce((s, i) => s + i.amount, 0);
      toast({ text: `${add.length} ${add.length === 1 ? 'vare' : 'varer'} sat ind · ${kr(got)}${r.total && Math.abs(r.total - got) > 0.5 ? ` (kvitteringen siger ${kr(r.total)}, tjek linjerne)` : ''}` });
      setText('');
    } catch (x) { toast({ text: (x as Error).message }); } finally { setReading(false); }
  }
  async function onFile(f?: File | null) {
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast({ text: 'Brug et billede af kvitteringen (JPG, PNG, HEIC eller et skærmbillede).' });
    try {
      const img = await shrinkImage(f);
      set({ receipt: img });
      if (ai) await fromReceipt({ image: img }); else toast({ text: 'Billedet er gemt. Forbind Assist under Indstillinger, så kan CENTRA læse kvitteringen for dig.' });
    } catch (x) { toast({ text: (x as Error).message }); }
  }
  function remove() {
    const { id: _i, type: _t, ...f } = o as any;
    const pids = pays.map((p) => p.id);
    for (const p of pids) e.remove('payment', p);
    e.remove('outlay', id); go({ screen: 'outlays' });
    toast({ text: 'Udlægget er slettet', action: { label: 'Fortryd', run: () => { e.set('outlay', id, { ...f, _deleted: false }); for (const p of pids) e.set('payment', p, { _deleted: false }); go({ screen: 'outlays', id }); } } });
  }
  function pay(person: string, amount: number) {
    if (!(amount > 0)) return;
    const pid = e.create('payment', { outlay: id, person, amount, at: new Date().toISOString() });
    toast({ person: { name: personName(e, person), photo: (e.get(person) as unknown as Person | null)?.photo }, text: `${personName(e, person)} har betalt ${kr(amount)}`, action: { label: 'Fortryd', run: () => e.remove('payment', pid) } });
    setPayFor(null); setPayAmt('');
  }
  const reminder = (pid: string, left: number) => `Hej ${personName(e, pid).split(' ')[0]}! Du mangler at betale ${kr(left)} for ${o.title || 'udlægget'}${o.date ? ` (${fmt.shortDate(o.date)})` : ''}. Tak 🙏`;

  return (
    <div className={`split__detail odetail ${drag ? 'is-drag' : ''}`} data-lenis-prevent
      onDragOver={(x) => { x.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(x) => { x.preventDefault(); setDrag(false); void onFile(x.dataTransfer.files?.[0]); }}
      onPaste={(x) => { const f = [...x.clipboardData.files].find((y) => y.type.startsWith('image/')); if (f) { x.preventDefault(); void onFile(f); } }}>
      <button className="phone-back" onClick={() => go({ screen: 'outlays' })}><Icon name="chevron-left" size="sm" />Udlæg</button>
      <div className="otitlerow">
        <input className="gtitle" defaultValue={o.title} placeholder="Hvad var det? (fx Pizza fredag)" aria-label="Titel" autoFocus={!o.title && !items.length} onBlur={(x) => x.target.value.trim() !== o.title && set({ title: x.target.value.trim() })} />
        <Btn size="sm" variant="text" icon="x" onClick={remove}>Slet udlæg</Btn>
      </div>
      <div className="ometa">
        <label className="ufield"><span>Dato</span><input type="date" value={o.date ?? ''} onChange={(x) => set({ date: x.target.value })} /></label>
        <label className="ufield"><span>Sted</span><input defaultValue={o.place ?? ''} placeholder="Butik eller sted" onBlur={(x) => set({ place: x.target.value.trim() })} /></label>
        <label className="ufield"><span>Kategori</span><select value={o.category ?? 'Mad & ude'} onChange={(x) => set({ category: x.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <div className="ototal"><span className="meta">I alt</span><b className="num">{kr(sum)}</b></div>
      </div>

      <section className="panel ofill">
        <div className="ofill__row">
          <Btn icon="camera" variant="primary" disabled={reading} onClick={() => file.current?.click()}>{reading ? 'Læser …' : 'Scan kvittering'}</Btn>
          <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={(x) => { void onFile(x.target.files?.[0]); x.target.value = ''; }} />
          <span className="meta">eller træk et billede herind, eller indsæt et skærmbillede (⌘V)</span>
        </div>
        <form className="askbar" onSubmit={(x) => { x.preventDefault(); if (text.trim()) void fromReceipt({ text }); }}>
          <textarea rows={2} className="otext" value={text} onChange={(x) => setText(x.target.value)} placeholder={'Eller skriv hvad der er købt, fx:\nPizza 240\n2 cola 40'} aria-label="Hvad er købt" />
          <Btn type="submit" disabled={reading || !text.trim()}>Sæt ind</Btn>
        </form>
        {o.receipt && <details className="oreceipt"><summary className="meta">Kvitteringen</summary><img src={o.receipt} alt="Kvittering" /><Btn size="sm" variant="text" onClick={() => set({ receipt: '' })}>Fjern billede</Btn></details>}
      </section>

      <section className="panel">
        <div className="panel__head"><h2 className="panel__title">Hvem var med</h2></div>
        <div className="chips opeople">
          {people.map((p) => {
            const c = p === ME ? null : (e.get(p) as unknown as Person | null);
            return <span key={p} className="pchip">{c ? <Avatar p={c} /> : <span className="avatar avatar--me">MIG</span>}{p === ME ? 'Mig' : c?.name ?? 'Ukendt'}{p !== ME && <button aria-label={`Fjern ${c?.name}`} onClick={() => removePerson(p)}><Icon name="x" size="sm" /></button>}</span>;
          })}
          <form className="addperson" onSubmit={(x) => { x.preventDefault(); addPerson(who); }}>
            <input list="contacts-list" value={who} onChange={(x) => setWho(x.target.value)} placeholder="+ Tilføj person" aria-label="Tilføj person" />
            <datalist id="contacts-list">{contacts.filter((c) => !people.includes(c.id)).map((c) => <option key={c.id} value={c.name} />)}</datalist>
          </form>
        </div>
        <div className="segmented pad-top" role="radiogroup" aria-label="Hvem betaler">
          {([[true, 'Delt med mig'], [false, 'Jeg lagde ud, de betaler det hele']] as const).map(([mine, label]) => (
            <button key={label} type="button" role="radio" aria-checked={people.includes(ME) === mine} className={people.includes(ME) === mine ? 'is-active' : ''}
              onClick={() => { if (people.includes(ME) === mine) return; set({ people: mine ? [ME, ...people] : people.filter((p) => p !== ME), items: items.map((it) => ({ ...it, who: (it.who ?? []).filter((w) => mine || w !== ME) })) }); }}>{label}</button>
          ))}
        </div>
        {!people.includes(ME) && <p className="meta small">Du er ikke med i delingen: {people.length ? 'de andre deler hele beløbet' : 'tilføj den eller dem, der skal betale'}.{people.length === 1 ? ` ${personName(e, people[0])} skylder dig ${kr(sum)}.` : ''}</p>}
      </section>

      <section className="panel">
        <div className="panel__head"><h2 className="panel__title">Varer</h2><span className="panel__count num">{items.length}</span>
          {items.length > 0 && <Btn size="sm" variant="text" className="push-right" onClick={() => { setItems(items.map((it) => ({ ...it, who: [] }))); setAssign(null); }}>Del alt ligeligt</Btn>}</div>
        {items.length > 0 && people.length > 1 && (
          <div className="oassign">
            <span className="meta">Ikke alt skal deles? Vælg en person og tryk på de varer, der kun er deres:</span>
            <div className="chips">{people.map((p) => (
              <button key={p} type="button" className={`tag ${assign === p ? 'is-active' : ''}`} aria-pressed={assign === p} onClick={() => setAssign(assign === p ? null : p)}>{p === ME ? 'Mig' : personName(e, p).split(' ')[0]}</button>
            ))}{assign && <Btn size="sm" variant="primary" onClick={() => setAssign(null)}>Færdig</Btn>}</div>
            {assign && <p className="meta small">Tryk på en vare for at give den til {assign === ME ? 'dig' : personName(e, assign).split(' ')[0]} alene. Tryk igen for at dele den mellem alle.</p>}
          </div>
        )}
        <ul className={`oitems ${assign ? 'is-assigning' : ''}`}>
          {items.map((it, i) => (
            <li key={it.id} className={assign && it.who?.length === 1 && it.who[0] === assign ? 'is-theirs' : ''}
              onClick={assign ? () => setItems(items.map((y, j) => (j === i ? { ...y, who: y.who?.length === 1 && y.who[0] === assign ? [] : [assign] } : y))) : undefined}>
              <input className="kvinput oitems__name" defaultValue={it.name} aria-label="Vare" onBlur={(x) => x.target.value !== it.name && setItems(items.map((y, j) => (j === i ? { ...y, name: x.target.value } : y)))} />
              <input className="kvinput oitems__amt num" inputMode="decimal" defaultValue={String(it.amount).replace('.', ',')} aria-label="Beløb" onBlur={(x) => { const n = parseKr(x.target.value); if (Number.isFinite(n) && n !== it.amount) setItems(items.map((y, j) => (j === i ? { ...y, amount: n } : y))); }} />
              <span className="oitems__who">{people.map((p) => {
                const on = !it.who?.length || it.who.includes(p);
                return <button key={p} aria-pressed={on} className={on ? 'is-on' : ''} title={on ? 'Betaler med. Tryk for at fjerne' : 'Betaler ikke. Tryk for at tilføje'} onClick={() => {
                  const cur = it.who?.length ? it.who : people;
                  const next = on ? cur.filter((w) => w !== p) : [...cur, p];
                  if (!next.length) return;
                  setItems(items.map((y, j) => (j === i ? { ...y, who: next.length === people.length ? [] : next } : y)));
                }}>{p === ME ? 'Mig' : personName(e, p).split(' ')[0]}</button>;
              })}</span>
              <Btn size="sm" variant="text" icon="x" aria-label={`Slet ${it.name}`} onClick={() => setItems(items.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ul>
        <form className="askbar" onSubmit={(x) => {
          x.preventDefault(); const f = new FormData(x.currentTarget); const n = String(f.get('n') ?? '').trim(), a = parseKr(String(f.get('a') ?? ''));
          if (n && Number.isFinite(a)) { setItems([...items, { id: rid(), name: n, amount: a, who: [] }]); x.currentTarget.reset(); (x.currentTarget.elements.namedItem('n') as HTMLInputElement).focus(); }
        }}>
          <input name="n" placeholder="Vare" aria-label="Ny vare" /><input name="a" className="oitems__amt" inputMode="decimal" placeholder="Beløb" aria-label="Beløb" /><Btn type="submit" icon="plus">Tilføj</Btn>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel__title">Hvem skylder hvad</h2>
        {people.includes(ME) && <div className="kv"><span>Din egen andel<span className="meta block">{o.countMine === false ? 'Tæller ikke med i Udgifter' : 'Tæller med i dine udgifter'}</span></span><span className="num">{kr(sh[ME] ?? 0)}</span></div>}
        {ow.map((w) => {
          const c = e.get(w.person) as unknown as Person | null;
          return (
            <div key={w.person} className="oweline">
              <div className="oweline__top">
                {c && <Avatar p={c} />}
                <span className="row__body"><span className="strong">{c?.name ?? 'Ukendt'}</span><span className="meta num">{w.share > 0 ? `Andel ${kr(w.share)}` : 'Ingen varer'}{w.paid > 0 ? ` · betalt ${kr(w.paid)}` : ''}</span></span>
                {w.left > 0 ? <Pill tone="focus">Mangler {kr(w.left)}</Pill> : <span className="status">{w.share > 0 ? 'Betalt' : 'Skal ikke betale'}</span>}
              </div>
              {w.share > 0 && <Progress ratio={w.paid / w.share} small />}
              {w.left > 0 && (payFor === w.person ? (
                <form className="askbar" onSubmit={(x) => { x.preventDefault(); pay(w.person, parseKr(payAmt)); }}>
                  <input autoFocus inputMode="decimal" value={payAmt} onChange={(x) => setPayAmt(x.target.value)} placeholder={String(w.left).replace('.', ',')} aria-label="Beløb betalt" />
                  <Btn type="submit" variant="primary">Gem</Btn><Btn type="button" variant="text" onClick={() => setPayFor(null)}>Annullér</Btn>
                </form>
              ) : (
                <div className="oweline__acts">
                  <Btn size="sm" variant="primary" icon="check" onClick={() => pay(w.person, w.left)}>Betalt alt</Btn>
                  <Btn size="sm" onClick={() => { setPayFor(w.person); setPayAmt(''); }}>Betalt en del</Btn>
                  {c?.phone && <a className="btn btn--text btn--sm" href={`sms:${c.phone.replace(/\s/g, '')}?&body=${encodeURIComponent(reminder(w.person, w.left))}`}>Send sms</a>}
                  {c?.email && <a className="btn btn--text btn--sm" href={`mailto:${c.email}?subject=${encodeURIComponent(o.title || 'Udlæg')}&body=${encodeURIComponent(reminder(w.person, w.left))}`}>Send mail</a>}
                  <Btn size="sm" variant="text" onClick={() => { void navigator.clipboard?.writeText(reminder(w.person, w.left)); toast({ text: 'Besked kopieret' }); }}>Kopiér besked</Btn>
                </div>
              ))}
            </div>
          );
        })}
        {!ow.length && <p className="muted">Tilføj de personer, der var med, så regner CENTRA ud, hvad de skylder.</p>}
        {pays.length > 0 && (<>
          <h3 className="panel__title pad-top">Betalinger</h3>
          <ul className="rows">{pays.map((p) => (
            <li key={p.id} className="memrow"><span className="row__body"><span>{personName(e, p.person)} betalte <b className="num">{kr(p.amount)}</b></span><span className="meta">{fmt.ago(p.at)}{p.note ? ' · ' + p.note : ''}</span></span>
              <Btn size="sm" variant="text" icon="x" aria-label="Slet betaling" onClick={() => { e.remove('payment', p.id); toast({ text: 'Betalingen er slettet', action: { label: 'Fortryd', run: () => e.set('payment', p.id, { _deleted: false }) } }); }} /></li>
          ))}</ul>
        </>)}
      </section>
      <div className="gedit__foot">
        <label className="checkrow small"><input type="checkbox" checked={o.countMine !== false} onChange={(x) => set({ countMine: x.target.checked })} />Min andel tæller med i Udgifter</label>
        <span className="push-right" />
        <Btn variant="primary" icon="check" onClick={() => { go({ screen: 'outlays' }); toast({ text: `${o.title || 'Udlægget'} er gemt` }); }}>Færdig</Btn>
      </div>
    </div>
  );
}


/** Each person's part of each item in one udlæg (items split evenly among the people on them). */
function partsOf(o: Outlay, person: string) {
  const ppl = o.people ?? [];
  return (o.items ?? []).flatMap((it) => {
    const w = (it.who?.length ? it.who : ppl).filter((x) => ppl.includes(x));
    return w.includes(person) ? [{ id: it.id, name: it.name, part: Math.round(((it.amount || 0) / w.length) * 100) / 100, split: w.length }] : [];
  });
}

/** Nothing chosen: who owes you, each with the udlæg behind it. Click a person to see it all. */
function Overview() {
  const e = useEngine();
  const { go } = useRoute();
  useList('outlay'); useList('payment'); useList('person');
  const bal = balances(e).filter((b) => b.left > 0);
  return (
    <div className="split__detail odetail" data-lenis-prevent>
      <h2 className="otitle">Hvem skylder dig</h2>
      {bal.length ? <div className="oppl">{bal.map((b) => {
        const p = e.get(b.person) as unknown as Person | null;
        const titles = b.open.map((oid) => (e.get(oid) as unknown as Outlay | null)?.title || 'Udlæg');
        return (
          <button key={b.person} className="panel operson" onClick={() => go({ screen: 'outlays', id: 'who:' + b.person })}>
            {p && <Avatar p={p} />}
            <span className="row__body"><span className="strong">{p?.name ?? 'Ukendt'}</span><span className="meta ellipsis">{titles.length} {titles.length === 1 ? 'udlæg' : 'udlæg'}: {titles.join(', ')}</span></span>
            <span className="operson__sum num">{kr(b.left)}</span><Icon name="chevron-right" size="sm" />
          </button>
        );
      })}</div> : <p className="muted">Ingen skylder dig noget lige nu. Tryk på Nyt udlæg, når du har lagt ud for nogen. Hvert udlæg får sin egen liste af varer.</p>}
    </div>
  );
}

/** One person: everything they owe, udlæg for udlæg and item for item, and ways to settle it. */
function PersonDebt({ person }: { person: string }) {
  const e = useEngine();
  const { go } = useRoute();
  const toast = useToast();
  const outlays = useList('outlay', (a, b) => (b.date ?? '').localeCompare(a.date ?? '')) as unknown as Outlay[];
  const pays = useList('payment') as unknown as Payment[];
  useList('person');
  const [part, setPart] = useState<string | null>(null);
  const p = e.get(person) as unknown as Person | null;
  const mine = outlays.map((o) => ({ o, w: owed(o, pays).find((x) => x.person === person) })).filter((x): x is { o: Outlay; w: NonNullable<typeof x.w> } => !!x.w && x.w.share > 0);
  const open = mine.filter((x) => x.w.left > 0.004), paid = mine.filter((x) => x.w.left <= 0.004);
  const left = Math.round(open.reduce((s, x) => s + x.w.left, 0) * 100) / 100;
  const first = (p?.name ?? '').split(' ')[0];
  const message = `Hej ${first}! Du mangler at betale ${kr(left)} for ${open.map((x) => `${x.o.title || 'udlæg'} (${kr(x.w.left)})`).join(', ')}. Tak 🙏`;
  const settle = (amount: number) => {
    if (!(amount > 0)) return;
    const ids = payBack(e, person, amount);
    toast({ person: { name: p?.name ?? 'Ukendt', photo: p?.photo }, text: `${p?.name ?? 'De'} har betalt ${kr(amount)}`, action: { label: 'Fortryd', run: () => ids.forEach((x) => e.remove('payment', x)) } });
    setPart(null);
  };
  const card = ({ o, w }: { o: Outlay; w: { share: number; paid: number; left: number } }) => (
    <section key={o.id} className="panel odebt">
      <button className="odebt__head" onClick={() => go({ screen: 'outlays', id: o.id })}>
        <span className="row__body"><span className="strong">{o.title || 'Udlæg'}</span><span className="meta">{fmt.shortDate(o.date)}{o.place ? ' · ' + o.place : ''} · i alt {kr(total(o))}</span></span>
        {w.left > 0.004 ? <Pill tone="focus">Mangler {kr(w.left)}</Pill> : <span className="status">Betalt</span>}
        <Icon name="chevron-right" size="sm" />
      </button>
      <ul className="odebt__items">{partsOf(o, person).map((it) => (
        <li key={it.id}><span className="ellipsis">{it.name}</span><span className="meta">{it.split > 1 ? `delt på ${it.split}` : 'kun ' + first}</span><span className="num">{kr(it.part)}</span></li>
      ))}</ul>
      <div className="odebt__foot meta num"><span>Andel {kr(w.share)}</span>{w.paid > 0 && <span>betalt {kr(w.paid)}</span>}</div>
      {w.share > 0 && <Progress ratio={w.paid / w.share} small />}
    </section>
  );
  return (
    <div className="split__detail odetail" data-lenis-prevent>
      <button className="phone-back" onClick={() => go({ screen: 'outlays' })}><Icon name="chevron-left" size="sm" />Udlæg</button>
      <div className="ophead">
        {p && <Avatar p={p} large />}
        <div><h2 className="otitle">{p?.name ?? 'Ukendt'}</h2><p className="meta">{left > 0 ? `Skylder dig ${kr(left)} for ${open.length} ${open.length === 1 ? 'udlæg' : 'udlæg'}` : 'Skylder dig ikke noget'}</p></div>
        <Btn size="sm" variant="text" className="push-right" onClick={() => go({ screen: 'contacts', id: person })}>Kontakt</Btn>
      </div>
      {left > 0 && (part !== null ? (
        <form className="askbar" onSubmit={(x) => { x.preventDefault(); settle(parseKr(part)); }}>
          <input autoFocus inputMode="decimal" value={part} onChange={(x) => setPart(x.target.value)} placeholder={String(left).replace('.', ',')} aria-label="Beløb betalt" />
          <Btn type="submit" variant="primary">Gem</Btn><Btn type="button" variant="text" onClick={() => setPart(null)}>Annullér</Btn>
        </form>
      ) : (
        <div className="oweline__acts">
          <Btn variant="primary" icon="check" onClick={() => settle(left)}>Betalt alt ({kr(left)})</Btn>
          <Btn onClick={() => setPart('')}>Betalt en del</Btn>
          {p?.phone && <a className="btn btn--text" href={`sms:${p.phone.replace(/\s/g, '')}?&body=${encodeURIComponent(message)}`}>Send sms</a>}
          {p?.email && <a className="btn btn--text" href={`mailto:${p.email}?subject=${encodeURIComponent('Udlæg')}&body=${encodeURIComponent(message)}`}>Send mail</a>}
          <Btn variant="text" onClick={() => { void navigator.clipboard?.writeText(message); toast({ text: 'Besked kopieret' }); }}>Kopiér besked</Btn>
        </div>
      ))}
      {open.length > 0 && <div className="gsec">Mangler betaling <span className="num">{open.length}</span></div>}
      {open.map(card)}
      {paid.length > 0 && <div className="gsec">Betalt <span className="num">{paid.length}</span></div>}
      {paid.map(card)}
    </div>
  );
}
