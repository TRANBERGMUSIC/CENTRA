import { useMemo, useRef, useState } from 'react';
import { useEngine, useList, useRecord, useRoute, fmt } from '../state.tsx';
import { Btn, vars } from '../ui/primitives.tsx';
import { ask } from '../ui/Confirm.tsx';
import { Icon } from '../ui/Icon.tsx';
import { useToast } from '../ui/Shell.tsx';
import { useScreenEnter } from '../motion.ts';
import { RELATIONS, SOCIALS, socialUrl, initials, hueOf, kr, balances, owed, total, type Person, type Outlay, type Payment } from '../money.ts';
import { shrinkImage } from '../ai/receipt.ts';
import { queueAssist } from './Assist.tsx';
import { ContactImport } from './ContactImport.tsx';
import { rememberDeleted } from '../contactImport.ts';

/** The people you know: how to reach them, how you know them, and what you share (udlæg, mails). */
export function Contacts() {
  const e = useEngine();
  const { route, go } = useRoute();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'contacts');
  const [q, setQ] = useState('');
  const [rel, setRel] = useState('Alle');
  const all = useList('person', (a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'da')) as unknown as Person[];
  const owes = Object.fromEntries(balances(e).map((b) => [b.person, b.left]));
  useList('outlay'); useList('payment');
  const list = all.filter((p) => (rel === 'Alle' || p.relation === rel) && (!q.trim() || `${p.name} ${p.phone ?? ''} ${p.email ?? ''} ${p.relation ?? ''} ${p.company ?? ''} ${p.notes ?? ''} ${(p.socials ?? []).map((s) => s.value).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase())));
  const groups = useMemo(() => {
    const m = new Map<string, Person[]>();
    for (const p of list) { const k = (p.name[0] ?? '#').toUpperCase(); m.set(k, [...(m.get(k) ?? []), p]); }
    return [...m.entries()];
  }, [list]);
  const id = route.id ?? (matchMedia('(max-width: 640px)').matches ? undefined : list[0]?.id);
  const newPerson = () => go({ screen: 'contacts', id: e.create('person', { name: '', createdAt: new Date().toISOString() }) });
  const rels = ['Alle', ...RELATIONS.filter((r) => all.some((p) => p.relation === r))];
  const toast = useToast();
  const [importing, setImporting] = useState(false);
  const [sel, setSel] = useState<Set<string> | null>(null);
  const toggle = (pid: string) => setSel((s) => { const n = new Set(s); if (n.has(pid)) n.delete(pid); else n.add(pid); return n; });
  function removeSelected() {
    if (!sel?.size) return;
    const gone = all.filter((p) => sel.has(p.id));
    for (const p of gone) { rememberDeleted(e, p.macId); e.remove('person', p.id); }
    setSel(null);
    if (route.id && sel.has(route.id)) go({ screen: 'contacts' });
    toast({ icon: 'contacts', text: `${gone.length} ${gone.length === 1 ? 'kontakt' : 'kontakter'} slettet`, action: { label: 'Fortryd', run: () => { for (const p of gone) e.set('person', p.id, { _deleted: false }); } } });
  }

  return (
    <main className={`split ${route.id ? 'has-open' : ''}`} ref={ref}>
      <div className="split__list" data-enter>
        <div className="nlist__head"><h1>Kontakter <span className="meta num">{all.length}</span></h1>
          <span className="nlist__acts">{all.length > 0 && <Btn size="sm" variant="text" onClick={() => setSel(sel ? null : new Set())}>{sel ? 'Færdig' : 'Vælg'}</Btn>}<Btn size="sm" variant="text" onClick={() => setImporting(true)}>Hent</Btn><Btn size="sm" icon="plus" onClick={newPerson}>Ny</Btn></span></div>
        {sel && (
          <div className="selbar">
            <span className="meta num">{sel.size} valgt</span>
            <Btn size="sm" variant="text" onClick={() => setSel(new Set(list.map((p) => p.id)))}>Vælg alle{q || rel !== 'Alle' ? ' viste' : ''}</Btn>
            {all.some((p) => p.macId) && <Btn size="sm" variant="text" onClick={() => setSel(new Set(all.filter((p) => p.macId).map((p) => p.id)))}>Alle hentede</Btn>}
            <span className="push-right" />
            <Btn size="sm" variant="primary" icon="x" disabled={!sel.size} onClick={removeSelected}>Slet</Btn>
          </div>
        )}
        <input className="msearch" value={q} onChange={(x) => setQ(x.target.value)} placeholder="Søg på navn, nummer, mail, noter …" aria-label="Søg i kontakter" />
        {rels.length > 2 && <div className="acctpick">{rels.map((r) => <button key={r} className={rel === r ? 'is-active' : ''} aria-pressed={rel === r} onClick={() => setRel(r)}>{r}</button>)}</div>}
        <div className="plist">
          {groups.map(([letter, ps]) => (
            <div key={letter}>
              <div className="gsec">{letter}</div>
              {ps.map((p) => (
                <button key={p.id} className={`prow ${(sel ? sel.has(p.id) : p.id === id) ? 'is-selected' : ''}`} onClick={() => (sel ? toggle(p.id) : go({ screen: 'contacts', id: p.id }))}>
                  {sel && <span className={`selbox ${sel.has(p.id) ? 'is-on' : ''}`} aria-hidden="true">{sel.has(p.id) && <Icon name="check" size="sm" />}</span>}
                  <Avatar p={p} />
                  <span className="row__body"><span className="ellipsis">{p.name || 'Uden navn'}</span><span className="meta ellipsis">{[p.relation, p.phone, p.email].filter(Boolean).join(' · ') || 'Ingen oplysninger endnu'}</span></span>
                  {owes[p.id] > 0 && <span className="pill pill--focus num">{kr(owes[p.id], { short: true })}</span>}
                </button>
              ))}
            </div>
          ))}
          {!all.length && <p className="muted pad">Ingen kontakter endnu. Tryk Hent for at få dem fra din Mac, opret en, gem en afsender fra indbakken, eller tilføj folk, når du laver et udlæg. Du kan også sige til Assist: "Gem Mads som kontakt, han er min kollega i Netto, 20 30 40 50".</p>}
          {all.length > 0 && !list.length && <p className="muted pad">Ingen fundet.</p>}
        </div>
      </div>
      {id ? <PersonCard key={id} id={id} /> : <div className="split__detail" />}
      {importing && <ContactImport onClose={() => setImporting(false)} />}
    </main>
  );
}

export function Avatar({ p, large }: { p: Pick<Person, 'name' | 'photo'>; large?: boolean }) {
  return p.photo
    ? <img className={`avatar avatar--img ${large ? 'avatar--xl' : ''}`} src={p.photo} alt="" />
    : <span className={`avatar ${large ? 'avatar--xl' : ''}`} style={vars({ '--h': hueOf(p.name || '?') })}>{initials(p.name || '?')}</span>;
}

function PersonCard({ id }: { id: string }) {
  const e = useEngine();
  const { go } = useRoute();
  const toast = useToast();
  const p = useRecord<Person>(id);
  const outlays = useList('outlay') as unknown as Outlay[];
  const pays = useList('payment') as unknown as Payment[];
  const mails = useList('mail') as any[];
  const photo = useRef<HTMLInputElement>(null);
  const [social, setSocial] = useState('instagram');
  const [sv, setSv] = useState('');
  if (!p) return <div className="split__detail" />;
  const set = (f: Partial<Person>) => e.set('person', id, f as Record<string, unknown>);
  const field = (k: keyof Person, label: string, type = 'text', ph = '') => (
    <label className="ufield"><span>{label}</span><input type={type} defaultValue={(p[k] as string) ?? ''} placeholder={ph} onBlur={(x) => { const v = x.target.value.trim(); if (v !== ((p[k] as string) ?? '')) set({ [k]: v } as Partial<Person>); }} /></label>
  );
  const shared = outlays.filter((o) => (o.people ?? []).includes(id)).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const myOwed = shared.map((o) => ({ o, w: owed(o, pays).find((x) => x.person === id)! })).filter((x) => x.w);
  const left = myOwed.reduce((s, x) => s + x.w.left, 0);
  const theirMails = p.email ? mails.filter((m) => m.fromEmail?.toLowerCase() === p.email!.toLowerCase()).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6) : [];

  async function remove() {
    if (shared.length && !(await ask({ title: `Slet ${p!.name}?`, text: `${p!.name} er med i ${shared.length} udlæg. Udlæggene beholdes.`, ok: 'Slet', danger: true }))) return;
    const { id: _i, type: _t, ...f } = p as any;
    rememberDeleted(e, p!.macId);
    e.remove('person', id); go({ screen: 'contacts' });
    toast({ person: { name: p!.name || '?', photo: p!.photo }, text: `${p!.name || 'Kontakten'} er slettet`, action: { label: 'Fortryd', run: () => { e.set('person', id, { ...f, _deleted: false }); go({ screen: 'contacts', id }); } } });
  }

  return (
    <div className="split__detail" data-lenis-prevent>
      <button className="phone-back" onClick={() => go({ screen: 'contacts' })}><Icon name="chevron-left" size="sm" />Kontakter</button>
      <div className="pcard__head">
        <button className="pcard__photo" onClick={() => photo.current?.click()} aria-label="Skift profilbillede" title="Skift profilbillede"><Avatar p={p} large /><span className="pcard__cam"><Icon name="camera" size="sm" /></span></button>
        <input ref={photo} type="file" accept="image/*" hidden onChange={async (x) => { const f = x.target.files?.[0]; if (f) { try { set({ photo: await shrinkImage(f, 320, 0.8) }); } catch (er) { toast({ text: (er as Error).message }); } } x.target.value = ''; }} />
        <div className="pcard__name">
          <input className="gtitle" defaultValue={p.name} autoFocus={!p.name} placeholder="Navn" aria-label="Navn" onBlur={(x) => x.target.value.trim() !== p.name && set({ name: x.target.value.trim() })} />
          <div className="pcard__quick">
            {p.phone && <a className="btn btn--secondary btn--sm" href={`tel:${p.phone.replace(/\s/g, '')}`}><Icon name="phone" size="sm" />Ring</a>}
            {p.phone && <a className="btn btn--secondary btn--sm" href={`sms:${p.phone.replace(/\s/g, '')}`}>Sms</a>}
            {p.email && <a className="btn btn--secondary btn--sm" href={`mailto:${p.email}`}><Icon name="send" size="sm" />Mail</a>}
            <Btn size="sm" variant="text" icon="assist" onClick={() => { queueAssist(`Hvad ved du om ${p.name}? Opsummér kort.`); go({ screen: 'assist' }); }}>Spørg Assist</Btn>
            {p.photo && <Btn size="sm" variant="text" onClick={() => set({ photo: '' })}>Fjern billede</Btn>}
          </div>
        </div>
      </div>

      <div className="pcard__grid">
        <section className="panel">
          <h2 className="panel__title">Oplysninger</h2>
          <div className="gedit__grid pad-top">
            {field('phone', 'Telefon', 'tel', '+45 …')}
            {field('email', 'Mail', 'email')}
            <label className="ufield"><span>Relation</span><input list="relations" defaultValue={p.relation ?? ''} placeholder="Ven, familie, kollega …" onBlur={(x) => set({ relation: x.target.value.trim() })} /></label>
            <datalist id="relations">{RELATIONS.map((r) => <option key={r} value={r} />)}</datalist>
            {field('company', 'Arbejde / firma')}
            {field('birthday', 'Fødselsdag', 'date')}
            {field('address', 'Adresse')}
          </div>
          {(p.extra ?? []).length > 0 && <>
            <h3 className="panel__title pad-top">Mere</h3>
            <ul className="rows">{(p.extra ?? []).map((x, i) => {
              const href = /@/.test(x.value) ? `mailto:${x.value}` : /^\+?[\d\s()-]{6,}$/.test(x.value) ? `tel:${x.value.replace(/\s/g, '')}` : undefined;
              return (
                <li key={i} className="memrow"><span className="meta socialkind">{x.label}</span>
                  {href ? <a className="row__body ellipsis" href={href}>{x.value}</a> : <span className="row__body ellipsis">{x.value}</span>}
                  <Btn size="sm" variant="text" icon="x" aria-label="Fjern" onClick={() => set({ extra: (p.extra ?? []).filter((_, j) => j !== i) })} /></li>
              );
            })}</ul>
          </>}
          <h3 className="panel__title pad-top">Sociale medier</h3>
          <ul className="rows">{(p.socials ?? []).map((s, i) => (
            <li key={i} className="memrow"><span className="meta socialkind">{SOCIALS.find(([, k]) => k === s.kind)?.[0] ?? s.kind}</span>
              <a className="row__body ellipsis" href={socialUrl(s)} target="_blank" rel="noreferrer">{s.value}</a>
              <Btn size="sm" variant="text" icon="x" aria-label="Fjern" onClick={() => set({ socials: (p.socials ?? []).filter((_, j) => j !== i) })} /></li>
          ))}</ul>
          <form className="askbar" onSubmit={(x) => { x.preventDefault(); if (sv.trim()) { set({ socials: [...(p.socials ?? []), { kind: social, value: sv.trim() }] }); setSv(''); } }}>
            <select className="kvinput socialpick" value={social} onChange={(x) => setSocial(x.target.value)} aria-label="Type">{SOCIALS.map(([l, k]) => <option key={k} value={k}>{l}</option>)}</select>
            <input value={sv} onChange={(x) => setSv(x.target.value)} placeholder="@brugernavn eller link" aria-label="Brugernavn" />
            <Btn type="submit" icon="plus" disabled={!sv.trim()}>Tilføj</Btn>
          </form>
        </section>

        <section className="panel">
          <h2 className="panel__title">Noter</h2>
          <p className="meta">Hvem er {p.name?.split(' ')[0] || 'personen'}, hvad laver de, hvad bruger du kontakten til? Assist læser med og husker det.</p>
          <textarea className="pnotes" defaultValue={p.notes ?? ''} placeholder="Fx: Kollega i Netto. Spiller bas. Kan låne en trailer." onBlur={(x) => x.target.value !== (p.notes ?? '') && set({ notes: x.target.value })} />
        </section>

        <section className="panel">
          <div className="panel__head"><h2 className="panel__title">Udlæg</h2>{left > 0 && <span className="pill pill--focus num">Skylder {kr(left)}</span>}</div>
          {myOwed.length ? <ul className="rows">{myOwed.map(({ o, w }) => (
            <li key={o.id}><button className="row" onClick={() => go({ screen: 'outlays', id: o.id })}>
              <Icon name="receipt" /><span className="row__body"><span className="row__line"><span className="ellipsis">{o.title}</span><span className="num row__trail">{w.left > 0 ? kr(w.left) : 'Betalt'}</span></span><span className="meta">{fmt.shortDate(o.date)} · andel {kr(w.share)} af {kr(total(o))}</span></span>
            </button></li>
          ))}</ul> : <p className="muted">Ingen udlæg med {p.name?.split(' ')[0] || 'personen'} endnu.</p>}
        </section>

        {theirMails.length > 0 && (
          <section className="panel">
            <h2 className="panel__title">Seneste mails</h2>
            <ul className="rows">{theirMails.map((m) => <li key={m.id}><button className="row" onClick={() => go({ screen: 'inbox', id: m.id })}><Icon name="inbox" /><span className="row__body"><span className="ellipsis">{m.subject}</span><span className="meta">{fmt.shortDate(m.at)}</span></span></button></li>)}</ul>
          </section>
        )}
      </div>
      <div className="gedit__foot"><Btn size="sm" variant="text" icon="x" onClick={remove}>Slet kontakt</Btn></div>
    </div>
  );
}
