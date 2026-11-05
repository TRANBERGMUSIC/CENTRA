import { useEffect, useRef, useState } from 'react';
import { Btn } from '../ui/primitives.tsx';
import { reduced, gsap, useGSAP } from '../motion.ts';
import { Logo } from '../ui/Logo.tsx';
import { bioKind, bioIsOn, bioUnlock, bioProblem, whenBack, BIO_NAME, type BioKind } from '../biometrics.ts';
import { DEFAULT_USER, canCreateHere, explain, lookUp, recover, signIn, type Lookup, type Session, type Step } from '../session.ts';
import DecryptedText from '../bits/DecryptedText.jsx';

type Mode = 'login' | 'create' | 'recover';
const MIN = 12;

/**
 * The lock screen: the same quiet card as the Mac's background lock (Veil.tsx), so locking always
 * looks the same. Login, first-time setup (choose the password) and recovery live here.
 */
export function Unlock({ onReady, notice }: { onReady: (s: Session) => void; notice?: string }) {
  // "Glemt password?" on the background lock comes straight here.
  const [mode, setMode] = useState<Mode>(() => { try { const m = sessionStorage.getItem('centra.unlockMode'); sessionStorage.removeItem('centra.unlockMode'); return m === 'recover' ? 'recover' : 'login'; } catch { return 'login'; } });
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
  const leave = () => (reduced() ? Promise.resolve() : new Promise((r) => gsap.to(card.current, { y: -12, scale: 0.98, opacity: 0, duration: 0.22, ease: 'power2.in', onComplete: r })));

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
  // Face ID / Touch ID asks by itself: when CENTRA opens, and every time you come back to it. Not
  // the moment you lock it yourself (only once you've been away), and not when a password is needed
  // anyway (logged out, or the password changed on another device).
  const asking = useRef(false);
  useEffect(() => {
    let alive = true, kindNow: BioKind = 'none';
    const manual = (() => { try { const m = sessionStorage.getItem('centra.lockManual') === '1'; sessionStorage.removeItem('centra.lockManual'); return m; } catch { return false; } })();
    const needsPassword = !!notice && /logget ud|password er skiftet/i.test(notice);
    const ask = async () => {
      if (!alive || asking.current || document.hidden || kindNow === 'none' || !bioIsOn(user) || needsPassword) return;
      if (document.querySelector('.unlock input[name=password2], .unlock input[name=recovery]')) return;
      asking.current = true;
      try { await tryBio(kindNow); } finally { asking.current = false; tried = Date.now(); }
    };
    let tried = 0;
    void bioKind().then((k) => {
      kindNow = k; setBio(k);
      if (!manual) void ask();
    });
    const off = whenBack(() => void ask(), () => tried);
    return () => { alive = false; off(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arrival: the icon settles, then the wordmark, tagline and fields rise in one after another.
  useGSAP(() => {
    if (reduced()) return;
    gsap.from(card.current!.children, { y: 12, opacity: 0, duration: 0.5, ease: 'expo.out', stagger: 0.04, clearProps: 'transform,opacity' });
  }, { scope: card });
  // Fields that appear later (second password, recovery key, a message) slide open instead of popping.
  useGSAP(() => {
    if (reduced()) return;
    gsap.from(card.current!.querySelectorAll('input:not([data-seen]), .veil__note, .unlock__error'), { opacity: 0, y: -6, duration: 0.3, ease: 'power3.out', clearProps: 'all' });
    card.current!.querySelectorAll('input').forEach((f) => f.setAttribute('data-seen', ''));
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
      if (!look.pre.exists && mode === 'login' && !look.migrate) {
        if (!look.pre.canRegister) { look.relay.close(); throw new Error('not-allowed'); }
        if (!canCreateHere()) { look.relay.close(); throw new Error('mac-first'); }
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

  const label = wait > 0 ? `Vent ${wait} s` : mode === 'login' ? 'Lås op' : mode === 'create' ? 'Opret og lås op' : 'Skift password';
  const quiet = !!notice && error === notice; // why it locked: said calmly, not as an error
  return (
    <main className="unlock unlock--plain">
      <form ref={card} className="veil__card" onSubmit={submit} autoComplete="on">
        <Logo size={54} />
        <h1>{mode === 'recover' ? 'Nyt password' : mode === 'create' ? 'Velkommen til CENTRA' : 'CENTRA er låst'}</h1>
        {step ? (
          <p className="unlock__stage" role="status"><DecryptedText key={step} text={step + ' …'} animateOn="view" sequential speed={30} maxIterations={6} characters="0123456789ABCDEF" encryptedClassName="encrypted" /></p>
        ) : (
          <>
            <input className="veil__user" name="username" aria-label="Brugernavn" autoComplete="username" autoCapitalize="none" spellCheck={false} value={user} onChange={(e) => { setUser(e.target.value); setPending(null); }} required />
            {info && <p className="meta veil__note" role="status">{info}</p>}
            {quiet && <p className="meta veil__note">{error}</p>}
            {mode === 'recover' && (
              <input name="recovery" aria-label="Gendannelsesnøgle" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="Gendannelsesnøgle" value={code} onChange={(e) => setCode(e.target.value)} required />
            )}
            <input type="password" name="password" aria-label={mode === 'login' ? 'Password' : 'Nyt password'} placeholder={mode === 'login' ? 'Password' : 'Nyt password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={pw} onChange={(e) => setPw(e.target.value)} required minLength={mode === 'login' ? 1 : MIN} autoFocus />
            {mode !== 'login' && (
              <input type="password" name="password2" aria-label="Gentag password" placeholder="Gentag password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={MIN} />
            )}
            {error && !quiet && <p className="unlock__error" role="alert">{error}</p>}
            <div className="veil__acts">
              {bioOn && <Btn type="button" onClick={() => void tryBio()}>{BIO_NAME[bio]}</Btn>}
              <Btn type="submit" variant="primary" disabled={wait > 0 || !pw}>{label}</Btn>
            </div>
            {mode === 'login'
              ? <button type="button" className="veil__out" onClick={() => { setMode('recover'); setError(null); setInfo(null); }}>Glemt password?</button>
              : <button type="button" className="veil__out" onClick={() => { setMode('login'); setPending(null); setError(null); setInfo(null); }}>Tilbage til login</button>}
          </>
        )}
      </form>
    </main>
  );
}

/** Shown once after the account is created: the only way back in if the password is forgotten. */
export function RecoveryCode({ code, onDone, replaced }: { code: string; onDone: () => void; replaced?: boolean }) {
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
        {replaced && <p className="unlock__info" role="status">Din konto er nu lagt op på din sync-server, så din iPhone kan logge ind. Derfor har du fået en ny gendannelsesnøgle. Den gamle virker ikke længere.</p>}
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
