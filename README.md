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
| `supabase-schema.sql` | Tables + Row Level Security policies — run once in Supabase |
| `migration-add-budgets.sql` | Run once to enable Budgets & "safe to spend today" |
| `migration-add-merchants.sql` | Run once to add merchant names to expenses |
| `migration-add-recurring.sql` | Run once to enable Recurring expenses (also run the categories migration first) |
| `supabase/functions/receipt-ocr/` | Private OCR.space proxy used by receipt scanning |
| `migration-add-categories.sql` | Run once if your database already existed before the Utilities/Car/Health/Other categories |
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
  monthly report that can be saved as PDF.

- **Quick add** — a big **+** button (bottom tab bar on phones, sidebar button or the
  **N** key on desktop) opens one sheet with an Expense / Income switch, an
  amount-first field, category/payment/source chips and a back-datable date.
- **Dashboard** — spent this month with a change-vs-last-month chip and a
  "% of income used" bar, plus daily average, top category and largest expense.
  A category doughnut + ranked list (tap a category or slice to see its
  transactions) and a 6-month trend (tap a bar to jump to that month).
- **History** — grouped by day with a per-day total; filter by type, category and
  month, and search. Tap a row to edit; **Delete** lives in the editor.
- **Recurring** — add bills and subscriptions (electricity, Netflix, Apple…) with a
  frequency and due date; they post as normal expenses automatically on each due
  date, including any missed while the app was closed. Pause, edit or delete them;
  the dashboard shows what's due next.
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

1. **Run the SQL.** In Supabase: **SQL Editor → New query**, paste
   `supabase-schema.sql`, and run it. (Already set up before? Run just the
   `migration-add-*.sql` files you haven't run yet — categories, recurring, budgets.) This creates the `expenses` and
   `incomes` tables and locks each row to its owner (select, insert,
   update and delete are all covered — edit/delete in History rely on this).

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
spending patterns, budget forecasts, CSV export and monthly reports need no
additional API key.

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

For existing databases, also run `migration-add-merchants.sql` once in the
Supabase SQL Editor. Fresh databases get the merchant column from
`supabase-schema.sql`.

## 4. Using it on mobile

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
