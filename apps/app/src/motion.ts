/**
 * The motion layer. GSAP drives every transition; Lenis smooths the long reading surfaces.
 * Rules: transform, opacity and filter only; screen changes are expressive (≈ 0.6 s), feedback
 * is quick (≤ 250 ms), the logo never moves, and everything collapses to an instant change under
 * prefers-reduced-motion.
 */
import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';
import { useGSAP } from '@gsap/react';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { motion as T } from '@centra/design-system';

gsap.registerPlugin(useGSAP, Flip);

export const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const s = (ms: number) => (reduced() ? 0 : ms / 1000);

/** The design-system curves as GSAP eases. */
gsap.registerEase('centra.standard', gsap.parseEase('power3.out'));
export const ease = { standard: 'power3.out', enter: 'expo.out', exit: 'power2.in' };
export const dur = { instant: s(T.duration.instant), quick: s(T.duration.quick), base: s(T.duration.base), slow: s(T.duration.slow) };

/** Rows that ride in after the panels on a screen change (first 14 of each list). */
const ROWS = '.row, .nrow, .mrow, .gitem, .goalrow, .orow, .crow, .xrow, .oweline, .msg, .plist > *';

/**
 * A screen arriving: its panels settle in from 8 px below, quickly, the first rows with them.
 * An app screen should feel there at once, so it's short (≈ 0.3 s all in), ease-out, transform and
 * opacity only (no blur: costly, and it makes text look like it's loading).
 */
export function useScreenEnter(scope: RefObject<HTMLElement | null>, key: unknown) {
  useGSAP(() => {
    if (reduced()) return;
    const root = scope.current!;
    // On the phone: shorter and without blur (blur is costly there, and a phone screen should feel instant).
    if (narrow()) {
      const parts = root.querySelectorAll(':scope [data-enter], :scope .kpi');
      gsap.from(parts, { y: 8, opacity: 0, duration: 0.26, ease: 'power3.out', stagger: { each: 0.025, amount: 0.12 }, clearProps: 'transform,opacity' });
      return;
    }
    const parts = root.querySelectorAll(':scope [data-enter], :scope .kpi');
    const rows = Array.from(root.querySelectorAll<HTMLElement>(ROWS)).filter((el, i, all) => all.indexOf(el) < 40 && !el.closest('[hidden]')).slice(0, 8);
    gsap.timeline()
      .from(parts, { y: 8, opacity: 0, duration: 0.28, ease: 'power3.out', stagger: { each: 0.025, amount: 0.12 }, clearProps: 'transform,opacity' })
      .from(rows, { y: 6, opacity: 0, duration: 0.24, ease: 'power3.out', stagger: 0.02, clearProps: 'transform,opacity' }, 0.06);
  }, { scope, dependencies: [key], revertOnUpdate: true });
}

/**
 * The app's living layer, mounted once around the shell:
 *  - segmented controls and tab bars get a thumb that glides to the chosen option (like iOS),
 *  - panels and cards carry a soft brand-coloured light that follows the pointer.
 */
