# KSF — logo and brand instructions

**KSF 2.0 · for a designer, an agency, or whoever draws the final mark**

The application already ships a working mark, drawn as inline SVG in
`frontend/src/components/Brand.tsx` and as static files in
`frontend/public/`. This document says what it is, why it is that way, and
exactly what a professional version has to satisfy to replace it.

Hand this whole file to a designer. It is written as a brief.

---

## 1. The name

| | |
|---|---|
| Product name | **KSF** |
| Full title | KSF Pharmacy Management System |
| Strapline (under the wordmark) | PHARMACY SYSTEM |
| Positioning line | Pharmacy management, built for Pakistan |
| Spelling | Always three capitals, never "Ksf" or "K.S.F." |

The name is set in one file — `frontend/src/brand.ts` — and every screen reads
it from there. If it ever changes again, that file and the e-mail wording in
`backend/src/services/mailer.ts` are the only edits.

---

## 2. What the mark is now

**The geometric K from the approved print artwork, in a rounded emerald
tile, with a small gold capsule lying in the crook above the K's arm.** The
letterforms are the outlined vector paths taken from the print artwork
(KSF-print-artwork.pdf), not a typeface, so the K and the KSF wordmark are
the same shape on a screen, a receipt and a printed sheet.

The reasoning, which any replacement should keep:

- **The K carries the name; the capsule says pharmacy.** At 16 pixels three
  letters are unreadable and a lone K could be anything; the gold capsule is
  what makes it a pharmacy's mark — small on purpose, a tick of gold rather
  than a second focal point.
- **Two shapes, one angle, no thin strokes.** The capsule sits on the same 45°
  as the K's diagonals, and both survive being shrunk to a 16px favicon.
- **It works in one colour.** A receipt printer has no gradients; the mono
  lock-up is the tile's outline and the K.

### Where it appears — one source

Every place the mark appears reads it from the same vector paths:

| Where | From |
|---|---|
| Sidebar, sign-in, website header and footer, loading screen, printed statements and invoices | `frontend/src/components/Brand.tsx` (`BrandMark`, `BrandLogo`, `KsfWordmark`) |
| Browser tab | `frontend/public/favicon.svg` (+ `favicon-32.png`) |
| Installed app (Android, desktop) | `frontend/public/icons/icon-192.svg`, `icon-512.svg`, `icon-192.png`, `icon-512.png` |
| iPhone and iPad home screen | `frontend/public/icons/apple-touch-icon.png` (180 × 180 — iOS ignores SVG here) |
| E-mails | `frontend/public/brand/ksf-email-logo.png`, on the brand green header |
| Documents and the designer's pack | `docs/brand/` |

**Light and dark.** The tile and the capsule are the same in both modes —
the brand does not change colour with the theme. The wordmark beside it uses
the text token (`--text`), so it is dark on light and light on dark, and in
dark mode the tile gets a hairline edge (`--brand-mark-edge`) so its deep
corner does not disappear into a dark sidebar. A pharmacy's colour theme
(Ocean Blue, Royal Purple…) changes the interface, never the mark.

**Replacing it with new approved artwork** is one edit: put the new outlines
in the four path constants at the top of `Brand.tsx`, update the static files
in the table above from the same outlines (any SVG-to-PNG tool, at the sizes
listed), and every screen, document and e-mail follows.

---

## 3. Colour

| Token | Hex | Use |
|---|---|---|
| Brand 400 | `#2ED6A0` | Gradient start (top-left of the tile) |
| Brand 600 | `#0E7A50` | **Primary brand colour.** Buttons, links, the gradient's middle |
| Brand 950 | `#052A1B` | Gradient end (bottom-right), deep shadow |
| Gold 500 | `#E7B84A` | The capsule. Money, ownership, the accent |
| White | `#FFFFFF` | The K; text on any brand fill |
| Ink 900 | `#101828` | Wordmark in light mode |
| Slate 050 | `#F8FAFC` | Wordmark in dark mode |

The full palette, including every surface, border and state, is in
`frontend/src/styles/tokens.css`. **Do not introduce a colour that is not in
that file** — add it there first, and it will follow the light and dark
themes automatically.

Contrast is held to WCAG AA (4.5:1 for text) and tested on every build. White
on Brand 600 passes; white on Brand 400 does not — never put text on the light
end of the gradient.

---

## 4. Construction

Drawn on a **64 × 64 grid**:

- Tile: `0,0` to `64,64`, corner radius **14**, emerald gradient
  `#12996A → #0E7A50 → #172A24` from top-left to bottom-right
- K: the print artwork's K, scaled to sit in the tile with optical margins
  (`K_ICON_PATH` in `Brand.tsx`), white
