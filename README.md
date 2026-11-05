# Smart Expense Tracker

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
| `tools/make-fixture.js` | Turns a saved scan-details file into a test fixture (`npm run fixture`) |
| `tests/` | Automated tests (`npm test`) and anonymised receipt fixtures |
| `supabase/functions/receipt-ocr/` | Private OCR.space proxy used by receipt scanning (signed-in users only, daily limit) |
| `supabase/functions/receipt-ai/` | Optional AI helper for unclear receipts. Off until you add a key |
| `supabase/functions/_shared/` | Login check, daily limits and CORS shared by the receipt functions |
| `supabase/functions/monthly-report-email/` | Scheduled monthly spending report sender |
| `manifest.json`, `sw.js`, `icons/` | Makes the site installable as an app (PWA) |
| `icon.png` | Browser tab favicon |

## Features

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
