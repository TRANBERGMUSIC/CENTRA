import { useMemo, useRef, useState } from 'react';
import { useEngine } from '../state.tsx';
import { Btn } from '../ui/primitives.tsx';
import { Icon } from '../ui/Icon.tsx';
import { useToast } from '../ui/Shell.tsx';
import { Avatar } from './Contacts.tsx';
import { parseVCards, fromMac, plan, apply, type Planned, type MacContact, type Incoming } from '../contactImport.ts';
import { shrinkImage } from '../ai/receipt.ts';
import { openExternal } from '../open.ts';

const desktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** data: URL → a small JPEG (photos from a vCard can be several MB). */
async function shrinkDataUrl(url: string) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!m) throw new Error('bad image');
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return shrinkImage(new Blob([bytes], { type: m[1] || 'image/jpeg' }), 320, 0.8);
}

/**
 * Pick contacts to bring in, from the Mac's Contacts or a .vcf file. Shows which are new, which only
 * fill in what is missing on someone you already have, and which you deleted before.
 */
export function ContactImport({ onClose }: { onClose: () => void }) {
  const e = useEngine();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Planned[] | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ text: string; settings?: string } | null>(null);
  const [q, setQ] = useState('');

  const load = (incoming: Incoming[]) => {
    const p = plan(e, incoming);
    setRows(p);
    setPick(new Set(p.filter((x) => x.status !== 'same' && !x.ignored).map((x) => x.c.uid)));
    if (!p.length) setErr({ text: 'Der var ingen kontakter at hente.' });
  };
  async function fromMacApp() {
    setErr(null); setBusy('Henter dine kontakter …');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const list = await invoke<MacContact[]>('contacts_fetch');
      load(list.map(fromMac).filter((x): x is Incoming => !!x));
    } catch (x) {
      const code = String((x as Error)?.message ?? x);
      setErr(code === 'denied'
        ? { text: 'CENTRA har ikke fået lov til at læse dine kontakter. Slå CENTRA til under Systemindstillinger → Anonymitet og sikkerhed → Kontakter, og prøv igen.', settings: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts' }
        : code === 'unavailable' ? { text: 'Det virker kun i Mac-appen. Brug en vCard-fil i stedet.' }
        : { text: `Kontakterne kunne ikke hentes (${code}). Prøv en vCard-fil i stedet: marker alle i appen Kontakter, og vælg Arkiv → Eksportér → Eksportér vCard.` });
    } finally { setBusy(null); }
  }
  async function fromFile(f?: File | null) {
    if (!f) return;
    setErr(null); setBusy('Læser filen …');
    try { load(parseVCards(await f.text())); } catch { setErr({ text: 'Filen kunne ikke læses. Brug en .vcf-fil (vCard).' }); } finally { setBusy(null); }
  }
  async function run() {
    if (!rows) return;
    const chosen = rows.filter((r) => pick.has(r.c.uid));
    setBusy(`Importerer ${chosen.length} …`);
    try {
      const r = await apply(e, chosen, shrinkDataUrl);
      toast({ icon: 'contacts', title: 'Kontakter hentet', text: [r.created && `${r.created} nye`, r.updated && `${r.updated} opdateret`].filter(Boolean).join(' · ') || 'Intet nyt' });
      onClose();
    } catch (x) { setErr({ text: (x as Error).message }); setBusy(null); }
  }

  const shown = useMemo(() => (rows ?? []).filter((r) => !q.trim() || `${r.c.name} ${r.c.phones.map((p) => p.value).join(' ')} ${r.c.emails.map((m) => m.value).join(' ')} ${r.c.company ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())), [rows, q]);
  const count = (s: Planned['status']) => (rows ?? []).filter((r) => r.status === s && !r.ignored).length;
  const toggle = (uid: string) => setPick((p) => { const n = new Set(p); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet cimport" role="dialog" aria-label="Hent kontakter">
        <div className="sheet__body">
          <h2>Hent kontakter</h2>
          {!rows ? (
            <>
              <p className="muted">Hent dem, du allerede har, med numre, mails, adresser, fødselsdage, profiler og billeder. Har du personen i CENTRA i forvejen, bliver kun det manglende fyldt ud. Du vælger selv, hvem der kommer med, og kan slette dem igen bagefter.</p>
              <div className="cimport__src">
                {desktop && <button className="cimport__opt" onClick={() => void fromMacApp()} disabled={!!busy}><Icon name="contacts" /><span><b>Fra Mac'ens Kontakter</b><span className="meta">Alt fra appen Kontakter, også iCloud. Mac'en spørger om lov første gang.</span></span></button>}
                <button className="cimport__opt" onClick={() => file.current?.click()} disabled={!!busy}><Icon name="paperclip" /><span><b>Fra en vCard-fil (.vcf)</b><span className="meta">Fra Kontakter (Arkiv → Eksportér → vCard), iCloud, Google eller din telefon.</span></span></button>
                <input ref={file} type="file" accept=".vcf,text/vcard,text/x-vcard" hidden onChange={(x) => { void fromFile(x.target.files?.[0]); x.target.value = ''; }} />
              </div>
            </>
          ) : (
            <>
              <p className="meta">{count('new')} nye · {count('update')} udfylder nogen, du har · {count('same')} har du allerede{(rows.filter((r) => r.ignored).length ? ` · ${rows.filter((r) => r.ignored).length} slettede før` : '')}</p>
              <div className="cimport__bar">
                <input className="msearch" value={q} onChange={(x) => setQ(x.target.value)} placeholder="Søg" aria-label="Søg" />
                <Btn size="sm" variant="text" onClick={() => setPick(new Set([...pick, ...shown.map((r) => r.c.uid)]))}>Vælg alle</Btn>
                <Btn size="sm" variant="text" onClick={() => setPick(new Set([...pick].filter((u) => !shown.some((r) => r.c.uid === u))))}>Ingen</Btn>
              </div>
              <ul className="cimport__list">
                {shown.map((r) => (
                  <li key={r.c.uid}><label className={`cimport__row ${pick.has(r.c.uid) ? 'is-on' : ''}`}>
                    <input type="checkbox" checked={pick.has(r.c.uid)} onChange={() => toggle(r.c.uid)} />
                    <Avatar p={{ name: r.c.name, photo: r.c.photo }} />
                    <span className="row__body"><span className="ellipsis">{r.c.name}</span><span className="meta ellipsis">{[r.c.phones[0]?.value, r.c.emails[0]?.value, r.c.company].filter(Boolean).join(' · ')}</span></span>
                    <span className={`cimport__tag cimport__tag--${r.ignored ? 'ignored' : r.status}`}>{r.ignored ? 'Slettet før' : r.status === 'new' ? 'Ny' : r.status === 'update' ? `+ ${r.adds.slice(0, 2).join(', ')}` : 'Har alt'}</span>
                  </label></li>
                ))}
              </ul>
            </>
          )}
          {busy && <p className="meta" role="status">{busy}</p>}
          {err && <p className="unlock__error" role="alert">{err.text} {err.settings && <button className="btn btn--text btn--sm" onClick={() => void openExternal(err.settings!)}>Åbn Systemindstillinger</button>}</p>}
          <div className="sheet__foot">
            {rows && <Btn variant="text" onClick={() => { setRows(null); setErr(null); }}>Tilbage</Btn>}
            <span className="push-right" />
            <Btn variant="text" onClick={onClose}>Annullér</Btn>
            {rows && <Btn variant="primary" disabled={!pick.size || !!busy} onClick={() => void run()}>Hent {pick.size} {pick.size === 1 ? 'kontakt' : 'kontakter'}</Btn>}
          </div>
        </div>
      </div>
    </>
  );
}
