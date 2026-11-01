import { useEffect, useMemo, useRef, useState } from 'react';
import { useEngine, useList, useRecord, useRoute } from '../state.tsx';
import { Btn } from '../ui/primitives.tsx';
import { Icon } from '../ui/Icon.tsx';
import { useToast } from '../ui/Shell.tsx';
import { ask } from '../ui/Confirm.tsx';
import { useScreenEnter } from '../motion.ts';
import { KINDS, searchPhotos, photoDay, type Photo } from '../photos.ts';
import { savePhoto, analyzePhoto } from '../ai/photoAi.ts';
import { shrinkImage } from '../ai/receipt.ts';
import { aiReady, aiSettings } from '../ai/agent.ts';
import { queueAssist } from './Assist.tsx';

const dataUrlBlob = (url: string) => { const [h, d] = url.split(','); const bin = atob(d); return new Blob([Uint8Array.from(bin, (c) => c.charCodeAt(0))], { type: /data:([^;]+)/.exec(h)?.[1] ?? 'image/jpeg' }); };
const groupOf = (p: Photo, now: Date) => {
  const d = photoDay(p);
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (days <= 0) return 'I dag';
  if (days === 1) return 'I går';
  if (days < 7) return d.toLocaleDateString('da-DK', { weekday: 'long' }).replace(/^./, (c) => c.toUpperCase());
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('da-DK', { month: 'long' }).replace(/^./, (c) => c.toUpperCase());
  return String(d.getFullYear());
};

/**
 * Billeder: things you want to remember by a picture. Add photos and screenshots (button, drag, ⌘V);
 * AI reads each one (what it is, colours, brand, all the text), so you and Assist can find it again.
 */
