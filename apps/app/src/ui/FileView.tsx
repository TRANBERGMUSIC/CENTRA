import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Btn } from './primitives.tsx';
import { Icon } from './Icon.tsx';
import { openLink } from '../open.ts';
import { prepareHtml } from './MailView.tsx';
import type { Deck, Item, Para, TextBox, Chart } from '../files/pptx.ts';
import type { Sheet } from '../files/sheet.ts';

/**
 * Files shown inside CENTRA, without saving them first: PDF, Word, PowerPoint, Excel, CSV, text,
 * pictures, video, sound, zip, and the first page of Keynote, Pages and Numbers. Everything is
 * read here; nothing in the file runs, and links go to the browser.
 */
export type ViewFile = { key: string; name: string; mime: string; size: number; load: () => Promise<Uint8Array> };

type Kind = 'image' | 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'csv' | 'text' | 'html' | 'video' | 'audio' | 'zip' | 'iwork' | 'none';
const extOf = (name: string) => (name.match(/\.([a-z0-9]{1,8})$/i)?.[1] ?? '').toLowerCase();
export function kindOf(name: string, mime: string): Kind {
  const x = extOf(name), m = mime.toLowerCase();
  if (/^(png|jpe?g|gif|webp|bmp|heic|heif|avif|svg)$/.test(x) || m.startsWith('image/')) return 'image';
  if (x === 'pdf' || m === 'application/pdf') return 'pdf';
  if (/^(docx|docm|dotx)$/.test(x) || m.includes('wordprocessingml')) return 'docx';
  if (/^(pptx|pptm|ppsx|potx)$/.test(x) || m.includes('presentationml')) return 'pptx';
  if (/^(xlsx|xlsm|xltx)$/.test(x) || m.includes('spreadsheetml')) return 'xlsx';
  if (/^(csv|tsv)$/.test(x) || m === 'text/csv') return 'csv';
  if (/^(html?|xhtml)$/.test(x) || m === 'text/html') return 'html';
  if (/^(txt|md|log|json|xml|ics|vcf|yml|yaml|ini|cfg|rtf|srt|vtt|eml)$/.test(x) || m.startsWith('text/') || m === 'application/json' || m === 'message/rfc822') return 'text';
  if (/^(mp4|m4v|mov|webm)$/.test(x) || m.startsWith('video/')) return 'video';
  if (/^(mp3|m4a|aac|wav|aiff?|flac|ogg|opus|caf)$/.test(x) || m.startsWith('audio/')) return 'audio';
  if (/^(key|pages|numbers)$/.test(x)) return 'iwork';
  if (x === 'zip' || m === 'application/zip' || m === 'application/x-zip-compressed') return 'zip';
  return 'none';
}
/** Can CENTRA show it itself? */
export const canView = (name: string, mime: string) => kindOf(name, mime) !== 'none';

