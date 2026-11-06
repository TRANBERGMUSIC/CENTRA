import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEngine, useList, useNow, useRoute } from '../state.tsx';
import { Btn } from '../ui/primitives.tsx';
import { Icon } from '../ui/Icon.tsx';
import { useToast } from '../ui/Shell.tsx';
import { ask } from '../ui/Confirm.tsx';
import { useScreenEnter } from '../motion.ts';
import {
  BOARD_COLORS, LABEL_COLORS, boardBg, labelHex, boards as allBoards, listsOf, cardsOf, boardCards, addBoard, addList, addCard, moveCard, moveList,
  removeList, removeBoard, addCheck, setChecklist, progress, type Board, type BList, type BCard,
} from '../boards.ts';

/**
 * Boards, like Trello: one per project. Lists side by side, cards you drag between them (with the
 * mouse, or hold a card on the iPhone and drag), and a card opens with its description, deadline,
 * labels and checklist. Everything syncs, so a board changes on every device as you work.
 */
export function Boards() {
  const { route } = useRoute();
  useList('board'); useList('blist'); useList('bcard');
  const e = useEngine();
  const board = route.id ? (e.get(route.id) as unknown as Board | null) : null;
  return board && !(board as any)._deleted ? <BoardView key={board.id} board={board} /> : <Overview />;
}

/* ---------------------------------------------------------------- all boards */
function Overview() {
  const e = useEngine();
  const { go } = useRoute();
  const toast = useToast();
  const now = useNow();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'boards');
  const list = allBoards(e);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const create = (ev: React.FormEvent) => {
    ev.preventDefault();
    try { const id = addBoard(e, name); setName(''); setAdding(false); go({ screen: 'boards', id }); } catch (x) { toast({ text: (x as Error).message }); }
  };
  return (
    <main className="canvas boards" ref={ref}>
      <div className="titlerow" data-enter><div><h1>Boards</h1></div></div>
      <div className="bgrid" data-enter>
        {list.map((b) => {
          const cards = boardCards(e, b.id);
          const open = cards.filter((c) => !c.done);
          const late = open.filter((c) => c.due && new Date(c.due) < now).length;
          const done = cards.length - open.length;
          return (
            <button key={b.id} className="btile" style={{ background: boardBg(b.color) }} onClick={() => go({ screen: 'boards', id: b.id })}>
              <span className="btile__name">{b.name}</span>
              <span className="btile__meta num">{open.length} kort{late ? ` · ${late} over frist` : ''}</span>
              {cards.length > 0 && <span className="btile__bar" aria-hidden="true"><span style={{ width: `${(done / cards.length) * 100}%` }} /></span>}
            </button>
          );
        })}
        {adding ? (
          <form className="btile btile--new is-open" onSubmit={create}>
            <input value={name} onChange={(x) => setName(x.target.value)} placeholder="Navn på board" aria-label="Navn på board" autoFocus onKeyDown={(x) => { if (x.key === 'Escape') setAdding(false); }} />
            <div className="btile__acts"><Btn size="sm" variant="text" type="button" onClick={() => setAdding(false)}>Annullér</Btn><Btn size="sm" variant="primary" type="submit" disabled={!name.trim()}>Opret</Btn></div>
          </form>
        ) : (
          <button className="btile btile--new" onClick={() => setAdding(true)}><Icon name="plus" /><span>Nyt board</span></button>
        )}
      </div>
    </main>
  );
}

/* ---------------------------------------------------------------- one board */
type Drag = { id: string; from: string; x: number; y: number; dx: number; dy: number; w: number; h: number; over: string | null; index: number };

