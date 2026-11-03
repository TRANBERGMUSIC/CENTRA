/**
 * PowerPoint (.pptx) for preview: every slide read from its XML with what it inherits from its
 * layout, master and theme (positions, colours, fonts, sizes), pictures, tables and simple charts.
 * The result is a plain model; FileView draws it. Nothing in the file runs.
 */
import type { Unzipped } from 'fflate';
import { unzip, xml, all, first, kids, kid, rels, image } from './zip.ts';

export type Run = { text: string; size: number; bold: boolean; italic: boolean; underline: boolean; strike: boolean; color: string; font: string; br?: boolean };
export type Para = { runs: Run[]; align: 'left' | 'center' | 'right' | 'justify'; bullet: string; level: number; indent: number; lineHeight: number; before: number; after: number; size: number; color: string; font: string; bold: boolean };
export type TextBox = { paras: Para[]; anchor: 'start' | 'center' | 'end'; inset: [number, number, number, number]; vertical: boolean };
type Box = { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean };
export type Item =
  | (Box & { kind: 'shape'; geom: 'rect' | 'round' | 'ellipse' | 'line'; fill: string; img: string | null; line: { color: string; w: number } | null; text: TextBox | null })
  | (Box & { kind: 'pic'; img: string; round: boolean })
  | (Box & { kind: 'table'; cols: number[]; rows: { h: number; cells: { text: TextBox; fill: string; span: number; rowSpan: number; hidden: boolean }[] }[] })
  | (Box & { kind: 'chart'; chart: Chart });
export type Chart = { type: 'col' | 'bar' | 'line' | 'pie' | 'area'; title: string; cats: string[]; series: { name: string; vals: number[]; color: string }[] };
export type Slide = { bg: string; bgImg: string | null; items: Item[]; hidden: boolean };
export type Deck = { w: number; h: number; slides: Slide[]; urls: string[] };

type Ctx = { z: Unzipped; theme: Theme; urls: string[]; rels: Record<string, { target: string; type: string }> };
type Theme = { colors: Record<string, string>; major: string; minor: string; map: Record<string, string> };
type Part = { path: string; doc: Document; rels: Record<string, { target: string; type: string }> };

const EMU_PT = 12700;
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rid = (n: Element | null, name = 'embed') => n?.getAttributeNS(R_NS, name) ?? n?.getAttribute(`r:${name}`) ?? '';
const n = (v: string | null | undefined, d = 0) => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

/* ---------------------------------------------------------------- colours */
function hexToRgb(h: string): [number, number, number] { const x = parseInt(h.slice(0, 6), 16); return [(x >> 16) & 255, (x >> 8) & 255, x & 255]; }
function rgbToHsl([r, g, b]: number[]): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb([h, s, l]: number[]): [number, number, number] {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
const PRESET: Record<string, string> = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', orange: 'FFA500' };

/** The colour in a fill-like element (solidFill, or the colour element itself). '' for none. */
function color(el: Element | null, t: Theme, ph?: string): string {
  if (!el) return '';
  const c = ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr'].includes(el.localName) ? el : kids(el).find((k) => ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr'].includes(k.localName));
  if (!c) return '';
  let hex = '';
  if (c.localName === 'srgbClr') hex = c.getAttribute('val') ?? '';
  else if (c.localName === 'sysClr') hex = c.getAttribute('lastClr') ?? (c.getAttribute('val') === 'window' ? 'FFFFFF' : '000000');
  else if (c.localName === 'prstClr') hex = PRESET[c.getAttribute('val') ?? ''] ?? '000000';
  else if (c.localName === 'scrgbClr') hex = [c.getAttribute('r'), c.getAttribute('g'), c.getAttribute('b')].map((v) => Math.round(Math.min(1, n(v) / 100000) * 255).toString(16).padStart(2, '0')).join('');
  else {
    let v = c.getAttribute('val') ?? '';
    if (v === 'phClr' && ph) return ph;
    v = t.map[v] ?? v;
    hex = t.colors[v] ?? '';
  }
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '';
  let rgb = hexToRgb(hex), alpha = 1;
  for (const m of kids(c)) {
    const val = n(m.getAttribute('val')) / 100000;
    if (m.localName === 'alpha') alpha = val;
    else if (m.localName === 'lumMod' || m.localName === 'lumOff') { const hsl = rgbToHsl(rgb); hsl[2] = Math.max(0, Math.min(1, m.localName === 'lumMod' ? hsl[2] * val : hsl[2] + val)); rgb = hslToRgb(hsl); }
    else if (m.localName === 'tint') rgb = rgb.map((x) => x * val + 255 * (1 - val)) as typeof rgb;
    else if (m.localName === 'shade') rgb = rgb.map((x) => x * val) as typeof rgb;
  }
  const [r, g, b] = rgb.map((x) => Math.round(Math.max(0, Math.min(255, x))));
  return alpha < 1 ? `rgba(${r},${g},${b},${alpha.toFixed(3)})` : `rgb(${r},${g},${b})`;
}

