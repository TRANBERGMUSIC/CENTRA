import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useEngine, useList, useRecord, useRoute, useNow, fmt } from '../state.tsx';
import { Btn, useProgressive, More } from '../ui/primitives.tsx';
import { Icon } from '../ui/Icon.tsx';
import { useLenis, useScreenEnter, flipState, gsap, useGSAP, reduced, narrow } from '../motion.ts';
// The editor (CodeMirror) loads when a note is opened, not with the rest of the app.
const NoteEditor = lazy(() => import('../ui/NoteEditor.tsx').then((m) => ({ default: m.NoteEditor })));
import { useToast } from '../ui/Shell.tsx';
import { ask } from '../ui/Confirm.tsx';
import { INBOX, TEMPLATES, clean, leaf, parentOf, folderTree, folderPaths, createFolder, renameFolder, deleteFolder, inFolder, linksIn, backlinks, plainText, type FolderNode } from '../notes.ts';

/**
 * Notes: folders (as deep as you like), pinned notes, tags, search and sorting on the left; the note
 * on the right. Title and metadata sync as LWW fields, the body is a shared Yjs text so two devices
 * can type in the same note at the same time.
 */
type View = { kind: 'all' } | { kind: 'pinned' } | { kind: 'folder'; path: string } | { kind: 'tag'; tag: string };
type NSort = 'edited' | 'created' | 'title';

/** Made in the last few seconds (here or on another device): it slides into the list. */
const isNew = (n: { createdAt?: string }) => !!n.createdAt && Date.now() - new Date(n.createdAt).getTime() < 4000;

