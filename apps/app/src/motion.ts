/**
 * The motion layer. GSAP drives every transition; Lenis smooths the long reading surfaces.
 * Rules (from the design system): 100–250 ms, transform + opacity only, nothing performs
 * an entrance for its own sake, and everything collapses to an instant change under
 * prefers-reduced-motion.
 */
import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';
import { useGSAP } from '@gsap/react';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { useEffect, type RefObject } from 'react';
import { motion as T } from '@centra/design-system';

gsap.registerPlugin(useGSAP, Flip);

export const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const s = (ms: number) => (reduced() ? 0 : ms / 1000);

/** The design-system curves as GSAP eases. */
gsap.registerEase('centra.standard', gsap.parseEase('power3.out'));
export const ease = { standard: 'power3.out', enter: 'expo.out', exit: 'power2.in' };
export const dur = { instant: s(T.duration.instant), quick: s(T.duration.quick), base: s(T.duration.base), slow: s(T.duration.slow) };

/** A screen arriving: content rises 8px and fades in, parts staggered 30ms. */
export function useScreenEnter(scope: RefObject<HTMLElement | null>, key: unknown) {
  useGSAP(() => {
    if (reduced()) return;
    gsap.from(scope.current!.querySelectorAll(':scope [data-enter]'), {
      y: 8, opacity: 0, duration: s(220), ease: ease.enter, stagger: 0.03, clearProps: 'transform,opacity',
    });
  }, { scope, dependencies: [key], revertOnUpdate: true });
}

/** Smooth, inertial scrolling for a reading pane (note editor, mail reader). Skipped under reduced motion. */
export function useLenis(wrapper: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>, key?: unknown) {
  useEffect(() => {
    if (reduced() || !wrapper.current || !content.current) return;
    const lenis = new Lenis({ wrapper: wrapper.current, content: content.current, duration: 0.9, allowNestedScroll: true, anchors: true });
    const tick = (t: number) => lenis.raf(t * 1000);
    gsap.ticker.add(tick);
    return () => { gsap.ticker.remove(tick); lenis.destroy(); };
  }, [wrapper, content, key]);
}

/** Collapse a row out of a list (approve / dismiss), then run `after`. */
export function collapseOut(el: HTMLElement, after: () => void) {
  if (reduced()) return after();
  gsap.timeline({ onComplete: after })
    .to(el, { opacity: 0, x: 12, duration: s(150), ease: ease.exit })
    .to(el, { height: 0, paddingTop: 0, paddingBottom: 0, marginTop: 0, marginBottom: 0, duration: s(200), ease: ease.standard });
}

/** Record positions before a list re-orders, animate to the new layout after React commits. */
export function flipState(targets: string | Element[] | NodeListOf<Element>) {
  const state = Flip.getState(targets);
  return () => Flip.from(state, { duration: s(250), ease: ease.standard, absolute: false, nested: true });
}

export { gsap, useGSAP, Flip };
