import { useRef, useState } from 'react';
import { useEngine, useList } from '../state.tsx';
import { Btn, Panel } from '../ui/primitives.tsx';
import { useToast } from '../ui/Shell.tsx';
import { ask } from '../ui/Confirm.tsx';
import { browserSettings, saveBrowserSettings, activeVpn, vpnWire, wgEndpoint, openLink, type BrowserSettings, type VpnProfile, type VpnKind } from '../open.ts';

const KIND_NAME: Record<VpnKind, string> = { wireguard: 'WireGuard', socks5: 'SOCKS5', http: 'HTTP-proxy' };
const desktop = () => '__TAURI_INTERNALS__' in window;
const rid = () => 'vpn-' + Math.random().toString(36).slice(2, 10);

/** Browser: where links open, private mode, search, and your VPNs (any number; one in use at a time). */
export function BrowserPanel() {
  const e = useEngine();
  const toast = useToast();
  useList('setting');
  const s = browserSettings(e);
  const active = activeVpn(s);
  const [edit, setEdit] = useState<VpnProfile | 'new' | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, string>>({});

  async function test(v: VpnProfile) {
    setChecking(v.id);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const r = await invoke<{ ip: string; country: string; city: string }>('browser_vpn_test', { vpn: vpnWire(v) });
      setChecked((c) => ({ ...c, [v.id]: `Virker. Hjemmesider ser dig som ${r.ip}${r.country ? ` i ${[r.city, r.country].filter(Boolean).join(', ')}` : ''}.` }));
    } catch (x) {
      setChecked((c) => ({ ...c, [v.id]: '✕ ' + String((x as Error)?.message ?? x) }));
    } finally { setChecking(null); }
  }
  async function remove(v: VpnProfile) {
    if (!(await ask({ title: `Fjern ${v.name}?`, text: 'Den slettes fra CENTRA. Hos VPN-tjenesten kan du også slette nøglen/filen.', ok: 'Fjern', danger: true }))) return;
    const vpns = s.vpns.filter((x) => x.id !== v.id);
    saveBrowserSettings(e, { vpns, vpnActive: s.vpnActive === v.id ? vpns[0]?.id ?? '' : s.vpnActive, ...(vpns.length ? {} : { vpnOn: false }), ...(v.id === 'vpn-old' ? { vpnHost: '', vpnPass: '', vpnUser: '', vpnName: '' } : {}) });
  }

  return (
    <Panel title="Browser og VPN" className="span-12">
      <div className="kv"><span>Åbn links i<span className="meta block">CENTRA's egen browser åbner links fra mails, Assist og resten af appen i et vindue for sig, med privat tilstand og VPN, hvis du vil.</span></span>
        <div className="segmented" role="radiogroup" aria-label="Åbn links i">
          {([['centra', 'CENTRA'], ['safari', 'Safari']] as const).map(([k, l]) => <button key={k} role="radio" aria-checked={s.mode === k} className={s.mode === k ? 'is-active' : ''} onClick={() => saveBrowserSettings(e, { mode: k })}>{l}</button>)}
        </div></div>
      <div className="kv"><span>Privat som standard<span className="meta block">Intet gemmes: cookies, logins og historik forsvinder, når browservinduet lukkes. Kan også slås til og fra i værktøjslinjen.</span></span>
        <input type="checkbox" checked={s.incognito} onChange={(x) => saveBrowserSettings(e, { incognito: x.target.checked })} aria-label="Privat som standard" /></div>
      <div className="kv"><span>Søgemaskine<span className="meta block">Når det, du skriver i adressefeltet, ikke er en adresse.</span></span>
        <select className="kvinput" value={s.search} onChange={(x) => saveBrowserSettings(e, { search: x.target.value as BrowserSettings['search'] })} aria-label="Søgemaskine">
          <option value="duckduckgo">DuckDuckGo (gemmer ingenting)</option><option value="startpage">Startpage (Google-resultater, privat)</option><option value="google">Google</option>
        </select></div>
      <div className="kv"><span>VPN i browseren<span className="meta block">{active ? `Når den er slået til, går alt fra browseren gennem ${active.name}. Kan VPN'en ikke nås, åbner siderne ikke (de går aldrig uden om), og WebRTC er slået fra, så din rigtige adresse ikke slipper ud. Gælder kun browseren, ikke resten af Mac'en.` : 'Tilføj en VPN herunder først.'}</span></span>
        <input type="checkbox" disabled={!active} checked={s.vpnOn && !!active} onChange={(x) => saveBrowserSettings(e, { vpnOn: x.target.checked })} aria-label="VPN i browseren" /></div>

      <div className="vpnlist">
        <div className="vpnlist__head"><b>Dine VPN'er</b><span className="meta">{s.vpns.length ? 'Den valgte bruges. Skift her eller i browserens værktøjslinje.' : 'Ingen endnu.'}</span><Btn size="sm" icon="plus" className="push-right" onClick={() => setEdit('new')}>Tilføj VPN</Btn></div>
        {s.vpns.length > 0 && (
          <ul role="radiogroup" aria-label="VPN i brug">
            {s.vpns.map((v) => (
              <li key={v.id} className={v.id === s.vpnActive ? 'is-on' : ''}>
                <label className="vpnlist__pick"><input type="radio" name="vpn-active" checked={v.id === s.vpnActive} onChange={() => saveBrowserSettings(e, { vpnActive: v.id })} />
                  <span className="row__body"><span className="strong ellipsis">{v.name}</span><span className="meta ellipsis">{KIND_NAME[v.kind]} · {v.kind === 'wireguard' ? wgEndpoint(v.conf) || 'fil indlæst' : `${v.host}:${v.port}`}</span>
                    {checked[v.id] && <span className={`meta vpnlist__check ${checked[v.id].startsWith('✕') ? 'is-bad' : ''}`}>{checked[v.id]}</span>}</span></label>
                <Btn size="sm" variant="text" disabled={!desktop() || checking === v.id} onClick={() => void test(v)}>{checking === v.id ? 'Tester …' : 'Test'}</Btn>
                <Btn size="sm" variant="text" icon="edit" aria-label={`Ret ${v.name}`} onClick={() => setEdit(v)} />
                <Btn size="sm" variant="text" icon="x" aria-label={`Fjern ${v.name}`} onClick={() => void remove(v)} />
              </li>
            ))}
          </ul>
        )}
      </div>
      {edit && <VpnEditor v={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSave={(v) => {
        const vpns = edit === 'new' ? [...s.vpns, v] : s.vpns.map((x) => (x.id === v.id ? v : x));
        saveBrowserSettings(e, { vpns, vpnActive: edit === 'new' && !s.vpns.length ? v.id : s.vpnActive || v.id });
        toast({ text: `${v.name} er gemt krypteret`, action: edit === 'new' ? { label: 'Brug den', run: () => saveBrowserSettings(e, { vpnActive: v.id, vpnOn: true }) } : undefined });
        setEdit(null);
      }} />}
    </Panel>
  );
}

