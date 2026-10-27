/* A calm scroll: the page glides to a place over most of a second — longer
   for longer trips, never rushed — easing in and out, instead of the
   browser's own smooth scroll, which crosses a long page in a blink.

   Any wheel, touch or key from the reader stops it at once: the page never
   fights the person holding it. With "reduce motion" on, it simply jumps. */

let current: (() => void) | null = null;

/** easeInOutCubic: slow away, quick through the middle, slow to rest. */
export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** How long a glide of `distance` pixels takes, in ms. */
export const glideDuration = (distance: number): number => Math.round(Math.min(1500, Math.max(700, 600 + Math.abs(distance) * 0.12)));

export function glideTo(top: number): void {
  current?.();
  const root = document.documentElement;
  const start = window.scrollY;
  const target = Math.max(0, Math.min(top, root.scrollHeight - window.innerHeight));
  const distance = target - start;
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* The stylesheet's smooth scrolling would smooth every step again: off while gliding. */
  root.classList.add('is-gliding');
  if (calm || Math.abs(distance) < 2) {
    window.scrollTo(0, target);
    root.classList.remove('is-gliding');
    return;
  }

  const duration = glideDuration(distance);
  const began = performance.now();
  let frame = 0;
  const stop = () => {
    window.cancelAnimationFrame(frame);
    root.classList.remove('is-gliding');
    for (const name of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.removeEventListener(name, stop);
    if (current === stop) current = null;
  };
  for (const name of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.addEventListener(name, stop, { passive: true });
  current = stop;

  const step = (now: number) => {
    const progress = Math.min(1, (now - began) / duration);
    window.scrollTo(0, start + distance * easeInOutCubic(progress));
    if (progress < 1) frame = window.requestAnimationFrame(step);
    else stop();
  };
  frame = window.requestAnimationFrame(step);
}
