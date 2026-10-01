# Smart Expense Tracker

A mobile-first expense & income tracker with real Supabase-backed auth
(email/password with a confirmation **link**, or Google) and a per-user
dashboard. Plain HTML/CSS/JS — no build step.

## Files

| File | Purpose |
|---|---|
| `index.html` | App markup — auth, setup, dashboard, expense, income, history, modals |
| `style.css` | Responsive styling (phone → tablet → desktop) |
| `app.js` | All logic: Supabase auth, data fetch/save/edit/delete, charts, navigation |
| `supabase-schema.sql` | Tables + Row Level Security policies — run once in Supabase |
| `manifest.json`, `sw.js`, `icons/` | Makes the site installable as an app (PWA) |
| `icon.png` | Browser tab favicon |

## Features

- **Dashboard** — month selector, total spent / income / balance (animated),
  per-category share bars, pie chart, 6-month bar chart and recent activity.
  Tap a category tile or pie slice to jump to its transactions; tap a bar to
  jump to that month.
- **Add expense / income** — chip selectors for category, payment and income
  source, plus a date field so you can back-date entries.
- **History** — filter by type, category, month and free-text search; tap a
  row (or the pen) to edit, or the bin to delete.
- **Auth** — email + password with verification link, resend link, password
  strength meter, Google sign-in (new Google users finish a short profile
  setup step with a username and password).
- **Feedback** — toasts for quick confirmations; a single `showModal()` for
  errors and confirmations (no browser `alert()`), closable with Esc.
- **PWA** — installable, works offline for the UI (data needs a connection).

## 1. One-time Supabase setup

Your Supabase project URL and anon key are already wired into `app.js`.
The anon key is *designed* to be public in client-side code — security
comes from Row Level Security, not from hiding the key.

1. **Run the schema.** In Supabase: **SQL Editor → New query**, paste
   `supabase-schema.sql`, and run it. This creates the `expenses` and
   `incomes` tables and locks each row to its owner (select, insert,
   update and delete are all covered — edit/delete in History rely on this).

2. **Make sure email confirmation is on.** **Authentication → Providers →
   Email → Confirm email**. The app uses Supabase's default confirmation
   **link** (not an OTP). After registering, the person clicks the link in
   their inbox, lands on the **login** screen with an "Email verified" message
   and signs in with their password. A "Resend it" link covers lost emails.

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
python -m http.server 8000
# open http://localhost:8000
```

(Open it through a server, not by double-clicking the file — the service
worker and Supabase redirects need `http://`.)

## 3. Using it on mobile

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