function readTheme(z: Unzipped, path: string | undefined, master: Document): Theme {
  const d = path ? xml(z, path) : null;
  const colors: Record<string, string> = {};
  for (const k of kids(first(d, 'clrScheme'))) {
    const c = kids(k)[0];
    colors[k.localName] = c?.localName === 'srgbClr' ? c.getAttribute('val') ?? '' : c?.getAttribute('lastClr') ?? (c?.getAttribute('val') === 'window' ? 'FFFFFF' : '000000');
  }
  const map: Record<string, string> = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
  const cm = first(master, 'clrMap');
  if (cm) for (const a of Array.from(cm.attributes)) map[a.name] = a.value;
  const font = (k: string) => first(first(d, k), 'latin')?.getAttribute('typeface') ?? '';
  return { colors, map, major: font('majorFont'), minor: font('minorFont') };
}

/* ---------------------------------------------------------------- placeholders and text styles */
type PhKey = { type: string; idx: string };
const phOf = (sp: Element): PhKey | null => {
  const ph = first(kid(sp, 'nvSpPr') ?? kid(sp, 'nvPicPr') ?? kid(sp, 'nvGraphicFramePr'), 'ph');
  return ph ? { type: ph.getAttribute('type') ?? 'body', idx: ph.getAttribute('idx') ?? '' } : null;
};
const family = (t: string) => (t === 'ctrTitle' || t === 'title' ? 'title' : t === 'subTitle' || t === 'body' || t === 'obj' ? 'body' : t);
function findPh(doc: Document | null, key: PhKey): Element | null {
  if (!doc) return null;
  const sps = all(first(doc, 'spTree'), 'sp');
  const withPh = sps.map((s) => [s, phOf(s)] as const).filter(([, p]) => p);
  return (key.idx && withPh.find(([, p]) => p!.idx === key.idx && family(p!.type) === family(key.type))?.[0])
    || withPh.find(([, p]) => p!.type === key.type)?.[0]
    || withPh.find(([, p]) => family(p!.type) === family(key.type))?.[0]
    || (key.idx ? withPh.find(([, p]) => p!.idx === key.idx)?.[0] : null)
    || null;
}

type Chain = { lst: (Element | null)[]; body: (Element | null)[]; xfrm: (Element | null)[]; style: 'title' | 'body' | 'other'; fontRef: string };

function lvlProps(lst: Element | null, lvl: number): Element | null { return lst ? kid(lst, `lvl${lvl + 1}pPr`) ?? (lvl === 0 ? kid(lst, 'defPPr') : null) : null; }

function font(face: string | null | undefined, t: Theme, fallback: string) {
  const f = !face ? fallback : face.startsWith('+mj') ? t.major : face.startsWith('+mn') ? t.minor : face;
  return f || fallback;
}

/** One property through the chain (paragraph first, then the shape, layout, master, defaults). */
function pick<T>(els: (Element | null)[], get: (e: Element) => T | null | undefined): T | null {
  for (const e of els) { if (!e) continue; const v = get(e); if (v != null) return v; }
  return null;
}

