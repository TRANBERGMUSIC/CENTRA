import { useEffect, useRef, useState } from 'react';
import { useSession } from '../state.tsx';
import { invoke } from '../platform.ts';
import { bioIsOn, bioKind, BIO_NAME, type BioKind } from '../biometrics.ts';
import { Logo } from './Logo.tsx';
import { Btn } from './primitives.tsx';
import { lock } from '../lock.ts';

/**
 * The Mac's lock while CENTRA runs in the background (lock.ts): it covers everything and takes
 * Touch ID or the password; behind it reminders, mail and push carry on.
 */
export function Veil() {
  const session = useSession();
  const [on, setOn] = useState(false);
  const [reason, setReason] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState<BioKind>('none');
  const asking = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const bio = kind !== 'none' && bioIsOn(session.user);

  useEffect(() => { void bioKind().then(setKind).catch(() => {}); }, []);
  useEffect(() => {
    const v = (ev: Event) => { setReason(String((ev as CustomEvent).detail ?? '')); setPw(''); setErr(null); setOn(true); };
    addEventListener('centra-veil', v);
    return () => removeEventListener('centra-veil', v);
  }, []);
  // Everything behind is out of reach (keyboard, screen readers) while it's on.
  useEffect(() => {
    const app = document.querySelector<HTMLElement>('.app');
    if (app) app.inert = on;
    if (on) setTimeout(() => field.current?.focus(), 50);
  }, [on]);

  async function finger() {
    if (asking.current) return;
    asking.current = true;
    try {
      const key = await invoke<number[]>('bio_unlock', { user: session.user.trim().toLowerCase() });
      key.fill(0);
      setOn(false);
    } catch { setErr(null); field.current?.focus(); } finally { asking.current = false; }
  }
  // Touch ID asks by itself when the window comes back.
  useEffect(() => {
    if (!on || !bio) return;
    const ask = () => { if (!document.hidden) void finger(); };
    ask();
    document.addEventListener('visibilitychange', ask);
    return () => document.removeEventListener('visibilitychange', ask);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, bio]);

  if (!on) return null;
  return (
    <div className="veil" role="dialog" aria-modal="true" aria-label="CENTRA er låst">
      <form className="veil__card" onSubmit={(ev) => {
        ev.preventDefault();
        try { session.verify(pw); setOn(false); setPw(''); } catch { setErr('Forkert password.'); setPw(''); }
      }}>
        <Logo size={54} />
        <h1>CENTRA er låst</h1>
        {reason && <p className="meta">{reason}</p>}
        <input ref={field} type="password" name="password" autoComplete="current-password" value={pw} onChange={(x) => setPw(x.target.value)} placeholder="Password" aria-label="Password" />
        {err && <p className="unlock__error" role="alert">{err}</p>}
        <div className="veil__acts">
          {bio && <Btn type="button" onClick={() => void finger()}>{BIO_NAME[kind]}</Btn>}
          <Btn type="submit" variant="primary" disabled={!pw}>Lås op</Btn>
        </div>
        <button type="button" className="veil__out" onClick={() => lock(undefined, true)}>Lås helt</button>
      </form>
    </div>
  );
}
