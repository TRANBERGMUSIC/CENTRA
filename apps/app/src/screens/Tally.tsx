import { useRef, useState } from 'react';
import { useEngine, useList, useRecord, useRoute, fmt } from '../state.tsx';
import { Btn } from '../ui/primitives.tsx';
import { Icon } from '../ui/Icon.tsx';
import { useToast } from '../ui/Shell.tsx';
import { ask } from '../ui/Confirm.tsx';
import { ME, gen, kr, parseKr, findOrCreatePerson, personName, tallyLeft, lineNet, lineExplain, type Tally, type TallyLine, type Payment, type Person } from '../money.ts';
import { aiReady, aiSettings } from '../ai/agent.ts';
import { readTallyText, applyTallyDraft } from '../ai/tallyText.ts';
import { useDictation } from '../ai/dictation.ts';
import { Avatar } from './Contacts.tsx';

const rid = () => Math.random().toString(36).slice(2, 10);
const KINDS: [TallyLine['kind'], string][] = [['expense', 'Udgift'], ['income', 'Indtægt'], ['gift', 'Gave']];

/** A row in the Udlæg list for a regnestykke. */
export function TallyRow({ t, selected, onOpen }: { t: Tally; selected: boolean; onOpen: () => void }) {
  const e = useEngine();
  const pays = useList('payment') as unknown as Payment[];
  const r = tallyLeft(t, pays);
  const first = personName(e, t.person).split(' ')[0];
  return (
    <button className={`orow ${selected ? 'is-selected' : ''}`} onClick={onOpen}>
      <span className="row__line"><span className="strong ellipsis">{t.title || 'Regnestykke'}</span><span className="num row__trail meta">{t.lines?.length ?? 0} poster</span></span>
      <span className="row__line meta"><span className="ellipsis">{fmt.shortDate(t.date)} · med {t.person ? first : 'hvem?'}</span>
        {r.left > 0.004 ? <span className="row__trail ow">{first} skylder {kr(r.left)}</span> : r.left < -0.004 ? <span className="row__trail iow">du skylder {kr(-r.left)}</span> : <span className="row__trail">kvit</span>}</span>
    </button>
  );
}

/**
 * One regnestykke: the lines (what, how much, who paid or got the money, whose it was), what each line
 * means in words, and the result: who owes whom. Write it in your own words, or add lines by hand.
 */
