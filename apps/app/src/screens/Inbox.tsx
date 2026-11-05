import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useEngine, useList, useRecord, useRoute, useNow, fmt } from '../state.tsx';
import { Btn, Pill, vars, useProgressive, More } from '../ui/primitives.tsx';
import { Icon } from '../ui/Icon.tsx';
import { MailView } from '../ui/MailView.tsx';
import { useToast } from '../ui/Shell.tsx';
import { useScreenEnter, collapseOut } from '../motion.ts';
import { moveMail, setMailFlag, syncAll, mailAvailable, sendAccounts, type MailAccount } from '../mail.ts';
import { setLunchHubStatus, type LhConn } from '../lunchhub.ts';
import { queueAssist } from './Assist.tsx';
import { folders as listFolders, moveToFolder, removeFolder, sortByRules, type MailFolder, type FolderRule } from '../mailFolders.ts';
import { ask } from '../ui/Confirm.tsx';
import { clearDanger, markDanger } from '../mailSafety.ts';
import { Composer, type ComposeMode } from '../ui/Composer.tsx';

/** 'inbox', 'sent', 'archive', or a folder's id. */
type Box = string;
type Sort = 'new' | 'old' | 'from' | 'unread';
const SORTS: [Sort, string][] = [['new', 'Nyeste først'], ['old', 'Ældste først'], ['from', 'Afsender A–Å'], ['unread', 'Ulæste først']];
const sorter = (k: Sort) => (a: any, b: any) => k === 'old' ? (a.at ?? '').localeCompare(b.at ?? '')
  : k === 'from' ? String(a.fromName || a.fromEmail || '').localeCompare(String(b.fromName || b.fromEmail || ''), 'da') || (b.at ?? '').localeCompare(a.at ?? '')
  : k === 'unread' ? Number(!!b.unread) - Number(!!a.unread) || (b.at ?? '').localeCompare(a.at ?? '')
  : (b.at ?? '').localeCompare(a.at ?? '');
type Filter = 'all' | 'important' | 'reply' | 'receipts' | 'other';
const BOXES: [Box, string][] = [['inbox', 'Indbakke'], ['sent', 'Sendt'], ['archive', 'Arkiv']];
const FILTERS: [Filter, string][] = [['all', 'Alle'], ['important', 'Vigtigt'], ['reply', 'Venter på svar'], ['receipts', 'Kvitteringer'], ['other', 'Reklamer og notifikationer']];
/** Noise: newsletters, automatic notices, or what the AI sorted out. Watched and starred mail is never noise. */
const noise = (m: any) => !m.watch && !m.flagged && (m.ai ? !m.ai.important : m.cat === 'Nyhedsbreve' || m.cat === 'Notifikationer');
const inBox = (m: any, b: Box) => b === 'archive' ? m.archived : m.archived ? false : b === 'sent' ? !!m.sent : b === 'inbox' ? !m.sent && !m.mbox : m.mbox === b;
const inFilter = (m: any, f: Filter) => f === 'all' ? true : f === 'important' ? !noise(m) : f === 'reply' ? m.needsReply && !noise(m) : f === 'receipts' ? m.cat === 'Kvitteringer' : noise(m);
/** Delete asks first (the mail goes to the server's papirkurv, so it is gone from every mail app). */
const askDelete = (m: any) => m.source === 'lunchhub'
  ? ask({ title: 'Fjern henvendelsen?', text: 'Den arkiveres i LunchHub og forsvinder herfra.', ok: 'Fjern', danger: true })
  : m.sent ? ask({ title: 'Fjern mailen fra CENTRA?', text: 'Kopien i Sendt på din mailserver bliver liggende.', ok: 'Fjern', danger: true })
  : ask({ title: 'Slet mailen?', text: `"${m.subject}" lægges i papirkurven på din mailserver.`, ok: 'Slet', danger: true });
