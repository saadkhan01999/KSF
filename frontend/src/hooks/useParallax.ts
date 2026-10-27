/* Scroll-driven motion for the marketing site and the workspace hero bands.

   Design notes, because the obvious implementation has two failure modes that
   both bite in production:

   1. NOTHING MAY DEPEND ON A SCROLL EVENT FIRING.
      Scroll events are surprisingly unreliable — embedded webviews, remote
      browsers, some in-app browsers on Android, and anything driving the page
      programmatically can move the scroll offset without dispatching one. So
      this module does not listen for scroll at all. It runs a single shared
      requestAnimationFrame ticker that *samples* the scroll offset, and only
      does work when the number actually changed. One rAF for the whole page,
      one integer comparison per frame when idle.

   2. A REVEAL ANIMATION MUST NEVER BE THE THING THAT MAKES CONTENT VISIBLE.
      The usual pattern — `opacity: 0` in CSS, a class added by
      IntersectionObserver — means any failure of the observer leaves the page
      blank. Here the hiding is applied by JavaScript (`.reveal-armed`) only
      once the ticker is confirmed running, and the same ticker does the
      revealing. If any of it breaks, the content is simply visible.

   Everything switches off under `prefers-reduced-motion`, which is a real
   accessibility need rather than a preference: parallax is a common migraine
   and motion-sickness trigger. */

import { useEffect, useRef, useState } from 'react';

const reducedMotion = () =>
  typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------ the ticker */

type Layer = {
  node: HTMLElement;
  speed: number;
  max: number;
  scale: number;
  fade: boolean;
};

const layers = new Set<Layer>();
const reveals = new Set<HTMLElement>();
const scrollSubscribers = new Set<(offset: number) => void>();

let ticking = false;
let lastOffset = -1;
/* When the ticker last ran: the reveal's safety net reads it. */
let lastFrameAt = 0;

/** Finds the element that actually scrolls: `.main` inside the app shell,
    otherwise the document. */
function scrollOffset(): number {
  const shellScroller = document.querySelector<HTMLElement>('.main');
  if (shellScroller && shellScroller.scrollHeight > shellScroller.clientHeight) {
    return shellScroller.scrollTop;
  }
  return window.scrollY || document.documentElement.scrollTop || 0;
}

/* The maths is kept pure and exported so it can be unit tested without a
   browser. That matters more than it looks: a hidden or headless tab never
   runs requestAnimationFrame, so the ticker itself cannot be exercised in an
   automated check — but the arithmetic it drives can be, exactly. */

export function parallaxTransform(
  box: { top: number; height: number },
  viewport: number,
  options: { speed: number; max: number; scale?: number }
): { transform: string; shift: number; centre: number } {
  // Where the element's centre sits relative to the viewport centre, as -1..1.
  const centre = (box.top + box.height / 2 - viewport / 2) / viewport;
  const shift = Math.max(-options.max, Math.min(options.max, centre * options.speed * viewport));

  let transform = `translate3d(0, ${shift.toFixed(2)}px, 0)`;
  if (options.scale) transform += ` scale(${(1 + Math.abs(centre) * options.scale).toFixed(4)})`;

  return { transform, shift, centre };
}

/** Opacity for a fading layer: 1 at the viewport centre, 0 towards the edges. */
export function parallaxOpacity(centre: number): number {
  return Math.max(0, Math.min(1, 1 - Math.abs(centre) * 1.1));
}

/** True once an element has come far enough into view to be revealed. */
export function shouldReveal(box: { top: number; bottom: number }, viewport: number): boolean {
  return box.top < viewport * 0.88 && box.bottom > 0;
}

function applyLayer(layer: Layer, viewport: number): void {
  const box = layer.node.getBoundingClientRect();
  const { transform, centre } = parallaxTransform(box, viewport, layer);
  layer.node.style.transform = transform;
  if (layer.fade) layer.node.style.opacity = String(parallaxOpacity(centre));
}

function revealPass(viewport: number): void {
  for (const node of [...reveals]) {
    // Revealed once its top edge has come 12% into the viewport.
    if (shouldReveal(node.getBoundingClientRect(), viewport)) {
      const delay = Number(node.dataset.revealDelay ?? 0);
      window.setTimeout(() => node.classList.add('is-visible'), delay);
      reveals.delete(node);
    }
  }
}

