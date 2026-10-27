import { useEffect, useRef, useState } from 'react';
import { useEngine, useList, useRoute } from '../state.tsx';
import { Btn, Panel } from '../ui/primitives.tsx';
import { useToast } from '../ui/Shell.tsx';
import { collapseOut, useScreenEnter, reduced } from '../motion.ts';
import { Icon } from '../ui/Icon.tsx';
import { ask, aiSettings, aiReady, saveAiSettings, testAi, AiError, type Msg } from '../ai/agent.ts';
import { MODEL_NAMES, spentThisMonth } from '../ai/usage.ts';
import { kr } from '../money.ts';
import { applyUndo, type Action } from '../ai/tools.ts';
import { useDictation } from '../ai/dictation.ts';
import { openExternal } from '../open.ts';
import ClickSpark from '../bits/ClickSpark.jsx';

/**
 * Assist never acts on its own: every suggestion waits for Godkend / Afvis.
 * Approving runs exactly the action in the suggestion's payload, and can be undone.
 */
export function SuggestionRows({ limit }: { limit?: number }) {
  const e = useEngine();
  const { go } = useRoute();
  const toast = useToast();
  const list = useList('suggestion').filter((s: any) => s.status === 'pending') as any[];
  const spark = useRef<{ spark: (x: number, y: number) => void }>(null);
  const shown = limit ? list.slice(0, limit) : list;

  function approve(s: any, row: HTMLElement, ev: React.MouseEvent) {
    const box = row.closest('.sparkhost')!.getBoundingClientRect();
    spark.current?.spark(ev.clientX - box.left, ev.clientY - box.top);
    collapseOut(row, () => {
      let undo: () => void = () => {};
      if (s.kind === 'goal') {
        const id = e.create('goalUpdate', { goal: s.payload.goal, at: new Date().toISOString(), delta: s.payload.delta, text: s.payload.text, src: 'Fra Løbetur i kalenderen · godkendt af dig' });
        undo = () => e.remove('goalUpdate', id);
      } else if (s.kind === 'calendar') {
        const id = e.create('event', { title: s.payload.title, start: new Date(s.payload.start).toISOString(), end: new Date(new Date(s.payload.start).getTime() + 15 * 60000).toISOString(), cal: 'Påmindelser' });
        undo = () => e.remove('event', id);
      } else if (s.kind === 'rule') {
        const id = e.create('rule', { rule: s.payload.rule, title: s.title.replace('?', ''), active: true });
        undo = () => e.remove('rule', id);
      } else if (s.kind === 'draft') {
        go({ screen: 'inbox', id: s.payload.mail });
      }
      e.set('suggestion', s.id, { status: 'approved', decidedAt: new Date().toISOString() });
      toast({ text: s.kind === 'draft' ? 'Udkastet er åbnet i indbakken' : 'Godkendt', action: s.kind === 'draft' ? undefined : { label: 'Fortryd', run: () => { undo(); e.set('suggestion', s.id, { status: 'pending' }); } } });
    });
  }
  function decline(s: any, row: HTMLElement) {
    collapseOut(row, () => {
      e.set('suggestion', s.id, { status: 'declined', decidedAt: new Date().toISOString() });
      toast({ text: 'Afvist. Assist lærer af det.', action: { label: 'Fortryd', run: () => e.set('suggestion', s.id, { status: 'pending' }) } });
    });
  }

  if (!shown.length) return <p className="muted">Ingen forslag lige nu. Assist foreslår kun noget, når den har et konkret grundlag.</p>;
  return (
    <div className="sparkhost">
      <ClickSpark ref={spark} sparkColor="#C9683A" sparkCount={9} sparkRadius={22} sparkSize={9} duration={420} layer="front">
        <ul className="rows">
          {shown.map((s) => (
            <li key={s.id} className="sugg">
              <div className="strong">{s.title}</div>
              <div className="sugg__actions">
                <Btn size="sm" icon="check" onClick={(ev) => approve(s, (ev.currentTarget as HTMLElement).closest('li')!, ev)}>Godkend</Btn>
                <Btn size="sm" variant="text" icon="x" aria-label="Afvis" onClick={(ev) => decline(s, (ev.currentTarget as HTMLElement).closest('li')!)} />
              </div>
              <div className="meta"><span className="muted">{s.detail}</span> · {s.source}</div>
            </li>
          ))}
        </ul>
      </ClickSpark>
    </div>
  );
}


