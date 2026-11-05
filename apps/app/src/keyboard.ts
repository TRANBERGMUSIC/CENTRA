/**
 * The iPhone keyboard. The screen's visible height (what's left above the keyboard) is kept in
 * --vvh, and html gets .kb-open while the keyboard is up. Screens that write long text (a note)
 * scroll inside that height themselves, so iOS doesn't push the whole page up: the top stays where
 * it is when the keyboard opens, and the text follows the cursor as you write, like in Noter.
 */
export function startKeyboard(): () => void {
  const vv = window.visualViewport;
  if (!vv || !matchMedia('(pointer: coarse)').matches) return () => {};
  const root = document.documentElement;
  let frame = 0;
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      root.classList.toggle('kb-open', kb > 120);
      // A screen that scrolls by itself: iOS's own nudge of the page is undone, so the top stays put.
      const own = document.querySelector<HTMLElement>('.has-open > .selfscroll');
      if (own && own.offsetParent && (scrollY !== 0 || vv.offsetTop !== 0)) scrollTo(0, 0);
      dispatchEvent(new Event('centra-viewport'));
    });
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
  return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); cancelAnimationFrame(frame); };
}
