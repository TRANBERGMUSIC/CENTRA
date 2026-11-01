/**
 * The little markdown Assist writes: paragraphs, "- " and "1. " lists, **fed**, *kursiv*, `kode`,
 * [links](https://…) and bare web addresses. Built as React elements (never HTML strings), so nothing
 * in an answer can run as code. Links open in CENTRA's browser.
 */
import type { ReactNode } from 'react';
import { openLink } from '../open.ts';

const INLINE = /(\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|`([^`\n]+)`|(?<![\w*])\*([^*\n]+?)\*(?!\w)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]))/g;

function Link({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} onClick={(x) => { x.preventDefault(); void openLink(href); }}>{children}</a>;
}

export function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, n = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[2] ?? m[3]) out.push(<strong key={k}>{inline(m[2] ?? m[3], k)}</strong>);
    else if (m[4]) out.push(<Link key={k} href={m[5]}>{inline(m[4], k)}</Link>);
    else if (m[6]) out.push(<code key={k}>{m[6]}</code>);
    else if (m[7]) out.push(<em key={k}>{inline(m[7], k)}</em>);
    else if (m[8]) out.push(<Link key={k} href={m[8]}>{m[8].replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}</Link>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block = { kind: 'p' | 'ul' | 'ol' | 'h'; lines: string[] };

export function blocks(src: string): Block[] {
  const out: Block[] = [];
  let cur: Block | null = null;
  for (const raw of String(src ?? '').replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const h = /^\s*#{1,4}\s+(.*)$/.exec(line);
    if (!line.trim()) { cur = null; continue; }
    if (h) { out.push({ kind: 'h', lines: [h[1]] }); cur = null; continue; }
    const kind = ul ? 'ul' : ol ? 'ol' : 'p';
    const text = ul ? ul[1] : ol ? ol[1] : line.trim();
    // A line that continues a list item (indented, not a new bullet) belongs to it.
    if (cur && cur.kind !== 'p' && kind === 'p' && /^\s{2,}/.test(raw)) { cur.lines[cur.lines.length - 1] += ' ' + text; continue; }
    if (!cur || cur.kind !== kind) { cur = { kind, lines: [] }; out.push(cur); }
    cur.lines.push(text);
  }
  return out;
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`md ${className}`}>
      {blocks(text).map((b, i) => {
        const k = `b${i}`;
        if (b.kind === 'h') return <p key={k} className="md__h">{inline(b.lines[0], k)}</p>;
        if (b.kind === 'ul') return <ul key={k}>{b.lines.map((l, j) => <li key={j}>{inline(l, `${k}-${j}`)}</li>)}</ul>;
        if (b.kind === 'ol') return <ol key={k}>{b.lines.map((l, j) => <li key={j}>{inline(l, `${k}-${j}`)}</li>)}</ol>;
        return <p key={k}>{b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l, `${k}-${j}`)}</span>)}</p>;
      })}
    </div>
  );
}
