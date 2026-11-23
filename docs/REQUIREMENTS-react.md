# VinExpenses v5 (React) — Software Requirements Specification

Status: APPROVED DECISIONS (v1.1) · Date: 23 Nov 2026 · Owner: Vincent Teo
Priority key: **M** = must (launch), **S** = should (soon after), **C** = could (later). Every requirement has an ID and a one-line acceptance test (AT).

---

## 1. Purpose and scope

**Purpose.** Rebuild the VinExpenses front end in **React + TypeScript** with no loss of function, a stronger security posture, a modular codebase, and the same Supabase back end. The product stays a free, mobile-first personal expense tracker for Malaysia (MYR), installable as a PWA, later wrapped for Android and iPhone.

**In scope.** Web app (React), public pages, PWA, Cloudflare Pages hosting, changes to the Supabase Edge Functions only where needed, automated tests, migration plan.

**Out of scope (v5).** Native-only features, multi-currency conversion, bank-feed integrations, shared/family accounts, paid plans, changing the database vendor.

**Product principles.** (1) A person can only ever see their own money data, including the admin. (2) Every screen works on a 320 px phone. (3) Every failure has a visible, human explanation and a next step. (4) Nothing secret ever reaches the browser.

## 2. Roles

| Role | Description |
|---|---|
| Visitor | Not signed in. Sees the welcome page, privacy, terms, 404, sign-in/up, contact form. |
| User | Signed in with email+password (optionally authenticator). Owns all their data. |
| Google user | Signed in through Google; must also set a strong password; authenticator optional. |
| Admin | A User whose email matches `ADMIN_EMAIL` (first claim only). Manages accounts, never reads money data. |
| Telegram user | A User with a linked Telegram chat; adds expenses and gets reports by chat. |
| System | Scheduled jobs: monthly report, plan reminders, weekly digest. |

## 3. Technical decisions (fixed for this chat unless you change them)

| ID | Decision | Reason |
|---|---|---|
| D-1 | **React 18+ with TypeScript (strict), built with Vite** | Mainstream, large ecosystem, easy reuse for React Native / Capacitor |
| D-2 | **React Router** (client routes, lazy-loaded per screen) | Real URLs, back-button behaviour, code splitting |
| D-3 | **TanStack Query** for server state (cache, retry, offline queue hooks) | Replaces hand-written fetch/refresh logic |
| D-4 | **React Hook Form + Zod** for forms and validation (one schema shared with server rules where possible) | Live per-field errors, consistent rules |
| D-5 | **CSS Modules + the existing design tokens** (CSS variables); no runtime CSS-in-JS; no inline styles | Most control over every pixel and layout, and keeps a strict CSP (`style-src 'self'`); chosen over Tailwind |
| D-6 | **Chart.js** wrapped in small React components (donut, bars, line) | Already proven in the app; self-hosted |
| D-7 | **vite-plugin-pwa** (Workbox) for manifest and service worker | Versioned caches, offline shell, update prompt |
| D-8 | **Vitest + React Testing Library + Playwright** (e2e, 320/390/820/1280 px) + keep the existing `node:test` suites for pure logic and Edge Functions | Parity safety net |
| D-9 | **Cloudflare Pages** hosting with a `_headers` file (real CSP, frame blocking, HSTS, Permissions-Policy) and a `404.html` | Faster, real HTTP headers |
| D-10 | **Backend unchanged**: Supabase Auth, Postgres + RLS, Edge Functions (auth-gate, admin, feedback, report-resend, monthly-report-email, receipt-ocr, receipt-ai, telegram-*, plan-reminders, delete-account, …) | The security model already lives there |
| D-11 | Pure logic (`finance-calc`, `receipt-parser`, `smart-entry`, `csv-import`, password rules) is ported to **TypeScript packages shared by the app and the Edge Functions** | One source of truth, no copies |
| D-12 | **Capacitor** later for Android/iOS store apps | No second rewrite |
| D-14 | **One codebase for the web app and the Telegram Mini App**: a second Vite entry (`/miniapp`) in the same repo, reusing `components/`, `lib/`, `shared/` and the design tokens; it keeps its own tighter CSP, its own small bundle, and signs in with Telegram `initData` through `miniapp-api` instead of a Supabase session | Same code and look, no duplicate logic, no weaker security |
| D-15 | **Free tiers only for now**: Cloudflare Pages (`*.pages.dev`), Supabase Free, Gmail SMTP, free Turnstile | Cost; limits documented in section 10 |
| D-16 | **Single admin** (the `ADMIN_EMAIL` account); no second admin role | Simplicity and safety |
| D-17 | **One switch at the end**: the old GitHub Pages site stays live until the React app has full parity, then the address is switched once | You need the whole app, not parts |
| D-13 | Package hygiene: lockfile, `npm ci`, `npm audit` in CI, pinned GitHub Actions, dependency allow-list review, no postinstall scripts | Supply-chain risk is the main cost of React |

