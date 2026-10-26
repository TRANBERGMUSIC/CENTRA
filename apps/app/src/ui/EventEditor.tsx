import { useEffect, useRef, useState } from 'react';
import { useEngine } from '../state.tsx';
import { Btn } from './primitives.tsx';
import { useToast } from './Shell.tsx';
import { dayKey, type CalEvent } from '../calendar.ts';

const DAYS: [number, string][] = [[1, 'Man'], [2, 'Tir'], [3, 'Ons'], [4, 'Tor'], [5, 'Fre'], [6, 'Lør'], [0, 'Søn']];
const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * Create, edit or delete one event. `occurrence` is the clicked day of a repeating event, so
 * "Slet kun denne dag" can skip just that date. Events from a subscribed calendar are read-only.
 */
export function EventEditor({ event, occurrence, defaultStart, onClose }: { event?: CalEvent; occurrence?: CalEvent; defaultStart?: Date; onClose: () => void }) {
  const e = useEngine();
  const toast = useToast();
  const base = event ?? null;
  const s0 = base ? new Date(base.start) : defaultStart ?? new Date();
  const e0 = base ? new Date(base.end) : new Date(s0.getTime() + 3600000);
  const [title, setTitle] = useState(base?.title ?? '');
  const [date, setDate] = useState(dayKey(occurrence && !base?.repeat ? new Date(occurrence.start) : s0));
  const [start, setStart] = useState(hm(s0));
  const [end, setEnd] = useState(hm(e0));
  const [place, setPlace] = useState(base?.place ?? '');
  const [days, setDays] = useState<number[]>(base?.repeat?.days ?? []);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const readOnly = !!(base as any)?.feed;

  useEffect(() => {
    const k = (ev: KeyboardEvent) => ev.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    box.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => removeEventListener('keydown', k);
  }, [onClose]);

  function save(ev: React.FormEvent) {
    ev.preventDefault();
    if (!title.trim()) return setErr('Giv aftalen et navn.');
    const s = new Date(`${date}T${start}`), en0 = new Date(`${date}T${end}`);
    if (isNaN(s.getTime()) || isNaN(en0.getTime())) return setErr('Tjek dato og tidspunkter.');
    const en = en0 <= s ? new Date(en0.getTime() + 86400000) : en0;
    const fields: Record<string, unknown> = { title: title.trim(), start: s.toISOString(), end: en.toISOString(), place: place.trim() || undefined, repeat: days.length ? { ...(base?.repeat ?? {}), days } : null };
    if (base) {
      const { id: _i, type: _t, ...prev } = base as any;
      e.set('event', base.id, fields);
      toast({ text: 'Aftalen er gemt', action: { label: 'Fortryd', run: () => e.set('event', base.id, prev) } });
    } else {
      const id = e.create('event', { ...fields, cal: days.length ? 'Faste' : 'Privat' });
      toast({ text: 'Aftalen er oprettet', action: { label: 'Fortryd', run: () => e.remove('event', id) } });
    }
    onClose();
  }

  function remove(onlyThisDay: boolean) {
    if (!base) return;
    const { id: _i, type: _t, ...prev } = base as any;
    if (onlyThisDay && base.repeat && occurrence) {
      e.set('event', base.id, { repeat: { ...base.repeat, skip: [...(base.repeat.skip ?? []), dayKey(new Date(occurrence.start))] } });
    } else e.remove('event', base.id);
    toast({ text: onlyThisDay ? 'Aflyst den dag' : 'Aftalen er slettet', action: { label: 'Fortryd', run: () => e.set('event', base.id, { ...prev, _deleted: false }) } });
    onClose();
  }

  return (
    <div>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={base ? 'Redigér aftale' : 'Ny aftale'} ref={box}>
        {readOnly ? (
          <div className="sheet__body">
            <h2>{base!.title}</h2>
            <p className="muted">{new Date(occurrence?.start ?? base!.start).toLocaleString('da-DK', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}{base!.place ? ' · ' + base!.place : ''}</p>
            <p className="meta">Fra {(base as any).cal ?? 'en tilknyttet kalender'}. Ret den i den kalender, den kommer fra; ændringen dukker op her ved næste opdatering.</p>
            <div className="unlock__row"><Btn variant="primary" onClick={onClose}>Luk</Btn></div>
          </div>
        ) : (
          <form className="sheet__body" onSubmit={save}>
            <input className="gtitle" value={title} onChange={(x) => setTitle(x.target.value)} placeholder="Navn på aftalen" aria-label="Navn" />
            <div className="gedit__grid">
              <label className="ufield"><span>{days.length ? 'Første dag' : 'Dato'}</span><input type="date" value={date} onChange={(x) => setDate(x.target.value)} /></label>
              <label className="ufield"><span>Fra</span><input type="time" value={start} onChange={(x) => setStart(x.target.value)} /></label>
              <label className="ufield"><span>Til</span><input type="time" value={end} onChange={(x) => setEnd(x.target.value)} /></label>
            </div>
            <label className="ufield"><span>Sted</span><input value={place} onChange={(x) => setPlace(x.target.value)} placeholder="Valgfrit" /></label>
            <div className="ufield"><span>Gentag hver uge</span>
              <div className="daypick" role="group" aria-label="Gentag på">
                {DAYS.map(([d, l]) => <button key={d} type="button" aria-pressed={days.includes(d)} className={days.includes(d) ? 'is-active' : ''} onClick={() => setDays((x) => x.includes(d) ? x.filter((y) => y !== d) : [...x, d])}>{l}</button>)}
              </div>
            </div>
            {err && <p className="unlock__error" role="alert">{err}</p>}
            <div className="sheet__foot">
              {base && (base.repeat && occurrence
                ? <><Btn type="button" size="sm" variant="text" onClick={() => remove(true)}>Aflys kun {new Date(occurrence.start).toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' })}</Btn><Btn type="button" size="sm" variant="text" onClick={() => remove(false)}>Slet hele serien</Btn></>
                : <Btn type="button" size="sm" variant="text" icon="x" onClick={() => remove(false)}>Slet</Btn>)}
              <span className="push-right" />
              <Btn type="button" variant="text" onClick={onClose}>Annullér</Btn>
              <Btn type="submit" variant="primary">Gem</Btn>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