function frame(): void {
  if (!ticking) return;
  window.requestAnimationFrame(frame);
  lastFrameAt = performance.now();

  if (document.hidden) return;

  const offset = scrollOffset();
  const viewport = window.innerHeight || 1;

  // Layers are re-applied whenever the offset changed, and once on the first
  // pass so nothing sits at its untransformed position.
  if (offset === lastOffset && reveals.size === 0) return;
  lastOffset = offset;

  for (const layer of layers) applyLayer(layer, viewport);
  revealPass(viewport);
  for (const subscriber of scrollSubscribers) subscriber(offset);
}

function startTicker(): void {
  if (ticking) return;
  ticking = true;
  lastOffset = -1;
  window.requestAnimationFrame(frame);
}

function stopTickerIfIdle(): void {
  if (layers.size === 0 && reveals.size === 0 && scrollSubscribers.size === 0) {
    ticking = false;
  }
}

/* ------------------------------------------------------------------ reveal */

/** Fades sections up as they arrive. Sections that render later — a list
    fetched from the server — are collected as they appear. Pass anything
    that changes with the page (the path) so a new page starts afresh. */
export function useReveal(deps: unknown[] = []): void {
  useEffect(() => {
    const pending = () => Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-visible)'));

    if (reducedMotion()) {
      pending().forEach((node) => node.classList.add('is-visible'));
      return undefined;
    }

    /* Arm the hiding from JavaScript, never from the stylesheet alone. If this
       line never runs, the content is simply visible — which is the correct
       failure. */
    document.documentElement.classList.add('reveal-armed');
    const collect = () => {
      for (const node of pending()) reveals.add(node);
      startTicker();
    };
    collect();

    /* New sections, as the page renders them. */
    let queued = 0;
    const watcher = new MutationObserver(() => {
      if (!queued) queued = window.requestAnimationFrame(() => { queued = 0; collect(); });
    });
    watcher.observe(document.body, { childList: true, subtree: true });

    /* Belt and braces: if the ticker ever stops running (a frozen or broken
       page), everything waiting is shown. A missed reveal is a cosmetic loss;
       hidden content is not. While the ticker runs, sections wait for the
       reader to scroll to them — that is the point of the motion. */
    const safety = window.setInterval(() => {
      if (performance.now() - lastFrameAt < 1500) return;
      for (const node of [...reveals]) {
        node.classList.add('is-visible');
        reveals.delete(node);
      }
    }, 1600);

    return () => {
      watcher.disconnect();
      window.cancelAnimationFrame(queued);
      window.clearInterval(safety);
      for (const node of pending()) reveals.delete(node);
      stopTickerIfIdle();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/* ---------------------------------------------------------------- parallax */

interface ParallaxOptions {
  /** Fraction of viewport height to move by. Negative rises, positive sinks. */
  speed?: number;
  /** Clamp, so a layer can never drift further than this many pixels. */
  max?: number;
  /** Scale slightly as it moves — used on the hero screenshot. */
  scale?: number;
  /** Fade out towards the edges of the viewport. */
  fade?: boolean;
}

/** Attaches parallax to one element. Spread the returned ref onto it. */
export function useParallax<T extends HTMLElement>(options: ParallaxOptions = {}) {
  const { speed = 0.25, max = 260, scale = 0, fade = false } = options;
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || reducedMotion()) return undefined;

    const layer: Layer = { node, speed, max, scale, fade };
    layers.add(layer);
    startTicker();

    return () => {
      layers.delete(layer);
      node.style.transform = '';
      node.style.opacity = '';
      stopTickerIfIdle();
    };
  }, [speed, max, scale, fade]);

  return ref;
}

/* ---------------------------------------------------------------- scroll Y */

/** Current scroll offset, sampled by the shared ticker. Used for the sticky
    nav's shrink state. */
/** Calls `listener` with the scroll offset whenever it changes, from the
    shared ticker (no scroll listener). Returns the unsubscribe. */
export function onScrollOffset(listener: (offset: number) => void): () => void {
  scrollSubscribers.add(listener);
  startTicker();
  return () => { scrollSubscribers.delete(listener); stopTickerIfIdle(); };
}

/** Whether the page has scrolled further than `threshold` pixels. Re-renders
    only when the answer changes, not on every frame of a scroll. */
export function useScrolledPast(threshold: number): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => onScrollOffset((offset) => setPast(offset > threshold)), [threshold]);
  return past;
}

/** Sets `data-view` on <html>, which decides whether the page scrolls
    (marketing site) or the shell scrolls internally (workspace). */
export function useViewMode(mode: 'app' | 'site'): void {
  useEffect(() => {
    document.documentElement.dataset.view = mode;
    return () => { delete document.documentElement.dataset.view; };
  }, [mode]);
}