export function TallyDetail({ id }: { id: string }) {
  const e = useEngine();
  const { go } = useRoute();
  const toast = useToast();
  const t = useRecord<Tally>(id);
  const pays = (useList('payment') as unknown as Payment[]).filter((p) => p.outlay === id);
  const contacts = useList('person', (a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'da')) as unknown as Person[];
  useList('setting');
  const [text, setText] = useState('');
  const [reading, setReading] = useState(false);
  const [who, setWho] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const spoken = useRef('');
  const dict = useDictation((x, final) => { setText((spoken.current ? spoken.current + ' ' : '') + x); if (final) box.current?.focus(); }, (p) => toast({ title: p.title, text: p.text, kind: 'error', icon: 'mic' }));
  if (!t) return <div className="split__detail" />;
  const set = (f: Partial<Tally>) => e.set('tally', id, f as Record<string, unknown>);
  const lines = t.lines ?? [];
  const setLine = (i: number, f: Partial<TallyLine>) => set({ lines: lines.map((l, j) => (j === i ? { ...l, ...f } : l)) });
  const first = t.person ? personName(e, t.person).split(' ')[0] : 'den anden';
  const r = tallyLeft(t, pays as Payment[]);
  const ai = aiReady(aiSettings(e));

  async function fromText() {
    const x = text.trim();
    if (!x || reading) return;
    if (dict.listening) dict.stop();
    if (!ai) return void toast({ text: 'Forbind Assist under Indstillinger, så forstår CENTRA, hvad du skriver. Indtil da kan du tilføje linjerne herunder.' });
    setReading(true);
    try {
      const before = { title: t!.title, person: t!.person, lines: t!.lines, date: t!.date };
      const { fields, created } = applyTallyDraft(e, t!, await readTallyText(e, t!, x), rid);
      set(fields); setText(''); spoken.current = '';
      const res = tallyLeft({ ...t!, ...fields } as Tally, pays as Payment[]);
      const f1 = fields.person ? personName(e, fields.person).split(' ')[0] : first;
      toast({ title: 'Regnestykket er opdateret', text: res.left > 0.004 ? `${f1} skylder dig ${kr(res.left)}` : res.left < -0.004 ? `Du skylder ${f1} ${kr(-res.left)}` : 'I er kvit', action: { label: 'Fortryd', run: () => { set(before); created.forEach((c) => e.remove('person', c)); } } });
    } catch (x) { toast({ text: (x as Error).message }); } finally { setReading(false); }
  }
  function remove() {
    const { id: _i, type: _t, ...f } = t as any;
    const pids = pays.map((p) => p.id);
    pids.forEach((p) => e.remove('payment', p));
    e.remove('tally', id); go({ screen: 'outlays' });
    toast({ text: 'Regnestykket er slettet', action: { label: 'Fortryd', run: () => { e.set('tally', id, { ...f, _deleted: false }); pids.forEach((p) => e.set('payment', p, { _deleted: false })); go({ screen: 'outlays', id }); } } });
  }
  function settle() {
    if (Math.abs(r.left) < 0.005 || !t!.person) return;
    const pid = e.create('payment', { outlay: id, person: r.left > 0 ? t!.person : ME, amount: Math.abs(r.left), at: new Date().toISOString(), note: 'afregnet' });
    toast({ text: r.left > 0 ? `${first} har betalt dig ${kr(r.left)}` : `Du har betalt ${first} ${kr(-r.left)}`, action: { label: 'Fortryd', run: () => e.remove('payment', pid) } });
  }
  const setPerson = (name: string) => {
    if (!name.trim()) return;
    const { id: pid, created } = findOrCreatePerson(e, name);
    if (pid === ME) return;
    set({ person: pid });
    if (created) toast({ person: { name: name.trim() }, text: `${name.trim()} er gemt som kontakt` });
    setWho('');
  };
  const p = t.person ? (e.get(t.person) as unknown as Person | null) : null;

  return (
    <div className="split__detail odetail" data-lenis-prevent>
      <button className="phone-back" onClick={() => go({ screen: 'outlays' })}><Icon name="chevron-left" size="sm" />Udlæg</button>
      <div className="otitlerow">
        <input className="gtitle" defaultValue={t.title} aria-label="Titel" onBlur={(x) => x.target.value.trim() !== t.title && set({ title: x.target.value.trim() })} />
        <Btn size="sm" variant="text" icon="x" onClick={remove}>Slet</Btn>
      </div>
      <div className="ometa">
        <label className="ufield"><span>Dato</span><input type="date" value={t.date ?? ''} onChange={(x) => set({ date: x.target.value })} /></label>
        <div className="ufield"><span>Med</span>
          {p ? <span className="pchip">{<Avatar p={p} />}{p.name}<button aria-label="Skift person" onClick={() => set({ person: '' })}><Icon name="x" size="sm" /></button></span>
            : <form className="addperson" onSubmit={(x) => { x.preventDefault(); setPerson(who); }}><input autoFocus={!lines.length} list="tally-people" value={who} onChange={(x) => setWho(x.target.value)} placeholder="Hvem?" aria-label="Med hvem" /><datalist id="tally-people">{contacts.map((c) => <option key={c.id} value={c.name} />)}</datalist></form>}
        </div>
      </div>

      <section className={`panel tresult ${r.left > 0.004 ? 'is-owed' : r.left < -0.004 ? 'is-owe' : 'is-even'}`} aria-live="polite">
        <div className="meta">Resultat</div>
        <div className="tresult__big">{r.left > 0.004 ? <>{first} skylder dig <b className="num">{kr(r.left)}</b></> : r.left < -0.004 ? <>Du skylder {first} <b className="num">{kr(-r.left)}</b></> : lines.length ? 'I er kvit' : 'Skriv, hvad der skete, så regner CENTRA det ud'}</div>
        {(r.paidMe > 0 || r.paidThem > 0) && <div className="meta num">{r.net > 0 ? `${first} skyldte ${kr(r.net)}` : r.net < 0 ? `Du skyldte ${kr(-r.net)}` : ''}{r.paidThem > 0 ? ` · ${first} har betalt ${kr(r.paidThem)}` : ''}{r.paidMe > 0 ? ` · du har betalt ${kr(r.paidMe)}` : ''}</div>}
        {Math.abs(r.left) > 0.004 && t.person && <div className="tresult__acts"><Btn variant="primary" icon="check" onClick={settle}>{r.left > 0 ? `${first} har betalt` : `Jeg har betalt ${first}`}</Btn></div>}
      </section>

      <section className="panel ofill">
        <div className="panel__head"><h2 className="panel__title">{lines.length ? 'Ret eller tilføj' : 'Hvad skete der?'}</h2></div>
        <form className="owrite" onSubmit={(x) => { x.preventDefault(); void fromText(); }}>
          <div className="owrite__box">
            <textarea ref={box} rows={3} className="otext" value={text} onChange={(x) => setText(x.target.value)} onKeyDown={(x) => { if (x.key === 'Enter' && (x.metaKey || x.ctrlKey)) { x.preventDefault(); void fromText(); } }}
              placeholder={lines.length ? 'Ret noget …' : 'Hvad skete der?'} aria-label="Hvad skete der" />
            <button type="button" className={`iconbtn ${dict.listening ? 'is-live' : ''}`} aria-pressed={dict.listening} aria-label={dict.listening ? 'Stop med at lytte' : 'Indtal det'} onClick={() => { spoken.current = text.trim(); dict.toggle(); }}><Icon name="mic" /></button>
          </div>
          <div className="owrite__bar"><Btn type="submit" variant="primary" icon="send" disabled={reading || !text.trim()}>{reading ? 'Regner …' : lines.length ? 'Opdatér' : 'Regn det ud'}</Btn></div>
        </form>
      </section>

      <section className="panel">
        <div className="panel__head"><h2 className="panel__title">Poster</h2><span className="panel__count num">{lines.length}</span></div>
        <ul className="tlines">
          {lines.map((l, i) => {
            const n = lineNet(l) / 100;
            return (
              <li key={l.id}>
                <div className="tline__top">
                  <input className="kvinput tline__text" defaultValue={l.text} aria-label="Hvad" onBlur={(x) => x.target.value !== l.text && setLine(i, { text: x.target.value })} />
                  <input className="kvinput oitems__amt num" inputMode="decimal" defaultValue={String(l.amount).replace('.', ',')} aria-label="Beløb" onBlur={(x) => { const v = parseKr(x.target.value); if (Number.isFinite(v) && v !== l.amount) setLine(i, { amount: Math.abs(v) }); }} />
                  <span className={`tline__net num ${n > 0 ? 'ow' : n < 0 ? 'iow' : ''}`}>{n > 0 ? `+${kr(n)}` : n < 0 ? `−${kr(-n)}` : '0 kr'}</span>
                  <Btn size="sm" variant="text" icon="x" aria-label={`Slet ${l.text}`} onClick={() => set({ lines: lines.filter((_, j) => j !== i) })} />
                </div>
                <div className="tline__opts">
                  <div className="segmented" role="radiogroup" aria-label="Slags">{KINDS.map(([k, label]) => <button key={k} type="button" role="radio" aria-checked={l.kind === k} className={l.kind === k ? 'is-active' : ''} onClick={() => setLine(i, { kind: k })}>{label}</button>)}</div>
                  <div className="segmented" role="radiogroup" aria-label={l.kind === 'income' ? 'Hvem fik pengene' : l.kind === 'gift' ? 'Hvem gav' : 'Hvem betalte'}>
                    {(['me', 'them'] as const).map((b) => <button key={b} type="button" role="radio" aria-checked={l.by === b} className={l.by === b ? 'is-active' : ''} onClick={() => setLine(i, { by: b })}>{b === 'me' ? (l.kind === 'income' ? 'Jeg fik' : l.kind === 'gift' ? 'Jeg gav' : 'Jeg betalte') : (l.kind === 'income' ? `${first} fik` : l.kind === 'gift' ? `${first} gav` : `${first} betalte`)}</button>)}
                  </div>
                  {l.kind !== 'gift' && <div className="segmented" role="radiogroup" aria-label="Hvis var det">
                    {(['both', 'me', 'them'] as const).map((w) => <button key={w} type="button" role="radio" aria-checked={l.whose === w} className={l.whose === w ? 'is-active' : ''} onClick={() => setLine(i, { whose: w })}>{w === 'both' ? 'Delt' : w === 'me' ? 'Mit' : gen(first)}</button>)}
                  </div>}
                </div>
                <p className="meta tline__why">{lineExplain(l, first)}</p>
              </li>
            );
          })}
        </ul>
        <form className="askbar" onSubmit={(x) => {
          x.preventDefault(); const f = new FormData(x.currentTarget); const n = String(f.get('n') ?? '').trim(), a = parseKr(String(f.get('a') ?? ''));
          if (n && Number.isFinite(a)) { set({ lines: [...lines, { id: rid(), text: n, amount: Math.abs(a), kind: 'expense', by: 'me', whose: 'both' }] }); x.currentTarget.reset(); }
        }}>
          <input name="n" placeholder="Post" aria-label="Ny post" /><input name="a" className="oitems__amt" inputMode="decimal" placeholder="Beløb" aria-label="Beløb" /><Btn type="submit" icon="plus">Tilføj</Btn>
        </form>
      </section>
      {pays.length > 0 && (
        <section className="panel">
          <div className="panel__head"><h2 className="panel__title">Betalinger</h2></div>
          <ul className="rows">{pays.map((x) => (
            <li key={x.id} className="memrow"><span className="row__body"><span>{x.person === ME ? `Du betalte ${first}` : `${first} betalte dig`}</span><span className="meta">{fmt.shortDate(x.at)}{x.note ? ' · ' + x.note : ''}</span></span><span className="num">{kr(x.amount)}</span>
              <Btn size="sm" variant="text" icon="x" aria-label="Slet betaling" onClick={async () => { if (await ask({ title: 'Slet betalingen?', ok: 'Slet', danger: true })) e.remove('payment', x.id); }} /></li>
          ))}</ul>
        </section>
      )}
    </div>
  );
}