function BoardView({ board }: { board: Board }) {
  const e = useEngine();
  const { go } = useRoute();
  const toast = useToast();
  const lists = listsOf(e, board.id);
  const [name, setName] = useState(board.name);
  useEffect(() => setName(board.name), [board.name]);
  const [open, setOpen] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [newList, setNewList] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const { drag, startMouse, startTouch, justDragged } = useCardDrag(scroller, (id, list, index) => moveCard(e, id, list, index));

  const saveName = () => { const n = name.trim(); if (n && n !== board.name) e.set('board', board.id, { name: n.slice(0, 80) }); else setName(board.name); };
  const del = async () => {
    setMenu(false);
    if (!(await ask({ title: `Slet "${board.name}"?`, text: 'Alle lister og kort på boardet slettes.', ok: 'Slet', danger: true }))) return;
    const undo = removeBoard(e, board.id);
    go({ screen: 'boards' });
    toast({ text: `Slettet: ${board.name}`, action: { label: 'Fortryd', run: undo } });
  };

  return (
    <main className="canvas board" style={{ ['--board' as any]: boardBg(board.color) }}>
      <div className="board__wash" aria-hidden="true" />
      <header className="board__head">
        <Btn size="sm" variant="text" icon="chevron-left" onClick={() => go({ screen: 'boards' })}>Boards</Btn>
        <input className="board__name" value={name} onChange={(x) => setName(x.target.value)} onBlur={saveName} onKeyDown={(x) => { if (x.key === 'Enter') (x.target as HTMLInputElement).blur(); if (x.key === 'Escape') { setName(board.name); (x.target as HTMLInputElement).blur(); } }} aria-label="Navn på board" />
        <span className="push-right" />
        <div className="board__menuwrap">
          <Btn size="sm" variant="text" icon="more" aria-label="Board" aria-expanded={menu} onClick={() => setMenu((m) => !m)} />
          {menu && <>
            <div className="board__menuscrim" onClick={() => setMenu(false)} />
            <div className="board__menu" role="menu">
              <div className="board__colors" role="group" aria-label="Farve">
                {BOARD_COLORS.map(([c, bg]) => <button key={c} role="menuitemradio" aria-checked={board.color === c} aria-label={c} className={board.color === c ? 'is-on' : ''} style={{ background: bg }} onClick={() => e.set('board', board.id, { color: c })} />)}
              </div>
              <button role="menuitem" className="board__mi" onClick={() => { setMenu(false); setNewList(''); }}><Icon name="plus" size="sm" />Ny liste</button>
              <button role="menuitem" className="board__mi is-danger" onClick={() => void del()}><Icon name="trash" size="sm" />Slet board</button>
            </div>
          </>}
        </div>
      </header>

      <div className="board__lists" ref={scroller} data-lenis-prevent>
        {lists.map((l, li) => (
          <ListColumn key={l.id} l={l} index={li} count={lists.length} drag={drag} onOpen={(id) => { if (!justDragged()) setOpen(id); }} startMouse={startMouse} startTouch={startTouch} />
        ))}
        {newList !== null ? (
          <form className="bl bl--new is-open" onSubmit={(x) => { x.preventDefault(); if (newList.trim()) { addList(e, board.id, newList); setNewList(''); } }}>
            <input value={newList} onChange={(x) => setNewList(x.target.value)} placeholder="Navn på liste" aria-label="Navn på liste" autoFocus onKeyDown={(x) => { if (x.key === 'Escape') setNewList(null); }} />
            <div className="bl__acts"><Btn size="sm" variant="primary" type="submit" disabled={!newList.trim()}>Tilføj liste</Btn><Btn size="sm" variant="text" type="button" icon="x" aria-label="Luk" onClick={() => setNewList(null)} /></div>
          </form>
        ) : (
          <button className="bl bl--new" onClick={() => setNewList('')}><Icon name="plus" size="sm" />Ny liste</button>
        )}
      </div>

      {drag && <DragGhost drag={drag} />}
      {open && e.get(open) && <CardSheet id={open} board={board} onClose={() => setOpen(null)} />}
    </main>
  );
}

