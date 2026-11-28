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
| RC-03 a loan makes its own recurring payments | Verified | `LoansPanel` ("Add payments to my expenses"), `recurring_expenses.loan_id` | `finance.spec.ts` (RC-03). By choice the loan is **not** marked paid by it: the person confirms each payment |
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
| RX-05 foreign-currency receipt | Partly | `fx.ts`, `_shared/fx.ts`, `fx-rate`, `AddSheet` | `fx.spec.ts`, `tests/telegram-parts.test.js` (rate by day, fallback to today, refusals); **the real Frankfurter service was not used** |
| RX-06 backup reader on the device | Partly | `localOcr.ts`, `scan.ts`, `ocrAssetsPlugin` (own /ocr policy) | `fx.spec.ts` (a drawn receipt is read with the online reader down); **a real phone was not used** |
| RX-07 mark total, shop and date on the photo | Verified | `highlight.ts`, `ScanPopups` | `highlight.test.ts`, `fx.spec.ts` |
| MN-01 scan statistics | Partly | `scan-log.ts`, `receipt-ocr`, Admin system tab | `tests/telegram-parts.test.js`, `admin.spec.ts`; **the scan_events table must be created in Supabase (see supabase-schema.sql)** |
| TX-06 future-dated record warning | Verified | `AddSheet` | `polish.spec.ts` |
| ON-01 first-time guided tour | Verified | `Tour.tsx`, `tourStore.ts` | `tour.spec.ts` |
| AN-01 Google Analytics on the public pages, after consent | Verified in a browser with Google blocked | `analytics.ts`, `AnalyticsConsent`, `headers.mts` (public pages only), `PrivacyPage` | `analytics.test.tsx`, `security.test.ts`; **the real Google property and its reports were not checked** |
| AN-02 readable sitemap | Verified | `seo.mts`, `headers.mts` (no page policy on sitemap.xml) | `seo.test.js`, `public.spec.ts` |
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
| SE-01 public guide pages (FD and loan calculators) | Verified | `features/guides/*`, `scripts/guide-pages.mts` (text written into the built HTML), `seo.mts` | `guides.spec.ts`, `public.spec.ts`, `seo.test.js`, `security.test.ts` |
| GD-01 to GD-03 guides in English, Malay and Chinese (4 articles, FD, loan and bill calculators, language links, share pictures) | Verified | `features/guides/*`, `src/content/articles/*`, `scripts/guide-pages.mts`, `scripts/seo.mts`, `public/share/*` | `guides.test.ts`, `bill.test.ts`, `guide-languages.spec.ts`, `seo.test.js` |
| SP-01 to SP-12 receipt calculator: reading (positions and text), audit, exact share, photo straightening, the /app/split page in three languages | Verified on invented receipts; on 4 real photos none reconciles automatically, the page lets the person fix and shows when it does not add up | `features/split/*`, `receipts/photoPrep.ts` | `split.test.ts`, `draft.test.ts`, `photoPrep.test.ts`, `split.spec.ts` |
| SP-13 to SP-15 receipt photo beside the table with shop, date, items and total areas; prepared photo and on-device re-read; accuracy scoring against printed figures | Measured on 19 private receipts (never committed): the normal reader 31%, browser Tesseract passes 48%, PaddleOCR models in the lab 77% (not yet in the app) | `features/split/ReceiptPhoto.tsx`, `read.ts`, `accuracy.ts`, `receipts/photoPrep.ts`, `receipts/localOcr.ts` | `split.test.ts`, `accuracy.test.ts`, `photoPrep.test.ts`, `split.spec.ts`; local-only `accuracy.local.test.ts` |
| SP-16 ways in to the split page: hideable Home card with a drawn receipt, Add-sheet card, desktop sidebar item, BETA pill and honest beta note in three languages | Verified in the browser: opens the page, hide is remembered, phone tab bar unchanged, accessibility scan light and dark, no sideways scroll at 320 px | `features/split/SplitCard.tsx`, `components/BetaBadge.tsx`, `layouts/AppShell.tsx`, `features/dashboard/DashboardPage.tsx` | `split-entry.spec.ts` |
| SH-04 bottom bar: solid floating bar with a pill that glides (stretching across the gap) from the old tab to the new one; vertical on the tablet rail; hides when no tab is active; jumps when motion is reduced | Verified in the browser: pill under the active tab, stretches while moving, no security-policy violations, resize and tablet rail, accessibility scan light and dark | `layouts/useTabIndicator.ts`, `layouts/AppShell.tsx`, `layouts/AppShell.module.css` | `tabbar.spec.ts` |
| AN-01 "What's new" announcement: one live announcement written by the administrator (English required, Malay and Chinese optional with a whole-text English fallback), shown above every other layer on opening the app, once per browser session until "don't show me again" is ticked (saved to the account and the device), before the guided tour for new accounts | Verified in the browser and in tests | `features/announce/*`, `components/Sheet.tsx` (`top`), `features/tour/Tour.tsx`, `supabase-schema.sql` | `announce.test.ts`, `announce.spec.ts` |
| AN-02 Admin announcements tab: editor per language, live preview with language switch, warnings for languages that will show English, publish confirmation, switch-off, read count, every change logged; administrator only, checked on the server | Verified in the browser and in tests | `features/admin/AnnouncementPanel.tsx`, `supabase/functions/admin/handler.ts` | `admin-announce.test.js`, `announce.spec.ts` |
| CP-01 to CP-05 notification capture (rules engine, review inbox, Android bridge) | Partly: the web side is verified, the Android plugin is not built yet | `features/capture/*`, `rules.json` (no app is read until real samples are added) | `capture.test.ts`, `capture.spec.ts` |
| PU-03 404 page | Verified | `public/404.*`, `vite.config.mts` (appPagesPlugin) | `notfound.spec.ts`, `security.test.ts` |
| PU-04 email action page | Verified | `email-action.html`, `src/email-action/main.ts` | `emailaction.spec.ts` |
| PU-05 hide built files from direct typing | **Not built** | | optional (Should); cosmetic |
| PU-06 install page: steps for Android, iPhone and computer; one-tap button only when the browser offers it; shows "installed" inside the app; honest offline note | Verified in the browser (axe light and dark, three device tabs, simulated install offer); **the real install dialog was not run on a phone** | `features/public/InstallPage.tsx`, `app/install.ts` | `install.spec.ts` |
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