export function useAppMotion(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const placed = new WeakSet<HTMLElement>();
    let raf = 0;
    const sync = () => {
      raf = 0;
      el.querySelectorAll<HTMLElement>('.segmented, .tabs, .acctpick').forEach((box) => {
        const active = box.querySelector<HTMLElement>(':scope > .is-active');
        let thumb = box.querySelector<HTMLElement>(':scope > .seg-thumb');
        if (!thumb) { thumb = document.createElement('span'); thumb.className = 'seg-thumb'; thumb.setAttribute('aria-hidden', 'true'); box.appendChild(thumb); box.dataset.thumb = '1'; }
        if (!active || !active.offsetWidth) { gsap.to(thumb, { opacity: 0, duration: 0.15 }); return; }
        const to = { x: active.offsetLeft, y: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight, opacity: 1 };
        if (!placed.has(thumb) || reduced()) { gsap.set(thumb, to); placed.add(thumb); }
        else gsap.to(thumb, { ...to, duration: 0.42, ease: 'back.out(1.15)', overwrite: true });
      });
    };
    const queue = () => { if (!raf) raf = requestAnimationFrame(sync); };
    const mo = new MutationObserver(queue);
    mo.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    addEventListener('resize', queue);
    queue();

    const glow = (e: PointerEvent) => {
      const card = (e.target as HTMLElement | null)?.closest?.('.panel, .kpi, .ocard, .ccard') as HTMLElement | null;
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
    if (!reduced()) el.addEventListener('pointermove', glow, { passive: true });
    return () => { mo.disconnect(); removeEventListener('resize', queue); el.removeEventListener('pointermove', glow); cancelAnimationFrame(raf); };
  }, [root]);

  // The shell itself arrives once, after unlocking: a short fade, so the unlock lands softly.
  useGSAP(() => {
    if (reduced() || !root.current) return;
    gsap.from(root.current, { opacity: 0, duration: 0.25, ease: 'power2.out', clearProps: 'opacity' });
  }, { scope: root });
}

/** The sidebar's active pill glides to the chosen item (ease-out, no bounce: this is a tool, not a toy). */
export function useNavPill(nav: RefObject<HTMLElement | null>, key: unknown) {
  useLayoutEffect(() => {
    const box = nav.current;
    const pill = box?.querySelector<HTMLElement>('.nav-pill');
    if (!box || !pill) return;
    const act = box.querySelector<HTMLElement>('.nav-item.is-active');
    if (!act) { gsap.to(pill, { opacity: 0, duration: 0.2 }); return; }
    const first = !pill.dataset.on;
    pill.dataset.on = '1';
    const to = { y: act.offsetTop, height: act.offsetHeight, opacity: 1 };
    if (first || reduced()) gsap.set(pill, to);
    else {
      gsap.to(pill, { ...to, duration: 0.32, ease: 'expo.out', overwrite: true });
    }
  }, [nav, key]);
}

/** Smooth, inertial scrolling for a reading pane (note editor, mail reader). Skipped under reduced motion. */
export function useLenis(wrapper: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>, key?: unknown) {
  useEffect(() => {
    // Touch screens scroll natively (smoothing fights the finger and the caret in a note).
    if (reduced() || matchMedia('(pointer: coarse)').matches || !wrapper.current || !content.current) return;
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

/** Phone width (the stylesheets' breakpoint). */
export const narrow = () => window.matchMedia('(max-width: 640px)').matches;

/**
 * Something new takes the place of something else, coming from a side: `dir` 1 = from the right
 * (next day, a page further in), -1 = from the left (back). Quick, ease-out, transform/opacity only.
 */
export function slideIn(targets: gsap.TweenTarget, dir: number, distance = 44, duration = 0.34) {
  if (reduced() || !dir) return;
  gsap.fromTo(targets, { x: dir * distance, opacity: 0 }, { x: 0, opacity: 1, duration, ease: 'expo.out', overwrite: true, clearProps: 'transform,opacity' });
}

/**
 * Moving between pages on the phone, like iOS: further in (a note from the list) slides in from
 * the right, back slides in from the left, another tab fades up. One element moves; nothing twice.
 */
export function usePageTransition(route: { screen: string; id?: string }) {
  const last = useRef(route);
  useLayoutEffect(() => {
    const prev = last.current;
    last.current = route;
    if (reduced() || !narrow() || (prev.screen === route.screen && prev.id === route.id)) return;
    const page = document.querySelector<HTMLElement>('.app > main, .app main');
    if (!page) return;
    if (prev.screen !== route.screen) return; // another tab: the screen's own entrance plays
    slideIn(page, route.id && !prev.id ? 1 : !route.id && prev.id ? -1 : 1, route.id && !prev.id ? 72 : 48, 0.38);
  }, [route.screen, route.id]);
}

export { gsap, useGSAP, Flip };