function ListColumn({ l, index, count, drag, onOpen, startMouse, startTouch }: {
  l: BList; index: number; count: number; drag: Drag | null; onOpen: (id: string) => void;
  startMouse: (ev: React.PointerEvent, c: BCard) => void; startTouch: (ev: React.TouchEvent, c: BCard) => void;
}) {
  const e = useEngine();
  const toast = useToast();
  const now = useNow();
  const cards = cardsOf(e, l.id);
  const [name, setName] = useState(l.name);
  useEffect(() => setName(l.name), [l.name]);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const body = useRef<HTMLDivElement>(null);

  const add = () => {
    if (!text.trim()) return;
    try { addCard(e, l.board, l.id, text); setText(''); setTimeout(() => { field.current?.focus(); body.current?.scrollTo({ top: body.current.scrollHeight }); }, 0); } catch (x) { toast({ text: (x as Error).message }); }
  };
  const del = async () => {
    setMenu(false);
    if (cards.length && !(await ask({ title: `Slet listen "${l.name}"?`, text: `${cards.length} kort slettes med.`, ok: 'Slet', danger: true }))) return;
    const undo = removeList(e, l.id);
    toast({ text: `Slettet: ${l.name}`, action: { label: 'Fortryd', run: undo } });
  };

  // While dragging: the card leaves its place, and a gap shows where it will land.
  const shown = drag ? cards.filter((c) => c.id !== drag.id) : cards;
  const gapAt = drag && drag.over === l.id ? drag.index : -1;
  return (
    <section className={`bl ${drag?.over === l.id ? 'is-over' : ''}`} data-list={l.id} aria-label={l.name}>
      <header className="bl__head">
        <input className="bl__name" value={name} onChange={(x) => setName(x.target.value)} onBlur={() => { const n = name.trim(); if (n && n !== l.name) e.set('blist', l.id, { name: n.slice(0, 60) }); else setName(l.name); }} onKeyDown={(x) => { if (x.key === 'Enter') (x.target as HTMLInputElement).blur(); }} aria-label="Navn på liste" />
        <span className="bl__n num">{cards.length || ''}</span>
        <div className="board__menuwrap">
          <Btn size="sm" variant="text" icon="more" aria-label={`Liste ${l.name}`} onClick={() => setMenu((m) => !m)} />
          {menu && <>
            <div className="board__menuscrim" onClick={() => setMenu(false)} />
            <div className="board__menu board__menu--list" role="menu">
              {index > 0 && <button role="menuitem" className="board__mi" onClick={() => { moveList(e, l.id, index - 1); setMenu(false); }}><Icon name="chevron-left" size="sm" />Flyt til venstre</button>}
              {index < count - 1 && <button role="menuitem" className="board__mi" onClick={() => { moveList(e, l.id, index + 1); setMenu(false); }}><Icon name="chevron-right" size="sm" />Flyt til højre</button>}
              <button role="menuitem" className="board__mi is-danger" onClick={() => void del()}><Icon name="trash" size="sm" />Slet liste</button>
            </div>
          </>}
        </div>
      </header>
      <div className="bl__cards" ref={body} data-cards={l.id}>
        {shown.map((c, i) => (
          <FragmentWithGap key={c.id} gap={gapAt === i ? drag!.h : 0}>
            <CardFace c={c} now={now} onOpen={() => onOpen(c.id)} onMouse={(ev) => startMouse(ev, c)} onTouch={(ev) => startTouch(ev, c)} hidden={drag?.id === c.id} />
          </FragmentWithGap>
        ))}
        {gapAt >= shown.length && <div className="bc__gap" style={{ height: drag!.h }} />}
        {adding && (
          <form className="bl__add" onSubmit={(x) => { x.preventDefault(); add(); }}>
            <textarea ref={field} value={text} onChange={(x) => setText(x.target.value)} rows={2} placeholder="Titel på kort" aria-label="Titel på kort" autoFocus enterKeyHint="done"
              onKeyDown={(x) => { if (x.key === 'Enter' && !x.shiftKey) { x.preventDefault(); add(); } if (x.key === 'Escape') { setAdding(false); setText(''); } }} />
            <div className="bl__acts"><Btn size="sm" variant="primary" type="submit" disabled={!text.trim()}>Tilføj kort</Btn><Btn size="sm" variant="text" type="button" icon="x" aria-label="Luk" onClick={() => { setAdding(false); setText(''); }} /></div>
          </form>
        )}
      </div>
      {!adding && <button className="bl__addbtn" onClick={() => setAdding(true)}><Icon name="plus" size="sm" />Tilføj kort</button>}
    </section>
  );
}

function FragmentWithGap({ gap, children }: { gap: number; children: React.ReactNode }) {
  return <>{gap > 0 && <div className="bc__gap" style={{ height: gap }} />}{children}</>;
}

function dueLabel(iso: string, now: Date) {
  const d = new Date(iso);
  const day = d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' });
  const t = d.getHours() || d.getMinutes() ? ` ${d.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}` : '';
  return d.getFullYear() !== now.getFullYear() ? `${day} ${d.getFullYear()}` : `${day}${t}`;
}