export function Notes() {
  const e = useEngine();
  const { route, go } = useRoute();
  const toast = useToast();
  const now = useNow();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'notes');
  useList('notefolder');
  const [view, setView] = useState<View>({ kind: 'all' });
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<NSort>('edited');
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [naming, setNaming] = useState<{ parent: string; from?: string } | null>(null);
  const [name, setName] = useState('');
  const [tplOpen, setTplOpen] = useState(false);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const all = useList('note') as any[];
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const tags = [...new Set(all.flatMap((n) => n.tags ?? []))].sort((a, b) => a.localeCompare(b, 'da'));
  const list = useMemo(() => all
    .filter((n) => (words.length ? words.every((w) => `${n.title} ${n.folder} ${(n.tags ?? []).join(' ')} ${e.doc(n.id).getText('body').toString()}`.toLowerCase().includes(w))
      : view.kind === 'all' ? true : view.kind === 'pinned' ? n.pinned : view.kind === 'tag' ? (n.tags ?? []).includes(view.tag) : inFolder(n, view.path)))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (sort === 'title' ? (a.title || '').localeCompare(b.title || '', 'da') : sort === 'created' ? (b.createdAt ?? b.editedAt ?? '').localeCompare(a.createdAt ?? a.editedAt ?? '') : (b.editedAt ?? '').localeCompare(a.editedAt ?? ''))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [all, view, q, sort]);
  const [shown, moreAt] = useProgressive(list.length, 60, `${JSON.stringify(view)}|${q}|${sort}`);
  const id = route.id ?? list[0]?.id;
  const tree = folderTree(e);
  const here = view.kind === 'folder' ? view.path : INBOX;

  const newNote = (tplId = 'blank') => {
    const t = TEMPLATES.find((x) => x.id === tplId) ?? TEMPLATES[0];
    const folder = view.kind === 'folder' ? view.path : t.folder ?? INBOX;
    const title = tplId === 'journal' ? `Dagbog ${new Date().toLocaleDateString('da-DK', { day: 'numeric', month: 'long' })}` : t.title;
    const nid = e.create('note', { title, folder, tags: view.kind === 'tag' ? [view.tag] : [], editedAt: new Date().toISOString(), createdAt: new Date().toISOString() });
    if (t.body) e.doc(nid).getText('body').insert(0, t.body);
    setTplOpen(false);
    go({ screen: 'notes', id: nid });
  };
  function saveName(ev: React.FormEvent) {
    ev.preventDefault();
    const n = clean(name);
    if (!n || !naming) return setNaming(null);
    try {
      if (naming.from) {
        const to = clean((parentOf(naming.from) ? parentOf(naming.from) + '/' : '') + n);
        const undo = renameFolder(e, naming.from, to);
        if (view.kind === 'folder' && inFolder({ folder: view.path }, naming.from)) setView({ kind: 'folder', path: to + view.path.slice(naming.from.length) });
        toast({ icon: 'folder', text: `Mappen hedder nu ${leaf(to)}`, action: { label: 'Fortryd', run: () => undo.forEach((u) => e.set(u.type, u.id, u.fields)) } });
      } else {
        const path = createFolder(e, (naming.parent ? naming.parent + '/' : '') + n);
        setOpen((o) => new Set([...o, naming.parent]));
        setView({ kind: 'folder', path });
      }
    } catch (x) { toast({ text: (x as Error).message }); }
    setNaming(null); setName('');
  }
  async function delFolder(path: string) {
    const n = all.filter((x) => inFolder(x, path)).length;
    if (!(await ask({ title: `Slet mappen ${leaf(path)}?`, text: n ? `${n} ${n === 1 ? 'note flyttes' : 'noter flyttes'} til ${parentOf(path) ? leaf(parentOf(path)) : INBOX}. Ingen noter slettes.` : 'Den er tom.', ok: 'Slet mappe', danger: true }))) return;
    const r = deleteFolder(e, path);
    setView({ kind: 'folder', path: r.to });
    toast({ icon: 'folder', text: `${leaf(path)} er slettet`, action: { label: 'Fortryd', run: () => r.undo.forEach((u) => e.set(u.type, u.id, u.fields)) } });
  }
  const drop = (path: string, ev: React.DragEvent) => {
    ev.preventDefault(); setDropOn(null);
    const nid = ev.dataTransfer.getData('text/centra-note');
    const n = nid ? (e.get(nid) as any) : null;
    if (!n || (n.folder || INBOX) === path) return;
    e.set('note', nid, { folder: path });
    toast({ icon: 'folder', text: `Flyttet til ${leaf(path)}`, action: { label: 'Fortryd', run: () => e.set('note', nid, { folder: n.folder }) } });
  };
  const folderRow = (f: FolderNode, depth: number): React.ReactNode => {
    const isOpen = open.has(f.path) || (view.kind === 'folder' && view.path.startsWith(f.path + '/'));
    const active = view.kind === 'folder' && view.path === f.path && !words.length;
    return (
      <li key={f.path}>
        <div className={`nfolder ${active ? 'is-active' : ''} ${dropOn === f.path ? 'is-drop' : ''}`} style={{ paddingLeft: 6 + depth * 14 }}
          onDragOver={(ev) => { ev.preventDefault(); setDropOn(f.path); }} onDragLeave={() => setDropOn(null)} onDrop={(ev) => drop(f.path, ev)}>
          <button className="nfolder__caret" aria-label={isOpen ? 'Fold sammen' : 'Fold ud'} aria-expanded={isOpen} style={{ visibility: f.children.length ? 'visible' : 'hidden' }} onClick={() => setOpen((o) => { const x = new Set(o); if (x.has(f.path)) x.delete(f.path); else x.add(f.path); return x; })}><Icon name="chevron-right" size="sm" /></button>
          <button className="nfolder__name" onClick={() => { setView({ kind: 'folder', path: f.path }); setQ(''); }} onDoubleClick={() => { if (f.path !== INBOX) { setNaming({ parent: parentOf(f.path), from: f.path }); setName(f.name); } }}>
            <Icon name="folder" size="sm" /><span className="ellipsis">{f.name}</span><span className="num meta">{f.total || ''}</span>
          </button>
          <span className="nfolder__acts">
            <button aria-label={`Ny mappe i ${f.name}`} title="Ny undermappe" onClick={() => { setNaming({ parent: f.path }); setName(''); }}><Icon name="plus" size="sm" /></button>
            {f.path !== INBOX && <button aria-label={`Omdøb ${f.name}`} title="Omdøb" onClick={() => { setNaming({ parent: parentOf(f.path), from: f.path }); setName(f.name); }}><Icon name="edit" size="sm" /></button>}
            {f.path !== INBOX && <button aria-label={`Slet ${f.name}`} title="Slet mappe" onClick={() => void delFolder(f.path)}><Icon name="x" size="sm" /></button>}
          </span>
        </div>
        {naming && !naming.from && naming.parent === f.path && <form className="nfolder__new" style={{ paddingLeft: 26 + (depth + 1) * 14 }} onSubmit={saveName}><input autoFocus value={name} onChange={(x) => setName(x.target.value)} onBlur={saveName} placeholder="Mappens navn" aria-label="Ny mappes navn" /></form>}
        {naming?.from === f.path && <form className="nfolder__new" style={{ paddingLeft: 26 + depth * 14 }} onSubmit={saveName}><input autoFocus value={name} onChange={(x) => setName(x.target.value)} onBlur={saveName} aria-label="Nyt navn" /></form>}
        {isOpen && f.children.length > 0 && <ul>{f.children.map((c) => folderRow(c, depth + 1))}</ul>}
      </li>
    );
  };
  const heading = words.length ? `${list.length} fundet` : view.kind === 'all' ? 'Alle noter' : view.kind === 'pinned' ? 'Fastgjort' : view.kind === 'tag' ? `#${view.tag}` : view.path.split('/').join(' › ');

  return (
    <main className={`notes2 notes3 ${route.id ? 'has-open' : ''}`} ref={ref}>
      <div className="nlist" data-enter data-lenis-prevent>
        <div className="nlist__head"><h1>Noter</h1>
          <span className="nlist__acts ntpl">
            <Btn size="sm" variant="text" onClick={() => setTplOpen((x) => !x)} aria-expanded={tplOpen}>Skabelon</Btn>
            <Btn size="sm" icon="plus" onClick={() => newNote()} aria-label="Ny note" title="Ny note (⌘N)" />
            {tplOpen && <div className="ntpl__menu" role="menu">{TEMPLATES.map((t) => <button key={t.id} role="menuitem" onClick={() => newNote(t.id)}>{t.name}{t.folder ? <span className="meta"> · {t.folder}</span> : null}</button>)}</div>}
          </span>
        </div>
        <input className="msearch" type="search" value={q} onChange={(x) => setQ(x.target.value)} placeholder="Søg i alle noter" aria-label="Søg i noter" />
        <nav className="nnav" aria-label="Mapper">
          <button className={`nnav__item ${view.kind === 'all' && !words.length ? 'is-active' : ''}`} onClick={() => { setView({ kind: 'all' }); setQ(''); }}><Icon name="notes" size="sm" /><span>Alle noter</span><span className="num meta">{all.length}</span></button>
          <button className={`nnav__item ${view.kind === 'pinned' && !words.length ? 'is-active' : ''}`} onClick={() => { setView({ kind: 'pinned' }); setQ(''); }}><Icon name="pin" size="sm" /><span>Fastgjort</span><span className="num meta">{all.filter((n) => n.pinned).length}</span></button>
          <div className="nnav__sec"><span>Mapper</span><button aria-label="Ny mappe" title="Ny mappe" onClick={() => { setNaming({ parent: '' }); setName(''); }}><Icon name="plus" size="sm" /></button></div>
          {naming && !naming.from && naming.parent === '' && <form className="nfolder__new" onSubmit={saveName}><input autoFocus value={name} onChange={(x) => setName(x.target.value)} onBlur={saveName} placeholder="Mappens navn" aria-label="Ny mappes navn" /></form>}
          <ul className="ntree">{tree.map((f) => folderRow(f, 0))}</ul>
          {tags.length > 0 && <><div className="nnav__sec"><span>Tags</span></div>
            <div className="ntags">{tags.map((t) => <button key={t} className={`tag ${view.kind === 'tag' && view.tag === t ? 'is-active' : ''}`} onClick={() => { setView({ kind: 'tag', tag: t }); setQ(''); }}>#{t}</button>)}</div></>}
        </nav>
        <div className="nlist__bar"><span className="strong ellipsis">{heading}</span>
          <select className="mselect" value={sort} onChange={(x) => setSort(x.target.value as NSort)} aria-label="Sortér noter"><option value="edited">Senest redigeret</option><option value="created">Senest oprettet</option><option value="title">Titel A–Å</option></select></div>
        <div className="nrows">
          {list.slice(0, shown).map((n) => (
            <button key={n.id} data-flip-id={n.id} draggable onDragStart={(ev) => { ev.dataTransfer.setData('text/centra-note', n.id); ev.dataTransfer.effectAllowed = 'move'; }} className={`nrow ${n.id === id ? 'is-selected' : ''} ${isNew(n) ? 'is-new' : ''}`} onClick={() => go({ screen: 'notes', id: n.id })}>
              <span className="nrow__t"><span className="ellipsis">{n.title || 'Uden titel'}</span>{n.pinned && <Icon name="pin" size="sm" className="faint" />}</span>
              <span className="nrow__x">{plainText(e.doc(n.id).getText('body').toString().slice(0, 200)).slice(0, 120) || 'Tom note'}</span>
              <span className="meta num nrow__m">{n.editedAt ? fmt.ago(n.editedAt, now) : ''}{(view.kind !== 'folder' || n.folder !== here) && n.folder ? ` · ${leaf(n.folder)}` : ''}{(n.tags ?? []).length ? ` · ${(n.tags as string[]).map((t) => '#' + t).join(' ')}` : ''}</span>
            </button>
          ))}
          <More at={moreAt} left={list.length - shown} />
          {!list.length && <p className="meta pad">{words.length ? 'Intet fundet.' : view.kind === 'folder' ? 'Mappen er tom.' : 'Ingen noter her endnu.'}</p>}
        </div>
      </div>
      {id ? <Editor key={id} id={id} /> : <div className="editor"><p className="muted">Ingen noter endnu. <button className="tag" onClick={() => newNote()}>Skriv den første</button></p></div>}
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
  const [text, setText] = useState(() => e.doc(id).getText('body').toString());
  useLenis(wrap, content, id);
  // The text (for the links under the note) follows edits from here and from other devices, a moment later.
  useEffect(() => {
    const yt = e.doc(id).getText('body');
    let t: ReturnType<typeof setTimeout> | null = null;
    const on = () => { if (!t) t = setTimeout(() => { t = null; setText(yt.toString()); }, 400); };
    yt.observe(on);
    return () => { yt.unobserve(on); if (t) clearTimeout(t); };
  }, [e, id]);
  // Switching notes on the Mac: the new one fades in where the old one was.
  useGSAP(() => {
    if (reduced() || narrow()) return;
    gsap.from(content.current!.querySelectorAll('.doc'), { opacity: 0, y: 6, duration: 0.28, ease: 'power3.out', clearProps: 'transform,opacity' });
  }, { dependencies: [id], scope: wrap });

  // "Redigeret" is stamped at most every few seconds while typing, not on every key.
  const lastTouch = useRef(0);
  const unstamped = useRef(false);
  const stamp = () => { unstamped.current = false; lastTouch.current = Date.now(); e.set('note', id, { editedAt: new Date().toISOString(), editedOn: navigator.userAgent.includes('iPhone') ? 'iPhone' : 'denne enhed' }); };
  const later = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touch = () => {
    const wait = 4000 - (Date.now() - lastTouch.current);
    if (wait <= 0) return stamp();
    unstamped.current = true;
    if (!later.current) later.current = setTimeout(() => { later.current = null; if (unstamped.current) stamp(); }, wait);
  };
  // Leaving the note: the last edits get their stamp too (the list's preview and order follow it).
  useEffect(() => () => { if (later.current) clearTimeout(later.current); later.current = null; if (unstamped.current) stamp(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [tagIn, setTagIn] = useState('');
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const notes = useList('note') as any[];
  const links = useMemo(() => linksIn(text), [text]);
  const back = useMemo(() => backlinks(e, note?.title ?? '', id), [e, note?.title, id, notes]);
  const allTags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags ?? []))], [notes]);
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
          {newFolder === null ? (
            <label className="nmove"><Icon name="folder" size="sm" /><select value={note.folder || INBOX} aria-label="Mappe" onChange={(x) => { if (x.target.value === '__new') { setNewFolder(''); return; } e.set('note', id, { folder: x.target.value }); }}>
              {folderPaths(e).map((p) => <option key={p} value={p}>{p.split('/').join(' › ')}</option>)}<option value="__new">Ny mappe …</option></select></label>
          ) : (
            <form className="nmove nmove--new" onSubmit={(x) => { x.preventDefault(); if (newFolder.trim()) { try { const p = createFolder(e, newFolder); e.set('note', id, { folder: p }); } catch (err) { toast({ text: (err as Error).message }); } } setNewFolder(null); }}>
              <Icon name="folder" size="sm" /><input autoFocus value={newFolder} onChange={(x) => setNewFolder(x.target.value)} onBlur={() => setNewFolder(null)} onKeyDown={(x) => x.key === 'Escape' && setNewFolder(null)} aria-label="Ny mappe" />
            </form>
          )}
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
          <div className="docmeta">
            {ev && <button className="linkchip" onClick={() => go({ screen: 'calendar' })}><Icon name="calendar" />{ev.title} · {fmt.hm(ev.start)}</button>}
            {mail && <button className="linkchip" onClick={() => go({ screen: 'inbox', id: mail.id })}><Icon name="inbox" />Mail · {fmt.clock(mail.at)}</button>}
            {(note.tags ?? []).map((t: string) => <span key={t} className="tag ntag">#{t}<button aria-label={`Fjern #${t}`} onClick={() => e.set('note', id, { tags: (note.tags ?? []).filter((x: string) => x !== t) })}><Icon name="x" size="sm" /></button></span>)}
            <form className="ntag__add" onSubmit={(x) => { x.preventDefault(); const v = tagIn.trim().replace(/^#/, '').toLowerCase(); if (v && !(note.tags ?? []).includes(v)) e.set('note', id, { tags: [...(note.tags ?? []), v] }); setTagIn(''); }}>
              <input value={tagIn} onChange={(x) => setTagIn(x.target.value)} placeholder="+ tag" aria-label="Tilføj tag" list="note-tags" />
              <datalist id="note-tags">{allTags.map((t) => <option key={t} value={t} />)}</datalist>
            </form>
          </div>
          <Suspense fallback={<div className="doc__body cmhost" />}><NoteEditor text={e.doc(id).getText('body')} placeholderText="Skriv løs. - giver punkter, [] en tjekliste, [[Notens titel]] et link." onLocalEdit={touch} /></Suspense>
          {(links.length > 0 || back.length > 0) && (
            <div className="nlinks">
              {links.length > 0 && <div><span className="meta">Links i noten</span>{links.map((l) => { const t = notes.find((n) => (n.title || '').trim().toLowerCase() === l.toLowerCase()); return <button key={l} className="linkchip" onClick={() => { if (t) go({ screen: 'notes', id: t.id }); else { const nid = e.create('note', { title: l, folder: note.folder || INBOX, tags: [], editedAt: new Date().toISOString(), createdAt: new Date().toISOString() }); go({ screen: 'notes', id: nid }); } }}><Icon name="notes" />{l}{!t && <span className="meta"> · lav den</span>}</button>; })}</div>}
              {back.length > 0 && <div><span className="meta">Nævnt i</span>{back.map((n: any) => <button key={n.id} className="linkchip" onClick={() => go({ screen: 'notes', id: n.id })}><Icon name="notes" />{n.title || 'Uden titel'}</button>)}</div>}
            </div>
          )}
        </article>
      </div>
    </div>
  );
}
