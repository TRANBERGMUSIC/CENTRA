import { useMemo, useRef, useState } from 'react';
import { useEngine, useList, useRecord, useRoute, useNow, fmt } from '../state.tsx';
import { Btn, Pill, vars } from '../ui/primitives.tsx';
import { Icon } from '../ui/Icon.tsx';
import { useToast } from '../ui/Shell.tsx';
import { useLenis, useScreenEnter, collapseOut } from '../motion.ts';
import { moveMail, sendMail, setMailFlag, syncAll, mailAvailable, type MailAccount } from '../mail.ts';
import { queueAssist } from './Assist.tsx';

type Tab = 'inbox' | 'reply' | 'people' | 'receipts' | 'news';
const TABS: [Tab, string][] = [['inbox', 'Alle'], ['reply', 'Venter på svar'], ['people', 'Personer'], ['receipts', 'Kvitteringer'], ['news', 'Nyhedsbreve']];
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
  const [tab, setTab] = useState<Tab>('inbox');
  const [acct, setAcct] = useState<string>('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const accts = useList('mailacct') as unknown as MailAccount[];
  const all = (useList('mail', (a, b) => (b.at ?? '').localeCompare(a.at ?? '')) as any[]).filter((m) => !m.archived);
  const rows = useMemo(() => all.filter((m) => (acct === 'all' || m.acct === acct)
    && (tab === 'inbox' || (tab === 'reply' ? m.needsReply : tab === 'people' ? m.cat === 'Personer' : tab === 'receipts' ? m.cat === 'Kvitteringer' : m.cat === 'Nyhedsbreve'))
    && (!q.trim() || `${m.fromName} ${m.fromEmail} ${m.subject} ${m.preview}`.toLowerCase().includes(q.trim().toLowerCase()))), [all, acct, tab, q]);
  const id = route.id ?? rows[0]?.id;
  const count = (t: Tab) => all.filter((m) => (acct === 'all' || m.acct === acct) && (t === 'inbox' || (t === 'reply' ? m.needsReply : t === 'people' ? m.cat === 'Personer' : t === 'receipts' ? m.cat === 'Kvitteringer' : m.cat === 'Nyhedsbreve'))).length;

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
          {all.length > 0 && <input className="msearch" value={q} onChange={(x) => setQ(x.target.value)} placeholder="Søg i mails" aria-label="Søg i mails" />}
          <div className="tabs" role="tablist">
            {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'is-active' : ''}`} onClick={() => setTab(k)}>{l} <span className="meta num">{count(k)}</span></button>)}
          </div>
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
                  <span className="mrow__mark meta"><span>{m.acctName ?? m.acct}</span>{m.watch ? <Pill tone="focus" icon="assist">Du bad om denne</Pill> : m.needsReply ? <Pill tone="focus">Venter på svar</Pill> : m.attachment ? <><Icon name="paperclip" size="sm" /><span>{m.cat === 'Kvitteringer' ? 'Kvittering' : 'Vedhæftning'}</span></> : null}{m.draft && <Pill tone="calm">Udkast</Pill>}</span>
                </span>
              </button>
            );
          })}
          {!rows.length && <p className="meta pad">{!accts.length ? <>Ingen mailkonti endnu. <button className="tag" onClick={() => go({ screen: 'connections' })}>Tilføj Gmail, iCloud, one.com eller Simply</button></> : all.length ? 'Intet her.' : 'Henter dine mails …'}</p>}
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
  useLenis(wrap, content, id);
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
      toast({ text: `Sendt til ${p.name}` });
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
        <h2>{m.subject}</h2>
        <div className="meta">{new Date(m.at).toLocaleString('da-DK', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} · {m.acctName}</div>
        <div className="msg">
          <div className="msg__head"><span className="avatar avatar--lg" style={vars({ '--h': p.hue })}>{p.initials}</span><div><div className="strong">{p.name}</div><div className="meta">{p.email}{m.to?.length ? ' · til ' + m.to.join(', ') : ''}</div></div></div>
          <div className="msg__body mailtext">{m.body || m.preview}</div>
          {m.attachments?.length > 0 && <div className="attach">{m.attachments.map((a: string) => <span key={a} className="pill pill--neutral"><Icon name="paperclip" size="sm" />{a}</span>)}<span className="meta">Åbn vedhæftninger i din mailapp</span></div>}
        </div>
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

const quote = (m: any) => `${new Date(m.at).toLocaleString('da-DK', { dateStyle: 'long', timeStyle: 'short' })} skrev ${m.fromName || m.fromEmail}:\n${String(m.body ?? '').split('\n').slice(0, 40).map((l: string) => '> ' + l).join('\n')}`;

function ContactRail({ id }: { id?: string }) {
  const { go } = useRoute();
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
      {related.length > 0 && <div className="dsec"><div className="dsec__title">Noter</div>{related.map((n) => <button key={n.id} className="row" onClick={() => go({ screen: 'notes', id: n.id })}><Icon name="notes" /><span className="row__body">{n.title}</span></button>)}</div>}
      {fromSame.length > 0 && <div className="dsec"><div className="dsec__title">Andre mails fra {p.name.split(' ')[0]}</div>{fromSame.map((x) => <button key={x.id} className="row" onClick={() => go({ screen: 'inbox', id: x.id })}><span className="row__body"><span className="ellipsis">{x.subject}</span><span className="meta num">{fmt.shortDate(x.at)}</span></span></button>)}</div>}
    </aside>
  );
}