## 4. Functional requirements

### 4.1 Authentication (AU)

| ID | P | Requirement | AT |
|---|---|---|---|
| AU-01 | M | Register with name, email, password and confirmation; the account works only after a **6-digit emailed code** | Wrong/expired code never signs in |
| AU-02 | M | Code is single-use, valid **5 minutes**, a new code replaces the old | Code from 6 min ago is refused |
| AU-03 | M | **3 codes per email per day** (Malaysia time) and **10 per month**; beyond that: "contact the admin" with a link to the contact form | 4th request in a day is refused with the right message |
| AU-04 | M | Password: ≥10 chars, upper, lower, number, symbol, ≤72; **live rule checklist** under the field; per-field errors; show/hide toggle | Each unmet rule is shown individually |
| AU-05 | M | Already-registered email: no new code is spent; user is sent to Sign in with the email kept | Existing email → sign-in tab + notice |
| AU-06 | M | Sign-in is password only (no code) with **Remember me (30 days)** on by default; when off, signed out when the browser closes | Flag expiry honoured |
| AU-07 | M | **5 wrong passwords** pause that device+email for **3 hours**; email-wide cap of 20 across devices; counts reset on success; the pause start time is stored and cleared on timeout or admin unblock | 5th failure shows the paused screen with a live countdown |
| AU-08 | M | Same generic message for wrong email or wrong password (no account enumeration) | Responses identical |
| AU-09 | M | **Forgot password**: code to email → new password (strong, not the old one) → all sessions signed out; admin blocks survive a reset | Old password rejected |
| AU-10 | M | **Google sign-in**; first-time Google users set display name and a strong password before using the app | App is unreachable until set |
| AU-11 | M | Optional **authenticator (TOTP)**: setup with QR + typed secret (account name "VinExpenses"), 6-digit confirm, **8 one-time recovery codes** shown once with copy/save | Recovery code works once |
| AU-12 | M | With the authenticator on: sign-in asks for the 6-digit code; the **database refuses password-only sessions** (restrictive RLS `mfa_ok()`); a recovery code + password turns it off | A password-only token reads no rows |
| AU-13 | M | Turning the authenticator off needs the password | Wrong password refused |
| AU-14 | M | Optional **Cloudflare Turnstile** on sign-in, sign-up, resend, forgot, contact; fails closed with a retry link | Missing token → clear message |
| AU-15 | M | Disabled-by-admin and admin-blocked accounts get specific messages with a contact link | — |
| AU-16 | S | Old emailed links (`#access_token…`) show an "out of date" notice and are removed from the address bar | — |
| AU-17 | M | Session handling: refresh tokens, sign-out everywhere on reset, safe behaviour on token failure (no loops) | — |

### 4.2 Account and security centre (AC)

