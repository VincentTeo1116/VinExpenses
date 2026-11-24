# Verification: Phase 0 (foundation), 23 Nov 2026

Every number below comes from a command that was actually run in this session. Anything not run is listed as **Not verified**.

## 1. Results

| Check | Command | Result |
|---|---|---|
| Lint (includes security rules: no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, inline `style`) | `npm run lint` | 0 problems |
| Type check (strict) | `npm run typecheck` | 0 errors |
| Unit and component tests | `npm run test:web` | **64 passed**, 8 files |
| Production build | `npm run build` | Built. Initial JS **178 KB gzip** (budget 200 KB), CSS 3.7 KB gzip |
| Browser tests (Chromium) | `npm run test:e2e` | **50 passed** |
| Backend and legacy tests | `npm test` | **530 passed**, 0 failed |
| Dependency audit, code that ships to users | `npm audit --omit=dev` | 0 vulnerabilities |
| Dependency audit, everything | `npm audit` | 4 moderate, all in a build-time tool (`workbox-build` → `glob`/`minimatch`, a denial-of-service pattern on file globs). Not in the shipped app. Fix needs a breaking upgrade; deferred |

## 2. Requirements verified in Phase 0

| Requirement | Status | Evidence |
|---|---|---|
| SEC-01 strict CSP and headers | Verified | `security.test.ts` (policy contents), `security.spec.ts`: every page (including the 404) returns CSP, `nosniff`, `X-Frame-Options: DENY`, HSTS, Referrer-Policy, Permissions-Policy, COOP; the running app produced **no policy violation** and no console error |
| SEC-02 no secret in source or bundle | Verified | source scan test; browser test downloads the built files and searches for secret names |
| SEC-04 no HTML/eval/inline code | Verified | lint rules + source scan + browser check: 0 inline scripts, 0 `style` attributes, 0 `<style>` tags, 0 inline handlers |
| Clickjacking | Verified | iframe test shows none of the app |
| AU-16 old emailed link ignored | Verified | token in the address bar is never stored |
| REL-01 API timeouts/retries/errors | Verified | 12 unit tests incl. timeout, retry only on 5xx, offline, bad shape, bad service name |
| I18N-01 three languages | Verified | key and `{placeholder}` parity test; switch, persistence, `<html lang>`, tamper test; 404 page in Malay |
| PF-03 dialog stacking, focus, inert page | Verified | 7 unit tests (second sheet on top, Esc closes only the top, Tab wraps, outside tap, scroll lock) + browser tests (Tab never leaves the dialog, focus returns to the opener) |
| PF-04 error boundary, offline banner | Verified | unit tests + browser offline test |
| PU-03 real 404 | Verified | `/typo-address`, `/app/nope`, `/auth/x`, `/.env`, `/package.json`, `/src/main.tsx`, `/legacy/app.js` all return HTTP **404**; the five real app addresses return 200; back/home/stay/language behaviours tested |
| RESP-01 responsive | Verified for the frame | 320, 375, 768, 1024, 1440, 1920 px: no horizontal scroll, right navigation shown, all targets ≥ 44 px, add sheet inside the screen, 404 fits; sticky sidebar stays at top with full window height while scrolling |
| A11Y-01 accessibility | Verified for the frame | axe (WCAG 2.0/2.1/2.2 A and AA) in **light and dark** at 375 and 1440 px on Home, History, Plan, Account, the add sheet, sign-in and 404: 0 findings of any impact; keyboard-only walk (skip link, visible focus ring on every stop, dialog focus trap) |
| PF-01 PWA | Partly | Manifest and `sw.js` served and valid (tested). Install prompt and offline use not exercised |
| Screens (AU, DB, TX …) | **Not built** | Placeholders say so honestly. See `docs/TRACEABILITY.md` |

## 3. Tests proven able to fail (mutation checks)

| Deliberate break | Result |
|---|---|
| Add `'unsafe-inline'` to the style policy | `security.test.ts` failed |
| Remove `inert` from lower dialogs | `Sheet.test.tsx` "only one that can be used" failed |
| Put `overflow-x: hidden` back on the page body (the cause of the earlier sticky-sidebar bug) | sticky-sidebar browser test failed (scrolled to −2500) |
| Remove `align-self: start` from the sidebar | **Did not fail**: the sidebar has an explicit height, so the property is not what keeps it in place. Kept as harmless; the test targets the real cause |

All breaks were reverted and the suites re-run green.

## 4. Bugs found by the tests and fixed

