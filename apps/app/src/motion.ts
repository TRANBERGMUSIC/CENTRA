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
import { useEffect, useLayoutEffect, type RefObject } from 'react';
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
 * A screen arriving: panels rise out of a soft blur, staggered, then the rows inside them follow.
 * Expressive but quick (≈ 0.6 s in total) and transform/opacity/filter only.
 */
export function useScreenEnter(scope: RefObject<HTMLElement | null>, key: unknown) {
  useGSAP(() => {
    if (reduced()) return;
    const root = scope.current!;
    const parts = root.querySelectorAll(':scope [data-enter], :scope .kpi');
    const rows = Array.from(root.querySelectorAll<HTMLElement>(ROWS)).filter((el, i, all) => all.indexOf(el) < 40 && !el.closest('[hidden]')).slice(0, 28);
    gsap.timeline()
      .from(parts, { y: 18, opacity: 0, scale: 0.985, filter: 'blur(6px)', duration: 0.6, ease: 'expo.out', stagger: 0.045, clearProps: 'transform,opacity,filter' })
      .from(rows, { y: 10, opacity: 0, duration: 0.45, ease: 'power3.out', stagger: 0.022, clearProps: 'transform,opacity' }, 0.12);
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

  // The shell itself arrives once, after unlocking: a gentle zoom out of the light.
  useGSAP(() => {
    if (reduced() || !root.current) return;
    const r = root.current;
    gsap.timeline()
      .from(r, { opacity: 0, scale: 1.02, filter: 'blur(10px)', duration: 0.7, ease: 'expo.out', clearProps: 'all' })
      .from(r.querySelectorAll('.sidebar .brand, .sidebar .searchbtn, .sidebar .nav-item, .sidebar__foot > *'), { x: -14, opacity: 0, duration: 0.5, ease: 'power3.out', stagger: 0.03, clearProps: 'transform,opacity' }, 0.1);
  }, { scope: root });
}

/** The sidebar's active pill glides between items with a little spring; the new icon pops. */
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
      gsap.to(pill, { ...to, duration: 0.55, ease: 'elastic.out(1, 0.8)', overwrite: true });
      gsap.fromTo(act.querySelector('.ic'), { scale: 0.6, rotate: -14 }, { scale: 1, rotate: 0, duration: 0.6, ease: 'back.out(3)' });
    }
  }, [nav, key]);
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
