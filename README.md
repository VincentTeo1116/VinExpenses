# Smart Expense Tracker

> **VinExpenses v5: React + TypeScript.** The repository root is the React app (`src/`); it also builds the Telegram Mini App (`/miniapp/`) and the email-link page (`/email-action.html`). The previous plain-JS site is kept in **`legacy/`** as a backup and still deploys to GitHub Pages until the single switch (`docs/CUTOVER.md`). The Supabase back end (`supabase/`, `supabase-schema.sql`) is shared by both.
>
> Start with: `docs/REQUIREMENTS-react.md` (what it must do) · `docs/DESIGN.md` · `docs/TRACEABILITY.md` (every requirement → code → test) · `docs/VERIFICATION.md` (what was tested, what was not, bugs found) · `docs/FALLBACKS.md` · `docs/DEPLOY-CLOUDFLARE.md` · `docs/CUTOVER.md`.
>
> | Command | What it does |
> |---|---|
> | `npm run dev` | Dev server on http://127.0.0.1:5173 (needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`) |
> | `npm run build` | Type-checks and builds to `dist/` (CSP, `_headers`, `404.html`, Mini App and email page included) |
> | `npm run check:web` | Lint, type check, unit tests, build |
> | `npm run test:web` | Unit and component tests (Vitest) |
> | `npm run test:e2e` | Builds a test copy and runs the browser tests against a local stand-in for Supabase (Playwright + axe: security, 404, accessibility, 320–1920 px, every feature) |
> | `npm test` | Backend, original-file and parity tests (`node:test`); the parity tests compare the TypeScript ports with the original JavaScript on thousands of random inputs |
>
> Everything below this box describes the **legacy site**; file paths such as `app.js` live under `legacy/`.

A mobile-first expense & income tracker with real Supabase-backed auth
(email/password with a confirmation **link**, or Google) and a per-user
dashboard. Plain HTML/CSS/JS — no build step.

## Files

| File | Purpose |
|---|---|
| `index.html` | App markup — auth, setup, dashboard, expense, income, history, modals |
| `style.css` | Responsive styling (phone → tablet → desktop) |
| `.env` / `.env.example` | Your Supabase URL + anon key (`.env` is gitignored; copy `.env.example` to start) |
| `build-config.js` | Turns `.env` into `config.js` (gitignored) — run it after editing `.env` |
| `.github/workflows/deploy.yml` | Builds `config.js` from repo secrets and deploys to GitHub Pages |
| `app.js` | All logic: Supabase auth, data fetch/save/edit/delete, charts, navigation |
| `supabase-schema.sql` | Complete, rerunnable SQL setup for base tables and all database features |
| `receipt-parser.js` | Finds the merchant, total and date in receipt text (OCR output or PDF text). No dependencies; unit-tested |
| `smart-entry.js` | Category suggestions (learns from your history + Malaysian merchant list) and duplicate detection. No dependencies; unit-tested |
| `csv-import.js` | Reads a CSV (this app's export or a bank statement) into expenses/income. No dependencies; unit-tested |
| `welcome.html`, `privacy.html`, `terms.html`, `pages.css`, `landing/` | Public pages: the landing page, Privacy Policy and Terms of Use (no scripts of their own; linked from the sign-in screen and Account). Screenshots in `landing/` use made-up demo data |
| `finance-calc.js` | Fixed-deposit and loan maths, schedules, statuses and reminder timing. No dependencies; unit-tested. The reminder function uses an identical copy |
| `plan.js` | The Plan tab's Deposits and Loans sections, the dashboard "Due soon" strip and the reminders pop-up |
| `supabase/functions/plan-reminders/` | Scheduled Telegram reminders for deposits that mature and loan payments that fall due |
| `tools/make-fixture.js` | Turns a saved scan-details file into a test fixture (`npm run fixture`) |
| `tests/` | Automated tests (`npm test`) and anonymised receipt fixtures |
| `supabase/functions/receipt-ocr/` | Private OCR.space proxy used by receipt scanning (signed-in users only, daily limit) |
| `supabase/functions/receipt-ai/` | Optional AI helper for unclear receipts. Off until you add a key |
| `supabase/functions/_shared/` | Login check, daily limits and CORS shared by the receipt functions |
| `supabase/functions/monthly-report-email/` | Scheduled monthly spending report sender |
| `manifest.json`, `sw.js`, `icons/` | Makes the site installable as an app (PWA) |
| `icon.png` | Browser tab favicon |

## Features

- **Plan tab: fixed deposits and loans** - the old Recurring screen is now **Plan**, with three sections:
  Recurring, Deposits and Loans.
  - **Fixed deposit calculator**: amount, rate, tenure (days / months / years), start date and payout (at
    maturity, monthly, quarterly, yearly). Shows what you receive, the interest, an optional tax, the yearly
    return, a growth chart, and a daily / monthly / yearly breakdown. Simple interest: amount x rate x days / 365.
  - **Loan calculator** (fixed rate): **reducing balance** or **flat rate**, with the monthly payment, total
    interest, cost per day / month / year, the real yearly rate of a flat-rate loan, a full repayment schedule,
    and "this loan" next to "all your loans together".
  - **Save and track**: deposits show progress and what is earned so far; when one matures you can record the
    interest as income in one tap, renew it or close it. Loans show payments made, what is left and the next
    due date. A loan can be **added to recurring expenses**: its payments are then added to your spending
    automatically and stop by themselves after the last one.
  - **Reminders**: by Telegram when it is connected (7 days, 1 day and on the day for a deposit; 3 days and on
    the day for a loan payment; you can change the days per item). In the app they are always listed under
    **Due soon** on the dashboard, and shown in **one pop-up that lists everything**, with "Don't show again
    for 24 hours" (kept with your account, so it applies on every device). Settings are in Account -> Reminders.
  - **It keeps working when things go wrong**: the calculators need no connection; a save made offline is kept
    on the device and sent later; if the database has not been updated yet the calculators still work and the
    screen says what to run. Results are estimates, not financial advice.

- **Smarter receipt reading** - scan a **photo or a PDF**. PDFs with a text layer
  (e-mailed receipts, e-invoices) are read **on your device**, exactly and
  instantly, and are never uploaded; photos and scanned PDFs go through OCR.
  The reader scores every amount on the receipt from the words around it
  (Total, Grand total, Jumlah, Anda bayar, 总计...), ignores subtotals, tax,
  discounts and foreign-currency values, and double-checks with arithmetic
  (subtotal + tax + fees - discounts). When it is unsure it **pre-fills nothing
  wrong** and shows the likely totals as tap-to-choose chips.
- **Month-to-month report** - the monthly report compares with last month
  (expenses, income, biggest category changes) and lists top merchants and where
  the money went.
- **CSV export / import** - Account -> Your data. Export everything, or import a
  CSV: this app's own export, or a bank statement with Date + Amount (or
  Debit/Credit) columns. Rows already in the app are skipped, categories are
  matched by name or guessed from the merchant, and you confirm a summary first.
  A file with only positive amounts is imported as expenses; add a `Type` column
  (`expense`/`income`) to say otherwise.
