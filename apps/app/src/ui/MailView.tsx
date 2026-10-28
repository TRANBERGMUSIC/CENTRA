import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SyncEngine } from '@centra/sync';
import { Btn } from './primitives.tsx';
import { Icon } from './Icon.tsx';
import { useToast } from './Shell.tsx';
import { mailBody, mailPart, openMailPart, mailAvailable, type Body, type Part } from '../mail.ts';
import { openExternal } from '../open.ts';

/**
 * A mail shown the way it was sent: its own HTML (layout, colours, pictures) in a sandboxed frame
 * where no script can run and nothing can reach CENTRA, its inline pictures filled in, and its
 * attachments as tiles you can look at, open or save.
 */

const MAIL_SETTING = 'setting-mail';
export const remoteImagesOn = (e: SyncEngine) => (e.get(MAIL_SETTING) as { remoteImages?: boolean } | null)?.remoteImages !== false;
export const setRemoteImages = (e: SyncEngine, on: boolean) => e.set('setting', MAIL_SETTING, { remoteImages: on });

const DROP = 'script, iframe, frame, frameset, object, embed, applet, form, input, button, select, textarea, meta[http-equiv], base, link, portal, noscript';
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Makes a mail's HTML safe to show and returns it as a full document, plus what it refers to. */
export function prepareHtml(html: string, opts: { remote: boolean }) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll(DROP).forEach((n) => n.remove());
  const cids = new Set<string>();
  let blocked = 0;
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase(), v = a.value.trim();
      if (n.startsWith('on') || n === 'srcset' || n === 'formaction' || n === 'ping') el.removeAttribute(a.name);
      else if ((n === 'href' || n === 'src' || n === 'background' || n === 'action' || n === 'xlink:href') && /^\s*(javascript|vbscript|file):/i.test(v)) el.removeAttribute(a.name);
    }
    if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noreferrer noopener'); }
    if (el.tagName === 'IMG') {
      const src = el.getAttribute('src') ?? '';
      const w = el.getAttribute('width'), h = el.getAttribute('height');
      if (/^cid:/i.test(src)) { const id = src.slice(4).replace(/^<|>$/g, ''); cids.add(id); el.setAttribute('data-cid', id); el.setAttribute('src', BLANK); }
      else if (w === '1' && h === '1') el.remove(); // tracking pixels
      else if (/^https?:/i.test(src) && !opts.remote) { el.setAttribute('data-src', src); el.setAttribute('src', BLANK); blocked++; }
    }
    // Background images in style="" from remote servers follow the same choice.
    const st = el.getAttribute('style');
    if (st && !opts.remote && /url\(\s*['"]?https?:/i.test(st)) { el.setAttribute('style', st.replace(/url\([^)]*\)/gi, 'none')); blocked++; }
  }
  const styles = Array.from(doc.querySelectorAll('style')).map((s) => s.outerHTML).join('');
  doc.querySelectorAll('style').forEach((s) => s.remove());
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>
    html,body{margin:0;background:#fff;}
    body{padding:24px 28px;font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;color:#1d1d1f;overflow-wrap:anywhere;}
    img{max-width:100%;height:auto;} table{max-width:100% !important;} pre{white-space:pre-wrap;}
    a{color:#0066cc;} blockquote{margin:0 0 0 8px;padding-left:12px;border-left:3px solid #d2d2d7;color:#424245;}
  </style>${styles}</head><body${bodyAttrs(doc.body)}>${doc.body?.innerHTML ?? ''}</body></html>`;
  return { page, cids, blocked };
}

/** The mail's own <body> look (background colour, style, alignment) kept on our body. */
function bodyAttrs(b: HTMLElement | null) {
  if (!b) return '';
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return ['style', 'bgcolor', 'text', 'link', 'class', 'align'].filter((a) => b.hasAttribute(a)).map((a) => ` ${a}="${esc(b.getAttribute(a)!)}"`).join('');
}

const fmtSize = (n: number) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('da-DK', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1000))} kB`);
const kindOf = (p: Part) => (p.mime.startsWith('image/') ? 'image' : p.mime === 'application/pdf' || /\.pdf$/i.test(p.name) ? 'pdf' : /calendar|\.ics$/i.test(p.mime + p.name) ? 'cal' : 'file');
const EXT = (p: Part) => (p.name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? p.mime.split('/')[1] ?? '').toUpperCase().slice(0, 4);

export function MailView({ e, m }: { e: SyncEngine; m: any }) {
  const toast = useToast();
  const [body, setBody] = useState<Body | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [remote, setRemote] = useState(() => remoteImagesOn(e));
  const [view, setView] = useState<number | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let live = true;
    setBody(null); setErr(null);
    mailBody(e, m).then((b) => live && setBody(b)).catch((x) => { if (live) { setErr((x as Error).message); setBody({ text: m.body ?? '', html: '', parts: m.parts ?? [] }); } });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id]);

  const prepared = useMemo(() => (body?.html ? prepareHtml(body.html, { remote }) : null), [body?.html, remote]);
  const parts = body?.parts ?? m.parts ?? [];
  const shown = parts.filter((p: Part) => !(p.cid && prepared?.cids.has(p.cid)));

  // Size the frame to its content, fill in cid: pictures, send links to the browser.
  function onLoad() {
    const f = frame.current, d = f?.contentDocument;
    if (!f || !d) return;
    const fit = () => { f.style.height = `${Math.max(120, d.documentElement.scrollHeight)}px`; };
    fit();
    new ResizeObserver(fit).observe(d.body);
    d.querySelectorAll('img').forEach((img) => img.addEventListener('load', fit));
    d.addEventListener('click', (ev) => {
      const a = (ev.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a) return;
      ev.preventDefault();
      const href = a.getAttribute('href') ?? '';
      if (/^(https?|mailto|tel|sms):/i.test(href)) void openExternal(href);
    });
    if (mailAvailable()) {
      d.querySelectorAll<HTMLImageElement>('img[data-cid]').forEach((img) => {
        const p = parts.find((x: Part) => x.cid === img.dataset.cid);
        if (p) void mailPart(e, m, p.index).then((url) => { img.src = url; }).catch(() => {});
      });
    }
  }

  async function act(p: Part, save: boolean) {
    try {
      const path = await openMailPart(e, m, p.index, save);
      if (save) toast({ icon: 'paperclip', title: 'Gemt i Overførsler', text: path.split('/').pop() ?? p.name });
    } catch (x) { toast({ text: (x as Error).message }); }
  }

  const images = shown.filter((p: Part) => kindOf(p) === 'image');
  return (
    <>
      {prepared && prepared.blocked > 0 && !remote && (
        <div className="mailbar"><Icon name="sun" size="sm" /><span>Billeder fra internettet er skjult i denne mail.</span>
          <Btn size="sm" variant="text" onClick={() => setRemote(true)}>Vis billeder</Btn>
          <Btn size="sm" variant="text" onClick={() => { setRemoteImages(e, true); setRemote(true); }}>Vis altid</Btn></div>
      )}
      {!body ? <div className="mailpaper mailpaper--loading" aria-busy="true"><span className="meta">Henter mailen …</span></div>
        : prepared ? <iframe ref={frame} className="mailframe" title={m.subject} sandbox="allow-same-origin" srcDoc={prepared.page} onLoad={onLoad} />
          : <div className="mailtext mailtext--plain">{linkify(body.text || m.body || m.preview || '')}</div>}
      {err && !body?.html && <p className="meta small">Viser tekstudgaven: {err}</p>}
      {shown.length > 0 && (
        <div className="atts">
          <div className="atts__head meta">{shown.length} {shown.length === 1 ? 'vedhæftning' : 'vedhæftninger'}</div>
          <div className="atts__grid">
            {shown.map((p: Part) => <Tile key={p.index} e={e} m={m} p={p} onView={() => setView(images.indexOf(p))} onOpen={() => void act(p, false)} onSave={() => void act(p, true)} />)}
          </div>
        </div>
      )}
      {view !== null && images[view] && <Lightbox e={e} m={m} parts={images} at={view} onAt={setView} onClose={() => setView(null)} onSave={(p) => void act(p, true)} onOpen={(p) => void act(p, false)} />}
    </>
  );
}

function Tile({ e, m, p, onView, onOpen, onSave }: { e: SyncEngine; m: any; p: Part; onView: () => void; onOpen: () => void; onSave: () => void }) {
  const kind = kindOf(p);
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    if (kind !== 'image' || !mailAvailable() || p.size > 15e6) return;
    let live = true;
    void mailPart(e, m, p.index).then((u) => live && setThumb(u)).catch(() => {});
    return () => { live = false; };
  }, [e, m, p.index, p.size, kind]);
  return (
    <div className={`att att--${kind}`}>
      <button className="att__face" onClick={kind === 'image' ? onView : onOpen} title={kind === 'image' ? 'Vis' : 'Åbn'} disabled={!mailAvailable()}>
        {kind === 'image' ? (thumb ? <img src={thumb} alt="" /> : <span className="att__ph" />) : <span className="att__icon"><span>{EXT(p) || 'FIL'}</span></span>}
      </button>
      <div className="att__meta"><span className="ellipsis" title={p.name}>{p.name}</span><span className="meta">{fmtSize(p.size)}</span></div>
      {mailAvailable() && <div className="att__acts"><Btn size="sm" variant="text" onClick={onOpen}>Åbn</Btn><Btn size="sm" variant="text" onClick={onSave}>Gem</Btn></div>}
    </div>
  );
}

