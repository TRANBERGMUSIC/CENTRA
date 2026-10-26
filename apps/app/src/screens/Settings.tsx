import { useEffect, useRef, useState } from 'react';
import { useEngine, useSession, useSyncStatus, fmt } from '../state.tsx';
import { Btn, Panel } from '../ui/primitives.tsx';
import { useToast } from '../ui/Shell.tsx';
import { useScreenEnter } from '../motion.ts';
import { APP_VERSION, REPO, checkForUpdate, platform, type Update } from '../updater.ts';
import type { DeviceRecord } from '@centra/sync';

export type Theme = 'dark' | 'oled' | 'light';
export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'light' ? '#F4F5F3' : t === 'oled' ? '#000000' : '#0B0F0E');
}

export function Settings({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const { relay, device, email } = useSession();
  const e = useEngine();
  const toast = useToast();
  const status = useSyncStatus();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'settings');
  const [devices, setDevices] = useState<DeviceRecord[]>(relay.devices);
  const [update, setUpdate] = useState<Update | null | 'checking' | 'none'>(null);
  useEffect(() => { relay.onDevices = setDevices; setDevices(relay.devices); return () => { relay.onDevices = undefined; }; }, [relay]);

  async function check() {
    setUpdate('checking');
    setUpdate((await checkForUpdate()) ?? 'none');
  }

  function exportAll() {
    const data = { exportedAt: new Date().toISOString(), version: APP_VERSION, records: ['note', 'event', 'mail', 'goal', 'goalUpdate', 'memory', 'rule', 'suggestion', 'person'].flatMap((t) => e.list(t)),
      noteBodies: Object.fromEntries(e.list('note').map((n) => [n.id, e.doc(n.id).getText('body').toString()])) };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `centra-eksport-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }

  return (
    <main className="canvas" ref={ref}>
      <div className="titlerow" data-enter><div><h1>Indstillinger</h1><p>{email}</p></div></div>
      <div className="grid12">
        <Panel title="Tema" className="span-5">
          <div className="segmented" role="radiogroup" aria-label="Tema">
            {([['dark', 'Mørk'], ['oled', 'OLED sort'], ['light', 'Lys']] as const).map(([k, l]) => (
              <button key={k} role="radio" aria-checked={theme === k} className={theme === k ? 'is-active' : ''} onClick={() => setTheme(k)}>{l}</button>
            ))}
          </div>
        </Panel>
        <Panel title="Opdateringer" className="span-7">
          <div className="kv"><span>Version</span><span className="num">{APP_VERSION} · {platform === 'desktop' ? 'desktop-app' : platform === 'mobile' ? 'mobil-app' : 'web'}</span></div>
          <div className="kv"><span>Kilde</span><span className="meta">github.com/{REPO}/releases</span></div>
          <div className="kv"><span>{update === 'none' ? 'Du har den nyeste version' : update === 'checking' ? 'Søger …' : update && typeof update === 'object' ? `Version ${update.version} er klar` : 'Søger automatisk hver halve time'}</span>
            {update && typeof update === 'object' ? <Btn variant="primary" size="sm" onClick={() => update.install()}>Installér og genstart</Btn> : <Btn size="sm" onClick={check}>Søg nu</Btn>}</div>
        </Panel>
        <Panel title="Enheder" className="span-7" count={devices.filter((d) => !d.revoked).length}>
          <ul className="rows">
            {devices.filter((d) => !d.revoked).map((d) => (
              <li key={d.id} className="row">
                <span className={`dot ${d.online ? '' : 'dot--off'}`} />
                <span className="row__body"><span className="row__line"><span>{d.name}</span>{d.id === device && <span className="meta">denne enhed</span>}</span><span className="row__line meta">{d.online ? 'Online nu' : 'Sidst set ' + fmt.ago(new Date(d.lastSeen).toISOString())}</span></span>
                {d.id !== device && <Btn size="sm" variant="text" onClick={() => { if (confirm(`Log ${d.name} ud? Enheden mister adgang med det samme.`)) { relay.revoke(d.id); toast({ text: `${d.name} er logget ud` }); } }}>Log ud</Btn>}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Synkronisering og kryptering" className="span-5">
          <div className="kv"><span>Forbindelse</span><span className="meta">{status.online ? 'Online' : 'Offline, ændringer gemmes lokalt'}</span></div>
          <div className="kv"><span>Venter på at blive sendt</span><span className="num">{status.pending}</span></div>
          <div className="kv"><span>Sidst synkroniseret</span><span className="num">{status.last ? fmt.hm(new Date(status.last)) : '—'}</span></div>
          <p className="meta pad-top">Alt indhold krypteres på enheden med en nøgle fra din passphrase (Argon2id + XChaCha20-Poly1305). Serveren gemmer kun krypterede data.</p>
        </Panel>
        <Panel title="Data" className="span-12">
          <div className="kv"><span>Eksportér alt som JSON</span><Btn size="sm" onClick={exportAll}>Eksportér</Btn></div>
          <div className="kv"><span>Fjern eksempeldata</span><Btn size="sm" variant="text" onClick={() => {
            if (!confirm('Fjern alle eksempeldata (noter, mails, mål og aftaler markeret som eksempel)?')) return;
            let n = 0;
            for (const t of ['note', 'event', 'mail', 'goal', 'goalUpdate', 'memory', 'suggestion', 'person']) for (const r of e.list(t)) if ((r as any).sample) { e.remove(t, r.id); n++; }
            toast({ text: `${n} eksempler fjernet` });
          }}>Fjern</Btn></div>
        </Panel>
      </div>
    </main>
  );
}
