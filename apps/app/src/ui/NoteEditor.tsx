/**
 * The note editor. What you write is stored as plain text with Markdown, in the same Yjs text as
 * before (so sync, search, Assist and older notes all keep working), and shown formatted while you
 * write, like Bear or Obsidian:
 *
 *   **fed**  *kursiv*  ++understreget++  ~~gennemstreget~~  # Overskrift
 *   - punkt   * punkt   1. nummer   - [ ] tjekpunkt   (Enter fortsætter listen)
 *
 * The markers are hidden except where the cursor is, bullets become •, and a task's [ ] becomes a
 * box you tap to tick off. Typing "[] " at the start of a line starts a checklist.
 */
import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { EditorSelection, EditorState, Prec, type Extension } from '@codemirror/state';
import { Decoration, EditorView, MatchDecorator, ViewPlugin, WidgetType, keymap, placeholder, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import type { MarkdownConfig } from '@lezer/markdown';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { Icon } from './Icon.tsx';

/* ---------------------------------------------------------------- ++underline++ (not in Markdown itself) */
const Punct = /[!-/:-@[-`{-~¡-¿‐-‧‰-⁞]/;
const UnderlineDelim = { resolve: 'Underline', mark: 'UnderlineMark' };
const Underline: MarkdownConfig = {
  defineNodes: [{ name: 'Underline' }, { name: 'UnderlineMark' }],
  parseInline: [{
    name: 'Underline',
    parse(cx, next, pos) {
      if (next !== 43 || cx.char(pos + 1) !== 43 || cx.char(pos + 2) === 43) return -1;
      const before = cx.slice(pos - 1, pos), after = cx.slice(pos + 2, pos + 3);
      const sB = /\s|^$/.test(before), sA = /\s|^$/.test(after), pB = Punct.test(before), pA = Punct.test(after);
      return cx.addDelimiter(UnderlineDelim, pos, pos + 2, !sA && (!pA || sB || pB), !sB && (!pB || sA || pA));
    },
    after: 'Emphasis',
  }],
};

/* ---------------------------------------------------------------- showing it formatted */
class Bullet extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement('span'); s.className = 'cm-bullet'; s.textContent = '•'; return s; }
}
class Check extends WidgetType {
  constructor(readonly on: boolean, readonly at: number) { super(); }
  eq(o: Check) { return o.on === this.on && o.at === this.at; }
  toDOM(view: EditorView) {
    const b = document.createElement('span');
    b.className = 'cm-check' + (this.on ? ' is-on' : '');
    b.setAttribute('role', 'checkbox');
    b.setAttribute('aria-checked', String(this.on));
    b.setAttribute('aria-label', this.on ? 'Udført' : 'Ikke udført');
    // Tap to tick off: change the character inside the brackets, keep the caret where it was.
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({ changes: { from: this.at + 1, to: this.at + 2, insert: this.on ? ' ' : 'x' }, userEvent: 'input.check' });
    });
    return b;
  }
  ignoreEvent() { return true; }
}

const INLINE: Record<string, string> = { StrongEmphasis: 'cm-b', Emphasis: 'cm-i', Strikethrough: 'cm-s', Underline: 'cm-u', InlineCode: 'cm-code' };
const MARKS = new Set(['EmphasisMark', 'StrikethroughMark', 'UnderlineMark', 'CodeMark', 'HeaderMark']);
const HIDE = Decoration.replace({});

function decorate(view: EditorView): DecorationSet {
  const { state } = view;
  const near = (from: number, to: number) => state.selection.ranges.some((r) => r.from <= to && r.to >= from);
  const out: ReturnType<Decoration['range']>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter: (n) => {
        const name = n.name;
        if (INLINE[name]) out.push(Decoration.mark({ class: INLINE[name] }).range(n.from, n.to));
        else if (/^ATXHeading\d$/.test(name)) out.push(Decoration.line({ class: 'cm-h' + Math.min(3, Number(name.slice(-1))) }).range(state.doc.lineAt(n.from).from));
        else if (MARKS.has(name)) {
          const p = n.node.parent;
          const line = state.doc.lineAt(n.from);
          // Headings show their # while the cursor is on the line; inline marks while it touches the word.
          const show = name === 'HeaderMark' ? near(line.from, line.to) : near(p?.from ?? n.from, p?.to ?? n.to);
          if (show) out.push(Decoration.mark({ class: 'cm-mark' }).range(n.from, n.to));
          else if (n.to > n.from) out.push(HIDE.range(n.from, name === 'HeaderMark' && state.sliceDoc(n.to, n.to + 1) === ' ' ? n.to + 1 : n.to));
        } else if (name === 'ListMark') {
          const task = n.node.parent?.getChild('Task');
          const text = state.sliceDoc(n.from, n.to);
          if (task) out.push(HIDE.range(n.from, task.from));
          else if (/^[-*+]$/.test(text)) out.push(Decoration.replace({ widget: new Bullet() }).range(n.from, n.to));
          else out.push(Decoration.mark({ class: 'cm-num' }).range(n.from, n.to));
        } else if (name === 'TaskMarker') {
          const on = /x/i.test(state.sliceDoc(n.from, n.to));
          out.push(Decoration.replace({ widget: new Check(on, n.from) }).range(n.from, n.to));
          if (on) out.push(Decoration.line({ class: 'cm-done' }).range(state.doc.lineAt(n.from).from));
        } else if (name === 'ListItem') {
          out.push(Decoration.line({ class: 'cm-li' }).range(state.doc.lineAt(n.from).from));
        }
      },
    });
  }
  return Decoration.set(out, true);
}

const live = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  /** Hidden signs, bullets and boxes: the caret steps over them as one character. */
  atomic: DecorationSet;
  constructor(view: EditorView) { this.decorations = decorate(view); this.atomic = this.hidden(); }
  update(u: ViewUpdate) {
    if (u.docChanged || u.selectionSet || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) { this.decorations = decorate(u.view); this.atomic = this.hidden(); }
  }
  hidden() { return this.decorations.update({ filter: (_f, _t, d) => !d.spec.class }); }
}, {
  decorations: (v) => v.decorations,
  provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.atomic ?? Decoration.none),
});

/** [[Another note]] links look like links. */
const wiki = new MatchDecorator({ regexp: /\[\[[^\]\n]{1,120}\]\]/g, decoration: Decoration.mark({ class: 'cm-wiki' }) });
const wikiLinks = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = wiki.createDeco(view); }
  update(u: ViewUpdate) { this.decorations = wiki.updateDeco(u, this.decorations); }
}, { decorations: (v) => v.decorations });

/* ---------------------------------------------------------------- formatting commands */
type Cmd = (view: EditorView) => boolean;

/** Bold, italic, underline, strikethrough: wraps the selection, or unwraps it if it already is. */
export const wrap = (m: string): Cmd => (view) => {
  const { state } = view;
  view.dispatch(state.update(state.changeByRange((r) => {
    const before = state.sliceDoc(r.from - m.length, r.from), after = state.sliceDoc(r.to, r.to + m.length);
    if (r.empty) {
      // "**|**" (nothing typed yet): take the pair away again.
      if (before === m && after === m) return { changes: { from: r.from - m.length, to: r.to + m.length }, range: EditorSelection.cursor(r.from - m.length) };
      // At the end of bold text: step out of it, so what you type next is plain again.
      if (after === m) return { range: EditorSelection.cursor(r.to + m.length) };
    }
    if (before === m && after === m) return { changes: [{ from: r.from - m.length, to: r.from }, { from: r.to, to: r.to + m.length }], range: EditorSelection.range(r.from - m.length, r.to - m.length) };
    const inner = state.sliceDoc(r.from, r.to);
    if (inner.length > 2 * m.length && inner.startsWith(m) && inner.endsWith(m)) return { changes: { from: r.from, to: r.to, insert: inner.slice(m.length, -m.length) }, range: EditorSelection.range(r.from, r.to - 2 * m.length) };
    return { changes: [{ from: r.from, insert: m }, { from: r.to, insert: m }], range: EditorSelection.range(r.from + m.length, r.to + m.length) };
  }), { userEvent: 'input.format', scrollIntoView: true }));
  view.focus();
  return true;
};

type LineKind = 'bullet' | 'number' | 'check' | 'h1' | 'h2' | 'text';
const PREFIX = /^(\s*)([-*+] \[[ xX]\] |[-*+] |\d+[.)] |#{1,6} )?/;
const kindOf = (t: string): LineKind => (/^\s*[-*+] \[[ xX]\] /.test(t) ? 'check' : /^\s*[-*+] /.test(t) ? 'bullet' : /^\s*\d+[.)] /.test(t) ? 'number' : /^\s*# /.test(t) ? 'h1' : /^\s*#{2,6} /.test(t) ? 'h2' : 'text');

/** Turns the selected lines into a list, checklist or heading, or back into text if they already are. */
export const lines = (kind: LineKind): Cmd => (view) => {
  const { state } = view;
  const nums = new Set<number>();
  for (const r of state.selection.ranges) for (let l = state.doc.lineAt(r.from).number; l <= state.doc.lineAt(r.to).number; l++) nums.add(l);
  const sorted = [...nums].sort((a, b) => a - b);
  const off = sorted.every((n) => kindOf(state.doc.line(n).text) === kind);
  const changes = sorted.map((n, i) => {
    const line = state.doc.line(n);
    const m = PREFIX.exec(line.text)!;
    const pre = off ? '' : { bullet: '- ', number: `${i + 1}. `, check: '- [ ] ', h1: '# ', h2: '## ', text: '' }[kind];
    return { from: line.from + m[1].length, to: line.from + m[1].length + (m[2]?.length ?? 0), insert: pre };
  });
  view.dispatch({ changes, userEvent: 'input.format', scrollIntoView: true });
  view.focus();
  return true;
};

/** "[] " or "- [] " at the start of a line becomes a checkbox. */
const checklistShortcut = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== ' ' || from !== to) return false;
  const line = view.state.doc.lineAt(from);
  const before = view.state.sliceDoc(line.from, from);
  const m = /^(\s*)(?:[-*] )?\[\]$/.exec(before);
  if (!m) return false;
  view.dispatch({ changes: { from: line.from + m[1].length, to, insert: '- [ ] ' }, selection: { anchor: line.from + m[1].length + 6 }, userEvent: 'input.format' });
  return true;
});

const shortcuts = Prec.high(keymap.of([
  { key: 'Mod-b', run: wrap('**') }, { key: 'Mod-i', run: wrap('*') }, { key: 'Mod-u', run: wrap('++') }, { key: 'Mod-Shift-x', run: wrap('~~') },
  { key: 'Mod-Shift-l', run: lines('check') }, { key: 'Mod-Shift-8', run: lines('bullet') }, { key: 'Mod-Shift-7', run: lines('number') },
]));

/** Which formats apply where the cursor is (lights up the toolbar buttons). */
function activeAt(state: EditorState): Set<string> {
  const on = new Set<string>();
  const pos = state.selection.main.head;
  for (let n: any = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (n.name === 'StrongEmphasis') on.add('b');
    if (n.name === 'Emphasis') on.add('i');
    if (n.name === 'Underline') on.add('u');
    if (n.name === 'Strikethrough') on.add('s');
  }
  on.add(kindOf(state.doc.lineAt(pos).text));
  return on;
}

/* ---------------------------------------------------------------- the component */
export function NoteEditor({ text, placeholderText, onLocalEdit }: { text: Y.Text; placeholderText: string; onLocalEdit?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [active, setActive] = useState<Set<string>>(new Set());
  const edit = useRef(onLocalEdit); edit.current = onLocalEdit;

  useEffect(() => {
    const extensions: Extension[] = [
      markdown({ base: markdownLanguage, extensions: [Underline] }),
      live, wikiLinks, checklistShortcut, shortcuts,
      keymap.of([...markdownKeymap, ...yUndoManagerKeymap, ...defaultKeymap, indentWithTab]),
      yCollab(text, null),
      EditorView.lineWrapping,
      placeholder(placeholderText),
      EditorView.contentAttributes.of({ 'aria-label': 'Indhold', autocapitalize: 'sentences', spellcheck: 'true' }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && u.transactions.some((t) => t.isUserEvent('input') || t.isUserEvent('delete') || t.isUserEvent('undo') || t.isUserEvent('redo') || t.isUserEvent('move'))) edit.current?.();
        if (u.docChanged || u.selectionSet) {
          const next = activeAt(u.state);
          setActive((cur) => (cur.size === next.size && [...next].every((x) => cur.has(x)) ? cur : next));
        }
      }),
    ];
    const view = new EditorView({ parent: host.current!, state: EditorState.create({ doc: text.toString(), extensions }) });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, [text, placeholderText]);

  const run = (cmd: Cmd) => (e: React.MouseEvent) => { e.preventDefault(); if (viewRef.current) cmd(viewRef.current); };
  const B = ({ k, label, cmd, children }: { k: string; label: string; cmd: Cmd; children: React.ReactNode }) => (
    <button type="button" className={`ntool ${active.has(k) ? 'is-on' : ''}`} aria-label={label} aria-pressed={active.has(k)} title={label} onMouseDown={run(cmd)}>{children}</button>
  );
  return (
    <div className="noteeditor">
      <div className="ntoolbar" role="toolbar" aria-label="Formatering">
        <B k="h1" label="Overskrift" cmd={lines('h1')}><span className="ntool__t">Aa</span></B>
        <B k="b" label="Fed (⌘B)" cmd={wrap('**')}><b>B</b></B>
        <B k="i" label="Kursiv (⌘I)" cmd={wrap('*')}><i>I</i></B>
        <B k="u" label="Understreget (⌘U)" cmd={wrap('++')}><u>U</u></B>
        <B k="s" label="Gennemstreget" cmd={wrap('~~')}><s>S</s></B>
        <span className="ntool__sep" aria-hidden="true" />
        <B k="bullet" label="Punktliste" cmd={lines('bullet')}><span className="ntool__t">•≡</span></B>
        <B k="number" label="Nummereret liste" cmd={lines('number')}><span className="ntool__t">1.</span></B>
        <B k="check" label="Tjekliste (⇧⌘L)" cmd={lines('check')}><Icon name="check" size="sm" /></B>
      </div>
      <div ref={host} className="doc__body cmhost" />
    </div>
  );
}