/* ================================================================ Assist: talk to CENTRA */

type LogItem = { role: 'user' | 'assistant' | 'error'; text: string; at: string; actions?: Action[]; via?: 'claude' | 'local'; model?: string; why?: string; usd?: number };
type Chat = { id: string; at: string; title?: string; messages: Msg[]; log: LogItem[] };

let queued: string | null = null;
/** Lets other screens (I dag, ⌘K) hand Assist a message to send as soon as it opens. */
export const queueAssist = (text: string) => { queued = text; setTimeout(() => window.dispatchEvent(new Event('centra-assist')), 0); };

const STARTERS: [string, string, boolean?][] = [
  ['Lær mig at kende', 'Jeg er ny i CENTRA. Stil mig spørgsmål om min hverdag, ét ad gangen, og gem det vigtige.', true],
  ['Min arbejdstid', 'Min arbejdstid er '],
  ['Diktér en note', 'Lav en note: '],
  ['Nyt mål', 'Jeg vil gerne nå '],
  ['Hold øje med en mail', 'Hold øje med en mail fra '],
];

export function Assist() {
  const e = useEngine();
  const { go } = useRoute();
  const toast = useToast();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'assist');
  const chats = useList('chat', (a, b) => (b.at ?? '').localeCompare(a.at ?? '')) as unknown as Chat[];
  useList('setting');
  const ai = aiSettings(e);
  const [sel, setSel] = useState<string | null>(null);
  const chat = chats.find((c) => c.id === sel) ?? chats[0];
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<Action[]>([]);
  const abort = useRef<AbortController | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const base = useRef('');

  const dict = useDictation((t, final) => {
    setText((base.current ? base.current + ' ' : '') + t);
    if (final) box.current?.focus();
  }, (p) => {
    toast({ title: p.title, text: p.text, kind: 'error', icon: 'mic', sticky: true, action: p.settings ? { label: 'Åbn Systemindstillinger', run: () => openExternal(p.settings!) } : undefined });
    box.current?.focus();
  });

  const log = chat?.log ?? [];
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' }); }, [log.length, busy, live.length]);
  const sendRef = useRef<(t: string) => void>(() => {});
  sendRef.current = (t) => void send(t);
  useEffect(() => {
    const take = () => {
      if (!queued) return;
      const q = queued; queued = null;
      if (aiReady(aiSettings(e))) sendRef.current(q); else { setText(q); base.current = q; }
    };
    take(); box.current?.focus();
    window.addEventListener('centra-assist', take);
    return () => window.removeEventListener('centra-assist', take);
  }, [e]);

  async function send(raw = text) {
    const msg = raw.trim();
    if (!msg || busy) return;
    if (dict.listening) dict.stop();
    const id = chat?.id ?? e.create('chat', { at: new Date().toISOString(), messages: [], log: [] });
    const cur = (e.get(id) as unknown as Chat) ?? { messages: [], log: [] };
    const userItem: LogItem = { role: 'user', text: msg, at: new Date().toISOString() };
    const nextLog = [...(cur.log ?? []), userItem];
    e.set('chat', id, { log: nextLog, at: userItem.at, title: cur.title ?? msg.slice(0, 60) });
    setText(''); base.current = ''; setBusy(true); setLive([]);
    abort.current = new AbortController();
    try {
      const t = await ask(e, cur.messages ?? [], msg, { signal: abort.current.signal, onAction: (a) => setLive((l) => [...l, a]) });
      e.set('chat', id, { messages: t.messages, log: [...nextLog, { role: 'assistant', text: t.reply, actions: t.actions, via: t.via, model: t.model, why: t.why, usd: t.usd, at: new Date().toISOString() }] });
    } catch (err) {
      if (!abort.current.signal.aborted) e.set('chat', id, { log: [...nextLog, { role: 'error', text: err instanceof AiError ? err.message : 'Assist kunne ikke svare: ' + (err as Error).message, at: new Date().toISOString() }] });
    } finally {
      setBusy(false); setLive([]); abort.current = null;
      setTimeout(() => box.current?.focus(), 0);
    }
  }

  function undo(item: number, k: number) {
    const cur = e.get(chat.id) as unknown as Chat;
    const a = cur.log[item].actions?.[k];
    if (!a?.undo || a.undone) return;
    applyUndo(e, a.undo);
    const nextLog = cur.log.map((l, i) => i !== item ? l : { ...l, actions: l.actions!.map((x, j) => j === k ? { ...x, undone: true } : x) });
    e.set('chat', chat.id, { log: nextLog });
    toast({ text: 'Fortrudt' });
  }

  const ready = aiReady(ai);
  return (
    <main className="canvas assist" ref={ref}>
      <div className="titlerow" data-enter>
        <div><h1>Assist</h1><p>Skriv eller tal. Assist husker det vigtige, lægger aftaler i kalenderen, skriver noter og holder styr på dine mål. Alt kan fortrydes.</p></div>
        <div className="actions">
          <button className="tag modelpill" onClick={() => go({ screen: 'usage' })} title="Se forbrug">{ai.provider === 'claude' ? (ai.claudeKey ? (ai.modelMode === 'auto' ? 'Automatisk model' : MODEL_NAMES[ai.modelMode] ?? 'Claude') + ' · ' + kr(spentThisMonth(e) * (ai.usdDkk || 6.9)) + ' i ' + new Date().toLocaleDateString('da-DK', { month: 'long' }) : 'Ikke forbundet') : 'Lokal · ' + ai.localModel}</button>
          {log.length > 0 && <Btn size="sm" icon="plus" onClick={() => setSel(e.create('chat', { at: new Date().toISOString(), messages: [], log: [] }))}>Ny samtale</Btn>}
        </div>
      </div>
      <div className="assist__grid">
        <section className="panel chat" data-enter aria-label="Samtale med Assist">
          <div className="chat__log" ref={scroller} aria-live="polite">
            {!ready ? <ConnectAi /> : log.length === 0 && !busy ? (
              <div className="chat__hello">
                <p className="chat__lead">Hej Willads. Fortæl mig om din hverdag, så sætter jeg CENTRA op efter dig.</p>
                <p className="muted">Fx: "Jeg arbejder i Netto fra 06 til 16 tirsdag til fredag, men om torsdagen har jeg fri kl. 15." Så husker jeg det og lægger det i kalenderen.</p>
                <div className="chips">
                  {STARTERS.map(([label, prompt, direct]) => (
                    <button key={label} className="tag" onClick={() => { if (direct) void send(prompt); else { setText(prompt); base.current = prompt.trim(); box.current?.focus(); } }}>{label}</button>
                  ))}
                </div>
              </div>
            ) : log.map((m, i) => (
              <div key={i} className={`msg msg--${m.role}`}>
                {m.text && <div className="msg__text">{m.text}</div>}
                {m.actions && m.actions.length > 0 && <ActionList actions={m.actions} onUndo={(k) => undo(i, k)} onOpen={(a) => a.open && go(a.open)} />}
                {m.role === 'assistant' && m.model && <span className="msg__meta" title={m.why ? 'Valgt fordi: ' + m.why : undefined}>{MODEL_NAMES[m.model] ?? m.model}{m.usd !== undefined ? ' · ' + (m.usd * (ai.usdDkk || 6.9) < 0.01 ? 'under 1 øre' : kr(m.usd * (ai.usdDkk || 6.9))) : ''}</span>}
              </div>
            ))}
            {busy && (
              <div className="msg msg--assistant">
                {live.length > 0 && <ActionList actions={live} />}
                <div className="typing" aria-label="Assist tænker"><i /><i /><i /></div>
              </div>
            )}
          </div>
          <form className="composer" onSubmit={(ev) => { ev.preventDefault(); void send(); }}>
            <textarea ref={box} rows={1} value={text} disabled={!ready} placeholder={dict.listening ? 'Lytter … tal bare' : 'Skriv til Assist, eller tryk på mikrofonen'}
              onChange={(ev) => { setText(ev.target.value); base.current = ev.target.value.trim(); }}
              onInput={(ev) => { const t = ev.currentTarget; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 200) + 'px'; }}
              onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) { ev.preventDefault(); void send(); } }} />
            <button type="button" className={`iconbtn ${dict.listening ? 'is-live' : ''}`} disabled={!ready} aria-pressed={dict.listening} aria-label={dict.listening ? 'Stop med at lytte' : 'Tal til Assist'} title="Tal til Assist" onClick={() => { base.current = text.trim(); dict.toggle(); }}><Icon name="mic" /></button>
            {busy
              ? <Btn type="button" variant="text" onClick={() => abort.current?.abort()}>Stop</Btn>
              : <Btn type="submit" variant="primary" icon="send" disabled={!text.trim() || !ready} aria-label="Send" />}
          </form>
        </section>
        <aside className="assist__side">
          <Memory />
          <Watches />
          <Chats chats={chats} current={chat?.id} onOpen={setSel} />
        </aside>
      </div>
    </main>
  );
}

