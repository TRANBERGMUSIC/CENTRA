import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon.tsx';
import { gsap, reduced } from '../motion.ts';

/**
 * Notifications in the top-right corner, in the spirit of macOS: frosted glass, an icon, a title
 * and a line of text, actions as pills. They stack (newest on top, older ones tuck in behind),
 * pause while you hover, count down with a thin line, and can be flicked away to the right.
 */
export type Kind = 'info' | 'done' | 'error' | 'mail' | 'money' | 'update';
export type Toast = {
  id: number; text: string; title?: string; kind?: Kind; sticky?: boolean;
  action?: { label: string; run: () => void };
  /** Override the picture: a specific icon, or a person (their photo or initials). */
  icon?: IconName; person?: { name: string; photo?: string };
};
type Input = Omit<Toast, 'id'>;

const Ctx = createContext<(t: Input) => void>(() => {});
export const useToast = () => useContext(Ctx);

const LIFE = 5200;

/** What a notification is about decides its picture and colour, like an app icon on macOS. */
type Topic = { icon: IconName; tint: string };
const TOPICS: [RegExp, Topic][] = [
  [/kunne ikke|afvist|fejl|ugyldig|ikke fundet|for travlt|svarer ikke|virker kun/i, { icon: 'x', tint: 'var(--c-focus)' }],
  [/version|genstart|opdatering hentet/i, { icon: 'sun', tint: 'var(--viz-6)' }],
  [/kontakt/i, { icon: 'contacts', tint: 'var(--viz-5)' }],
  [/udlæg|betalt|skylder|betaling/i, { icon: 'receipt', tint: 'var(--viz-4)' }],
  [/udgift|abonnement|tilføjet.*kr|kr\b/i, { icon: 'wallet', tint: 'var(--viz-4)' }],
  [/kvittering|varer sat ind|vare sat ind/i, { icon: 'camera', tint: 'var(--viz-4)' }],
  [/mail|indbakke|sendt til|arkiveret|fundet:/i, { icon: 'inbox', tint: 'var(--viz-1)' }],
  [/kalender|aftale|aflyst/i, { icon: 'calendar', tint: 'var(--viz-3)' }],
  [/mål|opdatering logget|opdatering slettet/i, { icon: 'goals', tint: 'var(--viz-6)' }],
  [/note/i, { icon: 'notes', tint: 'var(--c-stone, #C9B99A)' }],
  [/forbundet|forbind|nøgle/i, { icon: 'link', tint: 'var(--viz-1)' }],
  [/kopieret/i, { icon: 'paperclip', tint: 'var(--c-calm)' }],
  [/password|låst|gendannelse/i, { icon: 'settings', tint: 'var(--c-calm)' }],
];
const topicOf = (text: string, kind: Kind): Topic | null => TOPICS.find(([re]) => re.test(text))?.[1] ?? (kind === 'done' ? { icon: 'check', tint: 'var(--c-calm)' } : null);
const hueOf = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

/** Guesses the kind and a short title from the text, so existing calls look right without changes. */
function infer(t: Input): { kind: Kind; title: string; body: string } {
  const text = t.text.trim();
  const kind: Kind = t.kind ?? (/kunne ikke|afvist|fejl|mangler|ugyldig|ikke fundet|for travlt|svarer ikke|virker kun/i.test(text) ? 'error'
    : /mail|indbakke|sendt til|fundet:/i.test(text) ? 'mail'
    : /betalt|skylder|udlæg|kr\b|udgift/i.test(text) ? 'money'
    : /version|opdater|genstart/i.test(text) ? 'update'
    : t.action?.label === 'Fortryd' || /gemt|oprettet|tilføjet|slettet|fortrudt|arkiveret|kopieret|forbundet|logget|klaret/i.test(text) ? 'done' : 'info');
  if (t.title) return { kind, title: t.title, body: text };
  // "Netflix er tilføjet" → title, no body. "Gmail: Login blev afvist. Tjek …" → "Gmail" + rest.
  const colon = /^([^:.!?]{2,32}):\s+(.+)$/s.exec(text);
  if (colon) return { kind, title: colon[1], body: colon[2] };
  const sentence = /^(.{3,60}?[.!?])\s+(.+)$/s.exec(text);
  if (sentence) return { kind, title: sentence[1].replace(/\.$/, ''), body: sentence[2] };
  return { kind, title: text, body: '' };
}