- Capsule: a `15 × 7` rounded rectangle, radius **3.5**, gold `#E7B84A`,
  rotated **−45°** about `49,14`, with a hairline seam at 30% of the deep green
- Sheen: a soft white shape across the top-left corner at 10% opacity — it
  stops the tile reading flat at large sizes

The maskable app icons (`icons/icon-192.svg`, `icon-512.svg` and their PNGs)
and the iPhone icon use a **full-bleed background with no corner radius**,
and the K and capsule scaled to 80% so they sit inside the safe circle,
because Android and iOS crop the corners to whatever shape they want.

---

## 5. Lock-ups

| Lock-up | When |
|---|---|
| **Mark + wordmark + strapline** | Sign-in, sign-up, the marketing site header, the footer |
| **Mark + wordmark** | The app sidebar |
| **Mark alone** | Collapsed sidebar, favicon, app icon, loading screen, social avatar |

Wordmark: 800 weight, `-0.02em` tracking, set at **0.62 × the mark's height**.
Strapline: 700 weight, `0.2em` tracking, uppercase, at **0.2 × the mark's
height**, never below 8px.

**Clear space:** half the mark's height on all four sides. Nothing — no text,
no rule, no edge — inside it.

**Minimum sizes:** mark alone **16px**; mark + wordmark **24px** tall; drop
the strapline below **28px**, where it stops being legible and becomes dirt.

---

## 6. Variants the final artwork must include

1. **Full colour** — gradient tile, on light and on dark backgrounds
2. **Mono positive** — one colour, for a receipt, a fax, a rubber stamp
3. **Mono reversed** — white, for a photograph or a dark panel
4. **Favicon** — legible at 16px with no strapline
5. **Maskable app icon** — full-bleed, safe circle respected

---

## 7. Never

- Never stretch, skew or rotate the lock-up
- Never re-colour the mark outside the palette above
- Never put the mark on a busy photograph without the dark panel behind it
- Never add a drop shadow, outline, bevel or glow
- Never re-type the wordmark in a different typeface
- Never use the mark as a bullet, a watermark, or a background pattern
- Never place it inside another shape (a circle, a badge, a ribbon)

---

## 8. Files to hand back

| File | Format | Notes |
|---|---|---|
| `logo-full.svg` | SVG | Master. Outlined text, no external fonts |
| `logo-mark.svg` | SVG | Tile only |
| `logo-mono.svg` | SVG | Single colour, `currentColor` |
| `logo-reversed.svg` | SVG | White |
| `favicon.svg` | SVG | 64 × 64 viewBox |
| `icon-192.png`, `icon-512.png` | PNG | Maskable, full-bleed |
| `logo@1x/2x/3x.png` | PNG | Transparent, for documents |
| `social-card.png` | PNG | 1200 × 630, for link previews |
| Source | AI / Figma / Sketch | Editable, with layers named |

Every SVG must have its **text converted to outlines**, no embedded raster
images, no external font references, and a `viewBox` — an SVG without one will
not scale in the application.

---

## 9. Brief for a designer, in one paragraph

> KSF is pharmacy management software for Pakistan — a till, stock control,
> batch and expiry tracking and prescriptions, used by shop owners and
> counter staff, in Urdu-speaking Karachi as often as in English. We need a
> mark that says *pharmacy* rather than *hospital*, that reads at 16 pixels
> in a browser tab and in one colour on a thermal receipt, and that sits
> beside a "KSF" wordmark without competing with it. Emerald green and a warm
> gold, both already fixed by the product's palette. It should look like a
> serious business tool that a pharmacist trusts with prescription records —
> calm, clinical, and not clever.

## 10. If you are generating it with an image tool instead

> A minimal flat vector logo mark: a rounded square tile, 14px corner radius
> on a 64px grid, filled with a smooth emerald gradient from #12996A to
> #172A24. Inside it, a bold geometric white capital K with straight-cut
> diagonals, and a small warm-gold (#E7B84A) pharmaceutical capsule lying on
> the same 45° diagonal in the space above the K's upper arm. Flat,
> geometric, no shadow, no outline, no 3D. Must read clearly at 16 pixels.

Then trace the result into real vector geometry before shipping it — an image
generator's output is a picture of a logo, not a logo.

---

## 11. Acceptance checklist

- [ ] Legible at 16px, checked at 16px — not scaled down on screen
- [ ] Readable printed in black only on thermal paper
- [ ] Readable in white on the emerald panel and on `#0B0F17`
- [ ] Corners survive a circular Android mask
- [ ] Text outlined; no font dependency
- [ ] Uses only the palette in §3
- [ ] Clear space respected in every lock-up
- [ ] Trademark search done on the wordmark before it goes on invoices
