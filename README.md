# Smart Expense Tracker

A mobile-first expense & income tracker with real Supabase-backed
auth (email/password + email OTP verification, or Google) and a
per-user dashboard.

## Files

| File | Purpose |
|---|---|
| `index.html` | App markup — auth, dashboard, expense form, income form |
| `style.css` | Responsive styling (mobile-first, scales up for tablet/desktop) |
| `app.js` | All logic: Supabase auth, data fetch/save, navigation |
| `supabase-schema.sql` | Tables + Row Level Security policies — run once in Supabase |
| `manifest.json`, `sw.js`, `icons/` | Makes the site installable as an app (PWA) |

## 1. One-time Supabase setup

Your Supabase project URL and anon key are already wired into
`app.js`. The anon key is *designed* to be public in client-side
code — security comes from Row Level Security, not from hiding the
key.

1. **Run the schema.** In your Supabase project: **SQL Editor → New
   query**, paste the contents of `supabase-schema.sql`, and run it.
   This creates the `expenses` and `incomes` tables and locks each
   row to its owner.

2. **Make sure email confirmation is on.** Go to **Authentication →
   Providers → Email** and confirm **Confirm email** is enabled. No
   template changes are needed — the app uses Supabase's default
   confirmation **link** (not an OTP code). Registering shows a modal
   telling the person to check their inbox; clicking the link in the
   email brings them back to the app on the **login** screen with a
   "Email verified ✅" message, ready to sign in with their password.

3. **Enable Google sign-in (optional).**
   - In [Google Cloud Console](https://console.cloud.google.com/),
     create an OAuth 2.0 Client ID (Web application).
   - Add `https://<your-project-ref>.supabase.co/auth/v1/callback`
     as an authorized redirect URI.
   - In Supabase: **Authentication → Providers → Google**, paste the
     Client ID and Secret, and save.
   - Add your deployed site URL (and `http://localhost:...` for local
     testing) under **Authentication → URL Configuration → Redirect
     URLs**.

That's it — registration now does: user fills the form → taps **Send
OTP** → Supabase emails a real 6-digit code → user enters it and taps
**Verify & Create Account** → account is confirmed and they're
signed in.

## 2. Run it locally

No build step — it's plain HTML/CSS/JS. Easiest way to test with
working `fetch`/service worker behavior:

```bash
cd smart-expense-tracker
python3 -m http.server 8000
# open http://localhost:8000
```

## 3. Push to GitHub

```bash
cd smart-expense-tracker
git init
git add .
git commit -m "Smart expense tracker with Supabase auth"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

(Create the empty repo on GitHub first via **New repository**, then
run the commands above from this folder.)

### Free hosting straight from GitHub

Once it's pushed, you can host it for free with **GitHub Pages**:
**Repo → Settings → Pages → Deploy from branch → main → / (root)**.
You'll get a URL like `https://<username>.github.io/<repo>/` — add
that same URL to Supabase's **Redirect URLs** (step 1.3 above) so
Google login works there too.

## 4. Using it on mobile

The layout is already responsive (phone/tablet/desktop breakpoints
are in `style.css`). Two ways to get an "app" experience:

**A. Install as a PWA (no app store, works today)**
Once hosted (e.g. GitHub Pages), open the site on your phone and use
"Add to Home Screen" (iOS Safari: Share → Add to Home Screen; Android
Chrome: menu → Install app). It'll launch full-screen with its own
icon, using the `manifest.json` and `sw.js` already included.

**B. Wrap it as a real native app (App Store / Play Store)**
If you eventually want a store listing, wrap this same code with
[Capacitor](https://capacitorjs.com/):

```bash
npm install @capacitor/core @capacitor/cli
npx cap init "Smart Expense Tracker" "com.yourname.expensetracker"
npx cap add ios
npx cap add android
npx cap sync
```

Point Capacitor's `webDir` at this folder — no rewrite needed, since
it's already plain HTML/CSS/JS.

## Notes on this revision

- **No more OTP typing.** Registration now uses Supabase's standard
  email-confirmation **link**. Tap "Create Account" → a modal
  confirms the email was sent → tap the link in the inbox → you land
  back on the app's **login** screen with a "verified" message → sign
  in with your password. There's also a "Resend it" link if the email
  doesn't arrive.
- **No more `alert()` popups.** Every notice (validation errors,
  success messages, "log out?" confirmation, etc.) now goes through
  a single reusable `showModal({...})` function in `app.js`, styled
  to match the app rather than the browser's native alert box.
- Auth is real Supabase Auth throughout: passwords are hashed
  server-side, and expenses/incomes are read/written straight from
  Postgres, scoped to the logged-in user by Row Level Security.
- "Total spent this month" and each category total filter to the
  current calendar month.
- Redesigned inputs with left-aligned icons, a password show/hide
  toggle, a logout confirmation modal, loading spinners on buttons,
  and PWA files so the app installs to a phone home screen.

### Using the modal in your own code

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
```