| ID | P | Requirement |
|---|---|---|
| AC-01 | M | Profile: display name, email (read-only), sign-in method |
| AC-02 | M | Change password (current + new, live rules) |
| AC-03 | M | Authenticator: status, enable, view/regenerate recovery codes, disable |
| AC-04 | M | Telegram: status, link (one-time code), unlink |
| AC-05 | M | Monthly report: on/off, **channel** (auto / Telegram / email), recipient email, last delivery status, **Send again** (max 2 per report, 4 per day) with the "on its way, be patient, contact the admin" note |
| AC-06 | M | Preferences: **language (English / Melayu / 中文, saved with the account and used for the app, the emails and the monthly report)**, date format, categories, payment methods (rename, add, deactivate), reminders settings |
| AC-07 | M | Data: export CSV, import CSV, **delete account** (typed confirmation, server-side erase) |
| AC-08 | M | Admin entry shown only to the Admin; Contact-the-admin form always available |
| AC-09 | S | Telegram prompt on the dashboard for unlinked users: connect now / "don't ask again" (stored with the account) |

### 4.3 Dashboard (DB)

| ID | P | Requirement |
|---|---|---|
| DB-01 | M | Month switcher (prev/next/picker/this month) |
| DB-02 | M | **Main card = Spent this month**: amount, change vs the *same days* of last month, budget progress bar, "safe to spend today" when a budget exists |
| DB-03 | M | **Three small tiles**: Income, Balance (red if negative), Budget left / Over budget (amber ≥80%, red over; "Not set — tap" when none) |
| DB-04 | M | Insights: daily average (fixed bills separated), top category, largest expense |
| DB-05 | M | Category donut + ranked list (tap → History filtered); 6-month trend (tap a bar → that month) |
| DB-06 | M | **Coming up** (one list): deposits/loans due, then recurring bills/income |
| DB-07 | M | Recent activity; Spending patterns (7 days vs previous 7; possible repeats, never auto-added) |
| DB-08 | S | Quick-add chips for frequent merchants |
| DB-09 | M | Empty, loading (skeleton) and error states for every card; numbers always agree with History |
| DB-10 | M | Layout: desktop 7/5 split with sidebar; phone stacks, tiles 2+1, amounts never truncated at 320 px |

### 4.4 Transactions (TX) and History (HI)

| ID | P | Requirement |
|---|---|---|
| TX-01 | M | One add sheet: Expense/Income switch, amount-first field, category/payment/source chips, back-datable date, merchant, note; keyboard shortcut **N** |
| TX-02 | M | Auto-category suggestion with a plain-English reason; the user's explicit choice is never overridden |
| TX-03 | M | Duplicate warning (same amount + merchant + ±1 day) asks first |
| TX-04 | M | Edit and delete (delete inside editor, **Undo** toast); swipe left = delete, right = duplicate (touch) |
| TX-05 | M | Budget heads-up toast at 80% and 100% |
| TX-06 | M | Offline add: kept on device, shown "Not synced", sent automatically when online; failed sync is visible and retryable |
| HI-01 | M | Grouped by day with day totals; filter by type, category, month; search merchant/note |
| HI-02 | M | Export filtered list to CSV; open print-ready monthly report (in-app view with Back/Esc, Print/PDF) |
| HI-03 | M | Paging/virtual list for >1,000 rows |

### 4.5 Recurring (RC)

| ID | P | Requirement |
|---|---|---|
| RC-01 | M | Recurring expenses and incomes: name, amount, category/source, frequency, next due, active/pause, edit, delete |
| RC-02 | M | Due items post when the app opens on/after the due date, **missed dates back-filled**, never duplicated (idempotent, safe across tabs) |
| RC-03 | M | A loan can generate its own recurring payments and stops after the last one |
| RC-04 | M | **Signed totals**: recurring income counts as **plus** and recurring expenses as **minus**; the summary shows money in per month, money out per month, the **net** per month and per year (red when negative). Never a plain sum of both (done in the current app, to be kept) |

### 4.6 Budgets (BU)

| ID | P | Requirement |
|---|---|---|
| BU-01 | M | Overall monthly budget and per-category limits; progress amber at 80%, red when over |
| BU-02 | M | Month-end forecast from current pace with a gentle heads-up |

### 4.7 Plan: deposits and loans (PL)

