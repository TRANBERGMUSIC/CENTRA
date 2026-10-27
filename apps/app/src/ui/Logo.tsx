import { useId, useRef } from 'react';
import { gsap, useGSAP, reduced } from '../motion.ts';

/**
 * The CENTRA mark: a C (amber → flare → rose → violet) around a glowing orb. Static on purpose:
 * the motion lives in the app, not in the logo. Geometry shared with the app icons (scripts/icons.cjs).
 */
export const LOGO_ARC = 'M72.6 27.4 A32 32 0 1 0 72.6 72.6';
export const LOGO_STOPS: [number, string][] = [[0, '#FFE2B8'], [0.38, '#FF9A5C'], [0.72, '#D9507A'], [1, '#7B4DFF']];

export function Logo({ size = 40, className = '', title }: { size?: number; className?: string; title?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={`logo ${className}`} width={size} height={size} viewBox="0 0 100 100" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={`g${id}`} x1="30" y1="12" x2="78" y2="86" gradientUnits="userSpaceOnUse">
          {LOGO_STOPS.map(([o, c]) => <stop key={o} offset={o} stopColor={c} />)}
        </linearGradient>
        <radialGradient id={`o${id}`} cx="0.42" cy="0.38" r="0.62">
          <stop offset="0" stopColor="#FFFBF4" /><stop offset="0.55" stopColor="#FFE2B8" /><stop offset="1" stopColor="#FFB27A" />
        </radialGradient>
        <radialGradient id={`h${id}`}>
          <stop offset="0" stopColor="#FFD9A8" stopOpacity="0.85" /><stop offset="0.45" stopColor="#FF9A5C" stopOpacity="0.28" /><stop offset="1" stopColor="#FF9A5C" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle className="logo__glow" cx="50" cy="50" r="26" fill={`url(#h${id})`} />
      <g className="logo__c">
        <path className="logo__arc" d={LOGO_ARC} fill="none" stroke={`url(#g${id})`} strokeWidth="16" strokeLinecap="round" />
        <path className="logo__gloss" d="M58 24.2 A27 27 0 0 0 29.5 34" fill="none" stroke="#fff" strokeOpacity="0.38" strokeWidth="3" strokeLinecap="round" />
      </g>
      <circle className="logo__orb" cx="50" cy="50" r="10" fill={`url(#o${id})`} />
    </svg>
  );
}

/**
 * The living background: four soft lights in the brand colours drifting slowly, leaning gently
 * toward the pointer. Transform-only, paused when the tab is hidden, still under reduced motion.
 */
export function Aura({ className = '', strength = 1 }: { className?: string; strength?: number }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    if (reduced()) return;
    const blobs = gsap.utils.toArray<HTMLElement>('.aura__b', root.current);
    blobs.forEach((b, i) => {
      gsap.to(b, { xPercent: gsap.utils.random(-28, 28), yPercent: gsap.utils.random(-22, 22), scale: gsap.utils.random(0.85, 1.25), rotate: gsap.utils.random(-30, 30), duration: gsap.utils.random(9, 14), ease: 'sine.inOut', yoyo: true, repeat: -1, delay: -i * 2.3 });
    });
    const el = root.current!;
    const xTo = gsap.quickTo(el, 'x', { duration: 1.6, ease: 'power3.out' });
    const yTo = gsap.quickTo(el, 'y', { duration: 1.6, ease: 'power3.out' });
    const move = (e: PointerEvent) => { xTo((e.clientX / innerWidth - 0.5) * 40); yTo((e.clientY / innerHeight - 0.5) * 30); };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, { scope: root });
  return (
    <div ref={root} className={`aura ${className}`} aria-hidden="true" style={{ ['--aura' as any]: strength }}>
      <i className="aura__b aura__b--amber" /><i className="aura__b aura__b--flare" /><i className="aura__b aura__b--rose" /><i className="aura__b aura__b--violet" />
    </div>
  );
}