function CardFace({ c, now, onOpen, onMouse, onTouch, hidden }: { c: BCard; now: Date; onOpen: () => void; onMouse: (ev: React.PointerEvent) => void; onTouch: (ev: React.TouchEvent) => void; hidden?: boolean }) {
  const e = useEngine();
  const late = !c.done && c.due && new Date(c.due) < now;
  const soon = !c.done && c.due && !late && new Date(c.due).getTime() - now.getTime() < 86400000;
  const p = progress(c);
  const labels = (c.labels ?? []).filter(Boolean);
  return (
    <div className={`bc ${c.done ? 'is-done' : ''} ${hidden ? 'is-hidden' : ''}`} data-card={c.id} role="button" tabIndex={0} aria-label={c.title}
      onClick={onOpen} onKeyDown={(x) => { if (x.key === 'Enter' || x.key === ' ') { x.preventDefault(); onOpen(); } }}
      onPointerDown={(x) => { if (x.pointerType === 'mouse') onMouse(x); }} onTouchStart={onTouch}>
      {labels.length > 0 && <div className="bc__labels">{labels.map((l) => <span key={l} style={{ background: labelHex(l) }} />)}</div>}
      <div className="bc__row">
        <button className={`bc__check ${c.done ? 'is-on' : ''}`} aria-label={c.done ? 'Ikke færdig' : 'Færdig'} aria-pressed={!!c.done}
          onClick={(x) => { x.stopPropagation(); e.set('bcard', c.id, { done: !c.done }); }} onPointerDown={(x) => x.stopPropagation()} onTouchStart={(x) => x.stopPropagation()}><Icon name="check" size="sm" /></button>
        <span className="bc__title">{c.title}</span>
      </div>
      {(c.due || p || c.notes) && (
        <div className="bc__badges">
          {c.due && <span className={`bc__due ${c.done ? 'is-done' : late ? 'is-late' : soon ? 'is-soon' : ''}`}><Icon name="clock" size="sm" />{dueLabel(c.due, now)}</span>}
          {p && <span className={`bc__badge ${p.split('/')[0] === p.split('/')[1] ? 'is-full' : ''}`}><Icon name="checklist" size="sm" />{p}</span>}
          {c.notes && <span className="bc__badge" aria-label="Har beskrivelse"><Icon name="notes" size="sm" /></span>}
        </div>
      )}
    </div>
  );
}

function DragGhost({ drag }: { drag: Drag }) {
  const e = useEngine();
  const c = e.get(drag.id) as unknown as BCard | null;
  if (!c) return null;
  return createPortal(
    <div className="bc bc--ghost" style={{ width: drag.w, transform: `translate(${drag.x - drag.dx}px, ${drag.y - drag.dy}px) rotate(2.5deg)` }} aria-hidden="true">
      <div className="bc__row"><span className="bc__title">{c.title}</span></div>
    </div>,
    document.body,
  );
}

/* ---------------------------------------------------------------- dragging cards */
/**
 * Mouse: press and move a little. Touch: hold a moment, then drag (a quick swipe still scrolls).
 * The board scrolls sideways at the edges and a list scrolls up and down, so a card can travel far.
 */
