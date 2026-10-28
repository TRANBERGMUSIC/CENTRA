import { useEffect, useRef, useState } from 'react';
import { Wordmark } from '../ui/primitives.tsx';
import { reduced, gsap, useGSAP } from '../motion.ts';
import { Aura } from '../ui/Logo.tsx';
import { Icon } from '../ui/Icon.tsx';
import { bioKind, bioIsOn, bioUnlock, bioProblem, BIO_NAME, type BioKind } from '../biometrics.ts';
import { DEFAULT_USER, explain, lookUp, recover, signIn, type Lookup, type Session, type Step } from '../session.ts';
import DecryptedText from '../bits/DecryptedText.jsx';

type Mode = 'login' | 'create' | 'recover';
const MIN = 12;

/**
 * The one brand moment: the brand's light drifting behind the logo while the vault opens.
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
  const card = useRef<HTMLFormElement>(null);
  const [bio, setBio] = useState<BioKind>('none');
  const bioOn = bio !== 'none' && mode === 'login' && bioIsOn(user);
  const leave = () => (reduced() ? Promise.resolve() : new Promise((r) => gsap.to(card.current, { y: -24, scale: 0.96, opacity: 0, filter: 'blur(10px)', duration: 0.45, ease: 'power2.in', onComplete: r })));

  async function tryBio(kind = bio) {
    setError(null); setInfo(null);
    setStep('Låser op');
    try {
      const s = await bioUnlock(user);
      await leave();
      onReady(s);
    } catch (e) {
      setStep(null);
      const msg = bioProblem((e as Error).message, BIO_NAME[kind]);
      if (msg) setError(msg);
    }
  }
  // Touch ID asks by itself when the lock screen appears (or when you come back to the window).
  useEffect(() => {
    let off = () => {};
    void bioKind().then((k) => {
      setBio(k);
      if (k === 'none' || !bioIsOn(user) || notice) return;
      if (document.hasFocus()) void tryBio(k);
      else { const f = () => { off(); void tryBio(k); }; addEventListener('focus', f, { once: true }); off = () => removeEventListener('focus', f); }
    });
    return () => off();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arrival: the icon settles, then the wordmark, tagline and fields rise in one after another.
  useGSAP(() => {
    if (reduced()) return;
    gsap.from(card.current!.children, { y: 22, opacity: 0, filter: 'blur(8px)', duration: 0.9, ease: 'expo.out', stagger: 0.06, delay: 0.1, clearProps: 'all' });
  }, { scope: card });
  // Fields that appear later (second password, recovery key, a message) slide open instead of popping.
  useGSAP(() => {
    if (reduced()) return;
    gsap.from(card.current!.querySelectorAll('.ufield:not([data-seen]), .unlock__info, .unlock__error'), { height: 0, opacity: 0, y: -6, duration: 0.35, ease: 'power3.out', clearProps: 'all' });
    card.current!.querySelectorAll('.ufield').forEach((f) => f.setAttribute('data-seen', ''));
  }, { scope: card, dependencies: [mode, error, info] });

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
      await leave();
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
        <Aura />
      </div>
      <form ref={card} className="unlock__card" onSubmit={submit} autoComplete="on">
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
            {bioOn && <button type="button" className="btn btn--secondary unlock__bio" onClick={() => void tryBio()}><Icon name="fingerprint" />Lås op med {BIO_NAME[bio]}</button>}
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