| ID | P | Requirement |
|---|---|---|
| PL-01 | M | **FD calculator**: amount, rate, tenure (days/months/years), start date, payout (maturity/monthly/quarterly/yearly), optional tax; result, interest, yearly return, growth chart, daily/monthly/yearly breakdown (simple interest, /365) |
| PL-02 | M | **Loan calculator**: reducing balance or flat rate; monthly payment, total interest, cost per day/month/year, real yearly rate for flat, full schedule, "this loan" vs "all loans" |
| PL-03 | M | Save and track deposits (progress, earned so far; on maturity record interest as income / renew / close) and loans (paid, left, next due) |
| PL-04 | M | Reminders: Telegram (7d, 1d, day-of for FD; 3d and day-of for loans; per-item days) and in-app list; one pop-up with "don't show for 24 h" kept per account |
| PL-05 | M | Calculators work offline and when the database is not updated; saves made offline are queued; results labelled as estimates |

### 4.8 Receipts, categories, CSV (RX, CT, CS)

| ID | P | Requirement |
|---|---|---|
| RX-01 | M | Scan photo or PDF; text PDFs read **on the device**; photos/scans via the OCR function (signed-in, daily limit); images not stored |
| RX-02 | M | Parser scores totals by label (Total, Jumlah, 总计…), ignores subtotal/tax/discount/foreign currency, cross-checks arithmetic; if unsure, pre-fills nothing wrong and offers tap-to-choose chips |
| RX-03 | S | Optional AI helper for unclear receipts (off until keyed); output validated |
| RX-04 | S | Optional nearby-place lookup |
| CT-01 | M | Categorisation order: user's own history → built-in merchant lists (Malaysia, Singapore, Indonesia, Thailand, Brunei, international online brands, bank-statement forms like `GRAB*FOOD`) → receipt clues → custom category names; one test per brand; plain receipt words never match |
| CS-01 | M | Export everything to CSV; import this app's CSV or a bank statement (Date + Amount or Debit/Credit), skip existing rows, match/guess categories, confirm a summary first |

### 4.9 Reports and delivery (RP)

| ID | P | Requirement |
|---|---|---|
| RP-01 | M | Monthly report: totals, plain-English line, category shares, comparison with last month, top merchants |
| RP-02 | M | Delivery: Telegram by default if linked, else email; **fallback** to the other channel on failure; result stored (`last_status/channel/month`) |
| RP-03 | M | User **Send again** (2 per report); the admin can resend a chosen month **without seeing it** |
| RP-04 | M | Sent only on the 1st (Kuala Lumpur), once per month, to confirmed addresses; unsubscribe link works with one click |

### 4.10 Telegram (TG)

| ID | P | Requirement |
|---|---|---|
| TG-01 | M | Link by one-time code; add expenses by typing ("lunch 12.50"); /undo, /today, /month, /week, /top; category buttons; photos get a clear answer |
| TG-02 | M | Mini App dashboard inside Telegram (signed `initData`, own data only), built **in the same React codebase** as the web app (D-14), with the same screens, tiles and design |
| TG-03 | M | Weekly summary and plan reminders; blocked-bot handling; EN/MS/ZH messages |

### 4.11 Admin (AD)

| ID | P | Requirement |
|---|---|---|
| AD-01 | M | Admin is verified **on the server for every action**; the UI hides, the server decides |
| AD-02 | M | User list: search, status filter, paging; name, email, sign-in method, joined, **last expense date**, Telegram linked, authenticator on/off, code usage, status |
| AD-03 | M | Actions: send reset code (never shown to admin), block/unblock, disable/enable, clear code limit, reset authenticator, resend report (month picker). Self and other admins protected. Confirm dialog for each |
| AD-04 | M | Feedback inbox: open/resolved, mark resolved/reopen; messages escaped |
| AD-05 | M | System tab: health checks (email, bot, cron secret, allowed website, database up to date) and **append-only audit log** |
| AD-06 | M | **Admin can never read expenses, incomes or report contents**; a test fails if any admin path selects money tables |
| AD-07 | M | Actions on phones open as a **bottom sheet** (no dropdowns) |

### 4.12 Contact and public pages (PU)

