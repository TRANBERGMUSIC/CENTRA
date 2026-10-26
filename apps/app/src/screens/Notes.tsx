import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { useEngine, useList, useRecord, useRoute, useNow, fmt } from '../state.tsx';
import { Btn } from '../ui/primitives.tsx';
import { Icon } from '../ui/Icon.tsx';
import { useLenis, useScreenEnter, flipState } from '../motion.ts';
import { useToast } from '../ui/Shell.tsx';

/**
 * Notes, step 2 edition: title and metadata sync as LWW fields, the body is a shared Yjs text
 * so two devices can type in the same note at the same time. The block editor (/-commands,
 * tables, [[links]]) replaces the textarea in step 3 on the same document.
 */
export function Notes() {
  const e = useEngine();
  const { route, go } = useRoute();
  const now = useNow();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'notes');
  const [tab, setTab] = useState<'all' | 'pinned' | 'meetings'>('all');
  const all = useList('note', (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.editedAt ?? '').localeCompare(a.editedAt ?? '')) as any[];
  const list = all.filter((n) => tab === 'all' || (tab === 'pinned' ? n.pinned : n.folder === 'Møder'));
  const id = route.id ?? list[0]?.id;

  const newNote = () => go({ screen: 'notes', id: e.create('note', { title: '', folder: 'Indbakke', tags: [], editedAt: new Date().toISOString() }) });

  return (
    <main className={`notes2 ${route.id ? 'has-open' : ''}`} ref={ref}>
      <div className="nlist" data-enter data-lenis-prevent>
        <div className="nlist__head"><h1>Noter</h1><Btn size="sm" icon="plus" onClick={newNote} aria-label="Ny note" /></div>
        <div className="tabs" role="tablist">
          {([['all', 'Alle', all.length], ['pinned', 'Fastgjort', all.filter((n) => n.pinned).length], ['meetings', 'Møder', all.filter((n) => n.folder === 'Møder').length]] as const).map(([k, l, c]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'is-active' : ''}`} onClick={() => setTab(k)}>{l} <span className="meta num">{c}</span></button>
          ))}
        </div>
        <div className="nrows">
          {list.map((n) => (
            <button key={n.id} data-flip-id={n.id} className={`nrow ${n.id === id ? 'is-selected' : ''}`} onClick={() => go({ screen: 'notes', id: n.id })}>
              <span className="nrow__t"><span className="ellipsis">{n.title || 'Uden titel'}</span>{n.pinned && <Icon name="pin" size="sm" className="faint" />}</span>
              <span className="nrow__x">{e.doc(n.id).getText('body').toString().slice(0, 120) || 'Tom note'}</span>
              <span className="meta num">{n.editedAt ? fmt.ago(n.editedAt, now) : ''}</span>
            </button>
          ))}
        </div>
      </div>
      {id ? <Editor key={id} id={id} /> : <div className="editor"><p className="muted">Ingen noter endnu. <button className="tag" onClick={newNote}>Skriv den første</button></p></div>}
    </main>
  );
}

function Editor({ id }: { id: string }) {
  const e = useEngine();
  const { go } = useRoute();
  const note = useRecord<any>(id);
  const toast = useToast();
  const wrap = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(() => e.doc(id).getText('body').toString());
  useLenis(wrap, content, id);

  // Remote edits flow into the textarea while keeping the caret where the user left it.
  useEffect(() => {
    const yt = e.doc(id).getText('body');
    const onChange = (ev: Y.YTextEvent, tr: Y.Transaction) => {
      if (tr.local) return;
      const el = area.current;
      let caret = el?.selectionStart ?? 0;
      let pos = 0;
      for (const d of ev.delta) {
        if (d.retain) pos += d.retain;
        if (typeof d.insert === 'string') { if (pos < caret) caret += d.insert.length; pos += d.insert.length; }
        if (d.delete) { if (pos < caret) caret -= Math.min(d.delete, caret - pos); }
      }
      setText(yt.toString());
      requestAnimationFrame(() => el?.setSelectionRange(caret, caret));
    };
    yt.observe(onChange);
    return () => yt.unobserve(onChange);
  }, [e, id]);

  function onBody(next: string) {
    const yt = e.doc(id).getText('body');
    const prev = yt.toString();
    let a = 0;
    while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
    let b = 0;
    while (b < prev.length - a && b < next.length - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++;
    e.doc(id).transact(() => {
      if (prev.length - a - b > 0) yt.delete(a, prev.length - a - b);
      if (next.length - a - b > 0) yt.insert(a, next.slice(a, next.length - b));
    });
    setText(next);
    touch();
  }
  const touch = () => e.set('note', id, { editedAt: new Date().toISOString(), editedOn: navigator.userAgent.includes('iPhone') ? 'iPhone' : 'denne enhed' });

  useEffect(() => {
    const el = area.current;
    if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
  }, [text]);

  if (!note) return <div className="editor" />;
  const ev = note.event ? (e.get(note.event) as any) : null;
  const mail = note.mail ? (e.get(note.mail) as any) : null;

  function togglePin() {
    const done = flipState('.nrows .nrow');
    e.set('note', id, { pinned: !note!.pinned });
    requestAnimationFrame(done);
  }

  return (
    <div className="editor" ref={wrap}>
      <div ref={content}>
        <div className="editor__bar">
          <button className="phone-back" onClick={() => go({ screen: 'notes' })}><Icon name="chevron-left" />Noter</button>
          <span>{note.folder}</span>
          <span className="right">
            <span className="num">Redigeret {note.editedAt ? fmt.clock(note.editedAt) : ''}</span>
            <Btn size="sm" variant="text" icon="pin" onClick={togglePin}>{note.pinned ? 'Fastgjort' : 'Fastgør'}</Btn>
            <Btn size="sm" variant="text" icon="x" onClick={() => {
              const { id: _i, type: _t, ...f } = note as any;
              e.remove('note', id); go({ screen: 'notes' });
              toast({ text: 'Noten er slettet', action: { label: 'Fortryd', run: () => { e.set('note', id, { ...f, _deleted: false }); go({ screen: 'notes', id }); } } });
            }}>Slet</Btn>
          </span>
        </div>
        <article className="doc">
          <input className="doc__title" value={note.title} placeholder="Uden titel" onChange={(x) => { e.set('note', id, { title: x.target.value }); touch(); }} aria-label="Titel" />
          {(ev || mail || note.tags?.length) && (
            <div className="docmeta">
              {ev && <button className="linkchip" onClick={() => go({ screen: 'calendar' })}><Icon name="calendar" />{ev.title} · {fmt.hm(ev.start)}</button>}
              {mail && <button className="linkchip" onClick={() => go({ screen: 'inbox', id: mail.id })}><Icon name="inbox" />Mail · {fmt.clock(mail.at)}</button>}
              {(note.tags ?? []).map((t: string) => <span key={t} className="tag">#{t}</span>)}
            </div>
          )}
          <textarea ref={area} className="doc__body" value={text} placeholder="Skriv. /-kommandoer, tabeller og [[links]] kommer i trin 3." onChange={(x) => onBody(x.target.value)} aria-label="Indhold" />
        </article>
      </div>
    </div>
  );
}
