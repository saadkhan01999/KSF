/* ==========================================================================
   The KSF identity.
   --------------------------------------------------------------------------
   The letterforms here are not a typeface and not a redraw. They are the
   outlined vector paths taken from the approved print artwork
   (KSF-print-artwork.pdf), so the wordmark on a screen is the same shape as
   the wordmark on a printed sheet — same geometry, same emerald, same
   proportions. Nothing about the mark depends on a font being installed.

   The set:

     KsfWordmark   the three letters, 368 x 102, on their own
     BrandMark     the icon: the geometric K in a rounded tile, with a
                   capsule lying in the crook above the K's arm
     BrandLogo     mark + wordmark + strapline, horizontal or stacked

   The capsule is the only addition to the artwork. It is there because a
   pharmacy needs to be recognisable as a pharmacy at 16 pixels, where three
   letters are unreadable, and it is small and gold on purpose: the brief
   asked for restrained gold, not a second focal point.

   Gradient and clip identifiers come from useId(), because a page can show
   two marks at once — the sidebar and a dialog — and duplicate SVG ids
   silently make the second one pick the wrong fill.
   ========================================================================== */

import { useId } from 'react';
import { BRAND } from '../brand';

type Tone = 'auto' | 'invert' | 'mono';

/* The approved outlines. y increases downward, as in SVG. */
const K_PATH = 'M0 0 L28 0 L28 38 L66 0 L106 0 L58 49 L108 102 L69 102 L28 59 L28 102 L0 102 Z';
const S_PATH = 'M246 0 L164 0 C138 0 124 12 124 31 C124 48 137 57 161 61 L202 67 C208 68 212 70 212 74 C212 78 208 80 201 80 L140 80 L122 102 L204 102 C232 102 246 91 246 71 C246 53 234 43 211 39 L170 33 C163 32 159 30 159 27 C159 23 163 22 170 22 L229 22 Z';
const F_PATH = 'M260 0 L368 0 L349 24 L290 24 L290 39 L337 39 L319 63 L290 63 L290 102 L260 102 Z';

/** The same K, scaled and positioned for a 64 x 64 icon. */
const K_ICON_PATH = 'M6.59 8 L19.766 8 L19.766 25.882 L37.649 8 L56.472 8 L33.884 31.059 L57.414 56 L39.061 56 L19.766 35.765 L19.766 56 L6.59 56 L6.59 8 Z';

/**
 * The wordmark alone. Inherits `currentColor` unless a colour is given, so it
 * can be dropped into a dark panel, a receipt or an e-mail without edits.
 */
export function KsfWordmark({
  height = 24,
  colour,
  className = '',
  title = BRAND.name
}: {
  height?: number;
  colour?: string;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      height={height}
      viewBox="0 0 368 102"
      className={className}
      role="img"
      aria-label={title}
      style={{ display: 'block' }}
    >
      <path d={`${K_PATH} ${S_PATH} ${F_PATH}`} fill={colour ?? 'currentColor'} fillRule="evenodd" />
    </svg>
  );
}

/** The icon: the tile, the K, and the capsule. Favicon, collapsed sidebar,
    loading screen, avatar. */
export function BrandMark({
  size = 40,
  tone = 'auto',
  className = '',
  title = BRAND.name
}: {
  size?: number;
  tone?: Tone;
  className?: string;
  title?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const tile = `tile-${uid}`;

  /* One colour, no gradient: a monochrome print, a stamp, a fax, or an
     e-mail client that strips backgrounds. */
  if (tone === 'mono') {
    return (
      <svg
        width={size} height={size} viewBox="0 0 64 64" className={className}
        role="img" aria-label={title} style={{ flex: `0 0 ${size}px` }}
      >
        <rect width="64" height="64" rx="14" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d={K_ICON_PATH} fill="currentColor" transform="translate(-2 0) scale(0.94) translate(4 2)" />
      </svg>
    );
  }

  return (
    <svg
      width={size} height={size} viewBox="0 0 64 64" className={className}
      role="img" aria-label={title} style={{ flex: `0 0 ${size}px` }}
    >
      <defs>
        <linearGradient id={tile} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#12996A" />
          <stop offset=".55" stopColor="#0E7A50" />
          <stop offset="1" stopColor="#172A24" />
        </linearGradient>
      </defs>

      <rect width="64" height="64" rx="14" fill={`url(#${tile})`} />
      {/* In dark mode the tile's deep corner meets a dark sidebar: a hairline
          edge (transparent in light mode) keeps its outline. */}
      <rect x=".5" y=".5" width="63" height="63" rx="13.5" fill="none" stroke="var(--brand-mark-edge, transparent)" />
      {/* A sheen across the top-left corner. Without it the tile reads flat at
          the sizes where a logo is actually judged. */}
      <path d="M14 0h30C29 6 14 19 8 38 3 34 0 28 0 22V14C0 6.3 6.3 0 14 0Z" fill="#FFFFFF" opacity=".10" />

      {/* The K, from the print artwork. */}
      <path d={K_ICON_PATH} fill="#FFFFFF" transform="translate(-4 2) scale(0.93)" />

      {/* The capsule, lying in the crook above the K's arm and on the same
          45° as the letter's diagonals. It is small and gold on purpose: the
          brief asked for restrained gold, not a second focal point. At 16px
          it reduces to a faint gold tick, which is the intent — the K has to
          carry the mark at that size, and it does. */}
      <g transform="rotate(-45 49 14)">
        <rect x="41.5" y="10.5" width="15" height="7" rx="3.5" fill="#E7B84A" />
        <rect x="48.4" y="10.5" width="1.4" height="7" fill="#172A24" opacity=".3" />
      </g>
    </svg>
  );
}

/**
 * Mark plus wordmark.
 *
 * `tone`
 *   auto    themed text — the ordinary case, correct in light and dark
 *   invert  white, for a dark panel or a photograph
 *   mono    one colour throughout, inheriting currentColor
 *
 * `stacked` puts the wordmark under the mark, for a square space.
 */
export function BrandLogo({
  size = 38,
  tone = 'auto',
  strapline = BRAND.strapline,
  showStrapline = true,
  stacked = false,
  className = ''
}: {
  size?: number;
  tone?: Tone;
  strapline?: string;
  showStrapline?: boolean;
  stacked?: boolean;
  className?: string;
}) {
  /* Tokens, not literals: "white on a dark panel" has a value in both themes,
     so the wordmark cannot be the one thing left bright when the rest of the
     screen goes dark. */
  const wordColour = tone === 'auto' ? 'var(--text)' : tone === 'mono' ? 'currentColor' : 'var(--on-dark)';
  const subColour = tone === 'auto' ? 'var(--text-dim)' : tone === 'mono' ? 'currentColor' : 'var(--on-dark-dim)';

  return (
    <span
      className={`brand-logo ${stacked ? 'is-stacked' : ''} ${className}`}
      style={{ gap: stacked ? size * 0.26 : size * 0.3 }}
    >
      <BrandMark size={size} tone={tone} />
      <span className="brand-words" style={stacked ? { textAlign: 'center' } : undefined}>
        <KsfWordmark height={size * 0.42} colour={wordColour} className="brand-name" />
        {showStrapline && (
          <span
            className="brand-strapline"
            style={{
              marginTop: size * 0.14,
              fontSize: Math.max(8, size * 0.19),
              color: subColour,
              opacity: tone === 'mono' ? 0.66 : 1
            }}
          >
            {strapline}
          </span>
        )}
      </span>
    </span>
  );
}