1. `readEnv` threw an exception (instead of reporting) when the Supabase address was not an address at all.
2. Zod tried to compile with `eval`, which the page policy forbids (a console policy violation). Fixed by switching its compiler off (`zodSetup.ts`).
3. The policy written into the page included `frame-ancestors`, which browsers ignore there and warn about. Now only the HTTP headers carry it.
4. Focus did not return to the opener after a dialog closed because the page was still inert. The inert and scroll lock are now applied synchronously in the dialog stack.
5. Test infrastructure: `build-e2e` could not find Vite's binary; a test setup file assumed a browser; the config loader warned about module format. All fixed.
6. Earlier (legacy): the sticky sidebar broke because of `overflow-x: hidden` on the body; fixed with `overflow-x: clip`, and the new test guards it.

## 5. Not verified, and limits

- **Real Supabase and Cloudflare Pages were not used.** Tests run against a local server that imitates Pages' redirects and headers. The real `_headers`/`_redirects` behaviour on Cloudflare must be checked after the first deploy.
- **Only Chromium** was tested. Firefox, Safari and real iPhone/Android devices were not.
- **No screen reader** was used; only automated checks and a keyboard walk.
- **No Lighthouse or load-time measurement.** Bundle size is measured (178 KB gzip); speed is not.
- **Sign-in, money screens, admin, Telegram and the Mini App are not built yet** (Phases 1 to 6); so their requirements are not verified.
- The unit and e2e tests were written together with the code by the same author, so they are not fully independent evidence. The mutation checks above reduce, but do not remove, that risk.
- Screenshots were reviewed by eye at 375 and 1440 px (home, add sheet); the others were checked by automated overflow and target-size rules.

---

# Phase 1 (authentication, account security, contact form, public pages)

## Results (all commands were run)