function textBox(txBody: Element | null, chain: Chain, ctx: Ctx, fontColor: string, scaleIn = 1): TextBox | null {
  if (!txBody) return null;
  const t = ctx.theme;
  const bodyPrs = [kid(txBody, 'bodyPr'), ...chain.body];
  const auto = first(kid(txBody, 'bodyPr'), 'normAutofit');
  const scale = scaleIn * (auto ? n(auto.getAttribute('fontScale'), 100000) / 100000 : 1);
  const lnRed = auto ? n(auto.getAttribute('lnSpcReduction')) / 100000 : 0;
  const anchorV = pick(bodyPrs, (b) => b.getAttribute('anchor')) ?? 't';
  const ins = (k: string, d: number) => n(pick(bodyPrs, (b) => b.getAttribute(k)), d);
  const vert = pick(bodyPrs, (b) => b.getAttribute('vert'));
  const lstStyles = [kid(txBody, 'lstStyle'), ...chain.lst];
  const defFont = chain.style === 'title' ? t.major : t.minor;
  let num = 0;
  const paras: Para[] = kids(txBody, 'p').map((p) => {
    const pPr = kid(p, 'pPr');
    const level = n(pPr?.getAttribute('lvl'));
    const levels = [pPr, ...lstStyles.map((l) => lvlProps(l, level))];
    const defR = levels.map((l) => (l ? kid(l, 'defRPr') : null));
    const algn = pick(levels, (l) => l.getAttribute('algn')) ?? 'l';
    const size = n(pick(defR, (r) => r.getAttribute('sz')), chain.style === 'title' ? 4400 : 1800) / 100 * scale;
    // The shape's own colours first, then its style (white text on a shape), then the layout and master.
    const own = defR.slice(0, 2), inherited = defR.slice(2);
    const pColor = pick(own, (r) => color(kid(r, 'solidFill'), t) || null) ?? (chain.fontRef ? fontColor : null) ?? pick(inherited, (r) => color(kid(r, 'solidFill'), t) || null) ?? fontColor;
    const pFont = font(pick(defR, (r) => first(r, 'latin')?.getAttribute('typeface')), t, defFont);
    const pBold = pick(defR, (r) => (r.hasAttribute('b') ? r.getAttribute('b') === '1' || r.getAttribute('b') === 'true' : null)) ?? false;
    const runs: Run[] = [];
    for (const r of kids(p)) {
      if (r.localName === 'br') { runs.push({ text: '\n', size, bold: pBold, italic: false, underline: false, strike: false, color: pColor, font: pFont, br: true }); continue; }
      if (r.localName !== 'r' && r.localName !== 'fld') continue;
      const rPr = kid(r, 'rPr');
      const all2 = [rPr, ...defR];
      const b = (k: string) => pick(all2, (x) => (x.hasAttribute(k) ? x.getAttribute(k) === '1' || x.getAttribute(k) === 'true' : null)) ?? false;
      runs.push({
        text: kid(r, 't')?.textContent ?? '',
        size: rPr?.getAttribute('sz') ? n(rPr.getAttribute('sz')) / 100 * scale : size,
        bold: b('b'), italic: b('i'),
        underline: (pick(all2, (x) => x.getAttribute('u')) ?? 'none') !== 'none',
        strike: (pick(all2, (x) => x.getAttribute('strike')) ?? 'noStrike') !== 'noStrike',
        color: (rPr && color(kid(rPr, 'solidFill'), t)) || pColor,
        font: font(rPr && first(rPr, 'latin')?.getAttribute('typeface'), t, pFont),
      });
    }
    const hasText = runs.some((r) => r.text.trim());
    const buNone = pick(levels, (l) => (kid(l, 'buNone') ? true : kid(l, 'buChar') || kid(l, 'buAutoNum') ? false : null));
    let bullet = '';
    if (hasText && buNone === false) {
      const ch = pick(levels, (l) => kid(l, 'buChar')?.getAttribute('char'));
      const auto2 = pick(levels, (l) => kid(l, 'buAutoNum')?.getAttribute('type'));
      if (auto2) { num++; bullet = /alpha/i.test(auto2) ? `${String.fromCharCode(96 + num)}.` : /roman/i.test(auto2) ? `${['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][num - 1] ?? num}.` : `${num}.`; }
      else if (ch) { const bf = pick(levels, (l) => kid(l, 'buFont')?.getAttribute('typeface')) ?? ''; bullet = /wingdings|symbol|webdings/i.test(bf) || !ch.trim() ? '•' : ch; }
    } else if (!kid(pPr, 'buAutoNum')) num = 0;
    const lnPct = pick(levels, (l) => first(kid(l, 'lnSpc'), 'spcPct')?.getAttribute('val'));
    const spc = (k: string) => n(pick(levels, (l) => first(kid(l, k), 'spcPts')?.getAttribute('val'))) / 100;
    return {
      runs, level, bullet,
      align: algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' || algn === 'dist' ? 'justify' : 'left',
      indent: n(pick(levels, (l) => l.getAttribute('marL'))) / EMU_PT,
      lineHeight: Math.max(0.6, (lnPct ? n(lnPct) / 100000 : 1) - lnRed) * 1.2,
      before: spc('spcBef') * scale, after: spc('spcAft') * scale,
      size, color: pColor, font: pFont, bold: pBold,
    };
  });
  if (!paras.some((p) => p.runs.some((r) => r.text.trim()))) return null;
  return {
    paras,
    anchor: anchorV === 'ctr' ? 'center' : anchorV === 'b' ? 'end' : 'start',
    inset: [ins('tIns', 45720), ins('rIns', 91440), ins('bIns', 45720), ins('lIns', 91440)].map((v) => v / EMU_PT) as [number, number, number, number],
    vertical: !!vert && vert !== 'horz',
  };
}