| ID | P | Requirement |
|---|---|---|
| PU-01 | M | Contact form (email, topic, message ≤2000, Turnstile); works signed out; admin notified by email |
| PU-02 | M | Welcome/landing, Privacy Policy, Terms of Use: static, no app code, accurate list of outside services |
| PU-03 | M | **404 page** for any unknown address: Go back (same-site previous page) or welcome page; 8 s auto-return with "Stay here" |
| PU-04 | M | Email-action page (confirm/unsubscribe) acts only after a button press |
| PU-05 | S | On Cloudflare: typing `/config.js`, `/assets/*.js` etc. directly shows the 404 (cosmetic hardening using `Sec-Fetch-Dest`) |

### 4.13 Platform behaviours (PF)

| ID | P | Requirement |
|---|---|---|
| PF-01 | M | PWA: installable, offline shell, update prompt, versioned cache, never caches API responses with user data beyond the last-month snapshot |
| PF-02 | M | Light/dark by OS setting; reduced-motion respected; MYR display; date format choice |
| PF-03 | M | Toasts for quick confirmations; accessible modal/sheet system with focus trap, Esc, return focus; **stacking order**: sheet < secondary sheet < confirm dialog < toast |
| PF-04 | M | Global error boundary + per-screen error states with "Try again"; network offline banner |
| PF-05 | M | Logout clears local user data (FD/loans cache, drafts) |

## 5. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| SEC-01 | Strict CSP via `_headers`: `default-src 'none'`; scripts/styles `'self'` only; no inline script/style, no `eval`; `frame-ancestors 'none'`; HSTS; `Permissions-Policy`; `Referrer-Policy` | Verified by test on built output |
| SEC-02 | RLS on every table; restrictive MFA policy; service-role key and all private keys only in server secrets | Tests: no secret strings in `dist/` |
| SEC-03 | All server inputs validated again on the server; generic errors; rate limits fail closed | Existing function tests kept |
| SEC-04 | No `dangerouslySetInnerHTML`, no `eval`, no HTML from user/server text | ESLint rule + test |
| SEC-05 | Dependency control: lockfile, `npm audit` gate, license check, Dependabot, pinned Actions, ≤ N direct runtime deps (target ≤ 20) | CI gate |
| SEC-06 | Tokens never in `localStorage` beyond Supabase's session store; no PII in logs/URLs | Review + test |
| PERF-01 | Initial JS ≤ 200 KB gzip (route-split), LCP ≤ 2.5 s on 4G mid phone, CLS < 0.1, INP < 200 ms | Lighthouse CI |
| A11Y-01 | WCAG 2.2 AA: labels, focus order, contrast, 44 px targets, announcements for toasts/errors | axe in Playwright |
| RESP-01 | Works 320–1920 px, no horizontal scroll, safe-area aware, no hidden pop-ups | e2e at 320/360/390/820/1280 |
| REL-01 | Every network call has a timeout, retry policy and a human error; offline queue survives reload | Tests |
| I18N-01 | **English, Bahasa Melayu and 中文** at launch, English by default. Every string is in a catalogue (no hard-coded text); amounts stay MYR; dates follow the chosen format; a missing key falls back to English | Test: every language has every key and the same placeholders |
| OBS-01 | Client errors reported to a privacy-safe sink (no PII) or console in dev; admin health tab | S |
| MNT-01 | TypeScript strict, ESLint, Prettier, feature folders, ≤ 300 lines per component, ≥ 80% coverage on logic | CI |

## 6. Architecture

```
src/
  app/            router, providers (Query, Auth, Theme, Toast), error boundary
  features/
    auth/ account/ dashboard/ transactions/ history/ recurring/
    budgets/ plan/ receipts/ reports/ telegram/ admin/ contact/
  components/     Button, Sheet, Modal, Toast, Field, Chart*, Skeleton, EmptyState
  lib/            supabase client, api (typed Edge Function calls), money, dates, offline queue
  shared/         pure TS: finance-calc, receipt-parser, smart-entry, csv-import, password-rules
  styles/         tokens.css, base.css, modules
public/           icons, 404.html, welcome/privacy/terms (static)
```
Rules: features never import each other (only `components`, `lib`, `shared`); all server access goes through `lib/api` (typed, validated with Zod); no business logic in components; one place for money formatting.