export function NotificationHost({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((t: Input) => {
    const id = Date.now() + Math.random();
    setList((l) => [{ ...t, id }, ...l].slice(0, 5));
  }, []);
  const remove = useCallback((id: number) => setList((l) => l.filter((x) => x.id !== id)), []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="notes-stack" role="region" aria-label="Notifikationer" aria-live="polite">
        {list.map((t, i) => <Note key={t.id} t={t} index={i} onClose={() => remove(t.id)} />)}
      </div>
    </Ctx.Provider>
  );
}

function Note({ t, index, onClose }: { t: Toast; index: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const timer = useRef<gsap.core.Tween | null>(null);
  const leaving = useRef(false);
  const close = useRef(onClose); close.current = onClose; // parent re-renders must not restart the countdown
  const { kind, title, body } = infer(t);
  const behind = index >= 3;

  const leave = useCallback((dir = 1) => {
    if (leaving.current) return;
    leaving.current = true;
    timer.current?.kill();
    const el = ref.current;
    if (!el || reduced()) return close.current();
    gsap.to(el, { x: dir * 420, opacity: 0, duration: 0.35, ease: 'power2.in', onComplete: () => {
      gsap.to(el, { height: 0, marginBottom: -10, paddingTop: 0, paddingBottom: 0, duration: 0.2, ease: 'power2.out', onComplete: () => close.current() });
    } });
  }, []);

  // Slide in from the right with a little overshoot, like a banner dropping in.
  useLayoutEffect(() => {
    const el = ref.current!;
    if (!reduced()) gsap.fromTo(el, { x: 380, opacity: 0, scale: 0.94 }, { x: 0, opacity: 1, scale: 1, duration: 0.6, ease: 'back.out(1.35)' });
  }, []);

  // Countdown: the thin line runs out, then the note leaves. Hover pauses it.
  useEffect(() => {
    if (t.sticky) return;
    timer.current = gsap.fromTo(bar.current, { scaleX: 1 }, { scaleX: 0, duration: LIFE / 1000, ease: 'none', onComplete: () => leave() });
    return () => { timer.current?.kill(); };
  }, [t.sticky, leave]);

  // Flick to the right to dismiss.
  useEffect(() => {
    const el = ref.current!;
    let x0: number | null = null, dx = 0;
    const down = (e: PointerEvent) => { if ((e.target as HTMLElement).closest('button')) return; x0 = e.clientX; dx = 0; el.setPointerCapture(e.pointerId); timer.current?.pause(); };
    const move = (e: PointerEvent) => { if (x0 === null) return; dx = Math.max(-20, e.clientX - x0); gsap.set(el, { x: dx, opacity: 1 - Math.max(0, dx) / 360 }); };
    const up = () => { if (x0 === null) return; x0 = null; if (dx > 90) leave(); else { gsap.to(el, { x: 0, opacity: 1, duration: 0.3, ease: 'back.out(2)' }); timer.current?.resume(); } };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
  }, [leave]);

  return (
    <div ref={ref} className={`note note--${kind} ${behind ? 'is-behind' : ''}`} role={kind === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => timer.current?.pause()} onMouseLeave={() => !leaving.current && timer.current?.resume()}>
      <button className="note__close" aria-label="Luk" onClick={() => leave()}><Icon name="x" size="sm" /></button>
      <Picture t={t} kind={kind} text={`${title} ${body}`} />
      <div className="note__main">
        <div className="note__head"><span className="note__app">CENTRA</span><span className="note__time">nu</span></div>
        <div className="note__title">{title}</div>
        {body && <div className="note__body">{body}</div>}
        {t.action && (
          <div className="note__actions">
            <button className="note__btn" onClick={() => { t.action!.run(); leave(); }}>{t.action.label}</button>
            {t.sticky && <button className="note__btn note__btn--quiet" onClick={() => leave()}>Senere</button>}
          </div>
        )}
      </div>
      {!t.sticky && <span className="note__life"><span ref={bar} /></span>}
    </div>
  );
}

/** The notification's picture: a person, a topic icon on a coloured squircle, or the CENTRA icon. */
function Picture({ t, kind, text }: { t: Toast; kind: Kind; text: string }) {
  const badge = <img className="note__badge" src="./app-icon-dark.png" alt="" />;
  if (t.person) {
    const p = t.person;
    return (
      <span className="note__pic" aria-hidden="true">
        {p.photo ? <img className="note__face" src={p.photo} alt="" /> : <span className="note__face note__face--initials" style={{ ['--h' as any]: hueOf(p.name) }}>{p.name.split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('')}</span>}
        {badge}
      </span>
    );
  }
  const topic: Topic | null = t.icon ? { icon: t.icon, tint: TOPICS.find(([, x]) => x.icon === t.icon)?.[1].tint ?? 'var(--c-calm)' } : topicOf(text, kind);
  if (!topic) return <span className="note__pic" aria-hidden="true"><img className="note__app-icon" src="./app-icon-dark.png" alt="" /></span>;
  return (
    <span className="note__pic" aria-hidden="true">
      <span className="note__glyph" style={{ ['--tint' as any]: topic.tint }}><Icon name={topic.icon} /></span>
      {badge}
    </span>
  );
}