function useCardDrag(scroller: React.RefObject<HTMLDivElement | null>, onDrop: (id: string, list: string, index: number) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const cur = useRef<Drag | null>(null);
  const dropped = useRef(0);
  const raf = useRef(0);

  const update = (d: Drag | null) => { cur.current = d; setDrag(d); };
  const target = (x: number, y: number, d: Drag): Drag => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const list = el?.closest<HTMLElement>('[data-list]');
    if (!list) return { ...d, x, y };
    const id = list.dataset.list!;
    const cards = Array.from(list.querySelectorAll<HTMLElement>('[data-card]')).filter((c) => c.dataset.card !== d.id);
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) { const r = cards[i].getBoundingClientRect(); if (y < r.top + r.height / 2) { index = i; break; } }
    return { ...d, x, y, over: id, index };
  };
  // Edges: the board moves sideways, the list under the finger up and down.
  const edgeScroll = () => {
    const d = cur.current, s = scroller.current;
    if (!d || !s) return;
    const r = s.getBoundingClientRect(), edge = 60;
    if (d.x < r.left + edge) s.scrollLeft -= Math.ceil((r.left + edge - d.x) / 4);
    else if (d.x > r.right - edge) s.scrollLeft += Math.ceil((d.x - (r.right - edge)) / 4);
    const body = d.over ? document.querySelector<HTMLElement>(`[data-cards="${d.over}"]`) : null;
    if (body) {
      const b = body.getBoundingClientRect();
      if (d.y < b.top + 40) body.scrollTop -= 8; else if (d.y > b.bottom - 40) body.scrollTop += 8;
    }
    update(target(d.x, d.y, d));
    raf.current = requestAnimationFrame(edgeScroll);
  };
  const begin = (c: BCard, el: HTMLElement, x: number, y: number) => {
    const r = el.getBoundingClientRect();
    update(target(x, y, { id: c.id, from: c.list, x, y, dx: x - r.left, dy: y - r.top, w: r.width, h: r.height, over: c.list, index: 0 }));
    document.documentElement.classList.add('is-dragging');
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(edgeScroll);
  };
  const finish = (commit: boolean) => {
    cancelAnimationFrame(raf.current);
    document.documentElement.classList.remove('is-dragging');
    const d = cur.current;
    if (d && commit && d.over) { onDrop(d.id, d.over, d.index); dropped.current = Date.now(); }
    update(null);
  };

  const startMouse = (ev: React.PointerEvent, c: BCard) => {
    if (ev.button !== 0 || (ev.target as HTMLElement).closest('button:not(.bc), input, textarea')) return;
    const el = ev.currentTarget as HTMLElement, sx = ev.clientX, sy = ev.clientY;
    let started = false;
    const move = (m: PointerEvent) => {
      if (!started && Math.hypot(m.clientX - sx, m.clientY - sy) > 5) { started = true; begin(c, el, m.clientX, m.clientY); }
      if (started && cur.current) cur.current = { ...cur.current, x: m.clientX, y: m.clientY };
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', cancel); if (started) finish(true); };
    const cancel = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', cancel); if (started) finish(false); };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', cancel);
  };

  const startTouch = (ev: React.TouchEvent, c: BCard) => {
    if (ev.touches.length !== 1 || (ev.target as HTMLElement).closest('.bc__check')) return;
    const el = ev.currentTarget as HTMLElement, t0 = ev.touches[0], sx = t0.clientX, sy = t0.clientY;
    let started = false, x = sx, y = sy;
    const hold = setTimeout(() => { started = true; el.classList.add('is-lifting'); begin(c, el, x, y); }, 320);
    const move = (m: TouchEvent) => {
      const t = m.touches[0]; x = t.clientX; y = t.clientY;
      if (!started) { if (Math.hypot(x - sx, y - sy) > 8) end(false); return; }
      m.preventDefault(); // dragging: the page stays still
      if (cur.current) cur.current = { ...cur.current, x, y };
    };
    const end = (commit: boolean) => {
      clearTimeout(hold);
      el.classList.remove('is-lifting');
      el.removeEventListener('touchmove', move); el.removeEventListener('touchend', up); el.removeEventListener('touchcancel', cancel);
      if (started) finish(commit);
    };
    const up = (u: TouchEvent) => { if (started) u.preventDefault(); end(true); };
    const cancel = () => end(false);
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', cancel);
  };

  useEffect(() => () => { cancelAnimationFrame(raf.current); document.documentElement.classList.remove('is-dragging'); }, []);
  return { drag, startMouse, startTouch, justDragged: () => Date.now() - dropped.current < 300 };
}

/* ---------------------------------------------------------------- a card, opened */
const localInput = (iso: string) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

