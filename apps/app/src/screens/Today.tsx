import { useMemo, useRef, useState } from 'react';
import { useEngine, useList, useNow, useRoute, fmt, greeting } from '../state.tsx';
import { Avatar, Btn, Panel, Pill } from '../ui/primitives.tsx';
import { Icon } from '../ui/Icon.tsx';
import { DayStrip, Progress } from '../ui/DayStrip.tsx';
import { useScreenEnter } from '../motion.ts';
import { goalStats, type Goal, type GoalUpdate } from '../goals.ts';
import { SuggestionRows, queueAssist } from './Assist.tsx';
import { dayOccurrences, type CalEvent } from '../calendar.ts';
import DecryptedText from '../bits/DecryptedText.jsx';

export function Today({ firstOpen }: { firstOpen: boolean }) {
  const e = useEngine();
  const { go } = useRoute();
  const now = useNow();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'today');

  const allEvents = useList('event') as unknown as CalEvent[];
  const events = dayOccurrences(allEvents, now) as any[];
  const people = Object.fromEntries(useList('person').map((p: any) => [p.id, p]));
  const mails = useList('mail', (a, b) => b.at.localeCompare(a.at)) as any[];
  const notes = useList('note', (a, b) => (b.editedAt ?? '').localeCompare(a.editedAt ?? '')) as any[];
  const sugg = useList('suggestion').filter((s: any) => s.status === 'pending');
  const goals = useList<Goal>('goal', (a, b) => (a.order ?? 0) - (b.order ?? 0)) as unknown as Goal[];
  const updates = useList<GoalUpdate>('goalUpdate') as unknown as GoalUpdate[];

  const needsReply = mails.filter((m) => m.needsReply && !m.archived);
  const next = events.find((x) => new Date(x.start) > now);
  const minsToNext = next ? Math.round((new Date(next.start).getTime() - now.getTime()) / 60000) : 0;
  const focusMins = events.filter((x) => x.focus).reduce((s, x) => s + (new Date(x.end).getTime() - new Date(x.start).getTime()) / 60000, 0);
  const stats = useMemo(() => goals.map((g) => ({ g, s: goalStats(g, updates, now) })), [goals, updates, now]);
  const onTrack = stats.filter((x) => x.s.onTrack).length;

  const finding = next
    ? `Næste: ${next.title} kl. ${fmt.hm(next.start)}.`
    : needsReply.length ? `Dagens aftaler er overstået. ${needsReply.length} ${needsReply.length === 1 ? 'mail venter' : 'mails venter'} på dit svar.` : 'Dagens aftaler er overstået, og indbakken er tom.';
  const hello = `${greeting(now)}, Willads`;

  return (
    <main className="canvas" ref={ref}>
      <div className="titlerow" data-enter>
        <div>
          <h1>{firstOpen ? <DecryptedText text={hello} animateOn="view" sequential revealDirection="start" speed={28} maxIterations={8} characters="ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ" encryptedClassName="encrypted" /> : hello}</h1>
          <p>{fmt.dayLabel(now)}. {finding}</p>
        </div>
        <div className="actions">
          <Btn icon="calendar" onClick={() => go({ screen: 'calendar' })}>Find tid</Btn>
          <Btn icon="plus" kbd="⌘N" onClick={() => go({ screen: 'notes', id: e.create('note', { title: '', folder: 'Indbakke', tags: [], editedAt: new Date().toISOString() }) })}>Ny note</Btn>
        </div>
      </div>

      <div className="grid12">
        <Panel title="Din dag" className="span-12" count={`${events.length} aftaler${focusMins ? ' · ' + fmt.dur(focusMins) + ' fokustid' : ''}`} link="Åbn kalender" onLink={() => go({ screen: 'calendar' })}>
          <DayStrip events={events} now={now} nextId={next?.id} />
        </Panel>

        <section className="panel span-5 focuscard" data-enter aria-labelledby="h-next">
          <div className="panel__head"><h2 id="h-next" className="panel__title">Næste</h2>{next && <Pill tone="focus">om {fmt.dur(minsToNext)}</Pill>}</div>
          {next ? (
            <>
              <div className="nextname">{next.title}</div>
              <div className="muted num">{fmt.hm(next.start)}–{fmt.hm(next.end)}{next.place ? ' · ' + next.place : ''}{next.with ? ' · ' + next.with : ''}</div>
              <ul className="rows linked">
                {next.note && <li><button className="row" onClick={() => go({ screen: 'notes', id: next.note })}><Icon name="notes" /><span className="row__body ellipsis">{e.get(next.note)?.title as string}</span></button></li>}
                {next.mail && <li><button className="row" onClick={() => go({ screen: 'inbox', id: next.mail })}><Icon name="inbox" /><span className="row__body ellipsis">{(e.get(next.mail) as any)?.subject}</span></button></li>}
              </ul>
              {next.link && <a className="btn btn--primary" href={next.link} target="_blank" rel="noreferrer"><Icon name="video" />Deltag</a>}
            </>
          ) : (
            <p className="muted">Ingen flere aftaler i dag. I morgen starter med {events.length ? 'dine faste rutiner' : 'en tom kalender'}.</p>
          )}
        </section>

        <Panel title="Venter på dit svar" className="span-7" count={needsReply.length} link="Åbn indbakke" onLink={() => go({ screen: 'inbox' })}>
          {needsReply.length ? (
            <ul className="rows">
              {needsReply.slice(0, 3).map((m) => {
                const p = people[m.from] ?? { name: m.from, initials: '?', hue: 150 };
                return (
                  <li key={m.id}>
                    <button className="row" onClick={() => go({ screen: 'inbox', id: m.id })}>
                      <Avatar initials={p.initials} hue={p.hue} />
                      <span className="row__body">
                        <span className="row__line"><span className="strong ellipsis">{p.name}</span><span className="meta num row__trail">{fmt.ago(m.at, now)}</span></span>
                        <span className="row__line"><span className="ellipsis">{m.subject}</span></span>
                        <span className="row__line meta"><span>{m.acct}</span>{m.draft && <Pill tone="calm" icon="assist">Udkast klar</Pill>}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : <p className="muted">{mails.length ? 'Ingen mails venter på svar.' : 'Dine mailkonti forbindes i et senere trin. Assist kan allerede nu holde øje med bestemte mails for dig.'}</p>}
        </Panel>

        <Panel title="Spørg Assist" className="span-7" link="Åbn Assist" onLink={() => go({ screen: 'assist' })}>
          <AskBar />
          {sugg.length > 0 && <div className="pad-top"><SuggestionRows limit={3} /></div>}
        </Panel>

        <Panel title="Seneste noter" className="span-5" link="Alle noter" onLink={() => go({ screen: 'notes' })}>
          {!notes.length && <p className="muted">Ingen noter endnu. Skriv en, eller sig til Assist: "Lav en note om …"</p>}
          <ul className="rows">
            {notes.slice(0, 4).map((n) => (
              <li key={n.id}>
                <button className="row" onClick={() => go({ screen: 'notes', id: n.id })}>
                  <Icon name={n.auto ? 'calendar' : 'notes'} />
                  <span className="row__body">
                    <span className="row__line"><span className="strong ellipsis">{n.title || 'Uden titel'}</span><span className="meta num row__trail">{n.editedAt ? fmt.clock(n.editedAt, now) : ''}</span></span>
                    <span className="row__line meta"><span className="ellipsis">{n.folder}{n.auto ? ' · oprettet til et møde' : ''}</span></span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Mål" className="span-12" count={`${onTrack} af ${goals.length} på sporet`} link="Alle mål" onLink={() => go({ screen: 'goals' })}>
          {!goals.length && <p className="muted">Ingen mål endnu. Fortæl Assist, hvad du gerne vil nå, så sætter den målet op og følger med.</p>}
          <ul className="rows">
            {stats.map(({ g, s }) => (
              <li key={g.id}>
                <button className="goalrow" onClick={() => go({ screen: 'goals', id: g.id })}>
                  <span className="row__body"><span className="strong ellipsis">{g.title}</span><span className="meta">{g.area} · {g.kind === 'habit' ? 'vane' : 'frist ' + s.due}</span></span>
                  <span className="goalrow__bar"><Progress ratio={s.ratio} focus={!s.onTrack} small /><span className="meta num">{s.label}</span></span>
                  <span className={`status ${s.onTrack ? '' : 'is-due'}`}>{s.onTrack ? 'På sporet' : 'Kræver handling'}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </main>
  );
}

/** One line to Assist from the start page; the conversation continues on the Assist screen. */
function AskBar() {
  const { go } = useRoute();
  const memory = useList('memory');
  const [t, setT] = useState('');
  return (
    <>
      {!memory.length && <p className="muted">CENTRA kender dig ikke endnu. Fortæl Assist om din arbejdstid, dine rutiner og dine mål, så fylder den kalender, noter og mål ud for dig.</p>}
      <form className="askbar pad-top" onSubmit={(ev) => { ev.preventDefault(); if (!t.trim()) return; queueAssist(t.trim()); go({ screen: 'assist' }); }}>
        <input value={t} onChange={(ev) => setT(ev.target.value)} placeholder={memory.length ? 'Spørg eller bed om noget …' : 'Fx: Jeg arbejder i Netto 06–16 tirsdag til fredag'} aria-label="Skriv til Assist" />
        <Btn type="submit" variant="primary" icon="send" aria-label="Send" disabled={!t.trim()} />
      </form>
    </>
  );
}