export function Photos() {
  const e = useEngine();
  const { route, go } = useRoute();
  const toast = useToast();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'photos');
  const all = useList('photo', (a, b) => ((b.takenAt || b.at) ?? '').localeCompare((a.takenAt || a.at) ?? '')) as unknown as Photo[];
  useList('setting');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<string | null>(null);
  const [busy, setBusy] = useState(0);
  const [drag, setDrag] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const now = new Date();
  const list = useMemo(() => (q.trim() ? searchPhotos(e, q, { limit: 200 }) : all).filter((p) => !kind || p.kind === kind),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, q, kind]);
  const kinds = KINDS.filter((k) => all.some((p) => p.kind === k));
  const id = route.id;

  async function add(files: Iterable<File> | ArrayLike<File>) {
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    if (!imgs.length) return void toast({ text: 'Kun billeder: fotos og skærmbilleder (JPG, PNG, HEIC).' });
    const ai = aiReady(aiSettings(e));
    let first = '';
    for (const f of imgs.slice(0, 30)) {
      try {
        const [image, thumb] = await Promise.all([shrinkImage(f, 1600, 0.82), shrinkImage(f, 360, 0.7)]);
        setBusy((n) => n + 1);
        const pid = savePhoto(e, { image, thumb, name: f.name, takenAt: f.lastModified ? new Date(f.lastModified).toISOString() : '' }, () => setBusy((n) => Math.max(0, n - 1)));
        if (!ai) setBusy((n) => Math.max(0, n - 1));
        first ||= pid;
      } catch (x) { toast({ text: (x as Error).message }); }
    }
    if (first) go({ screen: 'photos', id: first });
    toast({ icon: 'camera', title: imgs.length === 1 ? 'Billedet er gemt' : `${imgs.length} billeder er gemt`, text: ai ? 'CENTRA læser det, så du kan søge efter det.' : 'Forbind Assist under Indstillinger, så kan CENTRA læse billederne, og du kan søge i dem.' });
  }
  useEffect(() => {
    const paste = (ev: ClipboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t?.closest('input, textarea, [contenteditable="true"]')) return;
      const fs = [...(ev.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (fs.length) { ev.preventDefault(); void add(fs); }
    };
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  });
  // Photos Assist saved keep the full picture as their preview; make a small one once.
  useEffect(() => {
    for (const p of all.filter((x) => x.thumb && x.thumb === x.image && x.image.length > 60_000).slice(0, 5)) {
      void shrinkImage(dataUrlBlob(p.image), 360, 0.7).then((t) => e.set('photo', p.id, { thumb: t })).catch(() => {});
    }
  }, [all, e]);

  let lastGroup = '';
  return (
    <main className={`photos ${id ? 'has-open' : ''} ${drag ? 'is-drag' : ''}`} ref={ref}
      onDragOver={(ev) => { if ([...ev.dataTransfer.types].includes('Files')) { ev.preventDefault(); setDrag(true); } }}
      onDragLeave={(ev) => { if (!ev.currentTarget.contains(ev.relatedTarget as Node)) setDrag(false); }}
      onDrop={(ev) => { ev.preventDefault(); setDrag(false); void add(ev.dataTransfer.files); }}>
      <div className="phlist" data-lenis-prevent>
        <div className="titlerow" data-enter>
          <div><h1>Billeder</h1></div>
          <div className="actions">
            <Btn icon="assist" onClick={() => { queueAssist('Hvad har jeg gemt af billeder for nylig? Giv mig et kort overblik.'); go({ screen: 'assist' }); }}>Spørg Assist</Btn>
            <Btn variant="primary" icon="plus" onClick={() => file.current?.click()}>Tilføj billeder</Btn>
            <input ref={file} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(x) => { if (x.target.files) void add(x.target.files); x.target.value = ''; }} />
          </div>
        </div>
        <div className="phbar" data-enter>
          <input className="msearch" type="search" value={q} onChange={(x) => setQ(x.target.value)} placeholder="Søg" aria-label="Søg i billeder" />
          {busy > 0 && <span className="meta phbusy"><span className="spinner" aria-hidden="true" />Læser {busy} {busy === 1 ? 'billede' : 'billeder'} …</span>}
        </div>
        {kinds.length > 1 && <div className="ntags phkinds">{[null, ...kinds].map((k) => <button key={k ?? 'all'} className={`tag ${kind === k ? 'is-active' : ''}`} onClick={() => setKind(k)}>{k ?? 'Alle'}</button>)}</div>}
        {list.length ? (
          <div className="phgrid">
            {list.map((p) => {
              const g = q.trim() ? '' : groupOf(p, now);
              const head = g && g !== lastGroup ? (lastGroup = g, <h3 key={'g' + g} className="phgroup">{g}</h3>) : null;
              return [head, (
                <button key={p.id} className={`phcard ${p.id === id ? 'is-selected' : ''}`} onClick={() => go({ screen: 'photos', id: p.id })} title={p.description || p.title}>
                  <img src={p.thumb || p.image} alt={p.title} loading="lazy" />
                  <span className="phcard__t ellipsis">{p.analyzed === false ? 'Læser …' : p.title}</span>
                </button>
              )];
            })}
          </div>
        ) : <div className="phempty"><Icon name="camera" /><p className="muted">{all.length ? 'Intet fundet.' : 'Ingen billeder endnu.'}</p></div>}
      </div>
      {id && <PhotoDetail key={id} id={id} />}
      {drag && <div className="chat__drop phdrop" aria-hidden="true"><Icon name="camera" /><span>Slip for at gemme billederne</span></div>}
    </main>
  );
}

