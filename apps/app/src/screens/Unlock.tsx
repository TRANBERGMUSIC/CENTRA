import { useState } from 'react';
import { Wordmark } from '../ui/primitives.tsx';
import { reduced } from '../motion.ts';
import LightRays from '../bits/LightRays.jsx';
import DecryptedText from '../bits/DecryptedText.jsx';

/**
 * The one brand moment in the app: the prism's light behind the wordmark while the vault opens.
 * Light rays are WebGL and skipped under reduced motion (a still of the brand texture instead).
 */
export function Unlock({ onUnlock }: { onUnlock: (email: string, pass: string, stage: (s: string) => void) => Promise<void> }) {
  const [email, setEmail] = useState(() => localStorage.getItem('centra.lastEmail') ?? '');
  const [pass, setPass] = useState('');
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const known = !!email && !!localStorage.getItem('centra.lastEmail');

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!email || pass.length < 8) return setError('Passphrasen skal være mindst 8 tegn.');
    setError(null);
    try { await onUnlock(email, pass, setStage); }
    catch (e) { setStage(null); setError((e as Error).message); }
  }

  return (
    <main className="unlock">
      <div className="unlock__light" aria-hidden="true">
        {reduced() ? <img src="./texture-background.png" alt="" /> :
          <LightRays raysOrigin="top-center" raysColor="#E8DCC6" raysSpeed={0.6} lightSpread={0.55} rayLength={2.4} haze={0.2} glow={0.35} intensity={0.75} followMouse mouseInfluence={0.06} cursorShadow={false} clickPulse={false} opacity={0.8} />}
      </div>
      <form className="unlock__card" onSubmit={submit}>
        <img className="unlock__symbol" src="./app-icon-dark.png" alt="" />
        <Wordmark className="unlock__word" />
        <p className="unlock__tag">Your life. In focus.</p>
        {stage ? (
          <p className="unlock__stage" role="status"><DecryptedText key={stage} text={stage + ' …'} animateOn="view" sequential speed={30} maxIterations={6} characters="0123456789ABCDEF" encryptedClassName="encrypted" /></p>
        ) : (
          <>
            <label className="ufield"><span>E-mail</span><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label className="ufield"><span>Passphrase</span><input type="password" autoComplete={known ? 'current-password' : 'new-password'} value={pass} onChange={(e) => setPass(e.target.value)} required minLength={8} /></label>
            {error && <p className="unlock__error" role="alert">{error}</p>}
            <button className="btn btn--primary unlock__go" type="submit">{known ? 'Lås op' : 'Lås op eller opret konto'}</button>
            <p className="meta unlock__note">Passphrasen forlader aldrig enheden. Den låser dine data op, og uden den kan ingen læse dem, heller ikke CENTRA.</p>
          </>
        )}
      </form>
    </main>
  );
}
