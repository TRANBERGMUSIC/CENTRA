/** Spreadsheets for preview: Excel (.xlsx/.xlsm) read from its XML, and CSV/TSV text. */
import { unzip, xml, all, first, kids, rels } from './zip.ts';

export type Sheet = { name: string; rows: string[][]; widths: number[]; cut: boolean };

const MAX_ROWS = 2000, MAX_COLS = 80;

/** "BC12" → column 54 (0-based), row 11. */
function ref(r: string): [number, number] {
  const m = /^([A-Z]+)(\d+)$/.exec(r);
  if (!m) return [-1, -1];
  let c = 0;
  for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
  return [c - 1, Number(m[2]) - 1];
}
export const colName = (i: number) => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };

const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const num = (v: string) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n.toLocaleString('da-DK', { maximumFractionDigits: Math.abs(n) < 1 ? 6 : 2 });
};
/** Excel's day numbers (1900 system). */
function date(v: string, withTime: boolean) {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  const d = new Date(Math.round((n - 25569) * 86400000));
  const opts: Intl.DateTimeFormatOptions = n < 1 ? { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' } : withTime && n % 1 ? { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' } : { dateStyle: 'short', timeZone: 'UTC' };
  return d.toLocaleString('da-DK', opts);
}

export function readXlsx(data: Uint8Array): Sheet[] {
  const z = unzip(data);
  const wbPath = 'xl/workbook.xml';
  const wb = xml(z, wbPath);
  if (!wb) throw new Error('Regnearket kunne ikke læses');
  const wbRels = rels(z, wbPath);
  const shared = all(xml(z, 'xl/sharedStrings.xml'), 'si').map((si) => all(si, 't').filter((t) => t.parentElement?.localName !== 'rPh').map((t) => t.textContent ?? '').join(''));
  // Which cell styles are dates.
  const styles = xml(z, 'xl/styles.xml');
  const custom = new Map(all(styles, 'numFmt').map((f) => [Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? '']));
  const xfs = kids(first(styles, 'cellXfs'), 'xf').map((xf) => {
    const id = Number(xf.getAttribute('numFmtId') ?? 0);
    const code = custom.get(id) ?? '';
    const isDate = BUILTIN_DATES.has(id) || (/[dmyhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) && !/^[#0.,%\s]+$/.test(code));
    return { isDate, time: /h|s/i.test(code) || id === 22 };
  });

  return all(wb, 'sheet').map((s) => {
    const name = s.getAttribute('name') ?? 'Ark';
    const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? s.getAttribute('r:id') ?? '';
    const path = wbRels[rid]?.target;
    const d = path ? xml(z, path) : null;
    const rows: string[][] = [];
    let cut = false, maxCol = 0;
    for (const row of all(d, 'row')) {
      for (const c of kids(row, 'c')) {
        const [ci, ri] = ref(c.getAttribute('r') ?? '');
        if (ci < 0) continue;
        if (ri >= MAX_ROWS || ci >= MAX_COLS) { cut = true; continue; }
        const t = c.getAttribute('t');
        const v = first(c, 'v')?.textContent ?? '';
        const st = xfs[Number(c.getAttribute('s') ?? 0)];
        let out = '';
        if (t === 's') out = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') out = all(c, 't').map((x) => x.textContent ?? '').join('');
        else if (t === 'str' || t === 'e') out = v;
        else if (t === 'b') out = v === '1' ? 'SAND' : 'FALSK';
        else if (v !== '') out = st?.isDate ? date(v, st.time) : num(v);
        if (!out) continue;
        while (rows.length <= ri) rows.push([]);
        rows[ri][ci] = out;
        maxCol = Math.max(maxCol, ci + 1);
      }
    }
    const widths = Array.from({ length: maxCol }, () => 0);
    for (const col of all(d, 'col')) {
      const w = Number(col.getAttribute('width'));
      for (let i = Number(col.getAttribute('min')) - 1; i < Math.min(maxCol, Number(col.getAttribute('max'))); i++) if (w) widths[i] = Math.round(w * 7 + 10);
    }
    return { name, rows: rows.map((r) => Array.from({ length: maxCol }, (_, i) => r[i] ?? '')), widths, cut };
  });
}

/** CSV / TSV: the separator is the one the first line uses most (; is common in Danish files). */
export function readCsv(textIn: string): Sheet {
  const t = textIn.replace(/^﻿/, '');
  const head = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = [';', ',', '\t', '|'].map((s) => [s, head.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false, cut = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"' && !cell) q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); cell = ''; rows.push(row.slice(0, MAX_COLS)); row = [];
      if (rows.length >= MAX_ROWS) { cut = i < t.length - 1; break; }
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row.slice(0, MAX_COLS)); }
  const width = Math.max(0, ...rows.map((r) => r.length));
  return { name: 'Ark', rows: rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')), widths: [], cut };
}