const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const initials = (n: string) => n.replace(/["<>]/g, '').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('') || '?';
const who = (m: any) => ({ name: (m.sent ? 'Til ' : '') + (m.fromName || m.fromEmail || 'Ukendt'), email: m.fromEmail ?? '', hue: hue(m.fromEmail ?? m.fromName ?? ''), initials: initials(m.fromName || m.fromEmail || '?') });
/** "I dag", "I går", "Mandag" …, then the month: mail grouped the way you think about it. */
function dayLabel(iso: string | undefined, now: Date) {
  if (!iso) return '';
  const d = new Date(iso), a = new Date(now); a.setHours(0, 0, 0, 0);
  const b = new Date(d); b.setHours(0, 0, 0, 0);
  const days = Math.round((a.getTime() - b.getTime()) / 86400000);
  if (days <= 0) return 'I dag';
  if (days === 1) return 'I går';
  if (days < 7) { const w = d.toLocaleDateString('da-DK', { weekday: 'long' }); return w.charAt(0).toUpperCase() + w.slice(1); }
  const mo = d.toLocaleDateString('da-DK', { month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  return mo.charAt(0).toUpperCase() + mo.slice(1);
}
/** Under a day heading the row only needs the time (this week) or the date. */
const rowTime = (iso: string | undefined, now: Date) => {
  if (!iso) return '';
  const d = new Date(iso);
  return now.getTime() - d.getTime() < 6.5 * 86400000 ? d.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' });
};
const ago = (iso: string | undefined, now: Date) => { if (!iso) return ''; const s = Math.round((now.getTime() - new Date(iso).getTime()) / 1000); return s < 60 ? 'lige nu' : s < 3600 ? `for ${Math.round(s / 60)} min siden` : `kl. ${new Date(iso).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}`; };

/** All your mail accounts in one inbox. Archive and delete happen on the server too. */
export function Inbox() {
  const e = useEngine();
  const { route, go } = useRoute();
  const toast = useToast();
  const now = useNow();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'inbox');
  const [box, setBox] = useState<Box>(() => route.id?.startsWith('folder:') ? route.id.slice(7) : 'inbox');
  const [sort, setSort] = useState<Sort>('new');
  const [editFolder, setEditFolder] = useState<MailFolder | 'new' | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  useList('mailfolder');
  const fl = listFolders(e);
  useEffect(() => { if (route.id?.startsWith('folder:')) { setBox(route.id.slice(7)); setQ(''); } }, [route.id]);
  if (box !== 'inbox' && box !== 'sent' && box !== 'archive' && !fl.some((f) => f.id === box)) setTimeout(() => setBox('inbox'), 0);
  const [filter, setFilter] = useState<Filter>('all');
  const [acct, setAcct] = useState<string>('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [searching, setSearching] = useState(false);
  const mailAccts = useList('mailacct') as unknown as MailAccount[];
  const lhConns = useList('lhconn') as unknown as LhConn[];
  // LunchHub shows up as one more "account" in the picker.
  const accts = [...mailAccts, ...lhConns.map((c) => ({ id: c.id, name: c.name }))] as { id: string; name: string }[];
  const multi = accts.length > 1 && acct === 'all';
  const everything = useList('mail', (a, b) => (b.at ?? '').localeCompare(a.at ?? '')) as any[];
  const all = everything.filter((m) => !m.archived);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // A search looks through every account and the archive, in sender, subject and the whole text.
  const rows = useMemo(() => everything.filter((m) => (acct === 'all' || m.acct === acct)
    && (words.length ? words.every((w) => `${m.fromName} ${m.fromEmail} ${(m.to ?? []).join(' ')} ${m.subject} ${m.body ?? m.preview} ${(m.attachments ?? []).join(' ')} ${m.acctName}`.toLowerCase().includes(w))
      : inBox(m, box) && (box !== 'inbox' || inFilter(m, filter)))).sort(sorter(sort)), [everything, acct, box, filter, q, sort]);
  const [shown, moreAt] = useProgressive(rows.length, 60, `${acct}|${box}|${filter}|${q}|${sort}`);
  // A mail you opened yourself. On the Mac the newest one shows when none is; on the iPhone the list
  // shows until you tap one, and then the mail fills the screen (with a way back), like Mail.
  const opened = route.id && !route.id.startsWith('folder:') ? route.id : undefined;
  const id = opened ?? rows[0]?.id;
  const folderCount = (f: string) => everything.filter((m) => !m.archived && m.mbox === f && (acct === 'all' || m.acct === acct)).length;
  const folderUnread = (f: string) => everything.filter((m) => !m.archived && m.mbox === f && m.unread && (acct === 'all' || m.acct === acct)).length;
  const dropTo = (target: string, ev: React.DragEvent) => {
    ev.preventDefault(); setDropOn(null);
    const mid = ev.dataTransfer.getData('text/centra-mail');
    if (!mid) return;
    const before = moveToFolder(e, [mid], target === 'inbox' ? '' : target);
    toast({ text: `Flyttet til ${target === 'inbox' ? 'Indbakke' : fl.find((f) => f.id === target)?.name ?? 'mappen'}`, action: { label: 'Fortryd', run: () => before.forEach((b) => e.set('mail', b.id, b.fields)) } });
  };
  const mine = everything.filter((m) => acct === 'all' || m.acct === acct);
  const unread = mine.filter((m) => inBox(m, 'inbox') && m.unread).length;
  const count = (f: Filter) => mine.filter((m) => inBox(m, 'inbox') && inFilter(m, f)).length;
  // When everything was last fetched (mail and LunchHub fetch on their own; "Hent nu" is only for the impatient).
  const synced = [...mailAccts, ...lhConns].map((a: any) => a.lastSync as string | undefined).filter(Boolean).sort().pop();
  const syncErr = [...mailAccts, ...lhConns].map((a: any) => a.lastError ? `${a.name}: ${a.lastError}` : '').filter(Boolean)[0];

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
  // ⌫ / Delete deletes the open mail, like in Mail (when you are not typing somewhere).
  const keyRef = useRef<(ev: KeyboardEvent) => void>(() => {});
  keyRef.current = (ev) => {
    if (ev.key !== 'Backspace' && ev.key !== 'Delete') return;
    const t = ev.target as HTMLElement | null;
    if (t?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]')) return;
    const m = everything.find((x) => x.id === id);
    if (!m) return;
    ev.preventDefault();
    void askDelete(m).then((yes) => { if (yes) void move(m, 'trash', document.getElementById(`mrow-${m.id}`)); });
  };
  useEffect(() => { const k = (ev: KeyboardEvent) => keyRef.current(ev); document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, []);
  async function refresh() {
    setBusy(true);
    const r = await syncAll(e);
    setBusy(false);
    toast({ text: r.errors.length ? r.errors.join(' · ') : r.added.length ? `${r.added.length} nye mails` : 'Ingen nye mails' });
  }

  return (
    <main className={`inbox ${opened ? 'has-open' : ''}`} ref={ref}>
      <div className="mlist" data-lenis-prevent>
        <div className="mlist__head" data-enter>
          <div className="mlist__title"><h1>Mail</h1>
            {accts.length > 0 && mailAvailable() && syncErr && <span className="meta mlist__sync errtext" title={syncErr}>Kunne ikke hente alt</span>}
            <span className="push-right" />
            {everything.length > 0 && <Btn size="sm" variant="text" icon="search" className={searching ? 'is-on' : ''} onClick={() => { setSearching((x) => !x); if (searching) setQ(''); }} aria-label="Søg i mails" aria-pressed={searching} title="Søg" />}
            {accts.length > 0 && mailAvailable() && <Btn size="sm" variant="text" icon="refresh" disabled={busy} onClick={refresh} aria-label="Hent nu" title={busy ? 'Henter …' : synced ? `Hentet ${ago(synced, now)}` : 'Hent nu'} className={busy ? 'is-spinning' : ''} />}
            {sendAccounts(e).length > 0 && mailAvailable() && <Btn size="sm" variant="text" icon="compose" className="mlist__new" onClick={() => setWriting(true)} aria-label="Ny mail" title="Ny mail" />}
          </div>
          {searching && (
            <div className="msearchrow">
              <input className="msearch" type="search" value={q} autoFocus onChange={(x) => setQ(x.target.value)} onKeyDown={(x) => { if (x.key === 'Escape') { setQ(''); setSearching(false); } }} placeholder="Søg i alle mails" aria-label="Søg i mails" enterKeyHint="search" />
              <Btn size="sm" variant="text" onClick={() => { setQ(''); setSearching(false); }}>Annullér</Btn>
            </div>
          )}
          <div className="segmented mbox" role="tablist" aria-label="Mappe">
            {BOXES.map(([k, l]) => <button key={k} role="tab" aria-selected={box === k && !words.length} className={`${box === k && !words.length ? 'is-active' : ''} ${dropOn === k ? 'is-drop' : ''}`} onClick={() => { setBox(k); setQ(''); }}
              onDragOver={k === 'inbox' ? (ev) => { ev.preventDefault(); setDropOn(k); } : undefined} onDragLeave={() => setDropOn(null)} onDrop={k === 'inbox' ? (ev) => dropTo('inbox', ev) : undefined}>{l}{k === 'inbox' && unread > 0 && <span className="mbox__n num">{unread}</span>}</button>)}
          </div>
          <div className="mfolders" role="tablist" aria-label="Dine mapper">
            {fl.map((f) => {
              const n = folderUnread(f.id);
              const sys = (f as any).system as string | undefined;
              return (
                <button key={f.id} role="tab" aria-selected={box === f.id && !words.length} className={`mfolder ${sys ? 'mfolder--danger' : ''} ${box === f.id && !words.length ? 'is-active' : ''} ${dropOn === f.id ? 'is-drop' : ''}`} title={f.description || undefined}
                  onClick={() => { setBox(f.id); setQ(''); }} onDragOver={(ev) => { ev.preventDefault(); setDropOn(f.id); }} onDragLeave={() => setDropOn(null)} onDrop={(ev) => dropTo(f.id, ev)}>
                  <Icon name={sys ? 'shield' : 'folder'} size="sm" /><span className="ellipsis">{f.name}</span><span className="num meta">{n ? <b>{n}</b> : folderCount(f.id)}</span>
                </button>
              );
            })}
            <button className="mfolder mfolder--add" onClick={() => setEditFolder('new')} aria-label="Ny mappe" title="Ny mappe"><Icon name="plus" size="sm" />{!fl.length && <span>Ny mappe</span>}</button>
          </div>
          {words.length > 0 ? (
            <div className="msearch__ask"><span className="meta">{rows.length} fundet i alle konti</span>
              <Btn size="sm" variant="text" icon="assist" onClick={() => { queueAssist(`Find i mine mails: ${q.trim()}. Fortæl hvad du fandt, og hvad jeg skal bruge det til.`); go({ screen: 'assist' }); }}>Spørg Assist</Btn></div>
          ) : (
            <div className="mtools">
              {box === 'inbox' ? (
                <div className="mfilter" role="radiogroup" aria-label="Vis">
                  {FILTERS.map(([k, l]) => { const n = count(k); return (k === 'all' || n > 0 || filter === k) && <button key={k} role="radio" aria-checked={filter === k} className={filter === k ? 'is-active' : ''} onClick={() => setFilter(k)}>{l} <span className="num">{n}</span></button>; })}
                </div>
              ) : fl.some((f) => f.id === box) && !(fl.find((f) => f.id === box) as any)?.system ? (
                <div className="mfolderbar"><span className="meta ellipsis">{fl.find((f) => f.id === box)?.description}</span>
                  <Btn size="sm" variant="text" icon="edit" onClick={() => setEditFolder(fl.find((f) => f.id === box) ?? null)}>Mappe og regler</Btn></div>
              ) : <span />}
              <label className="msortbtn" title="Sortér"><Icon name="sort" size="sm" /><span className="sr-only">Sortér</span>
                <select value={sort} onChange={(x) => setSort(x.target.value as Sort)} aria-label="Sortér">{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            </div>
          )}
        </div>
        <div className="mrows">
          {rows.slice(0, shown).map((m, i, list) => {
            const p = who(m);
            const day = sort === 'new' || sort === 'old' ? dayLabel(m.at, now) : '';
            const head = day && (i === 0 || dayLabel(list[i - 1].at, now) !== day);
            const danger = m.danger as 'phishing' | 'scam' | undefined;
            const line = m.ai?.summary || m.preview || '';
            return (
              <Fragment key={m.id}>
                {head && <div className="mday" role="presentation">{day}</div>}
                <button id={`mrow-${m.id}`} draggable onDragStart={(ev) => { ev.dataTransfer.setData('text/centra-mail', m.id); ev.dataTransfer.effectAllowed = 'move'; }} className={`mrow ${m.unread ? 'is-unread' : ''} ${m.id === id ? 'is-selected' : ''} ${danger ? 'is-danger' : ''}`} onClick={() => { go({ screen: 'inbox', id: m.id }); if (m.unread) setMailFlag(e, m, { unread: false }); }}>
                  {m.unread && <span className="unread-dot" aria-label="Ulæst" />}
                  {danger ? <span className="avatar avatar--danger" aria-hidden="true"><Icon name="shield" size="sm" /></span> : <span className="avatar" style={vars({ '--h': p.hue })}>{p.initials}</span>}
                  <span className="mrow__body">
                    <span className="mrow__who"><b className="ellipsis">{p.name}</b>{m.attachment && <Icon name="paperclip" size="sm" className="mrow__clip" />}<span className="meta num mrow__time">{day ? rowTime(m.at, now) : fmt.clock(m.at, now)}</span></span>
                    <span className="mrow__subj ellipsis">{m.subject}</span>
                    <span className="mrow__line">
                      <span className="mrow__prev ellipsis">{multi && <span className="mrow__acct">{m.acctName ?? m.acct}{m.mbox && box !== m.mbox ? ` · ${fl.find((f) => f.id === m.mbox)?.name ?? ''}` : ''} · </span>}{m.sent && box !== 'sent' ? 'Sendt · ' : ''}{m.archived ? 'Arkiveret · ' : ''}{line}</span>
                      {danger ? <Pill tone="danger" icon="shield">{danger === 'phishing' ? 'Phishing' : 'Svindel'}</Pill>
                        : m.watch ? <Pill tone="focus" icon="assist">Du bad om denne</Pill> : m.needsReply ? <Pill tone="focus">Venter på svar</Pill> : null}
                      {m.draft && <Pill tone="calm">Udkast</Pill>}
                    </span>
                  </span>
                </button>
              </Fragment>
            );
          })}
          <More at={moreAt} left={rows.length - shown} />
          {!rows.length && <p className="meta pad">{!accts.length ? <>Ingen mailkonti. <button className="tag" onClick={() => go({ screen: 'connections' })}>Tilføj mailkonto</button></> : words.length ? 'Intet fundet.' : box === 'sent' ? 'Ingen sendte mails.' : box === 'archive' ? 'Intet i arkivet.' : box !== 'inbox' ? 'Ingen mails i mappen.' : filter === 'other' ? 'Ingen reklamer eller notifikationer.' : all.length ? 'Intet her.' : 'Henter dine mails …'}</p>}
        </div>
      </div>
      {id ? <Reader key={id} id={id} onMove={(m, a) => move(m, a, document.getElementById(`mrow-${m.id}`))} onBack={() => go({ screen: 'inbox', id: box !== 'inbox' && box !== 'sent' && box !== 'archive' ? `folder:${box}` : undefined })} /> : <div className="reader" />}
      {editFolder && <FolderSheet f={editFolder === 'new' ? null : editFolder} onClose={() => setEditFolder(null)} onSaved={(fid) => { setBox(fid); setEditFolder(null); }} onDeleted={() => { setBox('inbox'); setEditFolder(null); }} />}
      {writing && <Composer mode="new" onClose={() => setWriting(false)} />}
      <ContactRail id={id} />
    </main>
  );
}

function Reader({ id, onMove, onBack }: { id: string; onMove: (m: any, a: 'archive' | 'trash') => void; onBack: () => void }) {
  const e = useEngine();
  const m = useRecord<any>(id);
  const toast = useToast();
  const { go } = useRoute();
  const wrap = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const senders = sendAccounts(e);
  const [compose, setCompose] = useState<ComposeMode | null>(null);
  useEffect(() => { setCompose(null); }, [id]);
  // Native scrolling here: the mail itself is a frame, and wheel events from it must reach this pane.
  if (!m) return <div className="reader" />;
  const p = who(m);
  const others = [...(m.to ?? []), ...(m.cc ?? [])].length > 1;
  const canWrite = mailAvailable() && (senders.length > 0 || m.source === 'lunchhub');

  return (
    <div className="reader" ref={wrap}>
      <div ref={content}>
        <button className="phone-back" onClick={onBack}><Icon name="chevron-left" />Mail</button>
        <div className="reader__bar">
          <Btn size="sm" variant="text" icon="reply" disabled={!canWrite} onClick={() => setCompose('reply')}>{m.sent ? 'Skriv igen' : 'Svar'}</Btn>
          {others && !m.sent && m.source !== 'lunchhub' && <Btn size="sm" variant="text" icon="reply-all" disabled={!canWrite} onClick={() => setCompose('all')}>Svar alle</Btn>}
          {m.source !== 'lunchhub' && <Btn size="sm" variant="text" icon="forward" disabled={!canWrite} onClick={() => setCompose('forward')}>Videresend</Btn>}
          <Btn size="sm" variant="text" icon="archive" onClick={() => onMove(m, 'archive')}>Arkivér</Btn>
          {!m.sent && <MoveTo m={m} />}
          {!m.sent && !m.danger && m.source !== 'lunchhub' && <Btn size="sm" variant="text" icon="shield" onClick={() => { const before = { danger: m.danger ?? null, dangerWhy: m.dangerWhy ?? [], mbox: m.mbox ?? '', mboxManual: !!m.mboxManual }; markDanger(e, m, 'scam'); toast({ text: 'Flyttet til Svindel', action: { label: 'Fortryd', run: () => e.set('mail', m.id, before) } }); }}>Svindel</Btn>}
          <Btn size="sm" variant="text" icon="x" onClick={() => void askDelete(m).then((yes) => { if (yes) onMove(m, 'trash'); })}>{m.sent ? 'Fjern' : 'Slet'}</Btn>
          {m.source === 'lunchhub' && (m.lhStatus === 'besvaret'
            ? <Btn size="sm" variant="text" icon="reply" onClick={() => void setLunchHubStatus(e, m, 'ny').then(() => toast({ text: 'Markeret som ubesvaret i LunchHub' }), (x) => toast({ text: (x as Error).message }))}>Markér ubesvaret</Btn>
            : <Btn size="sm" variant="text" icon="check" onClick={() => void setLunchHubStatus(e, m, 'besvaret').then(() => toast({ text: 'Markeret som besvaret i LunchHub' }), (x) => toast({ text: (x as Error).message }))}>Markér besvaret</Btn>)}
          {!m.sent && <Btn size="sm" variant="text" onClick={() => setMailFlag(e, m, { unread: !m.unread })}>{m.unread ? 'Markér læst' : 'Markér ulæst'}</Btn>}
          <Btn size="sm" variant="text" icon="star" aria-pressed={!!m.flagged} onClick={() => setMailFlag(e, m, { flagged: !m.flagged })}>{m.flagged ? 'Stjernet' : 'Stjerne'}</Btn>
          <Btn size="sm" variant="text" icon="assist" onClick={() => { queueAssist(`Lav et kort svarudkast i min tone til mailen [${m.id}] fra ${p.name} om "${m.subject}".`); go({ screen: 'assist' }); }}>Assist</Btn>
        </div>
        <article className="mailcard">
          <header className="mailhead">
            <span className="avatar avatar--lg" style={vars({ '--h': p.hue })}>{p.initials}</span>
            <div className="mailhead__who">
              <div className="mailhead__line"><span className="strong ellipsis">{p.name}</span><time className="meta num">{new Date(m.at).toLocaleString('da-DK', { day: 'numeric', month: 'short', year: new Date(m.at).getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: '2-digit', minute: '2-digit' })}</time></div>
              <div className="meta ellipsis">{m.sent ? `Fra dig${m.to?.length ? ` til ${m.to.join(', ')}` : ''}` : <>{p.email}{m.to?.length ? ` · til ${m.to.join(', ')}` : ''}</>}{m.cc?.length ? ` · cc ${m.cc.join(', ')}` : ''}</div>
            </div>
            <SaveSender m={m} />
          </header>
          <h2 className="mailsubject">{m.subject}</h2>
          <div className="meta mailacct">{m.acctName}{m.source === 'lunchhub' && <span className={`lhstatus lhstatus--${m.lhStatus}`}>{m.lhStatus === 'besvaret' ? 'Besvaret' : m.lhStatus === 'arkiv' ? 'Arkiveret' : 'Ikke besvaret'}</span>}</div>
          {m.danger && !m.dangerOk && <DangerNote m={m} onDelete={() => void askDelete(m).then((yes) => { if (yes) onMove(m, 'trash'); })} />}
          <MailView e={e} m={m} />
        </article>
        {m.draft && !compose && (
          <button className="mdraft" onClick={() => setCompose('reply')}><Icon name="assist" size="sm" /><span className="ellipsis">{String(m.draft).split('\n')[0]}</span><span className="mdraft__go">Åbn udkast</span></button>
        )}
        {compose && <Composer key={`${m.id}-${compose}`} mode={compose} m={m} onClose={() => setCompose(null)} onSent={(archive) => { if (archive) onMove(m, 'archive'); }} />}
      </div>
    </div>
  );
}

/** Why a mail was flagged as phishing or scam, and what to do: delete it, or say it's fine. */
function DangerNote({ m, onDelete }: { m: any; onDelete: () => void }) {
  const e = useEngine();
  const toast = useToast();
  const ph = m.danger === 'phishing';
  return (
    <div className="mdanger" role="alert">
      <span className="mdanger__ic" aria-hidden="true"><Icon name="shield" /></span>
      <div className="mdanger__body">
        <h3>{ph ? 'Mistænkt phishing' : 'Mistænkt svindel'}</h3>
        {(m.dangerWhy ?? []).length > 0 && <ul>{(m.dangerWhy as string[]).slice(0, 5).map((w) => <li key={w}>{w}</li>)}</ul>}
        <div className="mdanger__acts">
          <Btn size="sm" variant="primary" onClick={onDelete}>Slet</Btn>
          <Btn size="sm" onClick={() => { const undo = clearDanger(e, m); toast({ text: `Flyttet til Indbakke. Mails fra ${m.fromEmail} bliver ikke markeret igen.`, action: { label: 'Fortryd', run: undo } }); }}>Ikke {ph ? 'phishing' : 'svindel'}</Btn>
        </div>
      </div>
    </div>
  );
}

/** "Flyt til" a folder (or back to Indbakke). Moved by hand stays there: rules won't move it again. */
function MoveTo({ m }: { m: any }) {
  const e = useEngine();
  const toast = useToast();
  useList('mailfolder');
  const fl = listFolders(e);
  if (!fl.length) return null;
  return (
    <label className="moveto"><Icon name="folder" size="sm" />
      <select value={m.mbox ?? ''} aria-label="Flyt til mappe" onChange={(x) => {
        const target = x.target.value;
        const before = moveToFolder(e, [m.id], target);
        toast({ text: `Flyttet til ${target ? fl.find((f) => f.id === target)?.name : 'Indbakke'}`, action: { label: 'Fortryd', run: () => before.forEach((b) => e.set('mail', b.id, b.fields)) } });
      }}>
        <option value="">Indbakke</option>
        {fl.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
    </label>
  );
}

/** Make or change a folder: name, what belongs there (for Assist's sorting) and exact rules. */
function FolderSheet({ f, onClose, onSaved, onDeleted }: { f: MailFolder | null; onClose: () => void; onSaved: (id: string) => void; onDeleted: () => void }) {
  const e = useEngine();
  const toast = useToast();
  const [name, setName] = useState(f?.name ?? '');
  const [desc, setDesc] = useState(f?.description ?? '');
  const [rules, setRules] = useState<FolderRule[]>(() => (f?.rules?.length ? f.rules : [{ from: '', subject: '', words: '' }]));
  const [sortNow, setSortNow] = useState(true);
  const [err, setErr] = useState('');
  const setRule = (i: number, p: Partial<FolderRule>) => setRules((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  function save(ev: React.FormEvent) {
    ev.preventDefault();
    const n = name.trim();
    if (!n) return setErr('Giv mappen et navn.');
    if (listFolders(e).some((x) => x.id !== f?.id && x.name.toLowerCase() === n.toLowerCase())) return setErr('Der er allerede en mappe med det navn.');
    const clean = rules.map((r) => ({ from: r.from?.trim() ?? '', subject: r.subject?.trim() ?? '', words: r.words?.trim() ?? '' })).filter((r) => r.from || r.subject || r.words);
    const id = f ? (e.set('mailfolder', f.id, { name: n, description: desc.trim(), rules: clean }), f.id) : e.create('mailfolder', { name: n, description: desc.trim(), rules: clean, order: listFolders(e).length, createdAt: new Date().toISOString() });
    const moved = sortNow && clean.length ? sortByRules(e, undefined, id) : 0;
    toast({ icon: 'folder', text: `${n} er gemt${moved ? ` · ${moved} mails flyttet herind` : ''}. Nye mails sorteres herind, når de kommer.` });
    onSaved(id);
  }
  async function del() {
    if (!f || !(await ask({ title: `Slet mappen ${f.name}?`, text: 'Mailene i den kommer tilbage i Indbakke. Intet bliver slettet.', ok: 'Slet mappe', danger: true }))) return;
    const { id: _i, type: _t, ...fields } = f as any;
    const moved = removeFolder(e, f.id);
    toast({ text: `${f.name} er slettet`, action: { label: 'Fortryd', run: () => { e.set('mailfolder', f.id, { ...fields, _deleted: false }); moved.forEach((mid) => e.set('mail', mid, { mbox: f.id })); } } });
    onDeleted();
  }
  return (
    <div>
      <div className="scrim" onClick={onClose} />
      <form className="sheet foldersheet" role="dialog" aria-label={f ? `Ret ${f.name}` : 'Ny mappe'} onSubmit={save}>
        <div className="sheet__body">
          <h2>{f ? 'Mappe og regler' : 'Ny mappe'}</h2>
          <label className="ufield"><span>Navn</span><input autoFocus value={name} onChange={(x) => setName(x.target.value)} /></label>
          <label className="ufield"><span>Hvad hører til her? (Assist sorterer efter det)</span><input value={desc} onChange={(x) => setDesc(x.target.value)} /></label>
          <div className="frules">
            <span className="meta">Regler · komma = et af ordene</span>
            {rules.map((r, i) => (
              <div className="frule" key={i}>
                <input value={r.from ?? ''} onChange={(x) => setRule(i, { from: x.target.value })} placeholder="Fra (navn eller mail)" aria-label="Fra" />
                <input value={r.subject ?? ''} onChange={(x) => setRule(i, { subject: x.target.value })} placeholder="Emnet indeholder" aria-label="Emnet indeholder" />
                <input value={r.words ?? ''} onChange={(x) => setRule(i, { words: x.target.value })} placeholder="Teksten indeholder" aria-label="Teksten indeholder" />
                <Btn size="sm" type="button" variant="text" icon="x" aria-label="Fjern regel" onClick={() => setRules((x) => (x.length > 1 ? x.filter((_, j) => j !== i) : [{ from: '', subject: '', words: '' }]))} />
              </div>
            ))}
            <Btn size="sm" type="button" variant="text" icon="plus" onClick={() => setRules((x) => [...x, { from: '', subject: '', words: '' }])}>Regel</Btn>
          </div>
          <label className="checkrow small"><input type="checkbox" checked={sortNow} onChange={(x) => setSortNow(x.target.checked)} />Flyt også mails, der allerede ligger i Indbakke</label>
          {err && <p className="unlock__error" role="alert">{err}</p>}
          <div className="sheet__foot">
            {f && <Btn type="button" size="sm" variant="text" icon="x" onClick={() => void del()}>Slet mappe</Btn>}
            <span className="push-right" />
            <Btn type="button" variant="text" onClick={onClose}>Annullér</Btn>
            <Btn type="submit" variant="primary">Gem</Btn>
          </div>
        </div>
      </form>
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
