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
| `supabase/functions/receipt-ocr/` | Private OCR.space proxy used by receipt scanning |
| `supabase/functions/monthly-report-email/` | Scheduled monthly spending report sender |
| `manifest.json`, `sw.js`, `icons/` | Makes the site installable as an app (PWA) |
| `icon.png` | Browser tab favicon |

## Features

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
  monthly report that can be saved as PDF. Users can opt in to a monthly email,
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
- **Recurring** — schedule bills, subscriptions, salary, and other regular income. Due entries post to History the next time you open the app on or after the due date; missed dates are back-filled. Pause, edit, or delete schedules.
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

Receipt scanning is optional. Nearby-place lookup, merchant suggestions,
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

Keep the OCR key in Supabase Edge Function secrets. Do not put it in `.env`,
`config.js`, or browser JavaScript. The function requires a signed-in user and
does not log or save receipt images or extracted text.
Nearby lookup uses the OpenStreetMap public reverse-geocoding endpoint by
default, through the `nearby-place` function. It requires no API key. The app
only requests it on a button tap, caches results for the current browser session,
and shows the required attribution. To switch to a compatible provider, set the
`PLACE_REVERSE_URL` Edge Function secret to its reverse endpoint.

The merchant column and index are included in `supabase-schema.sql` for fresh
and existing databases.

## 4. Enable monthly report emails

Monthly email is opt-in per user. Each user opens **Account**, enters the
recipient address, turns on **Monthly report email**, and saves. Turning the
switch off stops future sends. The email contains monthly income, expenses,
net, record counts, and spending by category; it does not include individual
transactions or receipt images.

1. The monthly report preference table is included in `supabase-schema.sql`.
2. Create a [Resend](https://resend.com/) account, verify a sender domain, and
   choose a sender such as `VinExpenses <reports@yourdomain.com>`. Resend's
   current free tier lists 3,000 emails per month and 100 per day; sending from
   a custom domain requires verifying that domain with Resend.
3. Generate a long random value to use as the scheduler secret. Store these
   three values as Supabase Edge Function secrets (Dashboard → Edge Functions →
   Secrets, or CLI): `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and
   `MONTHLY_REPORT_CRON_SECRET`. The `SUPABASE_SERVICE_ROLE_KEY` and
   `SUPABASE_URL` are provided by the Supabase Edge Function environment.
4. Deploy the function:

   ```bash
   npx supabase functions deploy monthly-report-email
   ```

5. In Supabase **Vault**, store three named secrets: `project_url` set to
   `https://YOUR_PROJECT_REF.supabase.co`, `publishable_key` set to your
   Supabase anon/publishable key, and `monthly_report_cron_secret` set to the
   exact same value as the Edge Function secret.
6. Run `supabase-schema.sql` again in the SQL Editor. Once the Vault secrets
   exist, it installs the scheduler. The job checks hourly; the sender only sends on the first day in Kuala Lumpur,
   and skips any user already sent that month's report. Hourly checks allow
   retries during that day if the email provider is temporarily unavailable.

Use `cron.job_run_details` in the SQL Editor to inspect scheduled job runs.
Keep the Resend API key and scheduler secret out of browser `.env`, `config.js`,
and GitHub Pages secrets. They belong only in Supabase server-side secrets.

## 5. Using it on mobile

**A. Install as a PWA.** Once hosted (e.g. GitHub Pages), open the site on your
phone and use "Add to Home Screen" (iOS Safari: Share → Add to Home Screen;
Android Chrome: menu → Install app).

The service worker is *network-first*, so deployed changes show up on the next
load. If you ever need to force every device to drop its cache, bump
`CACHE_NAME` in `sw.js`.

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