/* ---------------------------------------------------------------- shapes */
type Tx = (b: Box) => Box;
const identity: Tx = (b) => b;

function box(xfrm: Element | null): Box | null {
  const off = kid(xfrm, 'off'), ext = kid(xfrm, 'ext');
  if (!off || !ext) return null;
  return { x: n(off.getAttribute('x')), y: n(off.getAttribute('y')), w: n(ext.getAttribute('cx')), h: n(ext.getAttribute('cy')), rot: n(xfrm!.getAttribute('rot')) / 60000, flipH: xfrm!.getAttribute('flipH') === '1', flipV: xfrm!.getAttribute('flipV') === '1' };
}

function fillOf(spPr: Element | null, style: Element | null, ctx: Ctx, part: Part): { fill: string; img: string | null } {
  const t = ctx.theme;
  if (spPr) {
    if (kid(spPr, 'noFill')) return { fill: '', img: null };
    const s = kid(spPr, 'solidFill');
    if (s) return { fill: color(s, t), img: null };
    const g = kid(spPr, 'gradFill');
    if (g) {
      const stops = all(g, 'gs').map((gs) => [n(gs.getAttribute('pos')) / 1000, color(gs, t)] as const).filter(([, c]) => c);
      const ang = n(first(g, 'lin')?.getAttribute('ang'), 5400000) / 60000;
      return { fill: stops.length > 1 ? `linear-gradient(${ang + 90}deg, ${stops.map(([p, c]) => `${c} ${p}%`).join(', ')})` : stops[0]?.[1] ?? '', img: null };
    }
    const b = kid(spPr, 'blipFill');
    if (b) { const r = part.rels[rid(first(b, 'blip'))]; return { fill: '', img: r ? image(ctx.z, r.target, ctx.urls) : null }; }
  }
  const ref = first(style, 'fillRef');
  if (ref && n(ref.getAttribute('idx')) > 0) return { fill: color(ref, t), img: null };
  return { fill: '', img: null };
}

function lineOf(spPr: Element | null, style: Element | null, ctx: Ctx): { color: string; w: number } | null {
  const ln = kid(spPr, 'ln');
  if (ln && kid(ln, 'noFill')) return null;
  const c = ln ? color(kid(ln, 'solidFill'), ctx.theme) : '';
  if (c) return { color: c, w: Math.max(0.5, n(ln!.getAttribute('w'), 12700) / EMU_PT) };
  const ref = first(style, 'lnRef');
  if (!ln && ref && n(ref.getAttribute('idx')) > 0) { const rc = color(ref, ctx.theme); if (rc) return { color: rc, w: 0.75 }; }
  return null;
}

