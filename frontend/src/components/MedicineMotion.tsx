/* ==========================================================================
   Medicines in motion, for the public website
   --------------------------------------------------------------------------
   Capsules, tablets, a blister pack, a bottle, a drop, a cross and a
   molecule that drift slowly behind a page's headline, and a heartbeat line
   that draws itself behind the call to action. They are decoration and
   nothing else: hidden from screen readers, never on top of anything a
   visitor reads or presses, and still under prefers-reduced-motion (the
   shapes stay where they are; the heartbeat is drawn once, whole).

   The layer drifts a little with the scroll too (useParallax), so the
   medicines sit at a different depth from the headline in front of them.
   ========================================================================== */

import type { CSSProperties } from 'react';
import { useParallax } from '../hooks/useParallax';

type Shape = 'capsule' | 'tablet' | 'oval' | 'cross' | 'blister' | 'molecule' | 'bottle' | 'drop';
type Tone = 'brand' | 'gold' | 'sky' | 'coral';

interface Floater {
  shape: Shape; tone: Tone;
  /** Where it sits, as a share of the layer: left and top, in %. */
  x: number; y: number;
  /** Width in px, starting turn in degrees, seconds for one drift, seconds before it appears. */
  size: number; turn: number; drift: number; delay: number;
  /** Hidden on a narrow screen, where the headline needs the room. */
  wide?: boolean;
}

/* The landing page: both edges of the hero, clear of the headline. */
const HERO: Floater[] = [
  { shape: 'capsule', tone: 'brand', x: 5, y: 12, size: 74, turn: -28, drift: 9, delay: 0.1 },
  { shape: 'tablet', tone: 'gold', x: 15, y: 30, size: 34, turn: 0, drift: 7, delay: 0.35, wide: true },
  { shape: 'blister', tone: 'brand', x: 3, y: 48, size: 78, turn: 12, drift: 11, delay: 0.55, wide: true },
  { shape: 'molecule', tone: 'sky', x: 6, y: 70, size: 58, turn: -8, drift: 12, delay: 0.75, wide: true },
  { shape: 'cross', tone: 'coral', x: 88, y: 9, size: 36, turn: 10, drift: 8, delay: 0.2 },
  { shape: 'capsule', tone: 'gold', x: 90, y: 28, size: 66, turn: 32, drift: 10, delay: 0.45, wide: true },
  { shape: 'bottle', tone: 'brand', x: 80, y: 46, size: 42, turn: -10, drift: 9.5, delay: 0.65, wide: true },
  { shape: 'oval', tone: 'sky', x: 92, y: 62, size: 46, turn: -18, drift: 8.5, delay: 0.85, wide: true },
  { shape: 'drop', tone: 'sky', x: 24, y: 10, size: 22, turn: 0, drift: 6.5, delay: 0.95, wide: true },
  { shape: 'tablet', tone: 'brand', x: 74, y: 16, size: 26, turn: 0, drift: 7.5, delay: 1.05, wide: true }
];

/* The other pages' shorter heroes: a few, at the edges. */
const PAGE: Floater[] = [
  { shape: 'capsule', tone: 'brand', x: 6, y: 22, size: 60, turn: -24, drift: 9, delay: 0.1 },
  { shape: 'tablet', tone: 'gold', x: 14, y: 62, size: 30, turn: 0, drift: 7, delay: 0.3, wide: true },
  { shape: 'molecule', tone: 'sky', x: 3, y: 74, size: 48, turn: 6, drift: 11, delay: 0.5, wide: true },
  { shape: 'cross', tone: 'coral', x: 89, y: 18, size: 30, turn: 8, drift: 8, delay: 0.2 },
  { shape: 'oval', tone: 'brand', x: 84, y: 56, size: 42, turn: -20, drift: 9.5, delay: 0.4, wide: true },
  { shape: 'capsule', tone: 'gold', x: 93, y: 74, size: 52, turn: 30, drift: 10, delay: 0.6, wide: true }
];

/** The medicines behind a hero. `hero` for the landing page, `page` for the others. */
export function FloatingMedicines({ variant = 'page' }: { variant?: 'hero' | 'page' }) {
  const layer = useParallax<HTMLDivElement>({ speed: variant === 'hero' ? 0.16 : 0.1, max: 70 });
  const items = variant === 'hero' ? HERO : PAGE;
  return (
    <div className={`med-float is-${variant}`} ref={layer} aria-hidden="true">
      {items.map((item, index) => (
        <span
          key={index}
          className={`med tone-${item.tone}${item.wide ? ' is-wide' : ''}`}
          style={{
            '--x': `${item.x}%`, '--y': `${item.y}%`, '--w': `${item.size}px`, '--turn': `${item.turn}deg`,
            '--drift': `${item.drift}s`, '--delay': `${item.delay}s`, '--sway': index % 2 ? '-1' : '1'
          } as CSSProperties}
        >
          <span className="med-body"><MedicineShape shape={item.shape} /></span>
        </span>
      ))}
    </div>
  );
}