function CardSheet({ id, board, onClose }: { id: string; board: Board; onClose: () => void }) {
  const e = useEngine();
  const toast = useToast();
  useList('bcard');
  const c = e.get(id) as unknown as BCard;
  const lists = listsOf(e, board.id);
  const [title, setTitle] = useState(c.title);
  const [notes, setNotes] = useState(c.notes ?? '');
  const [check, setCheck] = useState('');
  const save = (f: Partial<BCard>) => e.set('bcard', id, f as Record<string, unknown>);
  // Your typing is saved when you leave the field, so another device's edit doesn't jump under you.
  useEffect(() => { if (document.activeElement?.getAttribute('aria-label') !== 'Titel') setTitle(c.title); }, [c.title]);
  useEffect(() => { if (document.activeElement?.getAttribute('aria-label') !== 'Beskrivelse') setNotes(c.notes ?? ''); }, [c.notes]);
  const close = () => {
    if (title.trim() && title.trim() !== c.title) save({ title: title.trim().slice(0, 300) });
    if (notes !== (c.notes ?? '')) save({ notes: notes.slice(0, 20000) });
    onClose();
  };
  useEffect(() => {
    const k = (x: KeyboardEvent) => { if (x.key === 'Escape') { x.preventDefault(); close(); } };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });
  const list = c.checklist ?? [];
  const doneN = list.filter((x) => x.done).length;
  const labels = new Set(c.labels ?? []);
  const toggleLabel = (l: string) => { const s = new Set(labels); if (s.has(l)) s.delete(l); else s.add(l); save({ labels: [...s] }); };
  const del = () => {
    const { id: _i, type: _t, ...f } = c as any;
    e.remove('bcard', id);
    onClose();
    toast({ text: `Slettet: ${c.title}`, action: { label: 'Fortryd', run: () => e.set('bcard', id, { ...f, _deleted: false }) } });
  };

  return createPortal(
    <div className="cmpwrap">
      <div className="scrim" onClick={close} />
      <div className="sheet csheet" role="dialog" aria-modal="true" aria-label={c.title}>
        <div className="cmp__top">
          <Btn variant="text" icon="trash" aria-label="Slet kort" onClick={del} />
          <h2 className="ellipsis">{lists.find((l) => l.id === c.list)?.name}</h2>
          <Btn variant="primary" onClick={close}>Færdig</Btn>
        </div>
        <div className="csheet__body">
          <div className="csheet__titlerow">
            <button className={`bc__check bc__check--big ${c.done ? 'is-on' : ''}`} aria-label={c.done ? 'Ikke færdig' : 'Færdig'} aria-pressed={!!c.done} onClick={() => save({ done: !c.done })}><Icon name="check" size="sm" /></button>
            <textarea className="csheet__title" value={title} rows={1} aria-label="Titel" onChange={(x) => setTitle(x.target.value)} onBlur={() => { if (title.trim() && title.trim() !== c.title) save({ title: title.trim().slice(0, 300) }); }}
              onKeyDown={(x) => { if (x.key === 'Enter') { x.preventDefault(); (x.target as HTMLTextAreaElement).blur(); } }} />
          </div>

          <div className="csheet__grid">
            <label className="csheet__field"><span>Liste</span>
              <select value={c.list} onChange={(x) => moveCard(e, id, x.target.value, 1e9)}>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            </label>
            <label className="csheet__field"><span>Frist</span>
              <span className="csheet__due">
                <input type="datetime-local" value={c.due ? localInput(c.due) : ''} onChange={(x) => save({ due: x.target.value ? new Date(x.target.value).toISOString() : null })} />
                {c.due && <button className="csheet__clear" aria-label="Fjern frist" onClick={() => save({ due: null })}><Icon name="x" size="sm" /></button>}
              </span>
            </label>
          </div>

          <div className="csheet__field"><span>Mærker</span>
            <div className="csheet__labels" role="group" aria-label="Mærker">
              {LABEL_COLORS.map(([l, hex]) => <button key={l} aria-pressed={labels.has(l)} aria-label={l} className={labels.has(l) ? 'is-on' : ''} style={{ background: hex }} onClick={() => toggleLabel(l)}>{labels.has(l) && <Icon name="check" size="sm" />}</button>)}
            </div>
          </div>

          <label className="csheet__field"><span>Beskrivelse</span>
            <textarea className="csheet__notes" value={notes} aria-label="Beskrivelse" onChange={(x) => setNotes(x.target.value)} onBlur={() => { if (notes !== (c.notes ?? '')) save({ notes: notes.slice(0, 20000) }); }} rows={4} />
          </label>

          <div className="csheet__field"><span>Tjekliste{list.length ? <b className="num"> {doneN}/{list.length}</b> : null}</span>
            {list.length > 0 && <div className="csheet__progress" aria-hidden="true"><span style={{ width: `${(doneN / list.length) * 100}%` }} /></div>}
            <ul className="csheet__checks">
              {list.map((x) => (
                <li key={x.id} className={x.done ? 'is-done' : ''}>
                  <button className={`bc__check ${x.done ? 'is-on' : ''}`} aria-pressed={x.done} aria-label={x.text} onClick={() => setChecklist(e, c, list.map((y) => (y.id === x.id ? { ...y, done: !y.done } : y)))}><Icon name="check" size="sm" /></button>
                  <span>{x.text}</span>
                  <button className="csheet__rm" aria-label={`Fjern ${x.text}`} onClick={() => setChecklist(e, c, list.filter((y) => y.id !== x.id))}><Icon name="x" size="sm" /></button>
                </li>
              ))}
            </ul>
            <form className="csheet__addcheck" onSubmit={(x) => { x.preventDefault(); addCheck(e, c, check); setCheck(''); }}>
              <input value={check} onChange={(x) => setCheck(x.target.value)} placeholder="Nyt punkt" aria-label="Nyt punkt på tjeklisten" enterKeyHint="done" />
              {check.trim() && <Btn size="sm" variant="text" type="submit">Tilføj</Btn>}
            </form>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

