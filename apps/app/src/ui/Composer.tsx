import { useEffect, useMemo, useRef, useState } from 'react';
import { useEngine, useList } from '../state.tsx';
import { Btn } from './primitives.tsx';
import { Icon } from './Icon.tsx';
import { useToast } from './Shell.tsx';
import { ask } from './Confirm.tsx';
import { mailAvailable, sendAccounts, sendMail, type OutFile, type Part } from '../mail.ts';

/**
 * Writing mail: a new one, a reply, reply to all, or forwarding (with its attachments). Files can be
 * added from the Mac or, on the iPhone, from Filer, Billeder or the camera.
 */
export type ComposeMode = 'new' | 'reply' | 'all' | 'forward';

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
/** What a mail can carry along (servers stop at about 25 MB once it's encoded). */
const MAX = 18_000_000;
const fmtSize = (n: number) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('da-DK', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1000))} kB`);
const ext = (name: string) => (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? '').toUpperCase().slice(0, 4) || 'FIL';

const prefix = (p: string, s: string) => (new RegExp(`^${p}:`, 'i').test(s.trim()) ? s.trim() : `${p}: ${s.trim()}`);
const when = (m: any) => new Date(m.at).toLocaleString('da-DK', { dateStyle: 'long', timeStyle: 'short' });
const quote = (m: any) => `${when(m)} skrev ${m.fromName || m.fromEmail}:\n${String(m.body ?? '').split('\n').slice(0, 60).map((l: string) => '> ' + l).join('\n')}`;
const forwarded = (m: any) => [
  '---------- Videresendt mail ----------',
  `Fra: ${m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail}`,
  `Dato: ${when(m)}`,
  `Emne: ${m.subject}`,
  ...(m.to?.length ? [`Til: ${m.to.join(', ')}`] : []),
  ...(m.cc?.length ? [`Cc: ${m.cc.join(', ')}`] : []),
  '',
  String(m.body ?? m.preview ?? ''),
].join('\n');

function readFile(f: File): Promise<OutFile> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res({ name: f.name || 'fil', mime: f.type || 'application/octet-stream', size: f.size, data: String(r.result).split(',')[1] ?? '' });
    r.onerror = () => rej(new Error(`${f.name} kunne ikke læses`));
    r.readAsDataURL(f);
  });
}

export function Composer({ mode, m, inline, onClose, onSent }: { mode: ComposeMode; m?: any; inline?: boolean; onClose: () => void; onSent?: (archive: boolean) => void }) {
  const e = useEngine();
  const toast = useToast();
  const senders = sendAccounts(e);
  const mine = useMemo(() => new Set(senders.map((a: any) => String(a.email ?? a.user ?? '').toLowerCase()).filter(Boolean)), [senders]);
  const lh = m?.source === 'lunchhub';

  const start = useMemo(() => {
    if (!m || mode === 'new') return { to: [] as string[], cc: [] as string[], subject: '' };
    if (mode === 'forward') return { to: [], cc: [], subject: prefix('Fwd', m.subject ?? '') };
    const subject = lh ? `Sv: ${String(m.subject).replace(/^(Kontakt|Smagning): /, '')}` : /^(re|sv):/i.test(m.subject) ? m.subject : `Re: ${m.subject}`;
    const to = m.sent ? [...(m.to ?? [])] : [m.fromEmail].filter(Boolean);
    const cc = mode === 'all'
      ? [...(m.sent ? [] : m.to ?? []), ...(m.cc ?? [])].map(String).filter((x) => !mine.has(x.toLowerCase()) && !to.some((t) => t.toLowerCase() === x.toLowerCase()))
      : [];
    return { to, cc: [...new Set(cc)], subject };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m?.id, mode]);

  const [via, setVia] = useState<string>(() => (m && senders.some((a: any) => a.id === m.acct) ? m.acct : senders[0]?.id ?? ''));
  const [to, setTo] = useState<string[]>(start.to);
  const [cc, setCc] = useState<string[]>(start.cc);
  const [bcc, setBcc] = useState<string[]>([]);
  const [more, setMore] = useState(start.cc.length > 0);
  const [subject, setSubject] = useState(start.subject);
  const [body, setBody] = useState<string>(() => (mode === 'reply' && m?.draft) || '');
  const [files, setFiles] = useState<OutFile[]>([]);
  const [fwd, setFwd] = useState<Part[]>(() => (mode === 'forward' ? (m?.parts ?? []).filter((p: Part) => !p.inline || !p.cid) : []));
  const [sending, setSending] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setTimeout(() => (start.to.length ? text.current : first.current)?.focus(), 60); }, [start]);

  const size = files.reduce((n, f) => n + f.size, 0) + fwd.reduce((n, p) => n + p.size, 0);
  const bad = [...to, ...cc, ...bcc].filter((x) => !EMAIL.test(x));
  const dirty = !!(body.trim() || files.length || (mode === 'new' && (to.length || subject.trim())));

  async function add(list: FileList | null) {
    if (!list?.length) return;
    try {
      const got = await Promise.all(Array.from(list).map(readFile));
      const total = size + got.reduce((n, f) => n + f.size, 0);
      if (total > MAX) return toast({ text: `Vedhæftningerne fylder ${fmtSize(total)}. En mail kan højst have cirka 18 MB med.` });
      setFiles((x) => [...x, ...got]);
    } catch (x) { toast({ text: (x as Error).message }); }
    if (picker.current) picker.current.value = '';
  }

  async function close() {
    if (dirty && !(await ask({ title: 'Kassér mailen?', ok: 'Kassér', danger: true }))) return;
    if (mode === 'reply' && m?.draft) e.set('mail', m.id, { draft: '' });
    onClose();
  }

  async function send(archive = false) {
    if (!to.length && !cc.length && !bcc.length) return toast({ text: 'Skriv, hvem mailen skal til.' });
    if (bad.length) return toast({ text: `Tjek adressen: ${bad[0]}` });
    if (!subject.trim() && !(await ask({ title: 'Send uden emne?', ok: 'Send' }))) return;
    setSending(true);
    try {
      const tail = mode === 'forward' ? forwarded(m) : mode === 'reply' || mode === 'all' ? quote(m) : '';
      const full = [body.trimEnd(), tail].filter(Boolean).join('\n\n');
      await sendMail(e, via, { to, cc, bcc, subject: subject.trim(), body: full, replyTo: mode === 'reply' || mode === 'all' ? m : undefined, via, files, forward: fwd.length ? { mail: m, parts: fwd } : undefined });
      toast({ icon: 'send', text: `Sendt til ${[...to, ...cc][0] ?? bcc[0]}${to.length + cc.length + bcc.length > 1 ? ` og ${to.length + cc.length + bcc.length - 1} til` : ''}` });
      onSent?.(archive);
      onClose();
    } catch (x) { toast({ text: (x as Error).message }); } finally { setSending(false); }
  }

  const form = (
    <form className={`cmp ${inline ? 'cmp--inline' : ''}`} onSubmit={(x) => { x.preventDefault(); void send(); }}
      onKeyDown={(x) => { if ((x.metaKey || x.ctrlKey) && x.key === 'Enter') { x.preventDefault(); void send(); } if (x.key === 'Escape' && !inline) { x.stopPropagation(); void close(); } }}>
      {!inline && <div className="cmp__top">
        <Btn type="button" variant="text" onClick={() => void close()}>Annullér</Btn>
        <h2>{mode === 'forward' ? 'Videresend' : mode === 'new' ? 'Ny mail' : 'Svar'}</h2>
        <Btn type="submit" variant="primary" icon="send" disabled={sending || !mailAvailable()}>{sending ? 'Sender …' : 'Send'}</Btn>
      </div>}
      <div className="cmp__fields">
        <Recipients label="Til" value={to} onChange={setTo} inputRef={first} />
        {more ? <>
          <Recipients label="Cc" value={cc} onChange={setCc} />
          <Recipients label="Bcc" value={bcc} onChange={setBcc} />
        </> : <button type="button" className="cmp__more meta" onClick={() => setMore(true)}>Cc/Bcc</button>}
        {(senders.length > 1 || lh) && (
          <label className="cmp__row"><span className="cmp__lbl">Fra</span>
            {senders.length
              ? <select value={via} onChange={(x) => setVia(x.target.value)}>{senders.map((a: any) => <option key={a.id} value={a.id}>{a.name} · {a.email}</option>)}</select>
              : <span className="meta">Tilføj en mailkonto under Forbindelser.</span>}
          </label>
        )}
        <label className="cmp__row"><span className="cmp__lbl">Emne</span><input value={subject} onChange={(x) => setSubject(x.target.value)} aria-label="Emne" /></label>
      </div>
      {m?.draft && mode === 'reply' && body === m.draft && <div className="composer__ai"><Icon name="assist" size="sm" />Udkast fra Assist</div>}
      <textarea ref={text} className="composer__body cmp__body" value={body} onChange={(x) => setBody(x.target.value)} aria-label="Besked" />
      {mode === 'forward' && m && <div className="cmp__quote meta"><Icon name="forward" size="sm" />{m.fromName || m.fromEmail} · {m.subject}</div>}
      {(files.length > 0 || fwd.length > 0) && (
        <ul className="cmp__files" aria-label="Vedhæftninger">
          {fwd.map((p) => <li key={`f${p.index}`}><span className="cmp__ext">{ext(p.name)}</span><span className="ellipsis">{p.name}</span><span className="meta">{fmtSize(p.size)}</span>
            <button type="button" aria-label={`Fjern ${p.name}`} onClick={() => setFwd((x) => x.filter((y) => y !== p))}><Icon name="x" size="sm" /></button></li>)}
          {files.map((f, i) => <li key={`n${i}`}><span className="cmp__ext">{ext(f.name)}</span><span className="ellipsis">{f.name}</span><span className="meta">{fmtSize(f.size)}</span>
            <button type="button" aria-label={`Fjern ${f.name}`} onClick={() => setFiles((x) => x.filter((y) => y !== f))}><Icon name="x" size="sm" /></button></li>)}
        </ul>
      )}
      <input ref={picker} type="file" multiple hidden onChange={(x) => void add(x.target.files)} />
      <div className="composer__bar cmp__bar">
        {inline && <Btn type="submit" variant="primary" icon="send" disabled={sending || !mailAvailable()}>{sending ? 'Sender …' : 'Send'}</Btn>}
        {inline && (mode === 'reply' || mode === 'all') && !m?.sent && <Btn type="button" disabled={sending || !mailAvailable()} onClick={() => void send(true)}>Send og arkivér</Btn>}
        <Btn type="button" variant="text" icon="paperclip" onClick={() => picker.current?.click()}>Vedhæft</Btn>
        {size > 0 && <span className="meta num">{fmtSize(size)}</span>}
        {inline && <Btn type="button" variant="text" className="push-right" onClick={() => void close()}>Kassér</Btn>}
      </div>
    </form>
  );
  if (inline) return <div className="replybox">{form}</div>;
  return <div className="cmpwrap"><div className="scrim" onClick={() => void close()} /><div className="sheet cmpsheet" role="dialog" aria-label={mode === 'forward' ? 'Videresend' : 'Ny mail'}>{form}</div></div>;
}

/** Addresses as chips: type and press Enter (or comma), or pick from contacts and earlier mail. */
function Recipients({ label, value, onChange, inputRef }: { label: string; value: string[]; onChange: (v: string[]) => void; inputRef?: React.RefObject<HTMLInputElement | null> }) {
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const persons = useList('person') as any[];
  const mails = useList('mail') as any[];
  const known = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of persons) if (p.email) map.set(String(p.email).toLowerCase(), p.name ?? '');
    for (const x of mails) {
      if (x.fromEmail && !x.list && !map.has(x.fromEmail.toLowerCase())) map.set(x.fromEmail.toLowerCase(), x.fromName ?? '');
      if (x.sent) for (const t of x.to ?? []) if (!map.has(String(t).toLowerCase())) map.set(String(t).toLowerCase(), '');
    }
    return [...map].map(([email, name]) => ({ email, name }));
  }, [persons, mails]);
  const hits = useMemo(() => {
    const w = q.trim().toLowerCase();
    if (!w) return [];
    return known.filter((k) => !value.some((v) => v.toLowerCase() === k.email) && `${k.name} ${k.email}`.toLowerCase().includes(w)).slice(0, 6);
  }, [q, known, value]);

  const commit = (raw: string) => {
    const parts = raw.split(/[,;\s]+/).map((x) => x.trim().replace(/^<|>$/g, '')).filter(Boolean);
    if (!parts.length) return;
    onChange([...value, ...parts.filter((p) => !value.some((v) => v.toLowerCase() === p.toLowerCase()))]);
    setQ(''); setAt(0);
  };
  const pick = (email: string) => { onChange([...value, email]); setQ(''); setAt(0); };

  return (
    <div className="cmp__row cmp__rcpt">
      <span className="cmp__lbl">{label}</span>
      <div className="cmp__chips">
        {value.map((v) => (
          <span key={v} className={`cmp__chip ${EMAIL.test(v) ? '' : 'is-bad'}`} title={v}>
            {known.find((k) => k.email === v.toLowerCase())?.name || v}
            <button type="button" aria-label={`Fjern ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}><Icon name="x" size="sm" /></button>
          </span>
        ))}
        <input ref={inputRef} value={q} type="email" inputMode="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label={label}
          onChange={(x) => { const v = x.target.value; if (/[,;]$/.test(v)) commit(v); else { setQ(v); setAt(0); } }}
          onBlur={() => setTimeout(() => { if (q.trim()) commit(q); }, 150)}
          onPaste={(x) => { const t = x.clipboardData.getData('text'); if (/[,;\s]/.test(t.trim())) { x.preventDefault(); commit(t); } }}
          onKeyDown={(x) => {
            if (x.key === 'ArrowDown' && hits.length) { x.preventDefault(); setAt((a) => (a + 1) % hits.length); }
            else if (x.key === 'ArrowUp' && hits.length) { x.preventDefault(); setAt((a) => (a - 1 + hits.length) % hits.length); }
            else if ((x.key === 'Enter' || x.key === 'Tab') && q.trim()) { if (x.key === 'Enter') x.preventDefault(); if (hits[at]) pick(hits[at].email); else commit(q); }
            else if (x.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1));
          }} />
      </div>
      {hits.length > 0 && (
        <ul className="cmp__hits" role="listbox" aria-label={`Forslag til ${label}`}>
          {hits.map((h, i) => (
            <li key={h.email} role="option" aria-selected={i === at}>
              <button type="button" onMouseDown={(x) => x.preventDefault()} onClick={() => pick(h.email)}>
                {h.name && <span className="strong">{h.name}</span>}<span className="meta">{h.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
