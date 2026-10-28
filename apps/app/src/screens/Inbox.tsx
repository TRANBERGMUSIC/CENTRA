import { useMemo, useRef, useState } from 'react';
import { useEngine, useList, useRecord, useRoute, useNow, fmt } from '../state.tsx';
import { Btn, Pill, vars } from '../ui/primitives.tsx';
import { Icon } from '../ui/Icon.tsx';
import { MailView } from '../ui/MailView.tsx';
import { useToast } from '../ui/Shell.tsx';
import { useScreenEnter, collapseOut } from '../motion.ts';
import { moveMail, sendMail, setMailFlag, syncAll, mailAvailable, type MailAccount } from '../mail.ts';
import { queueAssist } from './Assist.tsx';

type Tab = 'important' | 'reply' | 'receipts' | 'other' | 'archive';
const TABS: [Tab, string][] = [['important', 'Vigtigt'], ['reply', 'Venter på svar'], ['receipts', 'Kvitteringer'], ['other', 'Andet'], ['archive', 'Arkiv']];
/** Noise: newsletters, automatic notices, or what the AI sorted out. Watched and starred mail is never noise. */
const noise = (m: any) => !m.watch && !m.flagged && (m.ai ? !m.ai.important : m.cat === 'Nyhedsbreve' || m.cat === 'Notifikationer');
const inTab = (m: any, t: Tab) => t === 'archive' ? m.archived : !m.archived && (t === 'important' ? !noise(m) : t === 'reply' ? m.needsReply && !noise(m) : t === 'receipts' ? m.cat === 'Kvitteringer' : noise(m));
const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const initials = (n: string) => n.replace(/["<>]/g, '').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('') || '?';
const who = (m: any) => ({ name: m.fromName || m.fromEmail || 'Ukendt', email: m.fromEmail ?? '', hue: hue(m.fromEmail ?? m.fromName ?? ''), initials: initials(m.fromName || m.fromEmail || '?') });

/** All your mail accounts in one inbox. Archive and delete happen on the server too. */
export function Inbox() {
  const e = useEngine();
  const { route, go } = useRoute();
  const toast = useToast();
  const now = useNow();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'inbox');
  const [tab, setTab] = useState<Tab>('important');
  const [acct, setAcct] = useState<string>('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const accts = useList('mailacct') as unknown as MailAccount[];
  const everything = useList('mail', (a, b) => (b.at ?? '').localeCompare(a.at ?? '')) as any[];
  const all = everything.filter((m) => !m.archived);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // A search looks through every account and the archive, in sender, subject and the whole text.
  const rows = useMemo(() => everything.filter((m) => (acct === 'all' || m.acct === acct)
    && (words.length ? words.every((w) => `${m.fromName} ${m.fromEmail} ${m.subject} ${m.body ?? m.preview} ${(m.attachments ?? []).join(' ')} ${m.acctName}`.toLowerCase().includes(w)) : inTab(m, tab))), [everything, acct, tab, q]);
  const id = route.id ?? rows[0]?.id;
  const count = (t: Tab) => everything.filter((m) => (acct === 'all' || m.acct === acct) && inTab(m, t)).length;

  async function move(m: any, action: 'archive' | 'trash', el: HTMLElement | null) {
    const next = rows.find((r) => r.id !== m.id && rows.indexOf(r) >= rows.indexOf(m)) ?? rows.find((r) => r.id !== m.id);
    const done = async () => {
      try {
        const { id: _i, type: _t, ...f } = m;
        await moveMail(e, m, action);
        go({ screen: 'inbox', id: next?.id });
        toast({ text: action === 'archive' ? 'Arkiveret' : 'Slettet (lagt i papirkurven)', action: !m.acct ? { label: 'Fortryd', run: () => e.set('mail', m.id, { ...f, _deleted: false, archived: false }) } : undefined });
      } catch (x) { toast({ text: (x as Error).message }); }
    };
    el ? collapseOut(el, () => void done()) : await done();
  }
  async function refresh() {
    setBusy(true);
    const r = await syncAll(e);
    setBusy(false);
    toast({ text: r.errors.length ? r.errors.join(' · ') : r.added.length ? `${r.added.length} nye mails` : 'Ingen nye mails' });
  }

  return (
    <main className="inbox" ref={ref}>
      <div className="mlist" data-lenis-prevent>
        <div className="mlist__head" data-enter>
          <div className="mlist__title"><h1>Indbakke</h1>
            {accts.length > 0 && mailAvailable() && <Btn size="sm" variant="text" disabled={busy} onClick={refresh} className="push-right">{busy ? 'Henter …' : 'Hent nu'}</Btn>}
          </div>
          {accts.length > 1 && (
            <div className="acctpick" role="radiogroup" aria-label="Konto">
              {[['all', 'Alle konti'] as const, ...accts.map((a) => [a.id, a.name] as const)].map(([k, l]) => <button key={k} role="radio" aria-checked={acct === k} className={acct === k ? 'is-active' : ''} onClick={() => setAcct(k)}>{l}</button>)}
            </div>
          )}
          {everything.length > 0 && <input className="msearch" type="search" value={q} onChange={(x) => setQ(x.target.value)} placeholder="Søg i alle mails og arkivet" aria-label="Søg i mails" />}
          {words.length > 0 ? (
            <div className="msearch__ask"><span className="meta">{rows.length} fundet i alle konti</span>
              <Btn size="sm" variant="text" icon="assist" onClick={() => { queueAssist(`Find i mine mails: ${q.trim()}. Fortæl hvad du fandt, og hvad jeg skal bruge det til.`); go({ screen: 'assist' }); }}>Spørg Assist</Btn></div>
          ) : (
            <div className="tabs" role="tablist">
              {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'is-active' : ''}`} onClick={() => setTab(k)}>{l} <span className="meta num">{count(k)}</span></button>)}
            </div>
          )}
        </div>
        <div className="mrows">
          {rows.map((m) => {
            const p = who(m);
            return (
              <button key={m.id} id={`mrow-${m.id}`} className={`mrow ${m.unread ? 'is-unread' : ''} ${m.id === id ? 'is-selected' : ''}`} onClick={() => { go({ screen: 'inbox', id: m.id }); if (m.unread) setMailFlag(e, m, { unread: false }); }}>
                {m.unread && <span className="unread-dot" aria-label="Ulæst" />}
                <span className="avatar" style={vars({ '--h': p.hue })}>{p.initials}</span>
                <span className="mrow__body">
                  <span className="mrow__who"><b className="ellipsis">{p.name}</b><span className="meta num mrow__time">{fmt.clock(m.at, now)}</span></span>
                  <span className="mrow__subj ellipsis">{m.subject}</span>
                  {m.ai?.summary && <span className="mrow__ai meta ellipsis">{m.ai.summary}</span>}
                  <span className="mrow__mark meta"><span>{m.acctName ?? m.acct}{m.archived ? ' · arkiveret' : ''}</span>{m.watch ? <Pill tone="focus" icon="assist">Du bad om denne</Pill> : m.needsReply ? <Pill tone="focus">Venter på svar</Pill> : m.attachment ? <><Icon name="paperclip" size="sm" /><span>{m.cat === 'Kvitteringer' ? 'Kvittering' : 'Vedhæftning'}</span></> : null}{m.draft && <Pill tone="calm">Udkast</Pill>}</span>
                </span>
              </button>
            );
          })}
          {!rows.length && <p className="meta pad">{!accts.length ? <>Ingen mailkonti endnu. <button className="tag" onClick={() => go({ screen: 'connections' })}>Tilføj Gmail, iCloud, one.com eller Simply</button></> : words.length ? 'Intet fundet. Prøv andre ord, eller spørg Assist.' : tab === 'other' ? 'Ingen reklamer eller nyhedsbreve. Dejligt.' : all.length ? 'Intet her.' : 'Henter dine mails …'}</p>}
        </div>
      </div>
      {id ? <Reader key={id} id={id} onMove={(m, a) => move(m, a, document.getElementById(`mrow-${m.id}`))} /> : <div className="reader" />}
      <ContactRail id={id} />
    </main>
  );
}

function Reader({ id, onMove }: { id: string; onMove: (m: any, a: 'archive' | 'trash') => void }) {
  const e = useEngine();
  const m = useRecord<any>(id);
  const toast = useToast();
  const { go } = useRoute();
  const wrap = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Native scrolling here: the mail itself is a frame, and wheel events from it must reach this pane.
  if (!m) return <div className="reader" />;
  const p = who(m);
  const text = reply ?? m.draft ?? '';
  const open = reply !== null || !!m.draft;

  async function send(archive: boolean) {
    if (!text.trim()) return;
    setSending(true);
    try {
      await sendMail(e, m.acct, { to: [m.fromEmail], subject: /^(re|sv):/i.test(m.subject) ? m.subject : `Re: ${m.subject}`, body: `${text.trim()}\n\n${quote(m)}`, replyTo: m });
      setReply(null);
      toast({ person: { name: p.name }, text: `Sendt til ${p.name}` });
      if (archive) onMove(m, 'archive');
    } catch (x) { toast({ text: (x as Error).message }); } finally { setSending(false); }
  }

  return (
    <div className="reader" ref={wrap}>
      <div ref={content}>
        <div className="reader__bar">
          <Btn size="sm" variant="text" icon="reply" onClick={() => setReply(text || '')}>Svar</Btn>
          <Btn size="sm" variant="text" icon="archive" onClick={() => onMove(m, 'archive')}>Arkivér</Btn>
          <Btn size="sm" variant="text" icon="x" onClick={() => { if (confirm('Slet mailen? Den lægges i papirkurven på din mailserver.')) onMove(m, 'trash'); }}>Slet</Btn>
          <Btn size="sm" variant="text" onClick={() => setMailFlag(e, m, { unread: !m.unread })}>{m.unread ? 'Markér læst' : 'Markér ulæst'}</Btn>
          <Btn size="sm" variant="text" icon="star" aria-pressed={!!m.flagged} onClick={() => setMailFlag(e, m, { flagged: !m.flagged })}>{m.flagged ? 'Stjernet' : 'Stjerne'}</Btn>
          <Btn size="sm" variant="text" icon="assist" onClick={() => { queueAssist(`Lav et kort svarudkast i min tone til mailen [${m.id}] fra ${p.name} om "${m.subject}".`); go({ screen: 'assist' }); }}>Assist</Btn>
        </div>
        <article className="mailcard">
          <header className="mailhead">
            <span className="avatar avatar--lg" style={vars({ '--h': p.hue })}>{p.initials}</span>
            <div className="mailhead__who">
              <div className="mailhead__line"><span className="strong ellipsis">{p.name}</span><time className="meta num">{new Date(m.at).toLocaleString('da-DK', { day: 'numeric', month: 'short', year: new Date(m.at).getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: '2-digit', minute: '2-digit' })}</time></div>
              <div className="meta ellipsis">{p.email}{m.to?.length ? ` · til ${m.to.join(', ')}` : ''}{m.cc?.length ? ` · cc ${m.cc.join(', ')}` : ''}</div>
            </div>
            <SaveSender m={m} />
          </header>
          <h2 className="mailsubject">{m.subject}</h2>
          <div className="meta mailacct">{m.acctName}</div>
          <MailView e={e} m={m} />
        </article>
        {open && (
          <div className="replybox">
            {m.draft && reply === null && <div className="composer__ai"><Icon name="assist" size="sm" />Udkast fra Assist · ret frit, intet sendes uden dig</div>}
            <textarea className="composer__body" autoFocus value={text} placeholder={`Svar til ${p.name}`} onChange={(x) => setReply(x.target.value)} aria-label="Svar" />
            <div className="composer__bar">
              <Btn variant="primary" icon="send" disabled={sending || !text.trim() || !mailAvailable()} onClick={() => send(false)}>{sending ? 'Sender …' : 'Send'}</Btn>
              <Btn disabled={sending || !text.trim() || !mailAvailable()} onClick={() => send(true)}>Send og arkivér</Btn>
              <Btn variant="text" className="push-right" onClick={() => { setReply(null); e.set('mail', id, { draft: '' }); }}>Kassér</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** "Gem som kontakt" / "Åbn kontakt" in the mail's header, so it works without the side panel too. */
function SaveSender({ m }: { m: any }) {
  const e = useEngine();
  const { go } = useRoute();
  const toast = useToast();
  const persons = useList('person') as any[];
  const p = who(m);
  if (!p.email) return null;
  const known = persons.find((x) => x.email && x.email.toLowerCase() === p.email.toLowerCase());
  if (known) return <Btn size="sm" variant="text" icon="contacts" onClick={() => go({ screen: 'contacts', id: known.id })}>Kontakt</Btn>;
  if (m.cat !== 'Personer') return null;
  return <Btn size="sm" variant="text" icon="contacts" onClick={() => { const cid = e.create('person', { name: m.fromName || p.email, email: p.email, createdAt: new Date().toISOString() }); toast({ person: { name: m.fromName || p.email }, text: `${m.fromName || p.email} er gemt som kontakt`, action: { label: 'Åbn', run: () => go({ screen: 'contacts', id: cid }) } }); }}>Gem kontakt</Btn>;
}

const quote = (m: any) => `${new Date(m.at).toLocaleString('da-DK', { dateStyle: 'long', timeStyle: 'short' })} skrev ${m.fromName || m.fromEmail}:\n${String(m.body ?? '').split('\n').slice(0, 40).map((l: string) => '> ' + l).join('\n')}`;

function ContactRail({ id }: { id?: string }) {
  const { go } = useRoute();
  const e = useEngine();
  const toast = useToast();
  const persons = useList('person') as any[];
  const m = useRecord<any>(id);
  const mails = useList('mail') as any[];
  const notes = useList('note') as any[];
  if (!m) return <aside className="details" />;
  const p = who(m);
  const related = notes.filter((n) => n.mail === m.id);
  const fromSame = mails.filter((x) => x.fromEmail === m.fromEmail && x.id !== m.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  return (
    <aside className="details" aria-label="Kontakt">
      <div className="contact"><span className="avatar avatar--lg" style={vars({ '--h': p.hue })}>{p.initials}</span><div><div className="strong">{p.name}</div><div className="meta">{p.email}</div></div></div>
      {(() => {
        const known = persons.find((x) => x.email && x.email.toLowerCase() === p.email.toLowerCase());
        if (known) return <button className="tag pad-top" onClick={() => go({ screen: 'contacts', id: known.id })}>Åbn kontakt</button>;
        if (m.cat !== 'Personer' || !p.email) return null;
        return <Btn size="sm" icon="contacts" className="pad-top" onClick={() => { const cid = e.create('person', { name: m.fromName || p.email, email: p.email, createdAt: new Date().toISOString() }); toast({ person: { name: m.fromName || p.email }, text: `${m.fromName || p.email} er gemt som kontakt`, action: { label: 'Åbn', run: () => go({ screen: 'contacts', id: cid }) } }); }}>Gem som kontakt</Btn>;
      })()}
      {m.ai?.summary && <div className="dsec"><div className="dsec__title">Kort fortalt</div><p className="small">{m.ai.summary}</p></div>}
      {related.length > 0 && <div className="dsec"><div className="dsec__title">Noter</div>{related.map((n) => <button key={n.id} className="row" onClick={() => go({ screen: 'notes', id: n.id })}><Icon name="notes" /><span className="row__body">{n.title}</span></button>)}</div>}
      {fromSame.length > 0 && <div className="dsec"><div className="dsec__title">Andre mails fra {p.name.split(' ')[0]}</div>{fromSame.map((x) => <button key={x.id} className="row" onClick={() => go({ screen: 'inbox', id: x.id })}><span className="row__body"><span className="ellipsis">{x.subject}</span><span className="meta num">{fmt.shortDate(x.at)}</span></span></button>)}</div>}
    </aside>
  );
}