- **Auto-category** - a suggested category with a plain-English reason. It learns
  from how *you* filed a merchant before, then uses a built-in Malaysian merchant
  list, receipt clues (service charge + table = restaurant) and your own custom
  category names. Your explicit choice is never overridden.
- **Duplicate warning** - saving the same amount at the same merchant on the same
  day (e.g. a receipt scanned twice) asks first.
- **Receipt scan & merchant shortcuts** - scan a receipt into an editable draft,
  use optional nearby-place lookup, reuse frequent merchants, and tap a recent
  merchant template to prefill amount/category/payment. Merchant names can be
  searched in History. Images go to OCR.space for recognition and are not saved.
- **Budget forecasts** - estimate month-end spending from the current pace and
  show a gentle heads-up if an active budget is likely to be exceeded.
- **Spending patterns** - compare the last 7 days with the week before and surface
  possible weekly/monthly merchant repeats from the user's history. Suggestions
  are never added as recurring bills automatically.
- **Exports and reports** - export filtered History to CSV or open a print-ready
  monthly report that can be saved as PDF. The report opens *inside* the app (with a Back button, Esc, and the phone's back gesture), so an installed home-screen app never gets stuck on it; use **Print / PDF** in the report to save it. Users can opt in to a monthly email,
  edit its recipient, and turn delivery off from Account.

- **Quick add** — a big **+** button (bottom tab bar on phones, sidebar button or the
  **N** key on desktop) opens one sheet with an Expense / Income switch, an
  amount-first field, category/payment/source chips and a back-datable date.
- **Dashboard** — spent this month with a change-vs-last-month chip and a
  "% of income used" bar, plus daily average, top category and largest expense.
  A category doughnut + ranked list (tap a category or slice to see its
  transactions) and a 6-month trend (tap a bar to jump to that month).
- **History** — grouped by day with a per-day total; filter by type, category and
  month, and search. Tap a row to edit; **Delete** lives in the editor.
- **Recurring** — schedule bills, subscriptions, salary, and other regular income. Due entries post to History when you open the app with an internet connection on or after the due date; missed dates are back-filled then. Schedules do not run in the background while the app is closed. Pause, edit, or delete schedules.
- **Personal spending options** — rename built-in categories and payment methods, add your own, or deactivate an option. Past transactions remain readable after deactivation.
- **Professional polish** — display amounts consistently in MYR (RM); choose `19 Oct 2026`, `19/10/2026`, or ISO date format in Account; escape user-defined labels; announce key updates to assistive technology; and provide clearer empty and loading states.
- **Budgets** — set an overall monthly budget and/or a limit per category. Category
  rows show progress (amber at 80%, red when over), the hero card shows how much is
  left, and **"Safe to spend today"** divides what's left by the days remaining.
  You get a heads-up toast when an expense pushes you past 80% or 100%.
- **Swipe actions** (touch) — in History, swipe a row **left to delete** or **right to
  duplicate** it as today's entry. Deleting shows an **Undo** toast instead of a
  confirmation dialog.
- **Works offline** — the app opens with your last saved data, and entries added
  without a connection are kept on the device, marked "Not synced", and sent
  automatically when you're back online. (Editing or deleting entries that are
  already saved needs a connection.)
