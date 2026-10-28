import { useEffect, useRef, useState } from 'react';
import { explain } from '../session.ts';
import { lock } from '../lock.ts';
import { useEngine, useList, useRoute, useSession, useSyncStatus, fmt } from '../state.tsx';
import { Btn, Panel } from '../ui/primitives.tsx';
import { ask } from '../ui/Confirm.tsx';
import { useToast } from '../ui/Shell.tsx';
import { useScreenEnter } from '../motion.ts';
import { APP_VERSION, WEB_VERSION, REPO, checkForUpdate, platform, type Update } from '../updater.ts';
import type { DeviceRecord } from '@centra/sync';
import { bioKind, bioIsOn, bioEnable, bioDisable, bioProblem, BIO_NAME, type BioKind } from '../biometrics.ts';
import { remoteImagesOn, setRemoteImages } from '../ui/MailView.tsx';
import { aiSettings, saveAiSettings, testAi, CLAUDE_MODELS, type AiSettings } from '../ai/agent.ts';

export type Theme = 'dark' | 'oled' | 'light';
export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'light' ? '#F4F1EC' : t === 'oled' ? '#000000' : '#0B0C0F');
}

export function Settings({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const session = useSession();
  const { relay, device, user } = session;
  const e = useEngine();
  const toast = useToast();
  useList('setting');
  const status = useSyncStatus();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'settings');
  const [devices, setDevices] = useState<DeviceRecord[]>(relay.devices);
  const [update, setUpdate] = useState<Update | null | 'checking' | 'none' | 'error'>(null);
  useEffect(() => { relay.onDevices = setDevices; setDevices(relay.devices); return () => { relay.onDevices = undefined; }; }, [relay]);

  async function check() {
    setUpdate('checking');
    try { setUpdate((await checkForUpdate()) ?? 'none'); } catch { setUpdate('error'); }
  }

  function exportAll() {
    const data = { exportedAt: new Date().toISOString(), version: APP_VERSION, records: ['note', 'event', 'mail', 'goal', 'goalUpdate', 'memory', 'rule', 'suggestion', 'person', 'watch', 'chat', 'outlay', 'payment', 'expense', 'usage'].flatMap((t) => e.list(t)),
      noteBodies: Object.fromEntries(e.list('note').map((n) => [n.id, e.doc(n.id).getText('body').toString()])) };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `centra-eksport-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }

  return (
    <main className="canvas" ref={ref}>
      <div className="titlerow" data-enter><div><h1>Indstillinger</h1><p>Logget ind som {user.charAt(0).toUpperCase() + user.slice(1)}</p></div></div>
      <div className="grid12">
        <SecurityPanel />
        <AiPanel />
        <Panel title="Tema" className="span-5">
          <div className="segmented" role="radiogroup" aria-label="Tema">
            {([['dark', 'Mørk'], ['oled', 'OLED sort'], ['light', 'Lys']] as const).map(([k, l]) => (
              <button key={k} role="radio" aria-checked={theme === k} className={theme === k ? 'is-active' : ''} onClick={() => setTheme(k)}>{l}</button>
            ))}
          </div>
        </Panel>
        <Panel title="Opdateringer" className="span-7">
          <div className="kv"><span>Version</span><span className="num">{APP_VERSION} · {platform === 'desktop' ? 'desktop-app' : platform === 'mobile' ? 'mobil-app' : 'web'}</span></div>
          <div className="kv"><span>Grænseflade<span className="meta block">{platform === 'desktop' ? 'Opdateres for sig selv på under et minut, uden ny app' : 'Bygget'}</span></span><span className="num">{new Date(WEB_VERSION * 1000).toLocaleString('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
          <div className="kv"><span>Kilde</span><span className="meta">github.com/{REPO}/releases</span></div>
          <div className="kv"><span>{update === 'none' ? 'Du har den nyeste version' : update === 'error' ? 'Kunne ikke tjekke. Enten er du offline, eller den nyeste udgivelse på GitHub mangler sin opdateringsfil (latest.json).' : update === 'checking' ? 'Søger …' : update && typeof update === 'object' ? `Version ${update.version} er klar` : 'Søger automatisk ved start, hvert kvarter og når vinduet får fokus'}</span>
            {update && typeof update === 'object' ? <Btn variant="primary" size="sm" onClick={() => update.install()}>Installér og genstart</Btn> : <Btn size="sm" onClick={check}>Søg nu</Btn>}</div>
        </Panel>
        {session.sync ? (<>
        <Panel title="Enheder" className="span-7" count={devices.filter((d) => !d.revoked).length}>
          <ul className="rows">
            {devices.filter((d) => !d.revoked).map((d) => (
              <li key={d.id} className="row">
                <span className={`dot ${d.online ? '' : 'dot--off'}`} />
                <span className="row__body"><span className="row__line"><span>{d.name}</span>{d.id === device && <span className="meta">denne enhed</span>}</span><span className="row__line meta">{d.online ? 'Online nu' : 'Sidst set ' + fmt.ago(new Date(d.lastSeen).toISOString())}</span></span>
                {d.id !== device && <Btn size="sm" variant="text" onClick={async () => {
                  if (!(await ask({ title: `Log ${d.name} ud?`, text: 'Enheden mister adgang med det samme, og nye data krypteres med en ny nøgle.', ok: 'Log ud', danger: true }))) return;
                  try { await session.logOutDevice(d.id); toast({ text: `${d.name} er logget ud. Skift også dit password, hvis enheden er mistet.` }); } catch (e) { toast({ text: explain(e) }); }
                }}>Log ud</Btn>}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Synkronisering og kryptering" className="span-5">
          <div className="kv"><span>Forbindelse</span><span className="meta">{status.online ? 'Online' : 'Offline, ændringer gemmes lokalt'}</span></div>
          <div className="kv"><span>Venter på at blive sendt</span><span className="num">{status.pending}</span></div>
          <div className="kv"><span>Sidst synkroniseret</span><span className="num">{status.last ? fmt.hm(new Date(status.last)) : '—'}</span></div>
          <p className="meta pad-top">Alt indhold krypteres på enheden med en nøgle fra dit password (Argon2id + XChaCha20-Poly1305). Serveren gemmer kun krypterede data.</p>
        </Panel>
        </>) : (
        <Panel title="Synkronisering" className="span-12">
          <div className="kv"><span>Slået fra<span className="meta block">CENTRA kører på denne computer, og alt gemmes krypteret med en nøgle fra dit password. Sync til iPhone og andre computere er bygget og slås til senere.</span></span><span className="meta">Kun denne enhed</span></div>
        </Panel>
        )}
        <Panel title="Mail" className="span-12">
          <div className="kv"><span>Vis billeder i mails automatisk<span className="meta block">Billeder hentes fra afsenderens server, når du åbner mailen. Slår du det fra, viser CENTRA en knap i stedet, og afsenderen kan ikke se, at du har læst den. Usynlige sporings-pixels fjernes altid.</span></span>
            <label className="checkrow"><input type="checkbox" checked={remoteImagesOn(e)} onChange={(x) => { setRemoteImages(e, x.target.checked); toast({ text: x.target.checked ? 'Billeder vises automatisk' : 'Billeder vises først, når du beder om det' }); }} aria-label="Vis billeder i mails automatisk" /></label></div>
        </Panel>
        <DataPanel onExport={exportAll} />
      </div>
    </main>
  );
}

/** What can be wiped, one kind at a time or everything. Every wipe can be undone right after. */
const KINDS: [string, string, string[]][] = [
  ['Udlæg og betalinger', 'Alle udlæg, varer og registrerede tilbagebetalinger', ['outlay', 'payment']],
  ['Kontakter', 'Personer med billeder, numre og noter', ['person']],
  ['Udgifter', 'Faste udgifter og abonnementer', ['expense']],
  ['Noter', 'Alle noter', ['note']],
  ['Kalender', 'Aftaler du har lavet (abonnerede kalendere hentes igen)', ['event']],
  ['Mål', 'Mål og alle deres opdateringer', ['goal', 'goalUpdate']],
  ['Samtaler med Assist', 'Chathistorikken', ['chat']],
  ['Det Assist ved om dig', 'Hukommelse, regler, mail-overvågning og forslag', ['memory', 'rule', 'watch', 'suggestion']],
  ['Mails på denne computer', 'Kun kopierne i CENTRA. Mails på serveren røres ikke og hentes igen', ['mail']],
  ['Claude-forbrug', 'Historikken over hvad Assist har kostet', ['usage']],
];

function DataPanel({ onExport }: { onExport: () => void }) {
  const e = useEngine();
  const toast = useToast();
  for (const [, , types] of KINDS) for (const t of types) useList(t); // eslint-disable-line react-hooks/rules-of-hooks
  const [ask, setAsk] = useState<string | null>(null);
  const [word, setWord] = useState('');
  const count = (types: string[]) => types.reduce((n, t) => n + e.list(t).length, 0);
  const wipe = (types: string[], label: string) => {
    const gone = types.flatMap((t) => e.list(t).map((r) => [t, r.id] as const));
    for (const [t, id] of gone) e.remove(t, id);
    setAsk(null); setWord('');
    toast({ text: `${label} er slettet (${gone.length})`, action: { label: 'Fortryd', run: () => { for (const [t, id] of gone) e.set(t, id, { _deleted: false }); } } });
  };
  const all = KINDS.flatMap(([, , t]) => t);
  return (
    <Panel title="Data" className="span-12">
      <div className="kv"><span>Eksportér alt som JSON<span className="meta block">Tag en kopi, før du sletter noget.</span></span><Btn size="sm" onClick={onExport}>Eksportér</Btn></div>
      {KINDS.map(([label, sub, types]) => {
        const n = count(types);
        return (
          <div key={label} className="kv"><span>{label}<span className="meta block">{sub}</span></span>
            {ask === label ? <span className="kvacts"><span className="meta">Slet {n}?</span><Btn size="sm" variant="primary" onClick={() => wipe(types, label)}>Ja, slet</Btn><Btn size="sm" variant="text" onClick={() => setAsk(null)}>Annullér</Btn></span>
              : <span className="kvacts"><span className="meta num">{n}</span><Btn size="sm" disabled={!n} onClick={() => setAsk(label)}>Slet</Btn></span>}
          </div>
        );
      })}
      <div className="kv kv--danger"><span>Slet alt indhold<span className="meta block">Alt ovenfor på én gang. Dit login, dine forbindelser og indstillinger bliver. Skriv SLET for at bekræfte.</span></span>
        <span className="kvacts"><input className="kvinput" value={word} onChange={(x) => setWord(x.target.value)} placeholder="SLET" aria-label="Skriv SLET" style={{ width: 90 }} /><Btn size="sm" variant="primary" disabled={word.trim().toUpperCase() !== 'SLET'} onClick={() => wipe(all, 'Alt indhold')}>Slet alt</Btn></span>
      </div>
    </Panel>
  );
}

/** Password, recovery code and lock: every change asks for the current password first. */
function SecurityPanel() {
  const session = useSession();
  const toast = useToast();
  const [form, setForm] = useState<null | 'password' | 'recovery'>(null);
  const [cur, setCur] = useState('');
  const [n1, setN1] = useState('');
  const [n2, setN2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const reset = () => { setForm(null); setCur(''); setN1(''); setN2(''); setErr(null); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (form === 'password') {
      if (n1.length < 12) return setErr('Det nye password skal være mindst 12 tegn.');
      if (n1 !== n2) return setErr('De to nye passwords er ikke ens.');
    }
    setBusy(true);
    await new Promise((r) => setTimeout(r, 20));
    try {
      if (form === 'password') { await session.changePassword(cur, n1); toast({ text: 'Password skiftet. Andre enheder skal logge ind igen.' }); reset(); }
      else { const c = await session.newRecoveryCode(cur); setCode(c); setForm(null); setCur(''); }
    } catch (x) { setErr(explain(x)); } finally { setBusy(false); }
  }

  return (
    <Panel title="Sikkerhed" className="span-12">
      {code ? (
        <div className="seccode">
          <p>Din nye gendannelsesnøgle. Den gamle virker ikke længere. Gem den nu, den vises kun én gang.</p>
          <code className="recovery">{code}</code>
          <div className="unlock__row"><Btn onClick={() => { void navigator.clipboard?.writeText(code); toast({ text: 'Kopieret' }); }}>Kopiér</Btn><Btn variant="primary" onClick={() => setCode(null)}>Jeg har gemt den</Btn></div>
        </div>
      ) : form ? (
        <form className="secform" onSubmit={submit}>
          <input type="text" name="username" autoComplete="username" value={session.user} readOnly hidden />
          <label className="ufield"><span>Nuværende password</span><input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></label>
          {form === 'password' && <>
            <label className="ufield"><span>Nyt password (mindst 12 tegn)</span><input type="password" autoComplete="new-password" value={n1} onChange={(e) => setN1(e.target.value)} required minLength={12} /></label>
            <label className="ufield"><span>Gentag nyt password</span><input type="password" autoComplete="new-password" value={n2} onChange={(e) => setN2(e.target.value)} required minLength={12} /></label>
          </>}
          {err && <p className="unlock__error" role="alert">{err}</p>}
          <div className="unlock__row"><Btn type="button" variant="text" onClick={reset}>Annullér</Btn><Btn type="submit" variant="primary" disabled={busy}>{busy ? 'Arbejder …' : form === 'password' ? 'Skift password' : 'Lav ny nøgle'}</Btn></div>
        </form>
      ) : (
        <>
          <div className="kv"><span>Password<span className="meta block">Låser dine data op. Gemmes ingen steder.</span></span><Btn size="sm" onClick={() => setForm('password')}>Skift password</Btn></div>
          <div className="kv"><span>Gendannelsesnøgle<span className="meta block">Den eneste vej ind, hvis du glemmer dit password.</span></span><Btn size="sm" onClick={() => setForm('recovery')}>Lav ny</Btn></div>
          <BioRow />
          <div className="kv"><span>Automatisk lås<span className="meta block">Efter 15 min uden aktivitet, eller 5 min i baggrunden.</span></span><Btn size="sm" onClick={() => lock()}>Lås nu</Btn></div>
        </>
      )}
    </Panel>
  );
}

/** Touch ID on/off. Turning it on asks for the finger once; the key then lives in the Mac's keychain. */
function BioRow() {
  const session = useSession();
  const toast = useToast();
  const [kind, setKind] = useState<BioKind>('none');
  const [on, setOn] = useState(() => bioIsOn(session.user));
  const [busy, setBusy] = useState(false);
  useEffect(() => { void bioKind().then(setKind); }, []);
  if (platform !== 'desktop') return null;
  const name = BIO_NAME[kind === 'none' ? 'touchid' : kind];
  async function toggle(next: boolean) {
    setBusy(true);
    try {
      if (next) { await bioEnable(session); toast({ icon: 'fingerprint', text: `${name} er slået til. Næste gang låser du op med fingeren.` }); }
      else { await bioDisable(session.user); toast({ icon: 'fingerprint', text: `${name} er slået fra` }); }
      setOn(next);
    } catch (e) {
      const msg = bioProblem(String((e as Error)?.message ?? e), name);
      if (msg) toast({ icon: 'fingerprint', text: msg });
    } finally { setBusy(false); }
  }
  return (
    <div className="kv"><span>Lås op med {name}<span className="meta block">{kind === 'none' ? 'Denne Mac har ingen fingeraftrykslæser, eller der er ikke sat et fingeraftryk op.' : `Nøglen gemmes i Mac'ens nøglering og bruges kun efter ${name}. Dit password virker stadig altid.`}</span></span>
      <label className="checkrow"><input type="checkbox" checked={on} disabled={busy || (kind === 'none' && !on)} onChange={(x) => void toggle(x.target.checked)} aria-label={`Lås op med ${name}`} /></label></div>
  );
}