**Fallbacks (global):** offline queue for writes; cached last snapshot for reads; calculators with no server; database-not-updated banner; Telegram→email report fallback; chart failure → table; OCR failure → manual entry.

## 7. Data and API (unchanged)

Tables: expenses, incomes, recurring_expenses/incomes, budgets, user_categories, user_payment_methods, user_preferences, monthly_report_preferences, fixed_deposits, loans, reminder_log, telegram_*, app_admins, usage_counters, receipt_scan_usage, auth_code_requests, auth_lockouts, mfa_recovery_codes, admin_audit_log, feedback. Functions as in D-10. The React app consumes them through a typed client; schema changes only via `supabase-schema.sql` (re-runnable).

## 8. Migration plan (strangler, no big bang)

| Phase | Deliverable | Exit test |
|---|---|---|
| 0 Foundation | Vite+TS+React app, CI, tokens, Sheet/Modal/Toast, Cloudflare Pages preview, `_headers` CSP | CSP test, axe, 320 px e2e shell |
| 1 Auth | AU-01…17, AC security (MFA, recovery), contact form, 404/public pages | Port of `auth-gate` e2e |
| 2 Core money | Add/edit/delete, History, Recurring, Budgets, Offline queue | Parity e2e vs old app on a fixture account |
| 3 Dashboard | DB-01…10 | Numbers equal History in tests |
| 4 Plan | FD/loans/reminders | Existing finance-calc tests pass unchanged |
| 5 Receipts/CSV/Categories | RX, CT, CS | Existing parser fixtures pass |
| 6 Reports/Telegram/Admin/Mini App | RP, TG prompt, AD, Mini App entry, EN/MS/ZH complete | Admin privacy test, resend flow, language key test |
| 7 Hardening and the single switch | Lighthouse, audit, a11y, pen-test checklist, full parity check against the old app; **one switch** of the live address; keep the old site 30 days | Go-live checklist signed |
| 8 Mobile | Capacitor Android/iOS | Store review checklist |

The phases are internal milestones, not releases: nothing goes live until every phase passes (D-17). Rollback: the old GitHub Pages site stays deployable until Phase 7 closes. No database change in phases 0–6 except additive ones.

## 9. Quality gates and Definition of Done

A feature is done when: acceptance tests pass; unit + component tests written; e2e at four widths; axe has no serious issues; no new dependency without review; strings in the catalogue; error, empty and offline states exist; works in light and dark; docs updated.

Existing suites that must keep passing during the move: all `node:test` suites for pure logic and Edge Functions (530 today).

## 10. Risks

| Risk | Mitigation |
|---|---|
| Rewrite regressions | Strangler phases, parity e2e, keep old site live |
| npm supply-chain | D-13, ≤20 direct deps, audit gate, Dependabot, review diffs of lockfile |
| Bundle growth | Route splitting, bundle budget in CI |
| CSP vs React tooling | No inline styles/scripts, CSS Modules, hashed assets; tested on built output |
| Supabase Free pauses after about 7 days idle (D-15) | Document "Restore project"; optional scheduled keep-alive ping (not guaranteed); reconsider Pro when real users arrive |
| Lockout gap on Free plan (direct token endpoint) | Turnstile + Supabase rate limits; documented |
| Time (one switch at the end means no early release) | Each phase is demoable on a preview address and has its own exit test, so progress stays visible |

## 11. Decisions confirmed (23 Nov 2026)

1. TypeScript strict from day one. 2. CSS Modules + design tokens (most control). 3. One switch at the end, full app. 4. `*.pages.dev` for now. 5. English, Malay, Chinese; English by default; changeable in Account → Preferences. 6. Single admin. 7. Mini App in the same codebase (D-14). 8. Stay on Supabase Free (D-15).

### Still open (do not block Phase 0)
- Name of the Cloudflare Pages project (decides `<name>.pages.dev`).
- Whether to add the scheduled keep-alive ping for Supabase Free.
- Whether the Chinese UI uses Simplified only (assumed) or also Traditional.