/** One medicine, drawn in the tone's colour (--med-a) and the pack's (--med-b). */
function MedicineShape({ shape }: { shape: Shape }) {
  switch (shape) {
    case 'capsule':
      return (
        <svg viewBox="0 0 80 32" focusable="false">
          <path d="M16 2H40V30H16A14 14 0 0 1 16 2Z" fill="var(--med-a)" />
          <path d="M40 2H64A14 14 0 0 1 64 30H40Z" fill="var(--med-b)" />
          <rect x="2" y="2" width="76" height="28" rx="14" fill="none" stroke="var(--med-edge)" strokeWidth="1.5" />
          <path d="M11 10H30" stroke="#fff" strokeOpacity=".55" strokeWidth="4" strokeLinecap="round" />
          <path d="M46 10H62" stroke="#fff" strokeOpacity=".8" strokeWidth="4" strokeLinecap="round" />
        </svg>
      );
    case 'tablet':
      return (
        <svg viewBox="0 0 40 40" focusable="false">
          <circle cx="20" cy="20" r="18" fill="var(--med-a)" />
          <circle cx="20" cy="20" r="13.5" fill="none" stroke="#fff" strokeOpacity=".28" strokeWidth="1.5" />
          <path d="M9 20H31" stroke="#fff" strokeOpacity=".5" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M11 11a12 12 0 0 1 9-4" stroke="#fff" strokeOpacity=".55" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        </svg>
      );
    case 'oval':
      return (
        <svg viewBox="0 0 52 30" focusable="false">
          <ellipse cx="26" cy="15" rx="24" ry="13" fill="var(--med-a)" />
          <path d="M11 15H41" stroke="#fff" strokeOpacity=".45" strokeWidth="2.5" strokeLinecap="round" />
          <ellipse cx="17" cy="9" rx="7" ry="2.5" fill="#fff" fillOpacity=".35" />
        </svg>
      );
    case 'cross':
      return (
        <svg viewBox="0 0 40 40" focusable="false">
          <rect x="14" y="3" width="12" height="34" rx="4" fill="var(--med-a)" />
          <rect x="3" y="14" width="34" height="12" rx="4" fill="var(--med-a)" />
          <rect x="17" y="7" width="3" height="10" rx="1.5" fill="#fff" fillOpacity=".45" />
        </svg>
      );
    case 'blister':
      return (
        <svg viewBox="0 0 66 46" focusable="false">
          <rect x="2" y="2" width="62" height="42" rx="9" fill="var(--med-b)" stroke="var(--med-edge)" strokeWidth="1.5" />
          {[0, 1, 2].map((column) => [0, 1].map((row) => (
            <g key={`${column}-${row}`}>
              <circle cx={15 + column * 18} cy={15 + row * 16} r="6.5" fill="var(--med-a)" />
              <circle cx={13 + column * 18} cy={13 + row * 16} r="2" fill="#fff" fillOpacity=".55" />
            </g>
          )))}
        </svg>
      );
    case 'molecule':
      return (
        <svg viewBox="0 0 58 50" focusable="false">
          <path d="M12 36L29 24L46 34M29 24L27 8" stroke="var(--med-a)" strokeOpacity=".7" strokeWidth="3" strokeLinecap="round" fill="none" />
          <circle cx="12" cy="36" r="7" fill="var(--med-a)" />
          <circle cx="29" cy="24" r="6" fill="var(--gold-500)" />
          <circle cx="46" cy="34" r="6.5" fill="var(--med-a)" />
          <circle cx="27" cy="8" r="5" fill="var(--med-a)" />
        </svg>
      );
    case 'bottle':
      return (
        <svg viewBox="0 0 38 50" focusable="false">
          <rect x="9" y="2" width="20" height="9" rx="3" fill="var(--med-a)" />
          <rect x="4" y="11" width="30" height="37" rx="7" fill="var(--med-b)" stroke="var(--med-edge)" strokeWidth="1.5" />
          <rect x="8" y="21" width="22" height="17" rx="3" fill="var(--med-a)" fillOpacity=".2" />
          <path d="M19 24.5V34.5M14 29.5H24" stroke="var(--med-a)" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );
    case 'drop':
      return (
        <svg viewBox="0 0 30 40" focusable="false">
          <path d="M15 2C15 2 3 17 3 26a12 12 0 0 0 24 0C27 17 15 2 15 2Z" fill="var(--med-a)" />
          <path d="M9 27a6 6 0 0 0 4 5" stroke="#fff" strokeOpacity=".6" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        </svg>
      );
    default:
      return null;
  }
}

const PULSE = 'M0 46H150L166 46L176 30L186 58L200 8L214 72L226 46H300L312 38L322 52L332 46H446L458 46L468 30L478 58L492 8L506 72L518 46H600';

/** A heartbeat line that keeps drawing itself, behind the call to action. */
export function HeartbeatLine() {
  return (
    <svg className="med-pulse" viewBox="0 0 600 80" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path className="med-pulse-base" d={PULSE} />
      <path className="med-pulse-trace" d={PULSE} pathLength={100} />
    </svg>
  );
}