function geomOf(spPr: Element | null): 'rect' | 'round' | 'ellipse' | 'line' {
  const g = first(spPr, 'prstGeom')?.getAttribute('prst') ?? 'rect';
  return g === 'ellipse' || g === 'flowChartConnector' ? 'ellipse' : /round|snip/i.test(g) ? 'round' : g === 'line' || g.startsWith('straightConnector') ? 'line' : 'rect';
}

type Layers = { layout: Document | null; master: Document | null; masterStyles: Element | null };

function chainFor(sp: Element, layers: Layers): Chain {
  const key = phOf(sp);
  const lay = key ? findPh(layers.layout, key) : null;
  const mas = key ? findPh(layers.master, key) : null;
  const styleName = !key ? 'other' : family(key.type) === 'title' ? 'title' : family(key.type) === 'body' ? 'body' : 'other';
  const txStyle = kid(layers.masterStyles, styleName === 'title' ? 'titleStyle' : styleName === 'body' ? 'bodyStyle' : 'otherStyle');
  const fr = first(first(sp, 'style'), 'fontRef');
  const frColor = !!fr && kids(fr).length > 0;
  return {
    lst: [lay && first(first(lay, 'txBody'), 'lstStyle'), mas && first(first(mas, 'txBody'), 'lstStyle'), txStyle],
    body: [lay && first(first(lay, 'txBody'), 'bodyPr'), mas && first(first(mas, 'txBody'), 'bodyPr')],
    xfrm: [lay && first(kid(lay, 'spPr'), 'xfrm'), mas && first(kid(mas, 'spPr'), 'xfrm')],
    style: styleName,
    fontRef: frColor ? 'ref' : '',
  };
}

function walk(tree: Element | null, part: Part, ctx: Ctx, layers: Layers, tx: Tx, out: Item[], placeholders: boolean) {
  const c2: Ctx = { ...ctx, rels: part.rels };
  for (const el of kids(tree)) {
    const name = el.localName;
    if (name === 'sp' || name === 'cxnSp') {
      const ph = phOf(el);
      if (ph && !placeholders) continue; // a layout's or master's placeholders are prompts, not content
      if (ph && ['dt', 'ftr', 'sldNum', 'hdr'].includes(ph.type) && !first(el, 't')?.textContent?.trim()) continue;
      const chain = chainFor(el, layers);
      const spPr = kid(el, 'spPr');
      const b = box(first(spPr, 'xfrm')) ?? box(chain.xfrm.find(Boolean) ?? null);
      if (!b) continue;
      const style = kid(el, 'style');
      const fontColor = color(first(style, 'fontRef'), ctx.theme) || `rgb(${hexToRgb(ctx.theme.colors[ctx.theme.map.tx1 ?? 'dk1'] || '000000').join(',')})`;
      const { fill, img } = fillOf(spPr, style, c2, part);
      const geom = geomOf(spPr);
      const line = lineOf(spPr, style, c2);
      const text = textBox(kid(el, 'txBody'), chain, c2, fontColor);
      if (!fill && !img && !line && !text) continue;
      out.push({ kind: 'shape', ...tx(b), geom, fill, img, line, text });
    } else if (name === 'pic') {
      const b = box(first(kid(el, 'spPr'), 'xfrm')) ?? box(chainFor(el, layers).xfrm.find(Boolean) ?? null);
      const r = part.rels[rid(first(kid(el, 'blipFill'), 'blip'))];
      const u = r ? image(ctx.z, r.target, ctx.urls) : null;
      if (b && u) out.push({ kind: 'pic', ...tx(b), img: u, round: geomOf(kid(el, 'spPr')) === 'ellipse' });
    } else if (name === 'grpSp') {
      const x = first(kid(el, 'grpSpPr'), 'xfrm');
      const b = box(x);
      const chOff = kid(x, 'chOff'), chExt = kid(x, 'chExt');
      if (!b || !chOff || !chExt) { walk(el, part, ctx, layers, tx, out, placeholders); continue; }
      const cx = n(chOff.getAttribute('x')), cy = n(chOff.getAttribute('y')), sx = b.w / (n(chExt.getAttribute('cx')) || 1), sy = b.h / (n(chExt.getAttribute('cy')) || 1);
      const inner: Tx = (k) => tx({ ...k, x: b.x + (k.x - cx) * sx, y: b.y + (k.y - cy) * sy, w: k.w * sx, h: k.h * sy });
      walk(el, part, ctx, layers, inner, out, placeholders);
    } else if (name === 'graphicFrame') {
      const b = box(kid(el, 'xfrm')) ?? box(chainFor(el, layers).xfrm.find(Boolean) ?? null);
      if (!b) continue;
      const tbl = first(el, 'tbl');
      if (tbl) { out.push({ kind: 'table', ...tx(b), ...table(tbl, c2) }); continue; }
      const ch = first(el, 'chart');
      const r = ch ? part.rels[rid(ch, 'id')] : null;
      const chart = r ? readChart(ctx.z, r.target, ctx.theme) : null;
      if (chart) out.push({ kind: 'chart', ...tx(b), chart });
    } else if (name === 'AlternateContent') {
      walk(kid(el, 'Fallback') ?? kid(el, 'Choice'), part, ctx, layers, tx, out, placeholders);
    }
  }
}

