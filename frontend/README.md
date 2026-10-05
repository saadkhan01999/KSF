# frontend — the website and the application

React 18 + TypeScript (strict) + Vite 6. Talks to the API in `../backend`
through `/api/v1` — proxied by Vite in development, served by the API itself
in production.

## Run

From the project root (recommended — starts the API as well):

```bash
npm run dev
```

Or this half alone, from this folder (expects the API on port 8790):

```bash
npm run dev        # http://localhost:5180
npm run build      # type-check, build to frontend/dist, then check the build
npm run typecheck
```

## Layout

| Path | Holds |
|---|---|
| `src/App.tsx` | Routes for the three faces: the public site, a pharmacy's workspace, the Super Admin's platform console |
| `src/pages/` | One component per screen. `platform/` is the Super Admin console (overview, pharmacies, support desk, people who need help, income, plans, activity); `settings/` holds Billing and Data migration; `onboarding/` is sign-up; `site/` the public pages |
| `src/components/` | `Layout` (shell, sidebar, top bar, support-mode banner), `ui` (buttons, fields, modal, floating menu, tables, charts), `support` (ticket list and thread), `topbar` (notifications, messages), `StaffPicker`, `StaffSupport`, `Calculator`, `auth-ui`, `account-ui` |
| `src/context/AppContext.tsx` | The signed-in person, permissions (`can()`), workspace, theme, support mode, toasts |
| `src/services/api.ts` | The only place that talks to the server: access token in memory, one-at-a-time refresh, `X-Pharmacy-Id` in support mode, password re-confirmation on `403 step_up_required`, server error wording passed through |
| `src/types/` | API shapes |
| `src/utils/` | `format.ts` (rupees, dates), `calculator.ts` (exact-decimal calculator) |
| `src/styles/` | `tokens.css` (every colour and size, light and dark), `themes.css` (the five themes), then base, layout, components and per-area sheets |
| `public/` | `theme.js` (applies the saved theme before first paint), `boot.js` (recovery card if the bundle fails to load), icons, manifest |
| `scripts/check-build.mjs` | Runs after every build; fails it if the bundle is a development build, too large, or missing files |

## Conventions

- Colours only as tokens from `tokens.css`; a theme changes tokens, never components.
- Seven breakpoints: xxs < 360, xs 360–479, sm 480–639, md 640–1023,
  lg 1024–1279, xl 1280–1535, xxl ≥ 1536. Below 1100 px the sidebar becomes
  a drawer; below 720 px the five daily actions move to a bottom bar.
- Buttons are drawn from permissions (`can('sales.refund')`), but the server
  is what enforces them.
- Product name and version come from `src/brand.ts` only.