- **Auth** — email + password with verification link, resend link, **forgot
  password** (emailed reset link), password strength meter, Google sign-in (new
  Google users finish a short profile setup).
- **Look & feel** — one design-token system; responsive from phone to desktop
  (tab bar -> sidebar at 1024px); follows the phone/OS light or dark setting,
  including the charts and status-bar colour; respects reduced-motion.
- **Feedback** — toasts for quick confirmations; `showModal()` for errors and
  confirmations (no browser `alert()`); **Esc** closes any sheet or dialog.
- **PWA** — installable, works offline for the UI (data needs a connection).

## 0. Configuration (`.env`)

Supabase settings live in `.env`, not in the code:

```bash
cp .env.example .env        # then fill in SUPABASE_URL and SUPABASE_ANON_KEY
node build-config.js        # generates config.js, which index.html loads
```

Re-run `node build-config.js` whenever you change `.env`. `.env` and
`config.js` are gitignored.

> **Heads-up:** this is a static site, so whatever is in `config.js` is
> visible to anyone who opens the page — `.env` keeps it out of git and makes
> it easy to switch projects, but it does not make the key secret. That's fine
> for the **anon** key (Row Level Security is what protects the data). **Never**
> put the `service_role` key here; `build-config.js` refuses to build with it.

**Deploying with GitHub Pages:** the workflow in `.github/workflows/deploy.yml`
creates `config.js` from repository secrets. One-time setup: add
`SUPABASE_URL` and `SUPABASE_ANON_KEY` under *Settings → Secrets and variables →
Actions*, and set *Settings → Pages → Source* to **GitHub Actions**. (On
Netlify/Vercel, set the same two environment variables and use
`node build-config.js` as the build command.)

## 1. One-time Supabase setup

1. **Run the SQL.** In Supabase, open **SQL Editor → New query**, paste the
   entire `supabase-schema.sql` file, and run it. This is the single database
   setup for both a new project and an existing project. It creates or upgrades
   tables for expenses, income, merchants, budgets, recurring items, personal
   categories/payment methods, date preferences, and monthly report settings.
   Existing records and category/payment keys are kept. It also enables the
   monthly email scheduler automatically if its required Vault secrets already
   exist; otherwise, rerun this same file after configuring those secrets.
   Currency remains MYR (RM).