function table(tbl: Element, ctx: Ctx) {
  const cols = all(first(tbl, 'tblGrid'), 'gridCol').map((g) => n(g.getAttribute('w')));
  const anyFill = all(tbl, 'tcPr').some((p) => kid(p, 'solidFill'));
  const accent = ctx.theme.colors.accent1 ? `#${ctx.theme.colors.accent1}` : '#4472c4';
  const chain: Chain = { lst: [], body: [], xfrm: [], style: 'other', fontRef: '' };
  const rows = kids(tbl, 'tr').map((tr, ri) => ({
    h: n(tr.getAttribute('h')),
    cells: kids(tr, 'tc').map((tc) => {
      const pr = kid(tc, 'tcPr');
      const own = color(kid(pr, 'solidFill'), ctx.theme);
      const fill = own || (anyFill ? '' : ri === 0 ? accent : ri % 2 ? `color-mix(in srgb, ${accent} 22%, white)` : `color-mix(in srgb, ${accent} 10%, white)`);
      const fc = !own && !anyFill && ri === 0 ? 'rgb(255,255,255)' : 'rgb(0,0,0)';
      return {
        text: textBox(kid(tc, 'txBody'), chain, ctx, fc) ?? { paras: [], anchor: 'start' as const, inset: [3.6, 7.2, 3.6, 7.2] as [number, number, number, number], vertical: false },
        fill, span: n(tc.getAttribute('gridSpan'), 1), rowSpan: n(tc.getAttribute('rowSpan'), 1),
        hidden: tc.getAttribute('hMerge') === '1' || tc.getAttribute('vMerge') === '1',
      };
    }),
  }));
  return { cols, rows };
}

const SERIES_COLORS = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
function readChart(z: Unzipped, path: string, t: Theme): Chart | null {
  const d = xml(z, path);
  const plot = first(d, 'plotArea');
  if (!plot) return null;
  const kind = kids(plot).find((k) => /^(bar|bar3D|line|line3D|pie|pie3D|doughnut|area|area3D)Chart$/.test(k.localName));
  if (!kind) return null;
  const type: Chart['type'] = kind.localName.startsWith('bar') ? (first(kind, 'barDir')?.getAttribute('val') === 'bar' ? 'bar' : 'col') : kind.localName.startsWith('line') ? 'line' : kind.localName.startsWith('area') ? 'area' : 'pie';
  const pts = (el: Element | null) => all(el, 'pt').sort((a, b) => n(a.getAttribute('idx')) - n(b.getAttribute('idx'))).map((p) => first(p, 'v')?.textContent ?? '');
  const sers = kids(kind, 'ser');
  const series = sers.map((s, i) => ({
    name: pts(kid(s, 'tx'))[0] ?? `Serie ${i + 1}`,
    vals: pts(kid(s, 'val')).map((v) => n(v)),
    color: color(kid(kid(s, 'spPr'), 'solidFill'), t) || `#${t.colors[SERIES_COLORS[i % 6]] ?? '4472c4'}`,
  }));
  const cats = pts(kid(sers[0] ?? null, 'cat'));
  const title = all(first(d, 'title'), 't').map((x) => x.textContent ?? '').join('');
  if (!series.length) return null;
  return { type, title, cats, series };
}

