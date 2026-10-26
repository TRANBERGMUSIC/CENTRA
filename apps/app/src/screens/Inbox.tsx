import { useRef, useState } from 'react';
import { useEngine, useList, useRecord, useRoute, useNow, fmt } from '../state.tsx';
import { Avatar, Btn, Pill, vars } from '../ui/primitives.tsx';
import { Icon } from '../ui/Icon.tsx';
import { useToast } from '../ui/Shell.tsx';
import { useLenis, useScreenEnter, collapseOut } from '../motion.ts';

/** Step 2: the inbox UI on synced sample mail. Real accounts (Gmail, Graph, IMAP) arrive in step 5. */
export function Inbox() {
  const e = useEngine();
  const { route, go } = useRoute();
  const toast = useToast();
  const now = useNow();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'inbox');
  const [tab, setTab] = useState<'inbox' | 'reply' | 'receipts'>('inbox');
  const people = Object.fromEntries(useList('person').map((p: any) => [p.id, p]));
  const all = (useList('mail', (a, b) => b.at.localeCompare(a.at)) as any[]).filter((m) => !m.archived);
  const rows = all.filter((m) => tab === 'inbox' || (tab === 'reply' ? m.needsReply : m.cat === 'Kvitteringer'));
  const id = route.id ?? rows[0]?.id;

  function archive(mid: string, el: HTMLElement | null) {
    const done = () => {
      e.set('mail', mid, { archived: true, unread: false });
      toast({ text: 'Arkiveret', action: { label: 'Fortryd', run: () => e.set('mail', mid, { archived: false }) } });
      const nextRow = rows.find((r) => r.id !== mid);
      go({ screen: 'inbox', id: nextRow?.id });
    };
    el ? collapseOut(el, done) : done();
  }

  return (
    <main className="inbox" ref={ref}>
      <div className="mlist" data-lenis-prevent>
        <div className="mlist__head" data-enter>
          <div className="mlist__title"><h1>Indbakke</h1><span className="meta">Eksempeldata · konti tilsluttes i trin 5</span></div>
          <div className="tabs" role="tablist">
            {([['inbox', 'Indbakke', all.length], ['reply', 'Venter på svar', all.filter((m) => m.needsReply).length], ['receipts', 'Kvitteringer', all.filter((m) => m.cat === 'Kvitteringer').length]] as const).map(([k, l, c]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'is-active' : ''}`} onClick={() => setTab(k)}>{l} <span className="meta num">{c}</span></button>
            ))}
          </div>
        </div>
        <div className="mrows">
          {rows.map((m) => {
            const p = people[m.from] ?? { name: m.from, initials: '?', hue: 150 };
            return (
              <button key={m.id} id={`mrow-${m.id}`} className={`mrow ${m.unread ? 'is-unread' : ''} ${m.id === id ? 'is-selected' : ''}`} onClick={() => { go({ screen: 'inbox', id: m.id }); if (m.unread) e.set('mail', m.id, { unread: false }); }}>
                {m.unread && <span className="unread-dot" aria-label="Ulæst" />}
                <Avatar initials={p.initials} hue={p.hue} />
                <span className="mrow__body">
                  <span className="mrow__who"><b className="ellipsis">{p.name}</b><span className="meta num mrow__time">{fmt.clock(m.at, now)}</span></span>
                  <span className="mrow__subj ellipsis">{m.subject}</span>
                  <span className="mrow__mark meta"><span>{m.acct}</span>{m.needsReply ? <Pill tone="focus">Venter på svar</Pill> : m.attachment ? <><Icon name="paperclip" size="sm" /><span>{m.cat === 'Kvitteringer' ? 'Kvittering' : 'Vedhæftning'}</span></> : m.cat === 'Invitationer' ? <span>Invitation</span> : null}</span>
                </span>
              </button>
            );
          })}
          {!rows.length && <p className="meta pad">Intet her. Godt gået.</p>}
        </div>
      </div>
      {id ? <Reader key={id} id={id} onArchive={(el) => archive(id, el)} /> : <div className="reader" />}
      <ContactRail id={id} />
    </main>
  );
}

function Reader({ id, onArchive }: { id: string; onArchive: (el: HTMLElement | null) => void }) {
  const e = useEngine();
  const m = useRecord<any>(id);
  const toast = useToast();
  const wrap = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  useLenis(wrap, content, id);
  if (!m) return <div className="reader" />;
  const p = (e.get(m.from) as any) ?? { name: m.from, initials: '?', hue: 150, email: '' };
  const text = draft ?? m.draft ?? '';
  return (
    <div className="reader" ref={wrap}>
      <div ref={content}>
        <div className="reader__bar">
          <Btn size="sm" variant="text" icon="archive" onClick={() => onArchive(document.getElementById(`mrow-${id}`))}>Arkivér</Btn>
          <Btn size="sm" variant="text" icon="star">Stjerne</Btn>
          <Btn size="sm" variant="text" icon="clock">Snooze</Btn>
        </div>
        <h2>{m.subject}</h2>
        <div className="meta">{m.thread} {m.thread === 1 ? 'besked' : 'beskeder'} · {m.acct}</div>
        {m.summary && (
          <div className="summary">
            <div className="summary__head"><Icon name="assist" />Resumé fra Assist</div>
            <ul>{m.summary.map((s: string) => <li key={s}>{s}</li>)}</ul>
            <div className="meta">Kilder: {m.thread} mails i tråden</div>
          </div>
        )}
        <div className="msg">
          <div className="msg__head"><span className="avatar avatar--lg" style={vars({ '--h': p.hue })}>{p.initials}</span><div><div className="strong">{p.name}</div><div className="meta">{p.email} · til dig</div></div><span className="meta num msg__time">{fmt.ago(m.at)}</span></div>
          <div className="msg__body">{m.body}</div>
        </div>
        {(m.needsReply || text) && (
          <div className="composer">
            {m.draft && <div className="composer__ai"><Icon name="assist" size="sm" />Udkast fra Assist i din tone · ret frit, intet sendes uden dig</div>}
            <textarea className="composer__body" value={text} placeholder="Skriv et svar" onChange={(x) => setDraft(x.target.value)} aria-label="Svar" />
            <div className="composer__bar">
              <Btn variant="primary" icon="send" onClick={() => toast({ text: 'Afsendelse via dine konti kommer i trin 5. Udkastet er gemt.' })}>Send</Btn>
              <Btn onClick={() => toast({ text: 'Send og arkivér kommer i trin 5.' })}>Send og arkivér</Btn>
              <Btn variant="text" className="push-right" onClick={() => { setDraft(''); e.set('mail', id, { draft: '' }); }}>Afvis udkast</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ContactRail({ id }: { id?: string }) {
  const e = useEngine();
  const { go } = useRoute();
  const m = useRecord<any>(id);
  const mails = useList('mail') as any[];
  const notes = useList('note') as any[];
  if (!m) return <aside className="details" />;
  const p = (e.get(m.from) as any) ?? { name: m.from, initials: '?', hue: 150 };
  const ev = m.event ? (e.get(m.event) as any) : null;
  const related = notes.filter((n) => n.mail === m.id);
  const fromSame = mails.filter((x) => x.from === m.from).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3);
  return (
    <aside className="details" aria-label="Kontakt">
      <div className="contact"><span className="avatar avatar--lg" style={vars({ '--h': p.hue })}>{p.initials}</span><div><div className="strong">{p.name}</div><div className="meta">{[p.org, p.email].filter(Boolean).join(' · ')}</div></div></div>
      {ev && <div className="dsec"><div className="dsec__title">Aftale</div><button className="row" onClick={() => go({ screen: 'calendar' })}><Icon name="calendar" /><span className="row__body"><span>{ev.title}</span><span className="meta num">{fmt.shortDate(ev.start)} {fmt.hm(ev.start)}</span></span></button></div>}
      {related.length > 0 && <div className="dsec"><div className="dsec__title">Noter</div>{related.map((n) => <button key={n.id} className="row" onClick={() => go({ screen: 'notes', id: n.id })}><Icon name="notes" /><span className="row__body">{n.title}</span></button>)}</div>}
      <div className="dsec"><div className="dsec__title">Seneste korrespondance</div>{fromSame.map((x) => <div key={x.id} className="kv"><span className="ellipsis">{x.subject}</span><span className="meta num">{fmt.shortDate(x.at)}</span></div>)}</div>
    </aside>
  );
}
