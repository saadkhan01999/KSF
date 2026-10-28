# KSF — logo and brand

**KSF 2.5 · the approved artwork, and where it appears**

The logo is the pharmacy's own approved artwork: the interlocking **K, S and
F** in deep green, with **KSF Pharmacy** set beneath it and the line
**• Dispensing care. Inspiring trust. •**. It is drawn as inline SVG in
`frontend/src/components/Brand.tsx` and as static files in
`frontend/public/` and `docs/brand/`, all from the same traced outlines.

---

## 1. The name

| | |
|---|---|
| Product name | **KSF** |
| On the logo | **KSF Pharmacy** |
| Full title | KSF Pharmacy Management System |
| Strapline | Dispensing care. Inspiring trust. |
| Positioning line | Pharmacy management, built for Pakistan |
| Spelling | Always three capitals, never "Ksf" or "K.S.F." |

The name and strapline are set in one file — `frontend/src/brand.ts` — and
every screen reads them from there.

---

## 2. The artwork

The mark, the wordmark and the strapline were **traced from the approved
artwork into vector outlines**, so they are sharp at any size and have **no
background**: the page shows through the counters of the S, exactly as on the
printed logo. Nothing depends on a font being installed.

| Constant in `Brand.tsx` | What it is |
|---|---|
| `MARK` | The interlocking K, S and F, 959 × 632 |
| `WORD` | "KSF Pharmacy", 789 × 98 |

The strapline in the application is set as text (bold capitals, slightly
spaced) so it stays crisp at 8px; in the static files it is the traced
artwork too.

### Where it appears — one source

| Where | From |
|---|---|
| Sidebar, website header and footer, sign-in, forgotten password, loading screen, printed statements and invoices, the website's product preview | `frontend/src/components/Brand.tsx` (`KsfMark`, `BrandMark`, `KsfWordmark`, `BrandLogo`) |
| Browser tab | `frontend/public/favicon.svg` (deep green; pale green when the browser is dark) and `favicon-32.png` |
| Installed app (Android, desktop) | `frontend/public/icons/icon-192.svg`, `icon-512.svg`, `icon-192.png`, `icon-512.png` |
| iPhone and iPad home screen | `frontend/public/icons/apple-touch-icon.png` (180 × 180) |
| E-mails | `frontend/public/brand/ksf-email-logo.png`, on a white header with a green rule |
| Documents, link previews and the designer's pack | `docs/brand/` |

**Light and dark.** In light mode the logo is the artwork's deep green. That
green would disappear on a dark screen, so in dark mode the same shapes are
drawn in a pale green (`--logo-ink` in `tokens.css`); on the dark sign-in
panel they are white. A pharmacy's colour theme (Ocean Blue, Royal Purple…)
changes the interface, never the logo.

**Home-screen icons** have a white ground: a phone puts a transparent icon on
black, where the deep green would vanish. The mark sits inside the safe
circle so Android's mask never crops it.

---

## 3. Colour

| Token | Hex | Use |
|---|---|---|
| Logo green | `#14442E` | The logo, in light mode; the e-mail header's rule; the browser's theme colour |
| Logo green, dark mode | `#8EDCB8` | The logo on dark screens |
| Brand 600 | `#0E7A50` | **The interface's brand colour.** Buttons, links |
| Scrollbar | `#22A06B` (dark mode `#2FB57C`) | The scrollbar thumb, green in every theme |
| White | `#FFFFFF` | The logo on a dark panel or a photograph |

The full palette is in `frontend/src/styles/tokens.css`. **Do not introduce a
colour that is not in that file** — add it there first.

---

## 4. Lock-ups

| Lock-up | Where |
|---|---|
| **Mark, KSF Pharmacy and the strapline, stacked** (as the artwork) | Forgotten password, the social card, `docs/brand/ksf-logo-stacked.svg` |
| **Mark + KSF Pharmacy + strapline**, side by side | Sign-in panel, website footer |
| **Mark + KSF Pharmacy** | The app sidebar, the website header, printed documents, e-mails |
| **Mark alone** | Collapsed sidebar, favicon, app icons, loading screen |

`BrandLogo`'s `size` sets the lock-up: side by side the mark is 0.9 × it and
the wordmark 0.4 × it (stacked, the mark is the full size); the strapline is
shown only where it can be read (never below 8px), and in the stacked lock-up
it carries the artwork's bullets.

**Clear space:** half the mark's height on all four sides.
**Minimum sizes:** mark alone **16px** wide; mark + wordmark **24px** tall.

---

## 5. Never

- Never stretch, skew or rotate the logo
- Never re-colour it outside the colours above
- Never add a drop shadow, outline, bevel or glow
- Never re-type "KSF Pharmacy" in another typeface — use the outlines
- Never put it inside another shape (a circle, a badge, a ribbon)

---

## 6. The files in `docs/brand/`

| File | What |
|---|---|
| `ksf-logo-stacked.svg`, `@2x.png` | The full artwork: mark, KSF Pharmacy, strapline |
| `ksf-logo-horizontal.svg`, `@1x/@2x/@3x.png` | Mark + KSF Pharmacy, transparent |
| `ksf-logo-mono.svg`, `@2x.png` | Black, for a receipt, a fax, a stamp |
| `ksf-logo-reversed.svg`, `@2x.png` | White, for a photograph or a dark panel |
| `ksf-wordmark.svg`, `@2x.png` | KSF Pharmacy alone |
| `ksf-icon.svg`, `ksf-icon-64/256/1024.png` | The mark alone, transparent |
| `favicon-16.png`, `favicon-48.png`, `icon-512.png` | Browser and app icons |
| `social-card.png` | 1200 × 630, for link previews |

---

## 7. Replacing the artwork

1. Trace the new artwork into SVG paths (any vectoriser; check the result
   against the original at large size — a picture of a logo is not a logo).
2. Put the paths in `MARK` and `WORD` at the top of `Brand.tsx`.
3. Regenerate the static files in the table in §2 and §6 from the same paths,
   at the sizes listed.

Every screen, document and e-mail follows.
