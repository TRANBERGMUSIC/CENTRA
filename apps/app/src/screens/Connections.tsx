import { useRef, useState } from 'react';
import { useEngine, useList, useRoute, fmt } from '../state.tsx';
import { Btn, Panel } from '../ui/primitives.tsx';
import { Icon } from '../ui/Icon.tsx';
import { useToast } from '../ui/Shell.tsx';
import { useScreenEnter } from '../motion.ts';
import { PRESETS, mailAvailable, testAccount, syncAccount, type MailAccount, type Preset, type Security } from '../mail.ts';
import { FEED_GUIDES, syncFeed, removeFeed, type CalFeed } from '../feeds.ts';
import { aiSettings } from '../ai/agent.ts';
import { DEFAULT_URL, testLunchHub, syncLunchHub, removeLunchHub, type LhConn } from '../lunchhub.ts';

/** Everything CENTRA pulls in from outside: mail accounts, calendars and the AI. */
export function Connections() {
  const e = useEngine();
  const { go } = useRoute();
  const toast = useToast();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'connections');
  const accts = useList('mailacct') as unknown as MailAccount[];
  const feeds = useList('calfeed') as unknown as CalFeed[];
  const lh = useList('lhconn') as unknown as LhConn[];
  useList('setting');
  const ai = aiSettings(e);
  const [adding, setAdding] = useState<null | 'mail' | 'cal' | 'lh'>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh(a: MailAccount) {
    setBusy(a.id);
    const r = await syncAccount(e, a);
    setBusy(null);
    toast({ text: r.error ? `${a.name}: ${r.error}` : r.added.length ? `${r.added.length} nye mails fra ${a.name}` : `${a.name} er opdateret` });
  }
  function removeAcct(a: MailAccount) {
    if (!confirm(`Fjern ${a.name} (${a.email}) fra CENTRA? Mails fra kontoen fjernes her, men ikke på serveren.`)) return;
    for (const m of e.list('mail')) if ((m as any).acct === a.id) e.remove('mail', m.id);
    e.remove('mailacct', a.id);
    toast({ text: `${a.name} er fjernet` });
  }

  return (
    <main className="canvas" ref={ref}>
      <div className="titlerow" data-enter><div><h1>Forbindelser</h1><p>Saml dine mails og kalendere i CENTRA. Adgangskoder gemmes krypteret med dit CENTRA-password og bruges kun til at hente og sende for dig.</p></div></div>
      <div className="grid12">
        <Panel title="Mail" className="span-12" count={accts.length} aside={<Btn size="sm" icon="plus" className="push-right" onClick={() => setAdding('mail')}>Tilføj mailkonto</Btn>}>
          {!mailAvailable() && <p className="muted">Mail virker kun i CENTRA-appen på din Mac. På telefonen og i browseren kan du se mails, der allerede er hentet, når sync slås til.</p>}
          {accts.length ? (
            <ul className="rows">{accts.map((a) => (
              <li key={a.id} className="memrow">
                <span className={`dot ${a.lastError ? 'dot--err' : ''}`} />
                <span className="row__body"><span className="row__line"><span className="strong">{a.name}</span><span className="meta">&nbsp;· {a.email}</span></span>
                  <span className={`meta ${a.lastError ? 'errtext' : ''}`}>{a.lastError ? a.lastError : a.lastSync ? `Hentet ${fmt.ago(a.lastSync)} · henter selv hvert 2. minut` : 'Ikke hentet endnu'}</span></span>
                <Btn size="sm" variant="text" disabled={busy === a.id || !mailAvailable()} onClick={() => refresh(a)}>{busy === a.id ? 'Henter …' : 'Hent nu'}</Btn>
                <Btn size="sm" variant="text" icon="x" aria-label={`Fjern ${a.name}`} onClick={() => removeAcct(a)} />
              </li>
            ))}</ul>
          ) : <p className="muted">Ingen mailkonti endnu. Tilføj Gmail, iCloud, one.com, Simply eller en anden IMAP-konto, så samles det hele i din indbakke.</p>}
        </Panel>

        <Panel title="Kalendere" className="span-12" count={feeds.length} aside={<Btn size="sm" icon="plus" className="push-right" onClick={() => setAdding('cal')}>Tilføj kalender</Btn>}>
          {feeds.length ? (
            <ul className="rows">{feeds.map((f) => (
              <li key={f.id} className="memrow">
                <span className={`dot ${f.lastError ? 'dot--err' : ''}`} />
                <span className="row__body"><span className="strong">{f.name}</span>
                  <span className={`meta ${f.lastError ? 'errtext' : ''}`}>{f.lastError || (f.lastSync ? `${f.count ?? 0} aftaler · opdateret ${fmt.ago(f.lastSync)} · kun visning` : 'Ikke hentet endnu')}</span></span>
                <Btn size="sm" variant="text" disabled={busy === f.id} onClick={async () => { setBusy(f.id); try { const n = await syncFeed(e, f); toast({ text: `${f.name}: ${n} aftaler` }); } catch (x) { toast({ text: (x as Error).message }); } setBusy(null); }}>{busy === f.id ? 'Henter …' : 'Opdatér'}</Btn>
                <Btn size="sm" variant="text" icon="x" aria-label={`Fjern ${f.name}`} onClick={() => { if (confirm(`Fjern kalenderen ${f.name} og dens aftaler fra CENTRA?`)) { removeFeed(e, f.id); toast({ text: `${f.name} er fjernet` }); } }} />
              </li>
            ))}</ul>
          ) : <p className="muted">Ingen kalendere endnu. Tilføj din Google-, iCloud- eller Outlook-kalender med dens hemmelige iCal-adresse. Dine egne aftaler i CENTRA ligger der allerede.</p>}
        </Panel>

        <Panel title="LunchHub" className="span-12" count={lh.length} aside={!lh.length ? <Btn size="sm" icon="plus" className="push-right" onClick={() => setAdding('lh')}>Forbind LunchHub</Btn> : undefined}>
          {lh.length ? (
            <ul className="rows">{lh.map((c) => (
              <li key={c.id} className="memrow">
                <span className={`dot ${c.lastError ? 'dot--err' : ''}`} />
                <span className="row__body"><span className="row__line"><span className="strong">{c.name}</span><span className="meta">&nbsp;· {c.who ?? ''}{c.sites ? ` · ${c.sites}` : ''}</span></span>
                  <span className={`meta ${c.lastError ? 'errtext' : ''}`}>{c.lastError || (c.lastSync ? `Hentet ${fmt.ago(c.lastSync)} · henvendelser lander i din indbakke` : 'Ikke hentet endnu')}</span></span>
                <Btn size="sm" variant="text" disabled={busy === c.id || !mailAvailable()} onClick={async () => { setBusy(c.id); const r = await syncLunchHub(e, c); setBusy(null); toast({ text: r.error ? `LunchHub: ${r.error}` : r.added.length ? `${r.added.length} nye henvendelser fra LunchHub` : 'LunchHub er opdateret' }); }}>{busy === c.id ? 'Henter …' : 'Hent nu'}</Btn>
                <Btn size="sm" variant="text" icon="x" aria-label={`Fjern ${c.name}`} onClick={() => { if (confirm('Fjern LunchHub fra CENTRA? Henvendelserne forsvinder her, men bliver i LunchHub.')) { removeLunchHub(e, c.id); toast({ text: 'LunchHub er fjernet' }); } }} />
              </li>
            ))}</ul>
          ) : <p className="muted">Få henvendelserne fra frajorden.dk, smagssans.dk og bord.dk ind i din indbakke her. Svarer du, eller arkiverer du en, bliver den også markeret i LunchHub.</p>}
        </Panel>

        <Panel title="Assist" className="span-12">
          <div className="kv"><span>{ai.provider === 'claude' ? (ai.claudeKey ? 'Claude er forbundet' : 'Claude er ikke forbundet') : `Lokal model: ${ai.localModel}`}<span className="meta block">Assist kan læse og søge i dine mails og kalendere, lave svarudkast og holde øje med bestemte mails. Den sender aldrig noget uden dig.</span></span>
            <Btn size="sm" onClick={() => go({ screen: 'settings' })}>Indstillinger</Btn></div>
        </Panel>

        <Panel title="Kommer senere" className="span-12">
          <ul className="rows soon">
            <li><Icon name="inbox" size="sm" />Outlook / Microsoft 365 med Microsoft-login</li>
            <li><Icon name="calendar" size="sm" />Google- og iCloud-kalender med redigering begge veje</li>
            <li><Icon name="check" size="sm" />Påmindelser og kontakter fra iPhone</li>
          </ul>
        </Panel>
      </div>
      {adding === 'mail' && <AddMail onClose={() => setAdding(null)} />}
      {adding === 'cal' && <AddCalendar onClose={() => setAdding(null)} />}
      {adding === 'lh' && <AddLunchHub onClose={() => setAdding(null)} />}
    </main>
  );
}

