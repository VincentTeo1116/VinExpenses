# VinExpenses v5 (React): design note

Status: Phase 0 (foundation) built and verified. Later phases add screens on top of this foundation.
Requirements: `docs/REQUIREMENTS-react.md` (IDs such as AU-04, PF-03). Decisions D-1 … D-17 are fixed there.

## 1. Parts and responsibilities

| Part | Responsibility | Owns |
|---|---|---|
| **Web app** (`src/`, React + TypeScript, Vite) | Screens, validation messages, offline queue, language, theme | UI, PF-*, I18N-01 |
| **Static host** (Cloudflare Pages) | Serves files, security headers (`_headers`), real 404 (one page per app address + `404.html`) | SEC-01, PU-03 |
| **Supabase Auth + Postgres (RLS)** | Who a person is, who may read which row, the authenticator rule (`mfa_ok()`) | SEC-02, AU-12 |
| **Edge Functions** (`supabase/functions/`) | Everything that must not be decided in a browser: sign-in counting and lockout, codes, admin actions, report delivery, OCR | AU-*, AD-*, RP-* |
| **Legacy site** (`legacy/`) | The previous plain-JS app, kept as a deployable backup until the single switch (D-17) | rollback |

The browser asks and displays. It never decides a security question: every rule is enforced again on the server or in the database.

## 2. How data moves

1. The page loads from the static host with a strict policy (own scripts and styles only; one Supabase address allowed for connections).
2. `AuthProvider` asks Supabase for the stored session. No session: the person is sent to `/auth`.
3. Screens read and write their own rows through the Supabase client (RLS limits every query to the signed-in person).
4. Anything sensitive goes through `callFunction` (`src/lib/api.ts`) to an Edge Function: typed, with a timeout, limited retries for safe calls, and a human error.
5. Language, and later a few UI choices, are kept in the browser; money data is never written to browser storage by the app.

## 3. Data inventory (Phase 0)

| Item | Where | Why | Req |
|---|---|---|---|
| Supabase session (token) | Supabase's own `localStorage` key | Stay signed in | AU-06, AU-17 |
| Language code (`ve_lang`) | `localStorage` | Remember the choice | I18N-01 |
| Public Supabase URL + anon key, optional Turnstile site key | Build-time `VITE_*` values in the bundle | The app must reach its server; these are public by design | SEC-02 |
| Nothing else | | No analytics, no tracking, no error reporting that leaves the device | privacy |

## 4. Stack choice

Interactive app, client state, no SEO need, needs a small back end for secrets: **Vite + React + TypeScript** with the existing Supabase back end (design-table row 2 and 4). PWA through `vite-plugin-pwa`. Reasons for each library are in D-1 … D-8. Direct runtime dependencies: 9 (target ≤ 20).

## 5. Design brief

- **Audience:** everyday people in Malaysia tracking personal spending, mostly on a phone, often one-handed.
- **Main task:** add a transaction in two taps. The big **+** is the most prominent control on every screen.
- **Tone:** calm, plain words, no jargon, no blame in errors ("Nothing is wrong with your account or your data").
- **Hierarchy:** one h1 per screen; the answer first (later: *Spent this month*), details below.
- **Delight:** a floating + with a soft gradient, smooth sheet rise, subtle press feedback. All motion is transform-only and off under reduced-motion.
- **States every screen has:** loading (spinner or skeleton), empty (says what to do), error (says what happened and offers *Try again*), offline (banner), success (toast).

### Tokens (`src/styles/tokens.css`)
Colour (brand, neutrals, success/danger/warning in light and dark), spacing 4–32 px, radius 10–24 px, shadows, type scale, tap target 44 px, z-layers (`--z-tabbar` 40 < `--z-sheet` 1000 < `--z-toast` 3000). Components use tokens only, never raw colours.

### Layout
- **< 1024 px:** content, floating tab bar (Home, History, **+**, Plan, Account). Sheets rise from the bottom.
- **≥ 1024 px:** fixed-size sticky sidebar (never stretches, never scrolls away) + content. Sheets are centred cards.
- Verified at 320, 375, 768, 1024, 1440 and 1920 px.

### Dialog stacking (PF-03)
`sheetStack` is the single list of open dialogs. The last one is on top; earlier ones and the whole page behind become `inert` synchronously, so a newly opened dialog can never be hidden behind an older one, and focus returns to the opener when it closes.

## 6. Checks of this design (logic review)

- No circular dependencies: `features → components, lib, shared`; `app` wires providers; `lib` imports nothing from `features`.
- Each requirement has one owning part (table above). Security rules are owned by the server/database; the browser only mirrors them for explanation.
- Nothing is stored or sent that the requirements do not call for (data inventory).
- Every external dependency has a fallback (`docs/FALLBACKS.md`).
- No secret in the client or the repository: tests scan the source and the built files.

## 7. Folder layout

```
src/app/        providers, routing, error boundary, PWA registration
src/layouts/    AppShell (sidebar, tab bar)
src/pages/      screens (placeholders until their phase)
src/components/ Button, Sheet, Toast, EmptyState, OfflineBanner, Icon, LanguageSelect
src/lib/        env, supabase client, api, money, i18n (en, ms, zh)
src/styles/     tokens.css, base.css
public/         404.html/js/css, icons, fonts
scripts/        headers (CSP + security headers), serve-dist (Pages-like server for tests), build-e2e
e2e/            Playwright tests (responsive, a11y, security, 404, fallbacks)
legacy/         previous site (backup)
supabase/       database schema, Edge Functions (unchanged)
tests/          backend and legacy tests (node:test)
```