function Chats({ chats, current, onOpen }: { chats: Chat[]; current?: string; onOpen: (id: string | null) => void }) {
  const e = useEngine();
  const toast = useToast();
  const list = chats.filter((c) => c.log?.length);
  if (!list.length) return null;
  return (
    <Panel title="Samtaler" count={list.length}>
      <ul className="rows">{list.map((c) => (
        <li key={c.id} className={`memrow ${c.id === current ? 'is-current' : ''}`}>
          <button className="row__body chatpick" onClick={() => onOpen(c.id)} aria-current={c.id === current}><span className="ellipsis">{c.title || 'Samtale'}</span><span className="meta">{new Date(c.at).toLocaleString('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {c.log.length} beskeder</span></button>
          <Btn size="sm" variant="text" icon="x" aria-label="Slet samtale" onClick={() => {
            const { id: _i, type: _t, ...f } = c as any;
            e.remove('chat', c.id); if (c.id === current) onOpen(null);
            toast({ text: 'Samtalen er slettet', action: { label: 'Fortryd', run: () => e.set('chat', c.id, { ...f, _deleted: false }) } });
          }} />
        </li>
      ))}</ul>
    </Panel>
  );
}

function ActionList({ actions, onUndo, onOpen }: { actions: Action[]; onUndo?: (k: number) => void; onOpen?: (a: Action) => void }) {
  return (
    <ul className="acts">
      {actions.map((a, k) => (
        <li key={k} className={`act ${a.undone ? 'is-undone' : ''}`}>
          <Icon name={a.undone ? 'x' : 'check'} size="sm" />
          <span className="act__label">{a.label}</span>
          {!a.undone && onOpen && a.open && <button className="act__btn" onClick={() => onOpen(a)}>Åbn</button>}
          {!a.undone && onUndo && a.undo && <button className="act__btn" onClick={() => onUndo(k)}>Fortryd</button>}
          {a.undone && <span className="meta">fortrudt</span>}
        </li>
      ))}
    </ul>
  );
}

function Memory() {
  const e = useEngine();
  const memory = useList('memory', (a, b) => (a.kind ?? '').localeCompare(b.kind ?? '')) as any[];
  const [edit, setEdit] = useState<string | null>(null);
  const [val, setVal] = useState('');
  return (
    <Panel title="Det ved CENTRA om dig" count={memory.length}>
      {memory.length ? (
        <ul className="rows">{memory.map((m) => (
          <li key={m.id} className="memrow">
            {edit === m.id ? (
              <form className="memedit" onSubmit={(ev) => { ev.preventDefault(); if (val.trim()) e.set('memory', m.id, { statement: val.trim(), source: 'Rettet af dig' }); setEdit(null); }}>
                <input autoFocus value={val} onChange={(ev) => setVal(ev.target.value)} onKeyDown={(ev) => ev.key === 'Escape' && setEdit(null)} aria-label="Ret" />
                <Btn size="sm" type="submit">Gem</Btn>
              </form>
            ) : (<>
              <span className="row__body"><span className="meta">{m.kind}</span><span>{m.statement}</span></span>
              <Btn size="sm" variant="text" icon="edit" aria-label="Ret" onClick={() => { setEdit(m.id); setVal(m.statement); }} />
              <Btn size="sm" variant="text" icon="x" aria-label="Glem" onClick={() => e.remove('memory', m.id)} />
            </>)}
          </li>
        ))}</ul>
      ) : <p className="muted">Intet endnu. Alt, du fortæller Assist om dig selv, kommer til at stå her, og du kan rette eller slette det.</p>}
    </Panel>
  );
}

function Watches() {
  const e = useEngine();
  const watches = useList('watch').filter((w: any) => w.active) as any[];
  const hasMail = useList('mailacct').length > 0;
  if (!watches.length) return null;
  return (
    <Panel title="Holder øje med" count={watches.length}>
      <ul className="rows">{watches.map((w) => (
        <li key={w.id} className="memrow">
          <span className="row__body"><span>{w.description}</span><span className="meta">{w.lastHitAt ? `Fundet ${new Date(w.lastHitAt).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })}` : hasMail ? 'Venter på mailen' : 'Starter, når du forbinder en mailkonto'}{[w.from && `fra ${w.from}`, w.subject && `emne: ${w.subject}`].filter(Boolean).map((x) => ' · ' + x).join('')}</span></span>
          <Btn size="sm" variant="text" icon="x" aria-label="Stop" onClick={() => e.remove('watch', w.id)} />
        </li>
      ))}</ul>
    </Panel>
  );
}

/** Shown in the chat until Assist has a brain: paste a Claude key, or use a model on this Mac. */
function ConnectAi() {
  const e = useEngine();
  const toast = useToast();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true); setErr(null);
    const s = { ...aiSettings(e), provider: 'claude' as const, claudeKey: key.trim() };
    try { await testAi(s); saveAiSettings(e, { provider: 'claude', claudeKey: s.claudeKey }); setKey(''); toast({ text: 'Assist er forbundet til Claude' }); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  async function local() {
    setBusy(true); setErr(null);
    const s = { ...aiSettings(e), provider: 'local' as const };
    try { await testAi(s); saveAiSettings(e, { provider: 'local' }); toast({ text: `Assist bruger ${s.localModel} på denne Mac` }); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="chat__hello">
      <p className="chat__lead">Forbind Assist til Claude</p>
      <p className="muted">Indsæt en API-nøgle fra console.anthropic.com (Settings → API keys). Den gemmes krypteret i CENTRA sammen med dine andre data og sendes kun til Anthropic.</p>
      <form className="connect" onSubmit={save}>
        <label className="ufield"><span>Claude API-nøgle</span><input type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={key} onChange={(ev) => setKey(ev.target.value)} /></label>
        <Btn type="submit" variant="primary" disabled={busy || key.trim().length < 20}>{busy ? 'Tester …' : 'Forbind'}</Btn>
      </form>
      <p className="meta">Eller kør en model lokalt på din Mac med Ollama (gratis, intet forlader computeren): <button className="tag" disabled={busy} onClick={local}>Brug lokal model</button></p>
      {err && <p className="unlock__error" role="alert">{err}</p>}
    </div>
  );
}