function AddMail({ onClose }: { onClose: () => void }) {
  const e = useEngine();
  const toast = useToast();
  const { go } = useRoute();
  const [p, setP] = useState<Preset | null>(null);
  const [f, setF] = useState({ email: '', pass: '', fromName: 'Willads Tranberg', user: '', host: '', port: 993, security: 'tls' as Security, smtpHost: '', smtpPort: 465, smtpSecurity: 'tls' as Security });
  const [adv, setAdv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pick = (x: Preset) => { setP(x); setF((o) => ({ ...o, host: x.host, port: x.port, security: x.security, smtpHost: x.smtpHost, smtpPort: x.smtpPort, smtpSecurity: x.smtpSecurity })); setAdv(x.id === 'other'); setErr(null); };
  const set = (k: keyof typeof f) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((o) => ({ ...o, [k]: ev.target.type === 'number' ? Number(ev.target.value) : ev.target.value }));

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    if (!p) return;
    setBusy(true); setErr(null);
    const acct: MailAccount = { id: '', name: p.id === 'other' ? f.email.split('@')[1] ?? 'Mail' : p.name, provider: p.id, email: f.email.trim(), fromName: f.fromName.trim(),
      user: (f.user || f.email).trim(), pass: p.id === 'gmail' ? f.pass.replace(/\s+/g, '') : f.pass, host: f.host, port: f.port, security: f.security, smtpHost: f.smtpHost, smtpPort: f.smtpPort, smtpSecurity: f.smtpSecurity, enabled: true };
    try {
      const n = await testAccount(acct);
      const { id: _skip, ...fields } = acct;
      const id = e.create('mailacct', fields);
      toast({ text: `${acct.name} er forbundet (${n} mails i indbakken). Henter de sidste 30 dage …` });
      onClose();
      const r = await syncAccount(e, { ...acct, id });
      toast({ text: r.error ? `${acct.name}: ${r.error}` : `${r.added.length} mails hentet fra ${acct.name}`, action: r.error ? undefined : { label: 'Åbn indbakke', run: () => go({ screen: 'inbox' }) } });
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="Tilføj mailkonto">
        {!p ? (
          <div className="sheet__body">
            <h2>Tilføj mailkonto</h2>
            <div className="providers">{PRESETS.map((x) => <button key={x.id} className="provider" onClick={() => pick(x)}>{x.name}{x.blocked && <span className="meta">kommer senere</span>}</button>)}</div>
            <div className="sheet__foot"><span className="push-right" /><Btn variant="text" onClick={onClose}>Luk</Btn></div>
          </div>
        ) : p.blocked ? (
          <div className="sheet__body">
            <h2>{p.name}</h2><p className="muted">{p.blocked}</p>
            <div className="sheet__foot"><Btn variant="text" onClick={() => setP(null)}>Tilbage</Btn><span className="push-right" /><Btn variant="primary" onClick={onClose}>OK</Btn></div>
          </div>
        ) : (
          <form className="sheet__body" onSubmit={save}>
            <h2>{p.name}</h2>
            <p className="muted small">{p.guide} {p.link && <a href={p.link[1]} target="_blank" rel="noreferrer">{p.link[0]} ↗</a>}</p>
            {!mailAvailable() && <p className="unlock__error">Mail virker kun i CENTRA-appen på din Mac.</p>}
            <label className="ufield"><span>E-mailadresse</span><input type="email" autoComplete="off" required value={f.email} onChange={set('email')} placeholder="dig@eksempel.dk" /></label>
            <label className="ufield"><span>{p.id === 'gmail' || p.id === 'icloud' ? 'App-adgangskode' : 'Adgangskode'}</span><input type="password" autoComplete="off" required value={f.pass} onChange={set('pass')} /></label>
            <label className="ufield"><span>Dit navn som afsender</span><input value={f.fromName} onChange={set('fromName')} /></label>
            <button type="button" className="tag" onClick={() => setAdv((x) => !x)} aria-expanded={adv}>{adv ? 'Skjul servere' : 'Servere og porte'}</button>
            {adv && (
              <div className="gedit__grid">
                <label className="ufield"><span>Brugernavn (hvis ikke e-mail)</span><input value={f.user} onChange={set('user')} placeholder={f.email} /></label>
                <label className="ufield"><span>IMAP-server</span><input required value={f.host} onChange={set('host')} /></label>
                <label className="ufield"><span>Port</span><input type="number" value={f.port} onChange={set('port')} /></label>
                <label className="ufield"><span>Sikkerhed</span><select value={f.security} onChange={set('security')}><option value="tls">SSL/TLS</option><option value="starttls">STARTTLS</option></select></label>
                <label className="ufield"><span>SMTP-server</span><input required value={f.smtpHost} onChange={set('smtpHost')} /></label>
                <label className="ufield"><span>Port</span><input type="number" value={f.smtpPort} onChange={set('smtpPort')} /></label>
                <label className="ufield"><span>Sikkerhed</span><select value={f.smtpSecurity} onChange={set('smtpSecurity')}><option value="tls">SSL/TLS</option><option value="starttls">STARTTLS</option></select></label>
              </div>
            )}
            {err && <p className="unlock__error" role="alert">{err}</p>}
            <div className="sheet__foot"><Btn type="button" variant="text" onClick={() => setP(null)}>Tilbage</Btn><span className="push-right" /><Btn type="button" variant="text" onClick={onClose}>Annullér</Btn><Btn type="submit" variant="primary" disabled={busy || !mailAvailable()}>{busy ? 'Forbinder …' : 'Forbind'}</Btn></div>
          </form>
        )}
      </div>
    </div>
  );
}

function AddCalendar({ onClose }: { onClose: () => void }) {
  const e = useEngine();
  const toast = useToast();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true); setErr(null);
    const id = e.create('calfeed', { name: name.trim() || 'Kalender', url: url.trim(), enabled: true });
    try { const n = await syncFeed(e, { id, name: name.trim() || 'Kalender', url: url.trim() }); toast({ text: `${name || 'Kalenderen'} er tilføjet med ${n} aftaler` }); onClose(); }
    catch (x) { removeFeed(e, id); setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <div>
      <div className="scrim" onClick={onClose} />
      <form className="sheet" role="dialog" aria-label="Tilføj kalender" onSubmit={save}>
        <div className="sheet__body">
          <h2>Tilføj kalender</h2>
          <p className="muted small">Indsæt kalenderens hemmelige iCal-adresse. Den hentes hvert kvarter og vises i CENTRA. Ret aftalerne i den kalender, de kommer fra.</p>
          <details className="guides"><summary>Sådan finder du adressen</summary>{FEED_GUIDES.map(([t, g]) => <p key={t} className="small"><b>{t}:</b> {g}</p>)}</details>
          <label className="ufield"><span>Navn</span><input value={name} onChange={(x) => setName(x.target.value)} placeholder="Fx Google privat" /></label>
          <label className="ufield"><span>iCal-adresse</span><input required value={url} onChange={(x) => setUrl(x.target.value)} placeholder="https://… eller webcal://…" spellCheck={false} /></label>
          {err && <p className="unlock__error" role="alert">{err}</p>}
          <div className="sheet__foot"><span className="push-right" /><Btn type="button" variant="text" onClick={onClose}>Annullér</Btn><Btn type="submit" variant="primary" disabled={busy || !/^(https|webcal):\/\//.test(url.trim())}>{busy ? 'Henter …' : 'Tilføj'}</Btn></div>
        </div>
      </form>
    </div>
  );
}

/** LunchHub: its address and a personal app key, made in LunchHub under your profile. */
function AddLunchHub({ onClose }: { onClose: () => void }) {
  const e = useEngine();
  const toast = useToast();
  const [url, setUrl] = useState(DEFAULT_URL);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true); setErr(null);
    try {
      const me = await testLunchHub(url.trim(), token.trim());
      const sites = (me.sites ?? []).map((x) => x.name).join(', ');
      const id = e.create('lhconn', { name: 'LunchHub', url: url.trim().replace(/\/+$/, ''), token: token.trim(), who: me.name ?? me.username ?? '', sites, enabled: true });
      const r = await syncLunchHub(e, e.get(id) as unknown as LhConn);
      toast({ icon: 'inbox', title: 'LunchHub er forbundet', text: r.error ? r.error : `${r.added.length} henvendelser hentet${sites ? ` fra ${sites}` : ''}` });
      onClose();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <div>
      <div className="scrim" onClick={onClose} />
      <form className="sheet" role="dialog" aria-label="Forbind LunchHub" onSubmit={save}>
        <div className="sheet__body">
          <h2>Forbind LunchHub</h2>
          <p className="muted small">Henvendelser fra hjemmesiderne kommer ind i din indbakke i CENTRA og hentes automatisk hvert minut. Du ser kun de virksomheder, du har indbakke-adgang til i LunchHub.</p>
          <details className="guides" open><summary>Sådan får du en app-nøgle</summary>
            <p className="small">Log ind på LunchHub, åbn din profil og vælg <b>Forbind CENTRA</b> → <b>Lav app-nøgle</b>. Kopiér nøglen (den starter med <code>lh_app_</code>) og sæt den ind her. Den vises kun én gang, og du kan slette den i LunchHub når som helst.</p>
          </details>
          <label className="ufield"><span>LunchHub-adresse</span><input required value={url} onChange={(x) => setUrl(x.target.value)} spellCheck={false} /></label>
          <label className="ufield"><span>App-nøgle</span><input required type="password" value={token} onChange={(x) => setToken(x.target.value)} placeholder="lh_app_…" autoComplete="off" spellCheck={false} /></label>
          {err && <p className="unlock__error" role="alert">{err}</p>}
          <div className="sheet__foot"><span className="push-right" /><Btn type="button" variant="text" onClick={onClose}>Annullér</Btn><Btn type="submit" variant="primary" disabled={busy || !token.trim() || !mailAvailable()}>{busy ? 'Forbinder …' : 'Forbind'}</Btn></div>
        </div>
      </form>
    </div>
  );
}
