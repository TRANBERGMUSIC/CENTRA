import { useEffect, useState } from 'react';
import { Wordmark } from '../ui/primitives.tsx';
import { reduced } from '../motion.ts';
import { DEFAULT_USER, explain, lookUp, recover, signIn, type Lookup, type Session, type Step } from '../session.ts';
import LightRays from '../bits/LightRays.jsx';
import DecryptedText from '../bits/DecryptedText.jsx';

type Mode = 'login' | 'create' | 'recover';
const MIN = 12;

/**
 * The one brand moment: the prism's light behind the wordmark while the vault opens.
 * Login, first-time setup (choose the password) and recovery (forgot the password) live here.
 */
export function Unlock({ onReady, notice }: { onReady: (s: Session) => void; notice?: string }) {
  const [mode, setMode] = useState<Mode>('login');
  const [user, setUser] = useState(DEFAULT_USER);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(notice ?? null);
  const [info, setInfo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [pending, setPending] = useState<Lookup | null>(null);

  useEffect(() => {
    if (!wait) return;
    const t = setTimeout(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  function fail(e: unknown) {
    setStep(null);
    setPw(''); setPw2('');
    const msg = explain(e);
    setError(msg);
    const m = msg.match(/om (\d+) sekunder/);
    setWait(m ? Number(m[1]) : 2);
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null); setInfo(null);
    try {
      if (mode === 'recover') {
        if (pw.length < MIN) return setError(`Det nye password skal være mindst ${MIN} tegn.`);
        if (pw !== pw2) return setError('De to passwords er ikke ens.');
        setStep('Forbinder');
        await recover(user, code, pw, setStep);
        setStep(null); setMode('login'); setCode(''); setPw(''); setPw2('');
        setInfo('Dit password er skiftet. Log ind med det nye.');
        return;
      }
      if (mode === 'create') {
        if (pw.length < MIN) return setError(`Vælg et password på mindst ${MIN} tegn.`);
        if (pw !== pw2) return setError('De to passwords er ikke ens.');
      }
      setStep('Forbinder');
      const look = pending ?? (await lookUp(user));
      if (!look.pre.exists && mode === 'login') {
        if (!look.pre.canRegister) { look.relay.close(); throw new Error('not-allowed'); }
        setPending(look); setStep(null); setMode('create'); setPw2('');
        setInfo('Første gang: vælg dit password. Det gemmes ingen steder og låser dine data op.');
        return;
      }
      const s = await signIn(look, pw, setStep);
      setPending(null);
      if (!reduced()) await new Promise((r) => setTimeout(r, 250));
      onReady(s);
    } catch (e) {
      setPending(null);
      if (mode === 'create') setMode('login');
      fail(e);
    }
  }

  return (
    <main className="unlock">
      <div className="unlock__light" aria-hidden="true">
        {reduced() ? <img src="./texture-background.png" alt="" /> :
          <LightRays raysOrigin="top-center" raysColor="#E8DCC6" raysSpeed={0.6} lightSpread={0.55} rayLength={2.4} haze={0.2} glow={0.35} intensity={0.75} followMouse mouseInfluence={0.06} cursorShadow={false} clickPulse={false} opacity={0.8} />}
      </div>
      <form className="unlock__card" onSubmit={submit} autoComplete="on">
        <img className="unlock__symbol" src="./app-icon-dark.png" alt="" />
        <Wordmark className="unlock__word" />
        <p className="unlock__tag">Your life. In focus.</p>
        {step ? (
          <p className="unlock__stage" role="status"><DecryptedText key={step} text={step + ' …'} animateOn="view" sequential speed={30} maxIterations={6} characters="0123456789ABCDEF" encryptedClassName="encrypted" /></p>
        ) : (
          <>
            {info && <p className="unlock__info" role="status">{info}</p>}
            <label className="ufield"><span>Brugernavn</span><input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={user} onChange={(e) => { setUser(e.target.value); setPending(null); }} required /></label>
            {mode === 'recover' && (
              <label className="ufield"><span>Gendannelsesnøgle</span><input name="recovery" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" value={code} onChange={(e) => setCode(e.target.value)} required /></label>
            )}
            <label className="ufield"><span>{mode === 'login' ? 'Password' : 'Nyt password'}</span>
              <input type="password" name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={pw} onChange={(e) => setPw(e.target.value)} required minLength={mode === 'login' ? 1 : MIN} /></label>
            {mode !== 'login' && (
              <label className="ufield"><span>Gentag password</span><input type="password" name="password2" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={MIN} /></label>
            )}
            {error && <p className="unlock__error" role="alert">{error}</p>}
            <button className="btn btn--primary unlock__go" type="submit" disabled={wait > 0}>
              {wait > 0 ? `Vent ${wait} s` : mode === 'login' ? 'Lås op' : mode === 'create' ? 'Opret og lås op' : 'Skift password'}
            </button>
            <div className="unlock__links">
              {mode === 'login' ? <button type="button" className="tag" onClick={() => { setMode('recover'); setError(null); setInfo(null); }}>Glemt password?</button>
                : <button type="button" className="tag" onClick={() => { setMode('login'); setPending(null); setError(null); setInfo(null); }}>Tilbage til login</button>}
            </div>
            <p className="meta unlock__note">Alt er krypteret på din enhed. Uden dit password kan ingen læse dine data, heller ikke serveren.</p>
          </>
        )}
      </form>
    </main>
  );
}

/** Shown once after the account is created: the only way back in if the password is forgotten. */
export function RecoveryCode({ code, onDone }: { code: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`CENTRA gendannelsesnøgle\nBrugernavn: ${DEFAULT_USER}\n\n${code}\n\nBrug den under "Glemt password?" på login-skærmen.\nOpbevar den et sikkert sted, fx i din password manager eller printet.\n`], { type: 'text/plain' }));
    a.download = 'CENTRA-gendannelsesnoegle.txt';
    a.click();
    setSaved(true);
  };
  return (
    <main className="unlock">
      <div className="unlock__card unlock__card--wide">
        <h1 className="unlock__title">Din gendannelsesnøgle</h1>
        <p className="muted">Hvis du glemmer dit password, er denne nøgle den eneste måde at komme ind på igen. Dine data er krypteret, så ingen andre kan hjælpe, heller ikke CENTRA. Den vises kun nu.</p>
        <code className="recovery" aria-label="Gendannelsesnøgle">{code}</code>
        <div className="unlock__row">
          <button className="btn btn--secondary" onClick={() => { void navigator.clipboard?.writeText(code); setSaved(true); }}>Kopiér</button>
          <button className="btn btn--secondary" onClick={download}>Gem som fil</button>
        </div>
        <label className="checkrow"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> Jeg har gemt nøglen et sikkert sted</label>
        <button className="btn btn--primary unlock__go" disabled={!saved} onClick={onDone}>Fortsæt</button>
      </div>
    </main>
  );
}
