/**
 * "Are you sure?" inside CENTRA. The browser's own confirm() does not show in the Mac app (the web view
 * answers "no" without asking), so every question goes through here instead:
 *   if (await ask({ title: 'Slet mailen?', text: '…', ok: 'Slet', danger: true })) …
 */
import { useEffect, useRef, useState } from 'react';
import { Btn } from './primitives.tsx';

export type Ask = { title: string; text?: string; ok?: string; cancel?: string; danger?: boolean };
type Open = Ask & { done: (yes: boolean) => void };

let show: ((a: Open) => void) | null = null;

export function ask(a: Ask): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) return resolve(typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm([a.title, a.text].filter(Boolean).join('\n\n')) : false);
    show({ ...a, done: resolve });
  });
}

export function ConfirmHost() {
  const [q, setQ] = useState<Open | null>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { show = (a) => setQ((cur) => { cur?.done(false); return a; }); return () => { show = null; }; }, []);
  useEffect(() => {
    if (!q) return;
    const prev = document.activeElement as HTMLElement | null;
    okRef.current?.focus();
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); close(false); } };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); prev?.focus?.(); };
  }, [q]);
  if (!q) return null;
  function close(yes: boolean) { q!.done(yes); setQ(null); }
  return (
    <>
      <div className="scrim scrim--ask" onClick={() => close(false)} />
      <div className="sheet askdlg" role="alertdialog" aria-modal="true" aria-labelledby="askdlg-t" aria-describedby={q.text ? 'askdlg-d' : undefined}>
        <div className="sheet__body">
          <h2 id="askdlg-t">{q.title}</h2>
          {q.text && <p id="askdlg-d" className="muted">{q.text}</p>}
          <div className="sheet__foot">
            <span className="push-right" />
            <Btn variant="text" onClick={() => close(false)}>{q.cancel ?? 'Annullér'}</Btn>
            <Btn ref={okRef} variant="primary" className={q.danger ? 'btn--danger' : ''} onClick={() => close(true)}>{q.ok ?? 'OK'}</Btn>
          </div>
        </div>
      </div>
    </>
  );
}
