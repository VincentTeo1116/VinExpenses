# Traceability: requirement → code → evidence

Status words: **Verified** (built, and a test that can fail checks it, against the local stand-in services), **Partly** (built with a stated gap), **Server** (the behaviour lives in the unchanged Supabase functions and database, covered by the existing backend tests), **Not built** (decided or deferred, listed in `docs/VERIFICATION.md`).
"Stand-in" means the local copy of Supabase and its functions in `scripts/fake-backend.mjs`. Nothing here has been run against the real Supabase, the real Telegram, real email or a real phone.

Tests: `src/**/*.test.ts(x)` (unit/component, Vitest) · `e2e/*.spec.ts` (browser, Playwright, with axe) · `tests/*.test.js` (Node: the original backend tests and the parity tests that compare the TypeScript ports with the original files).

## Sign-in and account (AU, AC)

| ID | Status | Code | Evidence |
|---|---|---|---|
| AU-01 … AU-05 register, code, limits, password rules, existing email | Verified | `features/auth/*`, `auth-gate` (server) | `auth.spec.ts`, `auth.test.ts`, `tests/web-parity.test.js` |
| AU-06 … AU-08 password sign-in, remember me, lockout, generic message | Verified | `SignInForm`, `AuthProvider`, `device.ts` | `auth.spec.ts` |
| AU-09 forgot password | Verified | `ForgotStep`, `ResetStep` | `auth.spec.ts` |
| AU-10 Google sign-in, first-time setup | Partly | `GoogleButton`, `SetupPage` | setup page tested; **the Google round trip itself was not run** |
| AU-11 … AU-13 authenticator, recovery codes, turning it off | Verified | `MfaSetupSheet`, `MfaStep`, Account | `auth.spec.ts`; the database refusing password-only sessions is **Server** |
| AU-14 Turnstile | Partly | `Turnstile` | fail-closed path tested; **a real key was not used** |
| AU-15 disabled / blocked messages | Verified | `BlockedStep` | `auth.spec.ts` |
| AU-16 old emailed links | Verified | `supabase.ts` | `security.spec.ts` |
| AU-17 session handling | Verified | `AuthProvider`, `ProtectedRoute` | `routing.test.tsx`, `fallback.spec.ts` |
| AC-01 profile | Verified | `AccountPage` | `auth.spec.ts` |
| AC-02 change password | Verified | `PasswordCard` | `auth.spec.ts` |
| AC-03 authenticator status, codes, disable | Verified | `SecurityCard` | `auth.spec.ts` |
| AC-04 Telegram link, unlink | Verified | `TelegramCard`, `useTelegram` | `account.spec.ts` (including a link that is not `t.me` being refused) |
| AC-05 monthly report: on/off, channel, email, confirm, last result, send again | Verified | `ReportCard` | `account.spec.ts` |
| AC-06 language, date format, categories, payment methods, reminder settings | Verified | `LanguageSelect`, `PreferencesCard`, `ReminderSettingsCard` | `plan.spec.ts`, `account.spec.ts`, `i18n.test.tsx` |
| AC-07 export, import, delete account | Verified | `DataCard`, `DeleteAccountCard` | `entry.spec.ts`, `account.spec.ts` |
| AC-08 admin entry only for the admin; contact form always | Verified | `useAdmin`, `AccountPage`, `AppShell` | `admin.spec.ts` |
| AC-09 Telegram nudge on Home | Verified | `TelegramPrompt` | `account.spec.ts` |

## Home, transactions, history (DB, TX, HI)

| ID | Status | Code | Evidence |
|---|---|---|---|
| DB-01 … DB-10 dashboard | Verified | `DashboardPage`, `summary.ts`, `charts.tsx` | `summary.test.ts`, `dashboard.spec.ts`, `money-visual.spec.ts` |
| TX-01 add/edit sheet, **N** key | Verified | `AddSheet` | `money.spec.ts` |
| TX-02 category suggestion with a reason | Verified | `smartEntry.ts`, `AddSheet` | `ports-parity.test.js`, `entry.spec.ts` |
| TX-03 duplicate warning | Verified | `calc.findDuplicate` | `calc.test.ts`, `money.spec.ts` |
| TX-04 edit, delete with Undo, duplicate | Partly | `data.ts`, `HistoryPage` | `money.spec.ts`; **swipe gestures not built** (buttons and the edit sheet instead) |
| TX-05 budget heads-up | Verified | `calc.crossedLimit` | `calc.test.ts`, `money.spec.ts` |
| TX-06 offline add and queue | Verified | `offlineQueue.ts` | `money.spec.ts` |
| HI-01 day groups, filters, search | Verified | `HistoryPage` | `money.spec.ts` |
| HI-02 export filtered CSV, print-ready report | Verified | `DataCard.downloadCsv`, `ReportPage` | `entry.spec.ts`, `report.spec.ts` |
| HI-03 more than 1,000 rows | Verified | `data.fetchAll` | `money.spec.ts` (1,205 rows, proven able to fail) |

## Recurring, budgets, plan (RC, BU, PL)