/** Add or change one VPN. WireGuard: load the provider's .conf (or paste it). SOCKS5/HTTP: server and login. */
function VpnEditor({ v, onClose, onSave }: { v: VpnProfile | null; onClose: () => void; onSave: (v: VpnProfile) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [f, setF] = useState<VpnProfile>(() => v ?? { id: rid(), name: '', kind: 'wireguard', conf: '', host: '', port: 1080, user: '', pass: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState('');
  const set = (p: Partial<VpnProfile>) => { setF((o) => ({ ...o, ...p })); setErr(''); setOk(''); };

  function check(): string {
    if (!f.name.trim()) return 'Giv den et navn, fx "Proton Holland".';
    if (f.kind === 'wireguard') {
      const c = f.conf ?? '';
      if (!/PrivateKey\s*=/i.test(c) || !/PublicKey\s*=/i.test(c) || !/Endpoint\s*=/i.test(c)) return 'Det ligner ikke en WireGuard-fil. Den skal have [Interface] med PrivateKey og [Peer] med PublicKey og Endpoint.';
      return '';
    }
    if (!f.host?.trim()) return 'Skriv serverens adresse.';
    if (!(Number(f.port) > 0 && Number(f.port) < 65536)) return 'Skriv en port, fx 1080.';
    return '';
  }
  async function load(x?: File | null) {
    if (!x) return;
    if (x.size > 20_000) return setErr('Filen er for stor til at være en WireGuard-fil.');
    const text = await x.text();
    const ep = wgEndpoint(text);
    set({ conf: text, name: f.name || x.name.replace(/\.conf$/i, '').replace(/[-_]+/g, ' ').trim() || (ep ? `WireGuard ${ep.split(':')[0]}` : 'WireGuard') });
  }
  async function test() {
    const bad = check(); if (bad) return setErr(bad);
    setBusy(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const r = await invoke<{ ip: string; country: string; city: string }>('browser_vpn_test', { vpn: vpnWire(f) });
      setOk(`Virker. Hjemmesider ser dig som ${r.ip}${r.country ? ` i ${[r.city, r.country].filter(Boolean).join(', ')}` : ''}.`);
    } catch (x) { setErr(String((x as Error)?.message ?? x)); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="scrim" onClick={onClose} />
      <form className="sheet vpnsheet" role="dialog" aria-label={v ? 'Ret VPN' : 'Tilføj VPN'} onSubmit={(x) => { x.preventDefault(); const bad = check(); if (bad) return setErr(bad); onSave({ ...f, name: f.name.trim(), host: f.host?.trim(), user: f.user?.trim() }); }}>
        <div className="sheet__body">
          <h2>{v ? `Ret ${v.name}` : 'Tilføj VPN'}</h2>
          <div className="segmented" role="radiogroup" aria-label="Type">
            {(['wireguard', 'socks5', 'http'] as VpnKind[]).map((k) => <button type="button" key={k} role="radio" aria-checked={f.kind === k} className={f.kind === k ? 'is-active' : ''} onClick={() => set({ kind: k, port: k === 'http' ? f.port || 89 : f.port || 1080 })}>{KIND_NAME[k]}</button>)}
          </div>
          {f.kind === 'wireguard' ? (
            <>
              <details className="guides" open={!v}><summary>Gratis: Proton VPN (anbefalet til at starte)</summary>
                <ol className="small vpnguide">
                  <li>Lav en gratis konto på <a href="https://protonvpn.com/free-vpn" onClick={(x) => { x.preventDefault(); void openLink('https://protonvpn.com/free-vpn'); }}>protonvpn.com</a> (Proton VPN Free, intet kort).</li>
                  <li>Log ind på <a href="https://account.protonvpn.com/downloads" onClick={(x) => { x.preventDefault(); void openLink('https://account.protonvpn.com/downloads'); }}>account.protonvpn.com</a> og vælg <b>Downloads</b> → <b>WireGuard configuration</b>.</li>
                  <li>Giv den et navn, vælg en gratis server (eller lad Proton vælge), behold <b>VPN Accelerator</b>, tryk <b>Create</b> og så <b>Download</b>.</li>
                  <li>Indlæs .conf-filen herunder. Vil du skifte land senere, så hent en fil mere og tilføj den som endnu en VPN.</li>
                </ol>
                <p className="meta">Andre tjenester med WireGuard-filer: Mullvad, IVPN, Surfshark, Windscribe, AirVPN, eller din egen server. Filen gemmes krypteret i CENTRA.</p>
              </details>
              <div className="vpnsheet__file">
                <Btn type="button" icon="paperclip" onClick={() => file.current?.click()}>{f.conf ? 'Vælg en anden fil' : 'Indlæs .conf-fil'}</Btn>
                <input ref={file} type="file" accept=".conf,text/plain" hidden onChange={(x) => { void load(x.target.files?.[0]); x.target.value = ''; }} />
                <span className="meta">{f.conf ? `Indlæst · server ${wgEndpoint(f.conf) || 'ukendt'}` : 'eller sæt teksten ind herunder'}</span>
              </div>
              <textarea className="otext vpnsheet__conf" rows={5} value={f.conf ?? ''} spellCheck={false} onChange={(x) => set({ conf: x.target.value })} placeholder={'[Interface]\nPrivateKey = …\nAddress = 10.2.0.2/32\nDNS = 10.2.0.1\n\n[Peer]\nPublicKey = …\nEndpoint = …:51820'} aria-label="WireGuard-konfiguration" />
            </>
          ) : (
            <>
              <p className="meta">Brug {f.kind === 'socks5' ? 'SOCKS5' : 'HTTP'}-proxyen fra din VPN-tjeneste med de "manuelle" login-oplysninger (fx NordVPN, Surfshark, Private Internet Access). Adresse og port står i tjenestens vejledning til manuel opsætning.</p>
              <div className="vpnform__grid">
                <label className="ufield vpnform__host"><span>Server</span><input value={f.host ?? ''} onChange={(x) => set({ host: x.target.value })} placeholder="Adressen fra din VPN-tjeneste" spellCheck={false} autoCapitalize="off" /></label>
                <label className="ufield"><span>Port</span><input value={String(f.port ?? '')} inputMode="numeric" onChange={(x) => set({ port: Number(x.target.value.replace(/\D/g, '')) || 0 })} placeholder="1080" /></label>
                <label className="ufield"><span>Brugernavn</span><input value={f.user ?? ''} onChange={(x) => set({ user: x.target.value })} autoComplete="off" spellCheck={false} autoCapitalize="off" /></label>
                <label className="ufield"><span>Adgangskode</span><input type="password" value={f.pass ?? ''} onChange={(x) => set({ pass: x.target.value })} autoComplete="off" /></label>
              </div>
            </>
          )}
          <label className="ufield"><span>Navn</span><input value={f.name} onChange={(x) => set({ name: x.target.value })} placeholder="Fx Proton Holland" /></label>
          {err && <p className="unlock__error" role="alert">{err}</p>}
          {ok && <p className="vpnform__ok" role="status">{ok}</p>}
          <div className="sheet__foot">
            <Btn type="button" disabled={busy || !desktop()} onClick={() => void test()}>{busy ? 'Tester …' : 'Test forbindelsen'}</Btn>
            <span className="push-right" />
            <Btn type="button" variant="text" onClick={onClose}>Annullér</Btn>
            <Btn type="submit" variant="primary">Gem</Btn>
          </div>
        </div>
      </form>
    </div>
  );
}