2. **Make sure email confirmation is on.** **Authentication → Providers →
   Email → Confirm email**. The app uses Supabase's default confirmation
   **link** (not an OTP). After registering, the person clicks the link in
   their inbox, lands on the **login** screen with an "Email verified" message
   and signs in with their password. A "Resend it" link covers lost emails.

   **Forgot password** uses the same setup: your site URL must be in **Authentication →
   URL Configuration → Redirect URLs**, because the reset email links back to the app.
   (Supabase's built-in email sender is rate-limited; add custom SMTP for production.)

3. **Enable Google sign-in (optional).**
   - In [Google Cloud Console](https://console.cloud.google.com/), create an
     OAuth 2.0 Client ID (Web application).
   - Add `https://<your-project-ref>.supabase.co/auth/v1/callback` as an
     authorized redirect URI.
   - In Supabase: **Authentication → Providers → Google**, paste the Client ID
     and Secret, and save.
   - Add your deployed site URL (and `http://localhost:8000` for local testing)
     under **Authentication → URL Configuration → Redirect URLs**.

## 2. Run it locally

```bash
node build-config.js        # once, if config.js doesn't exist yet
python -m http.server 8000
# open http://localhost:8000
```

(Open it through a server, not by double-clicking the file — the service
worker and Supabase redirects need `http://`.)

## 3. Enable receipt scanning (OCR.space)

PDF receipts with a text layer need **no setup at all** (they are read in the
browser). Photos and scanned PDFs need the OCR key below. Receipt scanning is
optional. Nearby-place lookup, merchant suggestions,
spending patterns, budget forecasts, CSV export and the in-app monthly report
need no additional API key. Monthly report emails use the separate setup below.

1. Create a free OCR.space API key at <https://ocr.space/ocrapi>.
2. Install Node.js, then from this project folder run `npx supabase login`.
3. Link your Supabase project: `npx supabase link --project-ref YOUR_PROJECT_REF`.
   The project ref is the subdomain in `https://YOUR_PROJECT_REF.supabase.co`.
4. Store the OCR key as an Edge Function secret:
   `npx supabase secrets set OCR_SPACE_API_KEY=YOUR_OCR_SPACE_KEY`.
5. Deploy both authenticated functions:
   `npx supabase functions deploy receipt-ocr`
   `npx supabase functions deploy nearby-place`.
6. Reload the app. Scan fills a draft; review the merchant, total, date and
   category before saving. The free OCR.space plan currently has a 1 MB image
   limit and no uptime guarantee; the app compresses photos before upload.

## Account deletion

Account -> Delete account requires typing `DELETE` and removes the signed-in
Supabase Auth user. The schema links user-owned rows with `ON DELETE CASCADE`,
so expenses, income, schedules, budgets, preferences and custom options are
removed with that user. The app then clears that account's local cache and
offline queue on the current device. Export your CSV first if you want a copy.
Deletion needs an internet connection and cannot be undone.

Deploy the authenticated deletion endpoint after linking the Supabase project:

```bash
npx supabase functions deploy delete-account
```

No additional secret is needed; Supabase supplies the service role key to the
Edge Function environment. The key stays server-side.

## Local recovery and sync

Offline entries remain saved on the device until synced. If Supabase rejects an
entry, the app keeps it marked as pending instead of discarding it. Account ->
Your data shows the last successful sync, lets you retry, and exports only
unsynced transactions to CSV. Keep in mind that browser local storage is tied to
that browser/device; export pending rows before clearing site data or changing
devices.

## Before sharing a release

Run `npm run check` from the project folder. It checks the app JavaScript syntax
and runs the receipt, CSV, categorisation and report tests. Then, with the
project's Supabase URL and public anon key configured, open the app on a desktop
and phone and confirm: sign-in; a manual expense and income; receipt scan review
before save (if OCR is deployed); an offline transaction marked pending and
synced after reconnect; a recurring item due today; CSV export; and the report
preference. Test account deletion only with a disposable test account, after
deploying `delete-account`. The automated checks cannot verify your Supabase
tables, Edge Function deployment, secrets, scheduled email job or mobile browser
behaviour.

Keep the OCR key in Supabase Edge Function secrets. Do not put it in `.env`,
`config.js`, or browser JavaScript. The function requires a **signed-in user**
(the public anon key alone is rejected), limits each user to a **daily number of
scans**, and does not log or save receipt images or extracted text.

**Protect the scan functions (recommended, 2 minutes).**

1. Run the latest `supabase-schema.sql` once more: it adds the
   `receipt_scan_usage` table and `consume_receipt_quota()` that enforce the daily
   limits. (Until you do, scanning keeps working but is not limited.)
2. Lock the functions to your website (**required**: while `ALLOWED_ORIGINS` is empty they refuse browser calls) and optionally set limits:
   `npx supabase secrets set ALLOWED_ORIGINS=https://YOURNAME.github.io`
   `npx supabase secrets set SCAN_DAILY_LIMIT=30 AI_DAILY_LIMIT=10`
3. Redeploy: `npx supabase functions deploy receipt-ocr`.

### Optional: AI help for unclear receipts

Off by default and **not required**. The normal reader handles clear receipts
without any AI. If you want a second opinion on messy ones:

1. Create a key in Google AI Studio (<https://aistudio.google.com/apikey>).
2. `npx supabase secrets set GEMINI_API_KEY=YOUR_KEY`
3. `npx supabase functions deploy receipt-ai`
4. In the app, tick **Let AI help when a receipt is unclear** in the scan card.

Only the receipt *text* (never the photo) is sent, only when the reader is unsure
and only for people who ticked the box. Every answer is validated before use
(amount range, date, your own category list). Note that on Google's free tier,
prompts may be used to improve Google's products; enable billing on the Google
project if receipts should not be used that way. Any other vision/text model can
be wired in by editing `supabase/functions/receipt-ai/index.ts`.

### Plan tab and reminders: setup

1. Run the updated `supabase-schema.sql` in the Supabase SQL Editor (safe to run again). It adds the
   `fixed_deposits`, `loans` and `reminder_log` tables and a few columns. Until you do, the calculators work
   but nothing can be saved, and the Plan tab says so.
2. For Telegram reminders, deploy the function: `npx supabase functions deploy plan-reminders`
   (the "Deploy Supabase functions" workflow does this for you on a push). It uses the secrets the bot already
   has (`TELEGRAM_BOT_TOKEN`, `MONTHLY_REPORT_CRON_SECRET`, optional `SITE_URL`) and the same three Vault
   secrets as the monthly report for its hourly schedule, which the SQL file installs. `REMINDER_BATCH`
   (default 60) limits how many reminders one run sends.
3. Without step 2, reminders still appear in the app.

If you change `finance-calc.js`, run `node tools/sync-shared.js` so the function's copy matches (a test fails
if it does not).

### Tests

`npm test` (Node 24) runs the parser, category, duplicate and AI-validation
tests. The fixtures in `tests/fixtures` are real receipt layouts with names,
e-mail addresses, phone numbers and addresses replaced. **When a receipt is read
wrongly, copy its text into a new fixture and add one line to the test list**:
that is how the reader keeps improving. After a scan the app shows
**Something wrong? Save the scan details**: fix the form first, tap it, then run
`npm run fixture -- path/to/scan-details.json my-receipt-name`. It writes a masked
fixture and prints the correct values to add as a test (read the fixture and
remove any names or addresses before committing). CI runs the tests before every deploy.
Nearby lookup uses the OpenStreetMap public reverse-geocoding endpoint by
default, through the `nearby-place` function. It requires no API key. The app
only requests it on a button tap, caches results for the current browser session,
and shows the required attribution. To switch to a compatible provider, set the
`PLACE_REVERSE_URL` Edge Function secret to its reverse endpoint.

The merchant column and index are included in `supabase-schema.sql` for fresh
and existing databases.

## 4. Enable monthly report emails (Gmail SMTP)

Monthly email is opt-in per user, and a report is only sent to an address its owner
**confirmed**. In **Account** a user enters the address, turns on **Monthly report
email**, saves, presses **Send confirmation email**, and clicks the button in the
message they receive. Turning the switch off, or pressing **Unsubscribe** in any
report, stops future sends. The email contains monthly income, expenses, net,
record counts and spending by category; no individual transactions or receipts.

Mail goes out through **Gmail SMTP** (`smtp.gmail.com`, port **465**, encrypted from
the first byte). Supabase blocks ports 25 and 587, so 465 is the one that works.
Gmail sends *from* the Gmail account itself and allows about **500 recipients a day**
(Google Workspace about 2,000); the app stops at `EMAIL_DAILY_CAP` (default 400).

**One-time setup**

1. In the Google account that will send the mail, turn on **2-Step Verification**
   (<https://myaccount.google.com/security>), then create an **App Password**
   (<https://myaccount.google.com/apppasswords>). It is 16 letters. Use a dedicated
   account for the app, not your personal inbox.
2. Store the secrets (Dashboard → Edge Functions → Secrets, or CLI). Never put
   them in `.env`, `config.js` or GitHub:

   ```bash
   npx supabase secrets set SMTP_USER=yourapp@gmail.com SMTP_PASS="abcd efgh ijkl mnop"
   npx supabase secrets set EMAIL_TOKEN_SECRET="$(openssl rand -hex 32)"
   npx supabase secrets set MONTHLY_REPORT_CRON_SECRET="$(openssl rand -hex 32)"
   npx supabase secrets set SITE_URL=https://YOURNAME.github.io/VinExpenses
   npx supabase secrets set ALLOWED_ORIGINS=https://YOURNAME.github.io
   npx supabase secrets set ADMIN_EMAIL=you@yourcompany.com
   ```

   `ALLOWED_ORIGINS` is **required**: while it is empty every function refuses
   browser calls. `ADMIN_EMAIL` is the login email of the person who becomes the
   administrator (see below). Optional: `EMAIL_FROM_NAME`, `EMAIL_DAILY_CAP`,
   `MONTHLY_REPORT_BATCH` (default 25 per hourly run).
3. Run the latest `supabase-schema.sql` in the SQL Editor (it adds the confirmed-address
   columns, the administrator table and the daily counters). **Existing users must
   confirm their address once**; until they do, no report is sent to them.
4. Deploy every function (the shared code changed):

   ```bash
   npx supabase functions deploy
   ```

5. Push the site so `email-action.html` (the page behind the email links) is published.
6. In Supabase **Vault**, store `project_url` (`https://YOUR_PROJECT_REF.supabase.co`),
   `publishable_key` (the anon/publishable key) and `monthly_report_cron_secret`
   (exactly the same value as `MONTHLY_REPORT_CRON_SECRET`), then run
   `supabase-schema.sql` once more to install the hourly scheduler. The job only
   sends on the 1st in Kuala Lumpur and never sends a user's report twice.

**Test it (administrator).** Sign in with the `ADMIN_EMAIL` account (its email must be
confirmed) and open **Account**. A card **Administrator: email service** appears; the
first time, that account is registered as the administrator automatically, and the
database refuses to register anyone else afterwards. **Send test email to me** sends a
real message to your own address and shows a checklist of the settings, or exactly
where it failed: connect, login, sender, recipient or delivery. It can only email the
administrator, at most 10 times a day.
To register an administrator by hand instead: run
`insert into public.app_admins (user_id) select id from auth.users where email = 'you@yourcompany.com';`

Use `cron.job_run_details` in the SQL Editor to inspect scheduled runs. See
[SECURITY.md](SECURITY.md) for how the email system is protected.

## 4a. Sign-in emails through Gmail, with the VinExpenses look

Sign-up confirmation, password reset and the other sign-in emails are sent by Supabase Auth, not by the
functions. Two things make them yours: Supabase must send them through your Gmail, and it must use the styled
templates in `supabase/templates/` (generated from the same layout as the monthly report).

One command does both. In PowerShell, from the project folder:

```
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."        # Supabase dashboard -> Account -> Access Tokens
$env:SMTP_USER = "you@gmail.com"              # the Gmail address that sends
$env:SMTP_PASS = "abcd efgh ijkl mnop"        # its 16-letter Gmail app password
node tools/auth-emails.js apply
Remove-Item Env:SMTP_PASS, Env:SUPABASE_ACCESS_TOKEN
```

- Leave out `SMTP_USER` and `SMTP_PASS` to update only the templates and subjects.
- The secrets are read from the environment only, sent only to `api.supabase.com`, and never printed.
- Prefer the dashboard? Authentication -> Emails: enter the Gmail settings (`smtp.gmail.com`, port `465`) under
  SMTP Settings, and paste each file from `supabase/templates/` into the matching template.
- After changing the layout in `supabase/functions/_shared/email-templates.ts`, run `node tools/auth-emails.js`
  to rebuild the files (a test fails if they are out of date), then `apply` again.
- Test it by signing up with an address that is not a member of your Supabase team.

## 4b. Telegram bot (add expenses by chatting)

Each person (you and your friends) signs in to the app and connects **their own**
Telegram chat; the bot then adds, reads and removes only that person's expenses.

In the chat: type `lunch 12.50`, `grab rm8.90 ewallet` or `7-eleven 5.50 card`. The
category is guessed from your own history first, then the built-in Malaysian merchant
list; the reply has **Undo** and **Category** buttons. Commands: `/today`, `/month`,
`/undo`, `/unlink`, `/help`. (Photos of receipts are not supported yet.)

**One-time setup**

1. In Telegram open **@BotFather** → `/newbot` → choose a name and a username ending in
   `bot` (for example `VinExpenses_bot`). Use a **new** bot, not the weather bot.
   BotFather gives you a token. Treat it like a password: never paste it into a chat,
   a commit or the website.
2. Store the secrets (PowerShell). The webhook secret is a random string only Telegram
   and your function know:

   ```powershell
   $wh = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   npx supabase secrets set TELEGRAM_BOT_TOKEN="<token from BotFather>" TELEGRAM_WEBHOOK_SECRET=$wh TELEGRAM_BOT_USERNAME=VinExpenses_bot
   ```
3. Run the latest `supabase-schema.sql` (adds the three Telegram tables), then deploy:

   ```powershell
   npx supabase functions deploy telegram-bot telegram-link
   ```

   `telegram-bot` must have **Enforce JWT verification OFF** (Telegram cannot send a
   login). `supabase/config.toml` already says so; confirm it under Edge Functions →
   telegram-bot → Details. (If it shows ON, redeploy with `--no-verify-jwt`.)
4. Tell Telegram where to send messages (this also sets the command menu). The token
   is read from the environment, never from the command line:

   ```powershell
   $env:TELEGRAM_BOT_TOKEN = "<token from BotFather>"
   $env:TELEGRAM_WEBHOOK_SECRET = $wh
   $env:SUPABASE_URL = "https://YOURREF.supabase.co"
   node tools/set-telegram-webhook.js
   ```
5. Push the site. In the app open **Account → Telegram → Connect Telegram → Open Telegram
   to finish → Start**. Friends do the same with their own accounts.

**Automatic category.** For every expense you type, the bot picks the category in this order:
(1) the built-in knowledge base (known Malaysian brands, everyday words such as `lunch`, `petrol`,
`toll`, and your own category names), (2) your own history (you filed the same place before),
(3) otherwise **Other**. The reply says which rule it used, and the **Category** button corrects
it; a correction is remembered for next time.

**Charts and reports.** Reports show the answer first and keep the detail one tap away.

| Report | What you get |
|---|---|
| `/month` (or 🗓 Month) | **Overview:** a donut picture and a short card: spending (with the change vs last month), income / net / saved, the top 5 categories with colour squares that match the slices, and the single most important thing (a blown budget, a risky pace, a big change). Four **tabs** sit under it: |
| &nbsp;&nbsp;🍩 Overview | The card above. |
| &nbsp;&nbsp;📅 Days | A picture of daily spending (busiest day in orange, today marked, days still to come faded), the busiest day, the daily average, weekend vs weekday, your 🔥 streak, and a **calendar heat-strip** (weekdays down the side, one column per week). |
| &nbsp;&nbsp;🎯 Budgets | A **progress-bar picture** (green under 80%, amber to 100%, red over) and, for each budget, used / limit and how much is left or over, worst first, plus the pace warning. |
| &nbsp;&nbsp;📈 Trend | A 6-month bar picture, an aligned table with the change versus the previous month, the average and the highest month. |
| `/week` | **Bars** for the week (biggest day in orange, today marked, days to come faded), a day-by-day table, last-week comparison, budgets that need attention, and a 📋 Details button. |
| `/today` | Today's total by category, plus your streak. |
| `/top` | Top categories and places in **aligned tables**. |
| **Buttons under every report** | `📅 Today · 📊 Week · 🗓 Month · 🏆 Top`; for the month also the tabs; `◀ Earlier / Later ▶` to page back (the tab and month are kept); `🔗 Open VinExpenses`. The report updates **in place**. |
| The Monday **weekly summary** | The same week chart, with the buttons continuing from last week. |

Charts are drawn by the bot itself (no chart service, nothing to pay, your numbers never leave your server). The pictures
contain no text: all names and amounts are in the caption, so Malay and Chinese work the same as English and colours are
never the only information. If a picture cannot be drawn or sent, you get that report as text instead (the tabs stay);
if an edit fails, the new view arrives as a new message; the report buttons are limited to 300 views a day per chat.
After updating, run `node tools/set-telegram-webhook.js` again to add `/week` to the command list.

**How it looks and feels.**

| What you see | Why |
|---|---|
| A **menu that is always at the bottom**: ➕ Add · 📊 Today · 🗓 Month · 🧾 Recent · ⚙️ Settings (in your language) | No commands to remember. `/menu` brings it back. |
| A quick 👌 **reaction on your own message** the moment the expense is saved | Instant "got it" without another message. |
| A **card**: amount first, then category, place, payment and "Today / Yesterday"; budget bars and the reason for the category tucked into a **collapsible quote**; budget warnings and duplicate warnings stay visible | The important part reads in one glance. |
| **Category chips** on every card (✓ the current one, then the ones you use most) | Fixing a category is one tap, not two. |
| **➕ Add** shows **🔁 Repeat last** and your usual expenses (same place and amount logged at least twice) | One tap for the things you buy every day. |
| Receipt photos use **one live message**: "Reading…" turns into the result | No pile of messages. |
| Small **pop-ups** ("Moved to Food ✓", "Undone ✓") and a "typing…" indicator | Feedback for every tap. |
| **⚙️ Settings**: language, weekly summary on/off, disconnect, and **🔗 Open VinExpenses** | Everything in one place (the open button needs the `SITE_URL` secret). |

If Telegram ever refuses the pretty formatting, the same message is sent as plain text, so nothing is lost. If a
nice-to-have (reaction, chips, favourites, menu) is unavailable, the expense is still saved and the card still appears.
After updating, run `node tools/set-telegram-webhook.js` again: it also sets the "/" command list in English, Malay
and Chinese (edit them in `tools/telegram-commands.js`).

**More things the bot does.**

| You do | The bot does |
|---|---|
| Send a **photo of a receipt** | Reads it (the same reader and daily scan allowance as the app), shows merchant / total / date / category with **Save · Edit amount · Cancel**. Nothing is saved until you press Save. If it cannot find a reliable total it asks you to type the amount. |
| `yesterday petrol 50`, `3/11 coffee 6`, `3 nov lunch 12`, `昨天 加油 50` | Saves it on that day (English, Malay and Chinese words). A date in the future, or more than about a year old, is refused. |
| `+3000 salary`, `income 500 ang pow` | Saves income. The **Undo** button removes it. |
| Any expense | Shows a **budget progress bar** for its category and overall (from your app budgets), a heads-up when you cross 80% and an alert when you go over, and warns about a **possible duplicate** (same amount, same place, same day) without blocking it. |
| `/recent` | Last 6 expenses; tap one to change the **amount**, **category** or **delete** it. |
| `/today` `/month` `/top` | Pretty reports with progress bars, trend arrows vs last month, savings rate, budgets and the top places. |
| `/language` | English, Bahasa Melayu or 中文 (first set from your Telegram language). |
| `/digest on` | An opt-in **weekly summary** every Monday morning (Malaysia time). `/digest off` stops it. |

Every extra has a fallback: if budgets, the duplicate check, the language column, the receipt reader or the
weekly summary is unavailable, the bot still saves what you typed and tells you plainly what is not available.

*To enable the new parts:* run the latest `supabase-schema.sql` again (adds language, weekly-summary and
pending-confirmation storage, and schedules the weekly job once the three Vault secrets from section 4 exist),
make sure `OCR_SPACE_API_KEY` is set (the same key the app uses), deploy the functions (the auto-deploy does this),
and run `node tools/set-telegram-webhook.js` once more to refresh the command menu. When you change
`smart-entry.js` or `receipt-parser.js`, run `node tools/sync-shared.js` so the bot's copy matches (a test fails if not).

**Auto-deploy the functions.** `.github/workflows/deploy-functions.yml` redeploys all Supabase
functions whenever code under `supabase/functions` changes on `main` (after the tests pass).
One-time: create an access token in Supabase (Account → Access Tokens) and add two repository
secrets in GitHub (Settings → Secrets and variables → Actions): `SUPABASE_ACCESS_TOKEN` and
`SUPABASE_PROJECT_REF` (the 20 letters before `.supabase.co`). It does not change database tables:
run `supabase-schema.sql` yourself when it changes. The Pages workflow still publishes the website.

If it does not answer: `node tools/set-telegram-webhook.js` prints Telegram's
`last error`, and Edge Functions → telegram-bot → Logs shows what the function saw.

## 4c. Telegram Mini App (the dashboard inside Telegram)

The bot has a **📱 Dashboard** button (and a `/app` command) that opens a full dashboard inside Telegram: the month at a glance
(donut chart), days (bars and a calendar heat map), budgets, a 6-month trend and a searchable history where you can add, edit
and delete expenses. It is part of this same website: the page lives in the `miniapp/` folder and is published to GitHub Pages
with everything else, at `https://<you>.github.io/<repo>/miniapp/`.

**Set up (nothing new to create):**
1. Make sure the bot secrets from section 4b exist, including `SITE_URL` (your GitHub Pages address, `https` only) and `ALLOWED_ORIGINS`.
2. Push. The deploy publishes `miniapp/`, and the functions workflow publishes the `miniapp-api` function.
3. Refresh the bot's command list once: `node tools/set-telegram-webhook.js` (adds `/app`; same steps as section 4b).
4. In Telegram send `/app` and tap **Dashboard**. Optional: in @BotFather choose *Bot Settings → Menu Button* and set the same address, so the dashboard is one tap away at any time.

**How it knows who you are:** Telegram hands the page a signed "launch pass". The function `miniapp-api` checks the signature with the
bot token (only the bot and Telegram can make a valid one), checks it is recent (6 hours by default, `MINIAPP_MAX_AGE_SECONDS`) and
finds the account linked to that Telegram chat. There is no password and no user id sent by the page. A chat that is not connected
gets a friendly "connect first" screen.

**Try the design in any browser, with made-up data:** open `miniapp/index.html?demo=1` (for example `http://localhost:8000/miniapp/index.html?demo=1`).
Nothing is read from or saved to any account in this mode.

Limits (all adjustable secrets): `MINIAPP_DAILY_LIMIT` (3000 requests/day/person) and `MINIAPP_WRITE_LIMIT` (300 changes/day/person).

## 4d. Accounts, codes, authenticator and admin (v4)

- **Sign-up and password reset** use a 6-digit emailed code (valid 5 minutes; 3 codes a day and 10 a month per address). Sign-in is password only, with "Remember me" for 30 days.
- **Wrong passwords**: 5 wrong tries on one device block that device for 3 hours; the admin can block or unblock an account by hand.
- **Authenticator (optional)**: turn it on in Account. Eight one-time recovery codes are shown once. Where it is on, the database also refuses password-only sessions.
- **Admin**: set `ADMIN_EMAIL`. The Admin screen lists accounts, last expense date, blocks, resets, report resends, feedback and a system check. It never reads expenses.
- **Deploy**: run the updated `supabase-schema.sql`, deploy `auth-gate`, `admin`, `feedback`, `report-resend` and `monthly-report-email`, then run `node tools/auth-emails.js apply`.
- **Supabase dashboard**: enable TOTP MFA, set email OTP length to 6 and expiry to 300 seconds.
- **Optional bot check**: create a Cloudflare Turnstile site; put the site key in the GitHub secret `TURNSTILE_SITE_KEY` and the secret key in the Supabase secret `TURNSTILE_SECRET_KEY`.

## 5. Using it on mobile

**A. Install as a PWA.** Once hosted (e.g. GitHub Pages), open the site on your
phone and use "Add to Home Screen" (iOS Safari: Share → Add to Home Screen;
Android Chrome: menu → Install app).

The service worker is *network-first* and revalidates app files with the server on
every load. Each deploy is stamped with its commit id (see `.github/workflows/deploy.yml`):
the CSS/JS URLs are versioned, the service-worker cache is renamed, and the id is shown in
**Account → Version**. An installed iPhone app resumes instead of reloading, so it checks for a
new version each time it returns to the foreground and shows a **Reload** prompt. If Account
shows `App x · Styles y` with different ids, close the app from the app switcher and reopen it.

**B. Wrap as a native app** with [Capacitor](https://capacitorjs.com/):

```bash
npm install @capacitor/core @capacitor/cli
npx cap init "Smart Expense Tracker" "com.yourname.expensetracker"
npx cap add ios
npx cap add android
npx cap sync
```

Point Capacitor's `webDir` at this folder.

## Using the modal in your own code

```js
showModal({
  type: 'success',       // 'success' | 'error' | 'warning' | 'info' | 'question'
  title: 'Saved!',
  message: 'Your expense has been recorded.',
  confirmText: 'OK',      // optional, defaults to 'OK'
  cancelText: null,       // set this to show a second (cancel) button
  danger: false,          // true = red confirm button, for destructive actions
  onConfirm: () => {},    // optional callback
  onCancel: () => {}      // optional callback
});

showToast('success', 'Saved');   // lightweight, auto-dismissing notice
```