| ID | Status | Code | Evidence |
|---|---|---|---|
| RC-01, RC-02 schedules, back-fill, never twice | Verified | `RecurringPanel`, `calc.planDue`, `data.processRecurring` | `calc.test.ts`, `plan.spec.ts` (two devices at once) |
| RC-03 a loan makes its own recurring payments | **Not built** | | listed as a gap |
| RC-04 signed totals | Verified | `calc.recurringTotals` | `calc.test.ts`, `plan.spec.ts` |
| BU-01 budgets | Verified | `BudgetsPanel` | `plan.spec.ts` |
| BU-02 month-end forecast | Verified | `summary.forecastMonth` | `summary.test.ts`, `dashboard.spec.ts` |
| PL-01 deposit calculator | Verified | `finance.ts`, `DepositsPanel` | `finance-parity.test.js` (3,000 random inputs against the original), `finance.spec.ts` |
| PL-02 loan calculator | Verified | `finance.ts`, `LoansPanel` | same |
| PL-03 saved deposits and loans | Verified | `finance/data.ts` | `finance.spec.ts` (including two devices recording interest) |
| PL-04 reminders, pop-up, 24-hour snooze | Partly | `Reminders.tsx` | `finance.spec.ts`; **Telegram delivery of reminders is Server** |
| PL-05 offline | Partly | | calculators work offline; **saving a deposit or loan offline is not queued** |

## Receipts, categories, CSV (RX, CT, CS)

| ID | Status | Code | Evidence |
|---|---|---|---|
| RX-01 scan photo or PDF | Partly | `scan.ts`, `AddSheet` | `entry.spec.ts` (PDF on the device, photo through the stand-in reader); **the real reader and a phone camera were not used** |
| RX-02 total scoring | Verified | `receiptParser.ts` | `ports-parity.test.js` (every fixture, plus thousands of random lines) and the original `receipt-parser.test.js` |
| RX-03 AI helper | **Not built** | | optional (Should) |
| RX-04 nearby place | Partly | `NearbyPicker`, `nearby-place` (list answer), `_shared/nearby.ts` | `nearby.spec.ts`, `tests/nearby.test.js`; **the real OpenStreetMap/Overpass service and a phone GPS were not used** |
| CT-01 categorisation order and brand lists | Verified | `smartEntry.ts`, `knownMerchants.ts` | `ports-parity.test.js` (every brand in every list), `entry.spec.ts` |
| CS-01 CSV export and import | Verified | `csv.ts`, `plan.ts`, `DataCard` | `ports-parity.test.js`, `plan.test.ts`, `entry.spec.ts` |

## Reports, Telegram, admin (RP, TG, AD)

| ID | Status | Code | Evidence |
|---|---|---|---|
| RP-01 report content | Verified | `ReportPage`, `insights.ts` | `ports-parity.test.js`, `report.spec.ts` |
| RP-02 … RP-04 delivery, send again, schedule, unsubscribe | Server | unchanged functions | existing backend tests; the user-side "send again" is in `account.spec.ts`; the unsubscribe page in `emailaction.spec.ts` |
| TG-01 bot commands | Server | unchanged `telegram-bot` | existing `tests/telegram.test.js` |
| TG-02 Mini App | Partly | `src/miniapp/*` | `miniapp.spec.ts`, `ports-parity.test.js`; **not run inside real Telegram** |
| TG-03 weekly summary, reminders, blocked bot | Server | unchanged functions | existing backend tests; the blocked-bot warning shows in `TelegramCard` |
| AD-01 server decides | Verified | `admin` function (unchanged), `AdminPage` | `admin-money.test.js`, `admin.spec.ts` |
| AD-02 … AD-05 users, actions, messages, system | Verified | `AdminPage` | `admin.spec.ts` |
| AD-06 never reads money | Verified | | `admin-money.test.js`, `admin.spec.ts` |
| AD-07 actions as a bottom sheet | Verified | `AdminPage` | `admin.spec.ts`, `a11y` scans |

## Public pages and platform (PU, PF)

| ID | Status | Code | Evidence |
|---|---|---|---|
| PU-01 contact form | Verified | `ContactSheet`, `LazyContactSheet` | `auth.spec.ts` |
| PU-02 welcome, privacy, terms | Verified | `features/public/*` (React, with motion that respects reduced-motion) | `public.spec.ts`, `public-motion.spec.ts`, `security.test.ts` |
| PU-03 404 page | Verified | `public/404.*`, `vite.config.mts` (appPagesPlugin) | `notfound.spec.ts`, `security.test.ts` |
| PU-04 email action page | Verified | `email-action.html`, `src/email-action/main.ts` | `emailaction.spec.ts` |
| PU-05 hide built files from direct typing | **Not built** | | optional (Should); cosmetic |
| PF-01 PWA | Partly | `vite-plugin-pwa`, `pwa.ts` | `fallback.spec.ts`; **install and update prompts were not run on a real device** |
| PF-02 light/dark, reduced motion, MYR, date format | Verified | `tokens.css`, `format` | every a11y scan runs in both themes |
| PF-03 sheets, toasts, stacking | Verified | `Sheet`, `sheetStack`, `Toast` | `Sheet.test.tsx`, `a11y.spec.ts` |
| PF-04 error boundary, offline banner, empty states | Verified | `ErrorBoundary`, `OfflineBanner` | `components.test.tsx`, `fallback.spec.ts` |
| PF-05 logout clears local data | Partly | `AuthProvider.signOut`, `DeleteAccountCard` | waiting offline records are **kept on purpose** across sign-out; deleting the account clears them |

## Across everything

| Quality | Evidence |
|---|---|
| Responsive 320–1920 px, 44 px targets, no sideways scroll | `responsive.spec.ts`, `money-visual.spec.ts` (every screen) |
| Accessibility (WCAG 2.2 AA scan, light and dark; keyboard) | `a11y.spec.ts` and an axe scan in each feature's spec |
| Security headers, no inline code or styles, no secrets in the browser | `security.spec.ts`, `security.test.ts`, `miniapp.spec.ts` (framing rule) |
| Speed budget (first download ≤ 200 KB gzip) | `performance.spec.ts` |