function background(doc: Document | null, part: Part | null, ctx: Ctx): { bg: string; img: string | null } | null {
  const bg = first(first(doc, 'cSld'), 'bg');
  if (!bg || !part) return null;
  const pr = kid(bg, 'bgPr');
  if (pr) { const f = fillOf(pr, null, { ...ctx, rels: part.rels }, part); return f.fill || f.img ? { bg: f.fill, img: f.img } : null; }
  const ref = kid(bg, 'bgRef');
  if (ref) { const c = color(ref, ctx.theme); return c ? { bg: c, img: null } : null; }
  return null;
}

/* ---------------------------------------------------------------- the deck */
export function readPptx(data: Uint8Array): Deck {
  const z = unzip(data);
  const presPath = 'ppt/presentation.xml';
  const pres = xml(z, presPath);
  if (!pres) throw new Error('Præsentationen kunne ikke læses');
  const sz = first(pres, 'sldSz');
  const w = n(sz?.getAttribute('cx'), 12192000), h = n(sz?.getAttribute('cy'), 6858000);
  const pr = rels(z, presPath);
  const urls: string[] = [];
  const load = (path: string | undefined): Part | null => { const doc = path ? xml(z, path) : null; return doc && path ? { path, doc, rels: rels(z, path) } : null; };
  const relOf = (p: Part | null, type: string) => (p ? Object.values(p.rels).find((r) => r.type === type)?.target : undefined);
  const cache = new Map<string, Part | null>();
  const cached = (path: string | undefined) => { if (!path) return null; if (!cache.has(path)) cache.set(path, load(path)); return cache.get(path)!; };

  const slides: Slide[] = all(first(pres, 'sldIdLst'), 'sldId').map((s) => pr[rid(s, 'id')]?.target).filter(Boolean).map((path) => {
    const slide = load(path)!;
    if (!slide) return { bg: '#fff', bgImg: null, items: [], hidden: false };
    const layout = cached(relOf(slide, 'slideLayout'));
    const master = cached(relOf(layout, 'slideMaster'));
    const theme = readTheme(z, relOf(master, 'theme'), master?.doc ?? slide.doc);
    const ctx: Ctx = { z, theme, urls, rels: slide.rels };
    const layers: Layers = { layout: layout?.doc ?? null, master: master?.doc ?? null, masterStyles: first(master?.doc, 'txStyles') };
    const items: Item[] = [];
    const showMaster = (d: Document | null) => first(d, 'sld')?.getAttribute('showMasterSp') !== '0' && first(d, 'sldLayout')?.getAttribute('showMasterSp') !== '0';
    if (master && showMaster(slide.doc) && showMaster(layout?.doc ?? null)) walk(first(master.doc, 'spTree'), master, ctx, layers, identity, items, false);
    if (layout && showMaster(slide.doc)) walk(first(layout.doc, 'spTree'), layout, ctx, layers, identity, items, false);
    walk(first(slide.doc, 'spTree'), slide, ctx, layers, identity, items, true);
    const b = background(slide.doc, slide, ctx) ?? background(layout?.doc ?? null, layout, ctx) ?? background(master?.doc ?? null, master, ctx);
    return { bg: b?.bg || `#${theme.colors[theme.map.bg1 ?? 'lt1'] ?? 'FFFFFF'}`, bgImg: b?.img ?? null, items, hidden: first(slide.doc, 'sld')?.getAttribute('show') === '0' };
  });
  return { w, h, slides, urls };
}
