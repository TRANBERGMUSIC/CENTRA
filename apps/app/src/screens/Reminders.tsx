import { useRef, useState } from 'react';
import { useEngine, useList, useNow } from '../state.tsx';
import { Btn } from '../ui/primitives.tsx';
import { Icon } from '../ui/Icon.tsx';
import { useToast } from '../ui/Shell.tsx';
import { useScreenEnter } from '../motion.ts';
import { addReminder, setDone, sorted, whenLabel, overdue, type Reminder } from '../reminders.ts';
import { askToNotify } from '../reminderAlerts.ts';
import { ios } from '../platform.ts';
import { addAlarm, alarms, daysLabel, type Alarm } from '../alarms.ts';

/** "2026-11-01T12:00" for <input type="datetime-local">, in local time. */
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/** Quick times: in an hour, this evening, tomorrow morning. */
function quick(now: Date): { label: string; at: Date }[] {
  const inHour = new Date(now.getTime() + 3600_000); inHour.setMinutes(Math.ceil(inHour.getMinutes() / 5) * 5, 0, 0);
  const evening = new Date(now); evening.setHours(18, 0, 0, 0);
  const morning = new Date(now); morning.setDate(morning.getDate() + 1); morning.setHours(9, 0, 0, 0);
  return [{ label: 'Om en time', at: inHour }, ...(now < evening ? [{ label: 'I aften kl. 18', at: evening }] : []), { label: 'I morgen kl. 9', at: morning }];
}

/** Huskelisten: what to remember to do. Tick it off when it's done. */
export function Reminders() {
  const e = useEngine();
  const toast = useToast();
  const now = useNow();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'reminders');
  const list = sorted(useList('reminder') as unknown as Reminder[]);
  const open = list.filter((r) => !r.done), done = list.filter((r) => r.done);
  const [text, setText] = useState('');
  const [at, setAt] = useState<string>('');
  const [picking, setPicking] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const add = (ev?: React.FormEvent) => {
    ev?.preventDefault();
    if (!text.trim()) return input.current?.focus();
    try {
      addReminder(e, text, at ? new Date(at) : null);
      if (at) void askToNotify().then((ok) => { if (!ok) toast({ text: ios ? 'Slå notifikationer til for CENTRA under Indstillinger › Notifikationer, så du får besked.' : 'Tillad notifikationer for CENTRA, så du får besked.' }); });
      setText(''); setAt(''); setPicking(false);
      input.current?.focus();
    } catch (x) { toast({ text: (x as Error).message }); }
  };
  const tick = (r: Reminder) => {
    setDone(e, r.id, !r.done);
    if (!r.done) toast({ text: `Klaret: ${r.text}`, action: { label: 'Fortryd', run: () => setDone(e, r.id, false) } });
  };

  return (
    <main className="canvas reminders" ref={ref}>
      <div className="titlerow" data-enter>
        <div><h1>Huskeliste</h1></div>
      </div>

      <form className="hl__add" onSubmit={add} data-enter>
        <span className="hl__plus" aria-hidden="true"><Icon name="plus" size="sm" /></span>
        <input ref={input} value={text} onChange={(x) => setText(x.target.value)} placeholder="Noget at huske …" aria-label="Noget at huske" enterKeyHint="done" />
        <div className="hl__when">
          {at
            ? <button type="button" className="hl__chip is-on" onClick={() => { setAt(''); setPicking(false); }} aria-label="Fjern tidspunkt"><Icon name="bell" size="sm" />{whenLabel(new Date(at).toISOString(), now)}<Icon name="x" size="sm" /></button>
            : <>
                {quick(now).map((q) => <button type="button" key={q.label} className="hl__chip" onClick={() => setAt(local(q.at))}>{q.label}</button>)}
                <button type="button" className="hl__chip" onClick={() => setPicking((p) => !p)} aria-expanded={picking}><Icon name="clock" size="sm" />Vælg tid</button>
              </>}
          {picking && !at && <input type="datetime-local" className="hl__pick" min={local(now)} onChange={(x) => x.target.value && setAt(x.target.value)} aria-label="Tidspunkt" />}
        </div>
        <Btn type="submit" variant="primary" disabled={!text.trim()}>Tilføj</Btn>
      </form>

      <Alarms />

      <ul className="hl" data-enter aria-label="Huskelisten">
        {open.map((r) => <Row key={r.id} r={r} now={now} editing={edit === r.id} onEdit={() => setEdit(edit === r.id ? null : r.id)} onTick={() => tick(r)} />)}
        {!open.length && <li className="hl__empty"><Icon name="check" /><span>{done.length ? 'Alt er klaret.' : 'Intet at huske endnu.'}</span></li>}
      </ul>

      {done.length > 0 && (
        <div className="hl__done" data-enter>
          <button className="hl__donehead" onClick={() => setShowDone((s) => !s)} aria-expanded={showDone}>
            <Icon name={showDone ? 'chevron-down' : 'chevron-right'} size="sm" />Klaret <span className="num">{done.length}</span>
          </button>
          {showDone && <>
            <ul className="hl">{done.slice(0, 50).map((r) => <Row key={r.id} r={r} now={now} editing={edit === r.id} onEdit={() => setEdit(edit === r.id ? null : r.id)} onTick={() => tick(r)} />)}</ul>
            <Btn size="sm" variant="text" onClick={() => { const ids = done.map((r) => r.id); for (const id of ids) e.remove('reminder', id); toast({ text: `${ids.length} fjernet`, action: { label: 'Fortryd', run: () => { for (const r of done) { const { id, type: _t, ...f } = r; e.set('reminder', id, { ...f, _deleted: false }); } } } }); }}>Ryd de klarede</Btn>
          </>}
        </div>
      )}
    </main>
  );
}