/** Which brain Assist uses. The Claude key lives in the encrypted store and is never shown again. */
function AiPanel() {
  const e = useEngine();
  const { go } = useRoute();
  const toast = useToast();
  const [s, setS] = useState<AiSettings>(() => aiSettings(e));
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const save = (p: Partial<AiSettings>) => { saveAiSettings(e, p); setS(aiSettings(e)); };
  async function test() {
    setBusy(true);
    try { const r = await testAi(aiSettings(e)); toast({ text: `Assist svarer: ${r}` }); } catch (x) { toast({ text: (x as Error).message }); } finally { setBusy(false); }
  }
  async function saveKey(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    try { await testAi({ ...s, provider: 'claude', claudeKey: key.trim() }); save({ claudeKey: key.trim(), provider: 'claude' }); setKey(''); toast({ text: 'Nøglen virker og er gemt krypteret' }); }
    catch (x) { toast({ text: (x as Error).message }); } finally { setBusy(false); }
  }
  return (
    <Panel title="Assist" className="span-12">
      <div className="kv"><span>Hjerne<span className="meta block">Claude er klogest. En lokal model kører helt på din Mac via Ollama.</span></span>
        <div className="segmented" role="radiogroup" aria-label="Hjerne">
          {([['claude', 'Claude'], ['local', 'Lokal model']] as const).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={s.provider === k} className={s.provider === k ? 'is-active' : ''} onClick={() => save({ provider: k })}>{l}</button>
          ))}
        </div></div>
      <div className="kv"><span>Claude API-nøgle<span className="meta block">{s.claudeKey ? 'Gemt krypteret (slutter på …' + s.claudeKey.slice(-4) + ')' : 'Hent en på console.anthropic.com → API keys'}</span></span>
        <form className="connect" onSubmit={saveKey}>
          <input className="kvinput" type="password" autoComplete="off" spellCheck={false} placeholder={s.claudeKey ? 'Ny nøgle' : 'sk-ant-…'} value={key} onChange={(ev) => setKey(ev.target.value)} aria-label="Claude API-nøgle" />
          <Btn size="sm" type="submit" disabled={busy || key.trim().length < 20}>Gem</Btn>
          {s.claudeKey && <Btn size="sm" type="button" variant="text" onClick={async () => { if (await ask({ title: 'Fjern Claude-nøglen?', text: 'Assist virker ikke, før du sætter en ny ind.', ok: 'Fjern', danger: true })) save({ claudeKey: '' }); }}>Fjern</Btn>}
        </form></div>
      <div className="kv"><span>Claude-model<span className="meta block">Automatisk sparer tokens: Haiku til korte kommandoer, Opus til det svære, Sonnet til resten.</span></span>
        <select className="kvinput" value={s.modelMode || 'auto'} onChange={(ev) => save({ modelMode: ev.target.value })} aria-label="Claude-model">
          {CLAUDE_MODELS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
        </select></div>
      <div className="kv"><span>Lokal model<span className="meta block">Navn i Ollama, fx qwen3:8b eller llama3.1. Hent med: ollama pull {s.localModel}</span></span>
        <input className="kvinput" defaultValue={s.localModel} onBlur={(ev) => ev.target.value.trim() && save({ localModel: ev.target.value.trim() })} aria-label="Lokal model" /></div>
      <div className="kv"><span>Brug den lokale model, når Claude ikke kan nås</span>
        <input type="checkbox" checked={s.fallbackLocal} onChange={(ev) => save({ fallbackLocal: ev.target.checked })} aria-label="Lokal model som reserve" /></div>
      <div className="kv"><span>Sortér nye mails med AI<span className="meta block">Claude (den hurtige model) læser afsender, emne og et kort uddrag af nye mails og flytter reklamer og nyhedsbreve til "Andet".</span></span>
        <input type="checkbox" checked={s.triage} onChange={(ev) => save({ triage: ev.target.checked })} aria-label="Sortér mails med AI" /></div>
      <div className="kv"><span>Forbrug og budget<span className="meta block">Hvad Claude har kostet, pr. dag og model, og hvad automatisk modelvalg har sparet.</span></span><Btn size="sm" onClick={() => go({ screen: 'usage' })}>Se forbrug</Btn></div>
      <div className="kv"><span>Test forbindelsen</span><Btn size="sm" onClick={test} disabled={busy}>{busy ? 'Tester …' : 'Test'}</Btn></div>
    </Panel>
  );
}