const fmtSize = (n: number) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('da-DK', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1000))} kB`);
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', svg: 'image/svg+xml', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', aif: 'audio/aiff', aiff: 'audio/aiff', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg', caf: 'audio/x-caf' };
function useBlobUrl(data: Uint8Array | null, name: string, mime: string) {
  const url = useMemo(() => (data ? URL.createObjectURL(new Blob([data as BlobPart], { type: MIME[extOf(name)] ?? (mime || 'application/octet-stream') })) : null), [data, name, mime]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url;
}
const decode = (d: Uint8Array) => {
  const utf = new TextDecoder('utf-8', { fatal: true });
  try { return utf.decode(d); } catch { return new TextDecoder('windows-1252').decode(d); }
};
/** Links inside a document open in the browser; nothing navigates CENTRA itself. */
function catchLinks(ev: React.MouseEvent) {
  const a = (ev.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a) return;
  ev.preventDefault();
  const href = a.getAttribute('href') ?? '';
  if (/^(https?|mailto|tel):/i.test(href)) void openLink(href);
  else if (href.startsWith('#')) a.ownerDocument.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth' });
}

export function FileView({ files, at, onAt, onClose, onOpen, onSave, saveLabel = 'Gem', onQuickLook }: {
  files: ViewFile[]; at: number; onAt: (i: number) => void; onClose: () => void;
  onOpen?: (f: ViewFile) => void; onSave?: (f: ViewFile) => void; saveLabel?: string; onQuickLook?: (f: ViewFile) => void;
}) {
  const f = files[at];
  const kind = kindOf(f.name, f.mime);
  const [data, setData] = useState<Uint8Array | null>(null);
  const [err, setErr] = useState('');
  const shell = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    setData(null); setErr('');
    if (kind === 'none') return;
    f.load().then((d) => live && setData(d)).catch((x) => live && setErr((x as Error).message || 'Filen kunne ikke hentes'));
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.key]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    shell.current?.focus();
    const k = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { ev.preventDefault(); onClose(); }
      const typing = (ev.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]');
      if (typing) return;
      if (ev.key === 'ArrowRight' && at < files.length - 1 && !ev.metaKey) onAt(at + 1);
      if (ev.key === 'ArrowLeft' && at > 0 && !ev.metaKey) onAt(at - 1);
    };
    addEventListener('keydown', k, true);
    const app = document.querySelector<HTMLElement>('.app');
    if (app) app.inert = true;
    return () => { removeEventListener('keydown', k, true); if (app) app.inert = false; prev?.focus?.(); };
  }, [at, files.length, onAt, onClose]);

  return createPortal(
    <div className="fv" role="dialog" aria-modal="true" aria-label={f.name} ref={shell} tabIndex={-1}>
      <div className="fv__bar">
        <Btn size="sm" variant="text" icon="x" aria-label="Luk" onClick={onClose} />
        <div className="fv__title"><span className="ellipsis strong">{f.name}</span><span className="meta num">{fmtSize(f.size)}{files.length > 1 ? ` · ${at + 1} af ${files.length}` : ''}</span></div>
        <span className="push-right" />
        {files.length > 1 && <>
          <Btn size="sm" variant="text" icon="chevron-left" aria-label="Forrige" disabled={at === 0} onClick={() => onAt(at - 1)} />
          <Btn size="sm" variant="text" icon="chevron-right" aria-label="Næste" disabled={at === files.length - 1} onClick={() => onAt(at + 1)} />
        </>}
        {onOpen && <Btn size="sm" variant="text" onClick={() => onOpen(f)}>Åbn</Btn>}
        {onSave && <Btn size="sm" variant="text" icon="share" onClick={() => onSave(f)}>{saveLabel}</Btn>}
      </div>
      <div className={`fv__body fv__body--${kind}`} data-lenis-prevent onClick={catchLinks}>
        {err ? <Unshown f={f} text={err} onOpen={onOpen} onQuickLook={onQuickLook} />
          : kind === 'none' ? <Unshown f={f} onOpen={onOpen} onQuickLook={onQuickLook} />
          : !data ? <div className="fv__wait" aria-busy="true"><span className="fv__spin" /></div>
          : <Viewer key={f.key} kind={kind} f={f} data={data} onFail={(t) => setErr(t)} />}
      </div>
    </div>,
    document.body,
  );
}

function Unshown({ f, text, onOpen, onQuickLook }: { f: ViewFile; text?: string; onOpen?: (f: ViewFile) => void; onQuickLook?: (f: ViewFile) => void }) {
  return (
    <div className="fv__none">
      <span className="fv__icon">{extOf(f.name).toUpperCase().slice(0, 4) || 'FIL'}</span>
      <div className="strong">{f.name}</div>
      {text && <p className="meta">{text}</p>}
      <div className="fv__noneacts">
        {onQuickLook && <Btn onClick={() => onQuickLook(f)}>Quick Look</Btn>}
        {onOpen && <Btn variant="primary" onClick={() => onOpen(f)}>Åbn</Btn>}
      </div>
    </div>
  );
}

function Viewer({ kind, f, data, onFail }: { kind: Kind; f: ViewFile; data: Uint8Array; onFail: (t: string) => void }) {
  const url = useBlobUrl(kind === 'image' || kind === 'video' || kind === 'audio' ? data : null, f.name, f.mime);
  if (kind === 'image') return <div className="fv__img"><img src={url ?? ''} alt={f.name} onError={() => onFail('Billedet kan ikke vises her.')} /></div>;
  if (kind === 'video') return <div className="fv__media"><video src={url ?? ''} controls playsInline autoPlay={false} onError={() => onFail('Videoen kan ikke afspilles her.')} /></div>;
  if (kind === 'audio') return <div className="fv__media fv__media--audio"><span className="fv__icon">{extOf(f.name).toUpperCase() || 'LYD'}</span><audio src={url ?? ''} controls onError={() => onFail('Lyden kan ikke afspilles her.')} /></div>;
  if (kind === 'pdf') return <PdfView data={data} onFail={onFail} />;
  if (kind === 'docx') return <DocxView data={data} onFail={onFail} />;
  if (kind === 'pptx') return <PptxView data={data} onFail={onFail} />;
  if (kind === 'xlsx' || kind === 'csv') return <SheetView data={data} csv={kind === 'csv'} onFail={onFail} />;
  if (kind === 'html') return <HtmlView data={data} />;
  if (kind === 'zip' || kind === 'iwork') return <ZipView data={data} iwork={kind === 'iwork'} onFail={onFail} />;
  return <pre className="fv__text">{decode(data).slice(0, 2_000_000)}</pre>;
}

/* ---------------------------------------------------------------- PDF: pages drawn as they come into view */
function PdfView({ data, onFail }: { data: Uint8Array; onFail: (t: string) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<{ w: number; h: number }[]>([]);
  const doc = useRef<any>(null);
  useEffect(() => {
    let live = true, task: { destroy: () => Promise<void> } | null = null;
    import('../files/pdf.ts').then(({ openPdf }) => { const t = openPdf(data.slice()); task = t; return t.promise; }).then(async (pdf) => {
      if (!live) return;
      doc.current = pdf;
      const sizes: { w: number; h: number }[] = [];
      for (let i = 1; i <= Math.min(pdf.numPages, 500); i++) { const vp = (await pdf.getPage(i)).getViewport({ scale: 1 }); sizes.push({ w: vp.width, h: vp.height }); }
      if (live) setPages(sizes);
    }).catch((x) => live && onFail(/password/i.test(String(x?.name ?? x)) ? 'PDF’en er låst med en adgangskode.' : 'PDF’en kunne ikke vises.'));
    return () => { live = false; doc.current = null; void task?.destroy(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  return <div className="fv__pages" ref={wrap}>{pages.map((p, i) => <PdfPage key={i} doc={doc} n={i + 1} w={p.w} h={p.h} />)}</div>;
}

function PdfPage({ doc, n, w, h }: { doc: React.RefObject<any>; n: number; w: number; h: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const done = useRef(0);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    let task: any = null;
    const draw = async () => {
      const width = c.clientWidth;
      if (!width || Math.abs(done.current - width) < 2 || !doc.current) return;
      done.current = width;
      const page = await doc.current.getPage(n);
      const scale = (width / w) * Math.min(3, devicePixelRatio || 1);
      const vp = page.getViewport({ scale });
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      task?.cancel?.();
      task = page.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: vp });
      await task.promise.catch(() => {});
    };
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) void draw(); }, { rootMargin: '800px 0px' });
    io.observe(c);
    const ro = new ResizeObserver(() => { if (done.current) void draw(); });
    ro.observe(c);
    return () => { io.disconnect(); ro.disconnect(); task?.cancel?.(); };
  }, [doc, n, w]);
  return <canvas ref={canvas} className="fv__page" style={{ aspectRatio: `${w} / ${h}` }} aria-label={`Side ${n}`} />;
}

/* ---------------------------------------------------------------- Word */
function DocxView({ data, onFail }: { data: Uint8Array; onFail: (t: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const out = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = out.current;
    if (!el) return;
    let live = true;
    const fit = () => {
      const page = el.querySelector<HTMLElement>('section.docx');
      const room = (host.current?.clientWidth ?? 0) - 32;
      if (page && room > 0) el.style.zoom = String(Math.min(1.4, room / page.offsetWidth));
    };
    import('docx-preview').then(({ renderAsync }) => renderAsync(data.slice(), el, undefined, {
      className: 'docx', inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true, renderHeaders: true, renderFooters: true,
      renderFootnotes: true, renderEndnotes: true, useBase64URL: false, experimental: false, trimXmlDeclaration: true, renderComments: false,
    })).then(() => { if (live) fit(); }).catch(() => live && onFail('Dokumentet kunne ikke vises.'));
    const ro = new ResizeObserver(fit);
    if (host.current) ro.observe(host.current);
    return () => { live = false; ro.disconnect(); el.innerHTML = ''; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  return <div className="fv__docx" ref={host}><div ref={out} /></div>;
}

/* ---------------------------------------------------------------- PowerPoint */
function PptxView({ data, onFail }: { data: Uint8Array; onFail: (t: string) => void }) {
  const [deck, setDeck] = useState<Deck | null>(null);
  useEffect(() => {
    let live = true, made: Deck | null = null;
    import('../files/pptx.ts').then(({ readPptx }) => { made = readPptx(data); if (live) setDeck(made); else made.urls.forEach(URL.revokeObjectURL); })
      .catch(() => live && onFail('Præsentationen kunne ikke vises.'));
    return () => { live = false; made?.urls.forEach((u) => URL.revokeObjectURL(u)); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  if (!deck) return <div className="fv__wait" aria-busy="true"><span className="fv__spin" /></div>;
  const wpt = deck.w / 12700;
  return (
    <div className="fv__slides">
      {deck.slides.map((s, i) => (
        <figure key={i} className={`fv__slidewrap ${s.hidden ? 'is-hidden' : ''}`}>
          <div className="fv__slide" style={{ aspectRatio: `${deck.w} / ${deck.h}`, background: s.bg, backgroundImage: s.bgImg ? `url("${s.bgImg}")` : undefined }} aria-label={`Dias ${i + 1}`}>
            {s.items.map((it, j) => <SlideItem key={j} it={it} deck={deck} wpt={wpt} />)}
          </div>
          <figcaption className="meta num">{i + 1}</figcaption>
        </figure>
      ))}
    </div>
  );
}

const cq = (pt: number, wpt: number) => `${(pt / wpt) * 100}cqw`;
const fam = (f: string) => `${f ? `"${f.replace(/"/g, '')}", ` : ''}-apple-system, "Helvetica Neue", Arial, sans-serif`;

function SlideItem({ it, deck, wpt }: { it: Item; deck: Deck; wpt: number }) {
  const pos: React.CSSProperties = {
    left: `${(it.x / deck.w) * 100}%`, top: `${(it.y / deck.h) * 100}%`, width: `${(it.w / deck.w) * 100}%`, height: `${(it.h / deck.h) * 100}%`,
    transform: it.rot || it.flipH || it.flipV ? `rotate(${it.rot}deg) scale(${it.flipH ? -1 : 1}, ${it.flipV ? -1 : 1})` : undefined,
  };
  if (it.kind === 'pic') return <img className="fv__it" src={it.img} alt="" style={{ ...pos, objectFit: 'fill', borderRadius: it.round ? '50%' : undefined }} />;
  if (it.kind === 'chart') return <div className="fv__it" style={pos}><ChartSvg c={it.chart} w={it.w / 12700} h={it.h / 12700} /></div>;
  if (it.kind === 'table') {
    const total = it.cols.reduce((a, b) => a + b, 0) || 1;
    return (
      <div className="fv__it" style={{ ...pos, height: 'auto' }}>
        <table className="fv__tbl"><colgroup>{it.cols.map((c, i) => <col key={i} style={{ width: `${(c / total) * 100}%` }} />)}</colgroup>
          <tbody>{it.rows.map((r, ri) => <tr key={ri} style={{ height: cq(r.h / 12700, wpt) }}>{r.cells.map((c, ci) => c.hidden ? null : (
            <td key={ci} colSpan={c.span > 1 ? c.span : undefined} rowSpan={c.rowSpan > 1 ? c.rowSpan : undefined} style={{ background: c.fill || undefined, padding: c.text.inset.map((v) => cq(v, wpt)).join(' ') }}>
              <Paras paras={c.text.paras} wpt={wpt} /></td>))}</tr>)}</tbody></table>
      </div>
    );
  }
  if (it.geom === 'line') {
    const c = it.line?.color ?? 'currentColor';
    return <svg className="fv__it" style={{ ...pos, overflow: 'visible' }} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="0" x2="100" y2={it.h ? 100 : 0} stroke={c} vectorEffect="non-scaling-stroke" style={{ strokeWidth: cq(it.line?.w ?? 1, wpt) }} /></svg>;
  }
  const t = it.text;
  return (
    <div className="fv__it fv__shape" style={{
      ...pos, background: it.fill || undefined, backgroundImage: it.img ? `url("${it.img}")` : undefined,
      borderRadius: it.geom === 'ellipse' ? '50%' : it.geom === 'round' ? cq(Math.min(it.w, it.h) / 12700 * 0.17, wpt) : undefined,
      boxShadow: it.line ? `inset 0 0 0 ${cq(it.line.w, wpt)} ${it.line.color}` : undefined,
      justifyContent: t?.anchor, padding: t ? t.inset.map((v) => cq(v, wpt)).join(' ') : undefined,
      writingMode: t?.vertical ? 'vertical-rl' : undefined,
    }}>
      {t && <Paras paras={t.paras} wpt={wpt} />}
    </div>
  );
}

function Paras({ paras, wpt }: { paras: Para[]; wpt: number }) {
  return <>{paras.map((p, i) => (
    <p key={i} className="fv__p" style={{ textAlign: p.align, lineHeight: p.lineHeight, marginTop: i ? cq(p.before, wpt) : 0, marginBottom: cq(p.after, wpt), paddingLeft: cq(p.indent, wpt), fontSize: cq(p.size, wpt), color: p.color, fontFamily: fam(p.font) }}>
      {p.bullet && <span className="fv__bu" style={{ marginLeft: p.indent ? `-${cq(Math.min(p.indent, p.size), wpt)}` : undefined, width: cq(Math.min(p.indent, p.size) || p.size, wpt) }}>{p.bullet}</span>}
      {p.runs.length ? p.runs.map((r, j) => r.br ? <br key={j} /> : (
        <span key={j} style={{ fontSize: cq(r.size, wpt), fontWeight: r.bold ? 700 : undefined, fontStyle: r.italic ? 'italic' : undefined, textDecoration: [r.underline && 'underline', r.strike && 'line-through'].filter(Boolean).join(' ') || undefined, color: r.color, fontFamily: fam(r.font) }}>{r.text}</span>
      )) : ' '}
    </p>
  ))}</>;
}

function ChartSvg({ c, w, h }: { c: Chart; w: number; h: number }) {
  const fs = Math.max(7, Math.min(w, h) / 22);
  const legend = c.series.length > 1 && c.type !== 'pie';
  const top = c.title ? fs * 2.4 : fs, bottom = fs * (legend ? 4.4 : 2.6), left = fs * 3.4, right = fs;
  const all = c.series.flatMap((s) => s.vals);
  const max = Math.max(0, ...all), min = Math.min(0, ...all);
  const span = max - min || 1;
  const cats = c.cats.length ? c.cats : (c.series[0]?.vals ?? []).map((_, i) => String(i + 1));
  const pw = w - left - right, ph = h - top - bottom;
  const y = (v: number) => top + ph - ((v - min) / span) * ph;
  if (c.type === 'pie') {
    const s = c.series[0];
    const sum = s.vals.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const r = Math.min(pw, ph) / 2, cx = left + pw / 2, cy = top + ph / 2;
    let a0 = -Math.PI / 2;
    const COLORS = ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'];
    return <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" role="img" aria-label={c.title || 'Diagram'}>
      {c.title && <text x={w / 2} y={fs * 1.6} textAnchor="middle" fontSize={fs * 1.2} fontWeight={600} fill="currentColor">{c.title}</text>}
      {s.vals.map((v, i) => { const a1 = a0 + (Math.max(0, v) / sum) * Math.PI * 2; const large = a1 - a0 > Math.PI ? 1 : 0;
        const d = `M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z`; a0 = a1;
        return <path key={i} d={d} fill={COLORS[i % COLORS.length]} stroke="#fff" strokeWidth={fs / 8}><title>{`${cats[i] ?? ''}: ${v.toLocaleString('da-DK')}`}</title></path>; })}
    </svg>;
  }
  const n = cats.length || 1;
  const band = (c.type === 'bar' ? ph : pw) / n;
  const ticks = 4;
  return <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" role="img" aria-label={c.title || 'Diagram'} style={{ color: '#404040' }}>
    {c.title && <text x={w / 2} y={fs * 1.6} textAnchor="middle" fontSize={fs * 1.2} fontWeight={600} fill="currentColor">{c.title}</text>}
    {c.type !== 'bar' && Array.from({ length: ticks + 1 }, (_, i) => { const v = min + (span * i) / ticks; return <g key={i}><line x1={left} x2={w - right} y1={y(v)} y2={y(v)} stroke="#d9d9d9" strokeWidth={fs / 14} /><text x={left - fs / 2} y={y(v) + fs / 3} textAnchor="end" fontSize={fs} fill="currentColor">{Math.round(v).toLocaleString('da-DK')}</text></g>; })}
    {cats.map((cat, i) => c.type === 'bar'
      ? <text key={i} x={left - fs / 2} y={top + band * (i + 0.5) + fs / 3} textAnchor="end" fontSize={fs} fill="currentColor">{cat}</text>
      : <text key={i} x={left + band * (i + 0.5)} y={h - bottom + fs * 1.4} textAnchor="middle" fontSize={fs} fill="currentColor">{cat}</text>)}
    {c.series.map((s, si) => {
      if (c.type === 'line' || c.type === 'area') {
        const pts = s.vals.map((v, i) => `${left + band * (i + 0.5)},${y(v)}`).join(' ');
        return c.type === 'area' ? <polygon key={si} points={`${left + band * 0.5},${y(min)} ${pts} ${left + band * (s.vals.length - 0.5)},${y(min)}`} fill={s.color} opacity={0.75} /> : <polyline key={si} points={pts} fill="none" stroke={s.color} strokeWidth={fs / 4} strokeLinejoin="round" />;
      }
      const k = c.series.length, bw = (band * 0.7) / k;
      return s.vals.map((v, i) => c.type === 'bar'
        ? <rect key={`${si}-${i}`} x={left + ((Math.min(v, 0) - min) / span) * pw} y={top + band * i + band * 0.15 + bw * si} width={(Math.abs(v) / span) * pw} height={bw} fill={s.color} />
        : <rect key={`${si}-${i}`} x={left + band * i + band * 0.15 + bw * si} y={y(Math.max(v, 0))} width={bw} height={Math.abs(y(v) - y(0))} fill={s.color} />);
    })}
    {legend && c.series.map((s, si) => <g key={`l${si}`} transform={`translate(${left + si * (pw / c.series.length)}, ${h - fs * 0.6})`}><rect width={fs * 0.8} height={fs * 0.8} y={-fs * 0.7} fill={s.color} /><text x={fs * 1.1} fontSize={fs} fill="currentColor">{s.name}</text></g>)}
  </svg>;
}

/* ---------------------------------------------------------------- Excel and CSV */
function SheetView({ data, csv, onFail }: { data: Uint8Array; csv: boolean; onFail: (t: string) => void }) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [tab, setTab] = useState(0);
  useEffect(() => {
    let live = true;
    import('../files/sheet.ts').then((m) => { const s = csv ? [m.readCsv(decode(data))] : m.readXlsx(data); if (live) setSheets(s); })
      .catch(() => live && onFail('Regnearket kunne ikke vises.'));
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, csv]);
  const [colName, setColName] = useState<((i: number) => string) | null>(null);
  useEffect(() => { void import('../files/sheet.ts').then((m) => setColName(() => m.colName)); }, []);
  if (!sheets || !colName) return <div className="fv__wait" aria-busy="true"><span className="fv__spin" /></div>;
  const s = sheets[tab] ?? sheets[0];
  const cols = Math.max(0, ...s.rows.map((r) => r.length));
  return (
    <div className="fv__sheet">
      {sheets.length > 1 && <div className="segmented fv__tabs" role="tablist" aria-label="Ark">{sheets.map((x, i) => <button key={i} role="tab" aria-selected={i === tab} className={i === tab ? 'is-active' : ''} onClick={() => setTab(i)}>{x.name}</button>)}</div>}
      <div className="fv__grid">
        {s.rows.length ? (
          <table>
            <thead><tr><th className="fv__corner" />{Array.from({ length: cols }, (_, i) => <th key={i} style={{ minWidth: s.widths[i] ? `${Math.min(400, s.widths[i])}px` : undefined }}>{colName(i)}</th>)}</tr></thead>
            <tbody>{s.rows.map((r, ri) => <tr key={ri}><th>{ri + 1}</th>{r.map((v, ci) => <td key={ci} className={/^-?[\d.,\s]+%?$/.test(v) && v.trim() ? 'is-num' : ''}>{v}</td>)}</tr>)}</tbody>
          </table>
        ) : <p className="meta pad">Arket er tomt.</p>}
      </div>
      {s.cut && <p className="meta fv__cut">Viser de første 2.000 rækker.</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- HTML, zip, iWork */
function HtmlView({ data }: { data: Uint8Array }) {
  const page = useMemo(() => prepareHtml(decode(data), { remote: false }).page, [data]);
  return <iframe className="fv__html" title="Dokument" sandbox="" srcDoc={page} />;
}

function ZipView({ data, iwork, onFail }: { data: Uint8Array; iwork: boolean; onFail: (t: string) => void }) {
  const [list, setList] = useState<{ name: string; size: number }[] | null>(null);
  const [pic, setPic] = useState<string | null>(null);
  useEffect(() => {
    let live = true; const urls: string[] = [];
    import('../files/zip.ts').then((z) => {
      if (iwork) { const u = z.iworkPreview(z.unzip(data), urls); if (!live) return; if (u) setPic(u); else onFail('Filen kan ikke vises her.'); }
      else if (live) setList(z.listing(data));
    }).catch(() => live && onFail(iwork ? 'Filen kan ikke vises her.' : 'Zip-filen kunne ikke læses.'));
    return () => { live = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, iwork]);
  if (iwork) return pic ? <div className="fv__img"><img src={pic} alt="Første side" /></div> : <div className="fv__wait" aria-busy="true"><span className="fv__spin" /></div>;
  if (!list) return <div className="fv__wait" aria-busy="true"><span className="fv__spin" /></div>;
  return (
    <ul className="fv__zip" aria-label="Indhold">
      {list.slice(0, 2000).map((x) => <li key={x.name}><Icon name={x.name.includes('/') ? 'folder' : 'paperclip'} size="sm" /><span className="ellipsis">{x.name}</span><span className="meta num">{fmtSize(x.size)}</span></li>)}
    </ul>
  );
}