function Lightbox({ e, m, parts, at, onAt, onClose, onSave, onOpen }: { e: SyncEngine; m: any; parts: Part[]; at: number; onAt: (n: number) => void; onClose: () => void; onSave: (p: Part) => void; onOpen: (p: Part) => void }) {
  const p = parts[at];
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { setUrl(null); void mailPart(e, m, p.index).then(setUrl).catch(() => {}); }, [e, m, p.index]);
  useEffect(() => {
    const k = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose(); if (ev.key === 'ArrowRight' && at < parts.length - 1) onAt(at + 1); if (ev.key === 'ArrowLeft' && at > 0) onAt(at - 1); };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [at, parts.length, onAt, onClose]);
  return (
    <div className="lightbox" role="dialog" aria-label={p.name} onClick={onClose}>
      <div className="lightbox__bar" onClick={(x) => x.stopPropagation()}>
        <span className="ellipsis">{p.name}</span><span className="meta num">{at + 1} af {parts.length}</span>
        <span className="push-right" /><Btn size="sm" variant="text" onClick={() => onOpen(p)}>Åbn i Eksempel</Btn><Btn size="sm" variant="text" onClick={() => onSave(p)}>Gem</Btn>
        <Btn size="sm" variant="text" icon="x" aria-label="Luk" onClick={onClose} />
      </div>
      {url ? <img className="lightbox__img" src={url} alt={p.name} onClick={(x) => x.stopPropagation()} /> : <span className="meta">Henter …</span>}
      {at > 0 && <button className="lightbox__nav lightbox__nav--prev" aria-label="Forrige" onClick={(x) => { x.stopPropagation(); onAt(at - 1); }}><Icon name="chevron-left" /></button>}
      {at < parts.length - 1 && <button className="lightbox__nav lightbox__nav--next" aria-label="Næste" onClick={(x) => { x.stopPropagation(); onAt(at + 1); }}><Icon name="chevron-right" /></button>}
    </div>
  );
}

/** Plain-text mails: links become clickable, everything else stays text. */
function linkify(t: string) {
  const out: React.ReactNode[] = [];
  const re = /\b(https?:\/\/[^\s<>"')\]]+|[\w.+-]+@[\w-]+\.[\w.-]+)/g;
  let last = 0, mm: RegExpExecArray | null, i = 0;
  while ((mm = re.exec(t))) {
    if (mm.index > last) out.push(t.slice(last, mm.index));
    const v = mm[0], href = v.includes('@') && !v.startsWith('http') ? `mailto:${v}` : v;
    out.push(<a key={i++} href={href} onClick={(x) => { x.preventDefault(); void openExternal(href); }}>{v}</a>);
    last = mm.index + v.length;
  }
  out.push(t.slice(last));
  return out;
}