function Row({ r, now, editing, onEdit, onTick }: { r: Reminder; now: Date; editing: boolean; onEdit: () => void; onTick: () => void }) {
  const e = useEngine();
  const toast = useToast();
  const [text, setText] = useState(r.text);
  const late = overdue(r, now);
  const save = (f: Partial<Reminder>) => e.set('reminder', r.id, f);
  return (
    <li className={`hl__row ${r.done ? 'is-done' : ''} ${late ? 'is-late' : ''} ${editing ? 'is-editing' : ''}`}>
      <button className={`hl__check ${r.done ? 'is-on' : ''}`} onClick={onTick} aria-pressed={!!r.done} aria-label={r.done ? `Ikke klaret: ${r.text}` : `Klaret: ${r.text}`}><Icon name="check" size="sm" /></button>
      {!editing ? (
        <button className="hl__body" onClick={onEdit}>
          <span className="hl__text">{r.text}</span>
          {r.at && <span className="hl__at"><Icon name="bell" size="sm" />{whenLabel(r.at, now)}</span>}
          {r.source && <span className="hl__src">{r.source}</span>}
        </button>
      ) : (
        <form className="hl__edit" onSubmit={(x) => { x.preventDefault(); save({ text: text.trim() || r.text }); onEdit(); }}>
          <input value={text} onChange={(x) => setText(x.target.value)} aria-label="Hvad" autoFocus />
          <input type="datetime-local" value={r.at ? local(new Date(r.at)) : ''} onChange={(x) => save({ at: x.target.value ? new Date(x.target.value).toISOString() : null })} aria-label="Tidspunkt" />
          <div className="hl__editbar">
            {r.at && <Btn size="sm" variant="text" type="button" onClick={() => save({ at: null })}>Uden tid</Btn>}
            <Btn size="sm" variant="text" type="button" className="hl__del" onClick={() => { const { id, type: _t, ...f } = r; e.remove('reminder', id); toast({ text: `Slettet: ${r.text}`, action: { label: 'Fortryd', run: () => e.set('reminder', id, { ...f, _deleted: false }) } }); }}>Slet</Btn>
            <span className="push-right" />
            <Btn size="sm" variant="primary" type="submit">Færdig</Btn>
          </div>
        </form>
      )}
    </li>
  );
}

/* ---------------------------------------------------------------- vækkeure */
const WEEK: [number, string][] = [[1, 'M'], [2, 'T'], [3, 'O'], [4, 'T'], [5, 'F'], [6, 'L'], [0, 'S']];

function Alarms() {
  const e = useEngine();
  const toast = useToast();
  useList('alarm');
  useList('setting');
  const list = alarms(e) as Alarm[];
  const [adding, setAdding] = useState(false);
  const [time, setTime] = useState('07:00');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [label, setLabel] = useState('');
  const status = (e.get('setting-alarms') as { native?: boolean; status?: string } | null);
  const save = (ev: React.FormEvent) => {
    ev.preventDefault();
    try { addAlarm(e, time, days, label); setAdding(false); setLabel(''); } catch (x) { toast({ text: (x as Error).message }); }
  };
  return (
    <section className="al" data-enter aria-label="Vækkeur">
      <div className="al__head"><h2>Vækkeur</h2>
        {!adding && <Btn size="sm" icon="plus" onClick={() => setAdding(true)}>Nyt</Btn>}
      </div>
      {ios && status?.status === 'denied' && <p className="meta errtext">Ikke tilladt: Indstillinger › CENTRA › Alarmer</p>}
      {list.length > 0 && <ul className="al__list">
        {list.map((a) => (
          <li key={a.id} className={`al__row ${a.on ? '' : 'is-off'}`}>
            <span className="al__time num">{a.time.replace(':', '.')}</span>
            <span className="al__meta"><b>{a.label || 'Vækkeur'}</b><span>{daysLabel(a.days ?? [])}</span></span>
            <button className="al__del" aria-label={`Slet ${a.label || 'vækkeur'} ${a.time}`} onClick={() => { const { id, type: _t, ...f } = a as any; e.remove('alarm', id); toast({ text: 'Vækkeur slettet', action: { label: 'Fortryd', run: () => e.set('alarm', id, { ...f, _deleted: false }) } }); }}><Icon name="x" size="sm" /></button>
            <label className="checkrow al__sw"><input type="checkbox" checked={!!a.on} onChange={(x) => e.set('alarm', a.id, { on: x.target.checked })} aria-label={`${a.label || 'Vækkeur'} ${a.time}`} /></label>
          </li>
        ))}
      </ul>}
      {adding && (
        <form className="al__new" onSubmit={save}>
          <input type="time" className="al__pick num" value={time} onChange={(x) => setTime(x.target.value)} aria-label="Tidspunkt" required />
          <div className="al__days" role="group" aria-label="Gentag">
            {WEEK.map(([d, l]) => <button key={d} type="button" aria-pressed={days.includes(d)} className={days.includes(d) ? 'is-on' : ''} onClick={() => setDays((x) => x.includes(d) ? x.filter((y) => y !== d) : [...x, d])}>{l}</button>)}
          </div>
          <input className="al__label" value={label} onChange={(x) => setLabel(x.target.value)} placeholder="Navn" aria-label="Navn" />
          <div className="al__foot"><span className="meta">{daysLabel(days)}</span><span className="push-right" /><Btn type="button" variant="text" onClick={() => setAdding(false)}>Annullér</Btn><Btn type="submit" variant="primary">Gem</Btn></div>
        </form>
      )}
    </section>
  );
}