function PhotoDetail({ id }: { id: string }) {
  const e = useEngine();
  const { go } = useRoute();
  const toast = useToast();
  const p = useRecord<Photo>(id);
  const [big, setBig] = useState(false);
  const [reading, setReading] = useState(false);
  const [tag, setTag] = useState('');
  if (!p) return <div className="phdetail" />;
  const set = (f: Partial<Photo>) => e.set('photo', id, f as Record<string, unknown>);
  async function reread() {
    setReading(true);
    try { set({ ...(await analyzePhoto(e, p!.image)), analyzed: true }); toast({ text: 'Billedet er læst igen' }); } catch (x) { toast({ text: (x as Error).message }); } finally { setReading(false); }
  }
  async function remove() {
    if (!(await ask({ title: 'Slet billedet?', text: `"${p!.title}" slettes fra CENTRA.`, ok: 'Slet', danger: true }))) return;
    const { id: _i, type: _t, ...f } = p as any;
    e.remove('photo', id); go({ screen: 'photos' });
    toast({ text: 'Billedet er slettet', action: { label: 'Fortryd', run: () => { e.set('photo', id, { ...f, _deleted: false }); go({ screen: 'photos', id }); } } });
  }
  function toNote() {
    const nid = e.create('note', { title: p!.title, folder: 'Billeder', tags: p!.tags.slice(0, 5), editedAt: new Date().toISOString(), createdAt: new Date().toISOString() });
    e.doc(nid).getText('body').insert(0, [p!.description, p!.text ? `\nTekst fra billedet:\n${p!.text}` : '', p!.note ? `\nNote: ${p!.note}` : ''].filter(Boolean).join('\n'));
    toast({ text: 'Gemt som note', action: { label: 'Åbn', run: () => go({ screen: 'notes', id: nid }) } });
  }
  return (
    <aside className="phdetail" data-lenis-prevent aria-label={p.title}>
      <div className="phdetail__bar">
        <button className="phone-back" onClick={() => go({ screen: 'photos' })}><Icon name="chevron-left" size="sm" />Billeder</button>
        <span className="push-right" />
        <Btn size="sm" variant="text" icon="x" onClick={() => go({ screen: 'photos' })} aria-label="Luk" />
      </div>
      <button className="phdetail__img" onClick={() => setBig(true)} aria-label="Vis større"><img src={p.image} alt={p.title} /></button>
      <input className="gtitle" defaultValue={p.title} key={p.title} onBlur={(x) => x.target.value.trim() && x.target.value.trim() !== p.title && set({ title: x.target.value.trim() })} aria-label="Titel" />
      <div className="meta">{photoDay(p).toLocaleString('da-DK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · <select className="phkind" value={p.kind} onChange={(x) => set({ kind: x.target.value })} aria-label="Slags">{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></div>
      {p.analyzed === false && <p className="meta"><span className="spinner" aria-hidden="true" /> CENTRA læser billedet …</p>}
      <label className="phfield"><span className="meta">Beskrivelse</span><textarea className="otext" rows={3} defaultValue={p.description} key={'d' + p.description} onBlur={(x) => x.target.value !== p.description && set({ description: x.target.value })} /></label>
      <div className="docmeta">
        {(p.tags ?? []).map((t) => <span key={t} className="tag ntag">#{t}<button aria-label={`Fjern #${t}`} onClick={() => set({ tags: p.tags.filter((x) => x !== t) })}><Icon name="x" size="sm" /></button></span>)}
        <form className="ntag__add" onSubmit={(x) => { x.preventDefault(); const v = tag.trim().replace(/^#/, '').toLowerCase(); if (v && !p.tags.includes(v)) set({ tags: [...p.tags, v] }); setTag(''); }}><input value={tag} onChange={(x) => setTag(x.target.value)} placeholder="+ tag" aria-label="Tilføj tag" /></form>
      </div>
      {p.text && <div className="phfield"><span className="meta">Tekst i billedet</span><pre className="phtext">{p.text}</pre><Btn size="sm" variant="text" onClick={() => { void navigator.clipboard?.writeText(p.text); toast({ text: 'Teksten er kopieret' }); }}>Kopiér teksten</Btn></div>}
      <label className="phfield"><span className="meta">Din note</span><input className="kvinput" defaultValue={p.note ?? ''} onBlur={(x) => x.target.value !== (p.note ?? '') && set({ note: x.target.value })} /></label>
      <div className="phacts">
        <Btn icon="assist" onClick={() => { queueAssist(`Se på mit gemte billede [${p.id}] "${p.title}": `); go({ screen: 'assist' }); }}>Spørg Assist</Btn>
        <Btn icon="notes" onClick={toNote}>Gem som note</Btn>
        <Btn variant="text" disabled={reading} onClick={() => void reread()}>{reading ? 'Læser …' : 'Læs igen'}</Btn>
        <Btn variant="text" icon="x" onClick={() => void remove()}>Slet</Btn>
      </div>
      {big && <div className="lightbox" role="dialog" aria-label={p.title} onClick={() => setBig(false)} onKeyDown={(x) => x.key === 'Escape' && setBig(false)} tabIndex={-1} ref={(el) => el?.focus()}>
        <div className="lightbox__bar" onClick={(x) => x.stopPropagation()}><span className="ellipsis">{p.title}</span><span className="push-right" /><Btn size="sm" variant="text" icon="x" onClick={() => setBig(false)}>Luk</Btn></div>
        <img className="lightbox__img" src={p.image} alt={p.title} onClick={(x) => x.stopPropagation()} />
      </div>}
    </aside>
  );
}