| Check | Result |
|---|---|
| Lint, strict type check | 0 problems |
| Unit and component tests (`npm run test:web`) | **84 passed** |
| Browser tests (`npm run test:e2e`, Chromium, local stand-in for Supabase) | **99 passed** (auth 24, auth visual 11, public pages 11, performance 3, plus Phase 0's 50) |
| Backend and legacy tests (`npm test`) | **532 passed** (2 new: web/server rule parity) |
| First download, JavaScript compressed | sign-in **196 KB**, signed-in app **156 KB** (budget 200 KB), measured by a browser test |

## What is verified (requirement → evidence)

| Req | Evidence |
|---|---|
| AU-01, AU-02 sign-up with a 6-digit emailed code valid 5 minutes | register, wrong code, right code, expired code (aged on the test server) |
| AU-03 3 codes a day | 4th request refused with a message and a "contact the admin" button that opens the form with the topic preset |
| AU-04 strong password with live rules | rules turn met/not met while typing, each rule is its own line, every field has its own message; parity test proves the browser rules equal the server's rules on 18 passwords, emails, names and codes |
| AU-05 existing email | no code spent, sent to sign-in with the address kept |
| AU-06 sign-in without a code, Remember me 30 days | sign-in; remembered session survives a "new browser session"; not remembered session ends |
| AU-07 5 wrong passwords → 3-hour pause, per device | countdown screen; even the right password refused; another device unaffected; ways out (reset, contact) |
| AU-08 same answer for any wrong email or password | tested |
| AU-09 forgot password | code by email, wrong/expired code, weak and same password refused, old password stops working; same answer for an unknown address |
| AU-10 first-time Google person | name + strong password required, then the optional authenticator offer (the Google redirect itself was not run) |
| AU-11 authenticator | QR code, typed key, wrong/right code, 8 recovery codes, cannot be dismissed until saved, leaving early removes the half-made setup |
| AU-12 sign-in with the authenticator | app code; a password-only session cannot reach any app page; recovery code works, once, and turns it off |
| AU-13 turning off needs the password | wrong password refused |
| AU-15 disabled and admin-paused accounts | their own messages; admin pause has no timer and no reset button |
| AU-16 old emailed links | explained, removed from the address bar, store no token |
| AC-01, AC-02 | profile shown; change password needs the current one (checked through the sign-in door so guesses are counted) |
| PU-01 contact form | works signed out; field messages; success; reopened clean; admin inbox received it (test server) |
| PU-02 welcome, privacy, terms | served with headers, accessible, no outside requests, linked from sign-in |
| I18N-01 | the sign-in flow in Malay and Chinese; languages load on demand and a half-typed form survives a language change |
| A11Y-01, RESP-01 | axe (WCAG 2.0 to 2.2 A and AA) on **every** sign-in step plus account, authenticator setup, recovery codes and first-time setup, light and dark; no sideways scroll and no target under 44 px on every step at 320, 375, 768, 1024, 1440 and 1920 px |
| SEC | the password never appears in browser storage, the address bar or the console; no policy violation during a full sign-in |

## Bugs found by the tests and fixed

1. **Pasted codes were cut short**: the code box limited its length before removing non-digits ("12ab34cd56" became "1234").
2. **A swallowed click**: a field's error message appeared when it lost focus, pushed the button down, and the click on the button was lost. A line is now reserved under every field.
3. **Low contrast**: the green "rule met" text was too faint on white; a darker text green was added.
4. **After signing out, the next sign-in on the device went back to the previous person's last page**; a deliberate sign-out now starts at Home.
5. The first download had grown to 217 KB: screens are now loaded on demand, the whole validation library was removed from the start-up path, languages other than English load when chosen, and the offline worker registers after the page has loaded.
6. Test-only: a race when signing out and in again; a strict-mode duplicate; a toast count.

## Tests proven able to fail (mutation checks)

| Deliberate break | Result |
|---|---|
| Remember-me ignored | failed |
| Authenticator step skipped | failed |
| Deliberate sign-out still remembers the old page | failed |
| Error line not reserved | failed |

## Not verified in Phase 1

- **Google sign-in itself** (the redirect to Google and back): the setup screen after it is tested, the OAuth round trip is not.
- **Cloudflare Turnstile**: the widget code and its policy are written and unit-checked for the "off" state; it was not run with a real site key.
- **Real emails, real Supabase rate limits, real TOTP apps**: the server is a local imitation (`scripts/fake-backend.mjs`) that mirrors `auth-gate`; the real function's own rules are covered by the existing 532 backend tests.
- Only Chromium; no real phone; no screen reader.

---

# Phase 2 (money screens: add, edit, delete, History, Recurring, Budgets, preferences, offline queue)

| Check | Result |
|---|---|
| Lint, strict type check | 0 problems |
| Unit and component tests | **110 passed** (26 new for dates, schedules, totals, budgets, duplicates, categories) |
| Browser tests (Chromium, local stand-in for the database) | **137 passed** (money 15, plan 13, money visual 10, plus earlier phases) |
| Backend and legacy tests | **532 passed** |
| First download | sign-in **199 KB**, signed-in app **167 KB** gzip (budget 200 KB; the sign-in page is close to the limit) |

## Verified

- **Adding** an expense and an income (sources), field messages, the duplicate warning with "Save again", the **N** key (not while typing), record in the database with the right values and owner.
- **Editing** (values pre-filled, kind fixed), **deleting with Undo** (same date and values), **Duplicate to today**.
- **Budget heads-up** at 80% and at 100%, and not again for every later expense.
- **History**: day groups with signed day totals, type/category/search filters, empty and "nothing matches" states, **1,205 records read completely** (beyond the 1,000-row page), a record you never see, change, delete or forge for another person (stand-in enforces the same rule as the database policies).
- **Offline**: saved on the device, shown "Not synced", survives while offline, sent when the connection returns, deletable while waiting.
- **Recurring**: missed months posted at once with the day kept (31st rule tested), posting is idempotent (reload, and **two devices opened at once never post a date twice**), pause/resume skips missed dates, end date stops and switches off, edit and delete (posted entries kept), **income plus / bills minus / net** (and a negative net in red).
- **Budgets**: save, progress amber and red, over by amount, clearing removes the limit, bad values explained.
- **Preferences**: date format changes every date and is remembered; rename, hide, add categories; hidden ones leave the add sheet but stay on old records; duplicate names refused; the last active one cannot be hidden.
- **A11Y and RESP**: axe on every money screen and sheet (light and dark, 375 and 1440 px); no sideways scroll and no target under 44 px on any of them at all six widths, with awkward data (very long names, RM 123,456,789.99).

## Bugs the tests found and fixed

1. **Going offline before the add sheet's code had loaded made the headline offline feature fail**: the sheet is now fetched quietly shortly after the app loads (it is not in the first download).
2. The first screen grew past the budget (208 KB): the add sheet and its form library load on demand.
3. A "label in name" accessibility failure (the History row's spoken name did not contain its visible text): the row is now named by its own content.
4. Low contrast on paused items (they were faded with opacity) and on the red button in dark mode.
5. A test that did not catch a real bug (only reading the first 1,000 records): made stricter and re-proved by breaking the code.

## Tests proven able to fail

Net as a plain sum (fails); history cut at the first 1,000 rows (fails after the test was fixed); a bill posted without claiming its date first (fails).

## Not built or not verified in Phase 2

- **Swipe gestures** on rows (left delete, right duplicate): not built; rows have buttons on wide screens and the edit sheet on phones.
- **Auto-category suggestion** (TX-02): Phase 5.
- **Budget forecast** (BU-02): its numbers are written and move to the dashboard (Phase 3).
- Logging out leaves records waiting to be sent on the device (so nothing is lost); they are encoded per person. Clearing them on sign-out is a decision for you.
- Only the local stand-in database was used; real Supabase row-level security is covered by the existing database tests, not re-run here.

---

# Phase 3 (Home dashboard, DB-01 … DB-10)

| Check | Result |
|---|---|
| Lint, strict type check | 0 problems |
| Unit and component tests | **131 passed** (21 new for the dashboard numbers) |
| Browser tests (Chromium, stand-in database) | **150 passed** (12 new dashboard tests; Home added to the 4-width/2-theme accessibility walk and the six-width sideways-scroll and tap-size walk) |
| Backend and legacy tests | **532 passed** |
| First download | sign-in **199.3 KB**, signed-in app **174.3 KB** gzip (budget 200 KB) |

## Built

Big "Spent in <month>" card (the largest element on the screen, tested), three tiles (Income, Balance, Budget left; the budget tile opens Plan on the Budgets tab), comparison with the **same days** of last month, safe-to-spend per day, budget forecast warning (BU-02), daily average that leaves out fixed bills from schedules and says how much, top category, largest expense, category donut and six-month bars (drawn as SVG, no chart library, each with its numbers in text and the bars as buttons that jump to a month), category rows that open History narrowed to that month and category, Coming up (bills and income by date), Recent activity (opens the record to edit), weekly pattern check and repeating merchants (suggestion text only, nothing added automatically), quick-add chips for places visited at least twice, month switcher, first-use empty state, Malay and Chinese text.

## Decisions

- **No Chart.js**: the donut and bars are small SVG drawings. Less code to download and nothing for the page policy to block. The numbers are always also shown as text.
- English text for this screen lives in its own file (`src/lib/i18n/enDash.ts`) and arrives with the screen, so the sign-in download stays under 200 KB.

## Found and fixed while testing

1. Six-month bars: the spoken name did not contain the visible month label (accessibility rule); now named by content.
2. A very large amount spilled out of the donut centre; the centre now keeps inside the ring.
3. Adding this screen's English text pushed sign-in to 200.2 KB; moved to a separate file (199.3 KB).
4. Earlier tests expected the old placeholder heading; updated.

## Tests proven able to fail

Comparing against the whole of last month instead of the same days (fails); not separating fixed bills (fails); not counting today in safe-to-spend (fails).

## Not verified or limits

- Charts are checked by their numbers, structure and accessibility scan, and by looking at screenshots; there is no pixel-comparison test.
- Chart tooltips on hover are not built (values are in text and in the bars' spoken names).
- The "repeats" detector is simple (same merchant on a weekly or monthly rhythm, at least 3 times); it is a hint only.
- Sign-in page has about 0.7 KB of headroom left under the 200 KB budget.

---

# Phase 4 (Plan: fixed deposits, loans, reminders, PL-01 … PL-05)

| Check | Result |
|---|---|
| Lint, strict type check | 0 problems |
| Unit and component tests | **131 passed** |
| Browser tests (Chromium, stand-in database) | **173 passed** (23 new in `finance.spec.ts`; deposits and loans added to the 6-width and 2-theme walks) |
| Backend and legacy tests | **536 passed** (4 new parity tests) |
| First download | sign-in **199.7 KB**, signed-in app **185 KB** gzip (budget 200 KB) |

## Built

- **Deposit calculator**: amount, rate, tenure in days/months/years, start date, payout (maturity, monthly, quarterly, yearly), tax, 360/365 basis, maturity date (worked out, can be overridden); result, tax, net interest, yearly return, growth chart (SVG), payouts, daily/monthly/yearly earnings table with paging.
- **Loan calculator**: reducing balance or flat; monthly payment, total interest, total repaid, total cost with fees, per day/month/year, the real yearly rate for flat loans, full schedule (12 months a page) or yearly summary, "this loan with all my other loans".
- **Saved deposits**: progress and earned so far, edit, close and reopen, delete (with confirmation), renew, and **add the interest to income once** (claim first, so a second device cannot add it again).
- **Saved loans**: paid count, balance left, next payment, overdue, "mark next payment paid" and undo, a loan that began in the past counts earlier payments as paid, edit, close, reopen, delete.
- **Reminders**: list on Plan and Home, one pop-up on Home, "don't show for 24 hours" kept with the account (works on every device), closed items and items with reminders off are left out.
- Messages in English, Malay and Chinese (errors are codes translated on screen).

## Proof the maths is right

`tests/finance-parity.test.js` runs the new TypeScript maths and the original file (still used by the server's reminder function) on thousands of random inputs and compares every number: **3,000 deposits (and their payouts, tables and chart), 3,000 loans (instalment, schedule, yearly), 1,500 saved items (status, progress, reminders)**; at least 400 deposits and 800 loans of those were valid, so both valid and invalid paths are compared. Browser tests check hand-worked sums (10,000 at 3.5% for a year is 350.00; 315.00 after 10% tax; 100,000 at 3% flat over 5 years is 1,916.67 a month).

## Tests proven able to fail

A loan interest rounding change (fails parity); reminder days sorted the wrong way (fails parity); recording interest without claiming first (fails the two-devices test); not saving the 24-hour snooze (fails).

## Found and fixed while testing

1. The Home screen hid the reminders for a person with no transactions yet; moved above the empty state.
2. Small-text red badge had too little contrast; new `--danger-text` token (light and dark).
3. Segmented buttons were 40 px tall; now 44 px.
4. A button's spoken name did not contain its visible text ("Mark paid" vs "Mark next payment paid").
5. Plan's four tabs wrapped onto two rows on desktop.

## Not verified or limits

- **Saving deposits and loans offline is not queued** (the calculators work offline and saving says it needs a connection). The old site queued saves; this is a deliberate simplification for now and PL-05 is **partly met**.
- **"Add this loan to recurring expenses"** (the link between a loan and a monthly bill) is **not built** yet.
- **Telegram reminders** and the reminder time / pop-up settings screen belong to Phase 6; the 24-hour snooze and the `never` pop-up setting are read from the account already.
- The sign-in download has only about 0.3 KB of headroom under the 200 KB budget.

---

# Phase 5 (receipts, category suggestions, CSV: TX-02, CT-01, RX-01, RX-02, CS-01, HI-02)

| Check | Result |
|---|---|
| Lint, strict type check | 0 problems |
| Unit and component tests | **136 passed** (5 new for planning an import) |
| Browser tests (Chromium, stand-in database and receipt reader) | **203 passed** (18 new in `entry.spec.ts`) |
| Backend and legacy tests | **543 passed** (7 new differential tests in `tests/ports-parity.test.js`) |
| First download | sign-in **199.7 KB**, signed-in app **186.5 KB** gzip (budget 200 KB); the PDF reader downloads only when a PDF is chosen |

## Built

- **Category suggestions** while typing the merchant: the person's own history first, then the built-in merchant lists (Malaysia, Singapore, Indonesia, Thailand, Brunei, international brands, bank-statement forms such as `GRAB*FOOD`), receipt clues, then their own category names, with a plain-English reason. A category the person picked is **never overridden**; the suggestion is only offered as a "Use …" button.
- **Receipt scanning** in the add sheet: a PDF with text is read **on the device** (the reader service is not called, proven by a test); photos and scanned PDFs go through the signed-in reader service (nothing stored). Time limits on every step, a clear message for each failure (reader off, unreadable, daily limit, empty text, wrong file type, broken or password-protected PDF, offline), and tap-to-choose total when unsure.
- **CSV**: History exports exactly what is on screen; Account exports everything and imports this app's own CSV or a bank statement (Date + Amount, or Debit/Credit, or a Type column; day-first dates, `RM 1,234.50`, `(12.00)`, `12.00 DR`, `1.234,50`). A summary is shown **before** anything is added; what is already in the app is skipped; formulas in cells are protected on export and un-protected on import.
- The English, Malay and Chinese text for all of it.

## Proof the ports are faithful

`tests/ports-parity.test.js` compares the TypeScript ports with the original files on: every fixture receipt (whole, 25 random slices and 25 shuffles each), 4,000 random receipt lines (amounts, labels, dates), 300 random PDF layouts, **every brand name pulled out of the merchant lists** (700+, plain and as `A*B`) and the fixture receipts for the suggester, 1,500 random histories/custom-category cases, and 1,500 random CSV files in six layouts. A round trip test checks that what the app writes reads back unchanged in a fresh account.

## Tests proven able to fail

A receipt scoring weight, the "DR" sign in CSV amounts, date-looking numbers read as amounts, the history threshold in the suggester (all fail the parity tests); skipping duplicates when importing (fails the unit and browser tests); overriding a chosen category (fails the browser test).

## Found and fixed while testing

1. The test server sent `.mjs` files (the PDF reader's worker) as the wrong file type, so PDFs "could not be opened". The real host sends it correctly, and the test server now does too.
2. Tests that shared one reader setting disturbed each other when run side by side; the stand-in reader is now per person.
3. A one-pixel hidden file input was counted as a too-small tap target; it is excluded from that check.

## Not verified or limits

- **The real reader service (OCR.space), real photos and a phone camera were not used.** A test image and a canned reply stand in; the parser itself is checked on the fixture receipts.
- **The optional "AI helper" for unclear receipts (RX-03, Should) is not built.**
- **Offline import is refused** with a message (the offline queue holds 500 records; the old site queued them); adding one record offline still works.
- Reasons for category suggestions and the parser's warnings are in English only (the requirement says plain English); everything around them is translated.
- Receipt-merchant lookup by location ("nearby place") is not built.

---

# Phase 6 (Account services, Admin, email page, monthly report, Telegram Mini App)

| Check | Result |
|---|---|
| Lint, strict type check | 0 problems |
| Unit and component tests | **136 passed** |
| Browser tests (Chromium, stand-in database and services) | **256 passed** (new: account 14, admin 13, email page 9, report 8, Mini App 21) |
| Backend and legacy tests | **548 passed** (new: admin never reads money 3; ports parity now also covers the monthly numbers and the Mini App) |
| First download | sign-in **198.2 KB**, signed-in app **194.9 KB** gzip (budget 200 KB) |

## Built

- **Account (AC-04 … AC-07, AC-09)**: Telegram (status, one-time link that is only opened if it is a genuine `t.me` link, check again, disconnect, blocked-bot warning); **monthly report** (on/off, channel Telegram-else-email or email, recipient, confirm-address email, last result, **Send again** twice then "contact the admin", the 15-minute "on its way" note); **reminder settings** (hour, pop-up mode, hide amounts); **delete account** (type DELETE, server erases, this device's queue cleared, signed out); the **Telegram nudge on Home** with "don't ask again" kept with the account and on the device.
- **Admin (AC-08, AD-01 … AD-07)**: entry only for the administrator (Account card and menu); Accounts (search, status filter, paging, facts incl. last expense *date*, Telegram, authenticator, code usage, status, pause), actions in a **bottom sheet** each with its own confirm (reset code, block/unblock, clear code limit, reset authenticator, disable/enable, resend a report for a chosen month), Messages (open/resolved, mark resolved, reopen, shown as plain text), System (health checks, test email, recent admin actions). The admin screen only asks the `admin` function, which checks the role on **every** call.
- **Email action page (PU-04)** at the same address the emails already use (`/email-action.html`): the token is removed from the address bar at once, nothing happens until the button is pressed, clear success and failure states, English/Malay/Chinese, and it only talks to the app's own server.
- **Monthly report in the app (RP-01, HI-02)**: totals, plain-English line, daily bars, comparison with last month, where it went, top merchants (branches counted as one place), category comparison, every transaction; **Back and Esc**, **Print / save as PDF** with the menus hidden.
- **Telegram Mini App (TG-02, D-14)**: the second entry of the same codebase at `/miniapp/`, using the same tokens, sheet, toast and chips; Overview, Days (stats and calendar), Budgets, Trend, History (search, category filter, paging), add / edit / delete with a two-step delete, Telegram theme colours, haptics, sample preview at `?demo=1` (only outside Telegram). It is the **only** page allowed in a frame, and only by Telegram (`frame-ancestors` lists Telegram's web apps; every other page still refuses framing; checked by a test).

## Proof

- Admin: the screen never names a money table and never calls the database directly (static test, proven able to fail); the server function checks the role before any action (static test); a browser test seeds an expense with a distinctive merchant and amount and checks that **no admin response or screen contains it**; an ordinary person gets a 403 from the server even when the screen is bypassed.
- Mini App: the dictionary (all three languages), formatting helpers, launch reader and sample data are compared with the original files; the real launch is tested against a stubbed service for what is sent (the signed launch data in a header, never a user id), what is shown for each answer (expired, unsigned, not linked, too many requests, server problem, no connection), and that editing sends only what changed.
- Monthly numbers: `summarizeMonth` / `compareMonths` are compared with the original on 1,500 random months.
- Tests proven able to fail: heat-map level threshold, Telegram theme brightness cut-off and first weekday of the sample month (all fail the parity test); admin screen querying a money table (fails the static test).

## Found and fixed while testing

1. The test server sent the Mini App's and PDF reader's `.mjs` files with the wrong type (an old finding), and did not drop a header the way the real host's `! Header` rule does; both fixed so the framing rule could be tested.
2. The Home nudge's grey text had too little contrast on its tinted card; a table of days exposed as a `table` role without cells (accessibility rule); `user-scalable=no` in the Mini App page (blocks zoom); heat-map cell contrast in dark mode.
3. Adding the second page changed how the code is split and pushed the sign-in download to 200.1 KB. The contact form now loads on first use and English text for signed-in screens (164 sentences) loads with them: 198.2 KB.
4. A test that clicked "Month" matched "Monthly expense report" as well; two tests changed shared server state side by side (fixed by keeping state per person or counting per page).

## Not verified or limits

- **Nothing was run inside real Telegram** (a real signed `initData`, the real bot, real themes, haptics, the in-Telegram frame). The server's signature check has its own existing tests; the page's side is tested with stand-ins.
- Real Supabase, real emails (confirm / reset / report), the real Telegram bot and the 1st-of-month sender were not run.
- Reports: the in-app report has no chart library (daily bars and tables); there is no per-category pie. The monthly **email/Telegram** report is produced by the existing server code, unchanged.
- The Mini App dashboard is a re-build with the same screens and data, not a pixel copy; the add/edit sheet there takes only what the server's `miniapp-api` accepts.
- The Admin "Email service test" button is on the System tab (it moved from Account).

---

# Phase 7 (hardening, parity, hand-over)

| Check | Result |
|---|---|
| Lint, strict type check | 0 problems |
| Unit and component tests | **136 passed** |
| Browser tests (Chromium) | **256 passed** across 20 spec files |
| Backend, original-file and parity tests | **548 passed** |
| Production build | builds; `_headers` carries the Mini App framing exception; no inline scripts or styles in any built page |
| `npm audit` (code that ships) | **0 vulnerabilities**; 4 moderate in build tooling only (`glob`/`minimatch` inside the PWA plugin), not shipped |
| Secrets | none in the built files (the word `sb_secret` appears only inside supabase-js, which uses it to warn when a secret key is used in a browser) |
| First download | sign-in 198.2 KB, signed-in app 194.9 KB gzip (budget 200 KB; **about 2 to 5 KB of headroom**) |

## Documents delivered

`docs/TRACEABILITY.md` (all 86 requirements → status → code → test), `docs/VERIFICATION.md` (this file), `docs/FALLBACKS.md`, `docs/DEPLOY-CLOUDFLARE.md` (your steps for Cloudflare Pages), `docs/CUTOVER.md` (the switch and removing the old site), `README.md`.

## Parity with the old site (what was proven and how)

Every number that comes from pure logic was compared with the original JavaScript on random inputs (deposit and loan maths, receipt reading, category suggestion, CSV reading, monthly report numbers, the Mini App's formatting and sample data) and every Must requirement has a browser test. See the "Proof" section of each phase above and the "Evidence" column of `docs/TRACEABILITY.md`.

## Honest list of what is not done or not verified

**Not built** (all optional or decided):
- Swipe gestures on rows (TX-04); a loan adding its own recurring payments (RC-03); the optional AI receipt helper (RX-03) and nearby-place lookup (RX-04); the cosmetic "typed built-file address shows 404" rule (PU-05).
- Saving deposits, loans and CSV imports **while offline** is refused with a message (adding one expense or income offline works and is queued).

**Not verified because it needs the real thing** (everything was run against a local stand-in for Supabase, its functions, the receipt reader and Telegram):
- Real Supabase (row-level security is covered by the existing database tests, not re-run here), real emails and codes, Google sign-in, Cloudflare Turnstile with a real key, the real OCR service, the real Telegram bot and Mini App inside Telegram, the 1st-of-the-month report sender.
- Cloudflare Pages itself (headers and redirects were checked with a local server that behaves like it).
- Browsers other than Chromium, real phones, screen readers (automated accessibility scans and keyboard walks only), and **Lighthouse** (it would not record a page load in this environment, so no Lighthouse score is claimed; the byte budget and the accessibility scans stand in for it).
- The one-time cut-over itself (`docs/CUTOVER.md` lists the manual checks to do on a preview address first).

## Bugs the testing found (all fixed)

Across the phases, 40 or more problems were found by the tests and fixed (listed in each phase above), including: a test that would have let a history cut at 1,000 rows pass; offline add failing when the sheet's code had not loaded; first-download budget overruns (five separate times); low contrast in six places; a table and a calendar with the wrong accessibility roles; a hidden file input counted as a tap target; shared test state making tests disturb each other; the test server serving `.mjs` files as the wrong type.

---

# Technical assessment pass

See `docs/TECHNICAL_ASSESSMENT.md`. In that pass the PDF reader was upgraded from 4.10 to 6.5 (all receipt tests pass), `tests/build-security.test.js` was added (scans the published files for secrets, source maps, inline code, headers and redirects), and the full suite was re-run: 136 unit, 256 browser, 553 backend and parity tests, 0 vulnerabilities in shipped code.

---

# Public pages rebuilt in React

The welcome page, Privacy Policy and Terms of Use are now React pages in the same app (`src/features/public/`), using the app's design tokens, light and dark mode, and pictures taken from the real app with made-up sample data (`e2e/landing-shots.spec.ts`, run on purpose with `SHOTS=1`).

- **Motion** (all off for people who ask for less motion): hero blobs and floating cards, sections that fade in as they are reached, numbers that count up, a "try it" loan calculator using the app's own maths, a reading-progress bar and a contents list that follows the reader on the legal pages, a back-to-top button.
- **Addresses:** `/`, `/welcome`, `/privacy`, `/terms`; the old `.html` addresses still work and redirect, so links in emails, the Google consent screen and Telegram keep working.
- **Tests:** 263 browser tests pass, including motion-on and motion-off checks, the old addresses, the calculator, and the accessibility scan after every animation has run (light and dark).
- **Text changes (please read):** the old policy text was kept word for word except where it described features that are not in the new app: the "Nearby" location lookup (OpenStreetMap), the optional AI receipt helper (Gemini) and "a copy of your records stored on the device" were removed or corrected; the Telegram Mini App and the language/device-number storage were added. Terms: "any AI help" and "map lookup" removed. A test fails if those names reappear. **Have the policy text checked by you (or a lawyer) before launch.**
- **Trade-off:** these pages now load the app's code (about 190 KB gzip) instead of being plain HTML, and search engines have to run JavaScript to read them. The pages set their own title and description, but a pre-rendered static version would be better for search ranking if that matters later.
- **Also fixed:** the Home screen's category list was cramped on laptop widths; it now chooses its layout from the card's own width.

## Search engines (SEO)

The welcome, Privacy and Terms pages may be listed; the app, sign-in, Mini App and email page may not. The page shell no longer says "noindex" (that tag would have stopped the welcome page being listed, because search engines may not run the page's script when they see it); instead those private addresses are sent with an `X-Robots-Tag: noindex, nofollow` header, `robots.txt` allows the public pages and disallows the private ones, and the public pages name their own address (canonical), title and description. Set `VITE_SITE_URL` to the public address at build time to also get `sitemap.xml` and absolute social-preview links. Tested in `tests/seo.test.js` and `e2e/public.spec.ts`. Not verified: how a real search engine lists the site (that needs the live address and a few weeks); a pre-rendered welcome page would still rank better than one drawn by script.

## Nearby places (RX-04) is built

In the add sheet, "Find places near me" asks the browser for the position once, asks the signed-in `nearby-place` function for the closest named shops, restaurants and amenities (within 150 m, widening to 300 m), and shows the 5 nearest. "Show all" reveals up to 10, and a search box filters them. Tapping one fills the merchant and suggests the category the same way typing would (a category the person chose is left alone). Nothing is filled in automatically and the position is not saved by the app. It is not offered when editing an existing record.

- **Server:** the function keeps its old single-name answer and adds `list: true`. Choosing and cleaning the places is in `_shared/nearby.ts` (nearest first, one entry per name, at most 20, names stripped of markup), tested in `tests/nearby.test.js`. Same daily limit as before.
- **Failures:** blocked or unavailable location, offline, the map service down, nothing nearby, and the daily limit each show a plain message and leave typing available (`e2e/nearby.spec.ts`, plus light and dark accessibility scans).
- **Privacy policy:** the position row and the OpenStreetMap row are back, and `src/test/security.test.ts` checks they are there.
- **Not verified:** the real Overpass service (it may be slow or refuse some requests, and its data is thin in some Malaysian areas), a real phone's GPS accuracy, and the redeployed server function. **The updated `nearby-place` function must be deployed to Supabase before the list works for real.**
