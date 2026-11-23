# Security notes

No website can honestly be called "unhackable". The goal here is **defence in depth**: several independent
layers, so that one mistake or one stolen secret does not become a breach, plus tests that fail if a layer is
weakened. This file explains the layers, what **you** must still do, and the limits.

Run all checks: `npm test` (also runs before every deploy) and `node tools/vendor.js verify`.

## 1. The website (browser side)

| Layer | What it stops |
|---|---|
| Strict Content-Security-Policy (`<meta>` in `index.html`, `email-action.html`): scripts and styles only from this site, no inline code, no `eval`, `connect-src` limited to your Supabase project (pinned at deploy by `tools/pin-csp.js`) and the map service | Injected script (XSS) running or sending your data anywhere |
| Libraries are **self-hosted** in `vendor/` at pinned versions; `tools/vendor.js` records SHA-384 of every file and checks the registry's SHA-512 when downloading; CI fails if a file differs | A compromised CDN or package silently changing the code that runs |
| All dynamic text goes through `escapeHtml` / `safeIcon` / `safeColor`; CSV export neutralises spreadsheet formulas; the database also checks icon/colour formats | Stored XSS, CSV injection |
| Clickjacking guard (`frame-guard.js`, fails closed) | Your page being framed by another site |
| Service worker handles only this site and caches only good same-origin responses | Cache poisoning |
| PDF reader hardened (`isEvalSupported:false`, no XFA, size caps; pdf.js 4.10.38 is past CVE-2024-4367) | Malicious receipt PDFs |
| GitHub Actions pinned to commit hashes, minimal permissions, Dependabot | Supply-chain attacks on the build |

## 2. The database (Supabase)

* Row Level Security on every table: a signed-in user can only touch their own rows.
* Tables that only the server may use (`app_admins`, `usage_counters`, `receipt_scan_usage`) have RLS on and **no**
  grants for `anon`/`authenticated`. `SECURITY DEFINER` functions pin `search_path` and are executable by
  `service_role` only.
* `monthly_report_preferences`: signed-in users may write only `recipient_email` and `enabled`. The columns
  `verified_email`, `verified_at`, `sent_for_month` and `failed_for_month` can only be written by the server.

## 3. The edge functions

* Every browser-facing function: **allowed website** (`ALLOWED_ORIGINS`, empty = refuse everyone) → **signed-in
  user** (the public anon key alone is rejected) → **daily quota**. Counters fail *closed*.
* `monthly-report-email` can only be started by the scheduler (secret header, constant-time comparison, refuses
  an unset secret).
* `email-action` is public by necessity (people click it from their inbox). It is protected by **signed tokens**
  (HMAC-SHA-256, expiring, single purpose, tied to one account and one address) and never changes anything on a
  GET, because mail scanners open every link.

## 4. Email (Gmail SMTP)

* **Transport:** port 465, TLS from the first byte, certificate always verified (no way to switch it off in
  the code, and a test checks that). No plain-text fallback, no STARTTLS downgrade, other ports refused.
* **Injection:** every address, subject, name and header is checked for line breaks/NUL before anything is
  written; only 3 extra headers are allowed; the body is base64, and dot-stuffed, so text can never become SMTP
  commands. Tests try the classic `\r\nBcc:` and `RCPT TO` attacks.
* **No mailing strangers:** double opt-in. A report is sent only to an address whose owner clicked the link in a
  confirmation email, and only while it is still the address on the account. Confirmation emails are limited per
  user (3/day), per destination (2/day, hashed) and app-wide (`EMAIL_DAILY_CAP`).
* **Unsubscribe:** one click in every report, plus the standard `List-Unsubscribe` one-click header.
* **Protecting the Gmail account:** daily cap below Gmail's limit; the run stops at the first rejected login
  (repeated bad logins can lock an account); the app password exists only as a Supabase secret and is never
  logged or returned. Use a **dedicated** Gmail account.
* **Administrator:** one function, `admin-email-test`, that sends a test message to the administrator's own
  address only (10/day). The first administrator is the confirmed account matching `ADMIN_EMAIL`, registered
  once by the database itself; nobody can be added afterwards through the app.

## 4b. Telegram bot

* **The door:** `telegram-bot` is public (Telegram cannot log in), so it checks Telegram's secret header
  (`TELEGRAM_WEBHOOK_SECRET`, 24+ characters, constant-time comparison) before reading anything, and refuses to run
  at all if the secret or token is missing.
* **Linking:** only a signed-in user can create a code: 10 unambiguous characters, valid 10 minutes, single use
  (deleting the row *is* the check), stored only as a hash, one live code per account, and a limit on wrong guesses
  per chat. A chat can belong to one account and an account to one chat; nobody can take over a linked chat.
* **Isolation between friends:** the bot reaches the database with the server key, which ignores row-level
  security, so every query is scoped to the linked user id, and a test fails if one is not. Button presses carry an
  expense id, but the delete/update still filters by the owner, so a guessed id from another chat does nothing.
* **Abuse limits:** private chats only; 300 messages and 100 saved expenses per chat per day; amounts 0.01 to
  1,000,000; messages capped at 500 characters; control and invisible characters stripped; everything shown back is
  HTML-escaped; repeated deliveries of the same Telegram update are ignored.
* **Secrets:** the bot token exists only as a Supabase secret and in your shell while registering the webhook. It is
  never logged (Telegram's API address contains it, so errors are logged without the address).
* **Privacy:** bot chats are not end-to-end encrypted, so the amounts and merchants you type or receive are stored
  by Telegram. Summaries are only sent when the user asks; nothing is pushed.

### Telegram bot, receipts and weekly summary

* **Receipt photos:** only real images are accepted (the file's own bytes decide, not its name), at most 1 MB; each
  scan is counted against the same daily allowance as the app *before* the paid OCR call; nothing is saved until the
  person presses Save, and the image and its text are never logged or stored.
* **Pending questions** ("send the new amount", a receipt waiting for Save) live in a server-only table, per chat,
  expire in 15 minutes, and can only be answered from that chat.
* **Weekly summary:** `telegram-digest` is scheduler-only (secret header, constant-time comparison), claims each person
  before sending so runs never double-send, switches off anyone who blocked the bot, and sends only to people who opted in.
* **Fallbacks are part of the safety design:** every optional feature fails to "do the main job and say what is
  unavailable", never to "save something wrong" or "stop working".

* **Charts:** drawn inside the function (`_shared/tg-chart.ts`: no network access, no libraries, a test checks both), so
  nobody's spending numbers are sent to a chart service. Every report query is scoped to the linked person (a test fails
  if one is not), navigation buttons carry only a view letter and a bounded number, and report views are limited per chat.

## 4b-2. Telegram Mini App

- **Identity** comes only from Telegram's signed launch data (`initData`). `miniapp-api` recomputes the HMAC-SHA256 signature with the bot token,
  rejects anything unsigned, tampered, duplicated, malformed, in the future, or older than 6 hours (`MINIAPP_MAX_AGE_SECONDS`), then looks up the linked
  account by the verified Telegram id. The page cannot name a user: no request field is ever read as a user id.
- The function runs with the service key (it has to read and write for the person), so **every query carries `user_id=eq.<verified user>`**, and updates/deletes
  require ownership. Tests cover cross-user access. It is public to the internet (`verify_jwt = false`, like the bot) and protected by the signature,
  daily request and write limits that fail closed, a 20 KB body cap, strict value checks, and CORS limited to `ALLOWED_ORIGINS`.
- **The page** has a strict Content-Security-Policy (own scripts only, no inline code or styles, connects only to your Supabase project once deployed).
  It does not load Telegram's script: it speaks the small protocol itself, so no third-party code runs next to your data. All text from the server or a person
  is HTML-escaped; colours are validated before use.
- **Not framed-protected on purpose:** Telegram Web shows Mini Apps in a frame, so the page cannot refuse framing as the main site does. A framed copy has no
  launch data, so it is inert, and the bridge also refuses frames from anything but Telegram's web clients where the browser reports it.
- **Honest limit:** a signed launch pass can be replayed by whoever holds it until it expires (6 hours). It only reaches that one person's own data, and it is only
  ever delivered to that person inside Telegram.

## 4b-3. Plan tab: deposits, loans and reminders

* `fixed_deposits` and `loans`: Row Level Security, one policy each (`auth.uid() = user_id` for reading and
  writing), value ranges checked by the database too, rows removed with the account.
* **At most 200 deposits and 200 loans per account** (a database trigger). The hourly reminder run reads every open
  item, so without a limit one account could slow it down for everybody.
* `reminder_log` and `telegram_links.reminders_blocked_at` are server-only (no grants for `anon`/`authenticated`).
  The log's unique key is what stops a reminder being sent twice.
* `plan-reminders` can only be started by the scheduler (secret header, constant-time comparison, refuses an unset
  secret). It filters by user id itself, escapes names before they go into a Telegram message, never logs names,
  amounts or chat ids, and never changes a deposit or a loan. "Hide amounts in Telegram reminders" (Account) keeps
  figures out of the chat.
* In the browser, saved names reach the page only through `escapeHtml` or `textContent` (a test fails otherwise).
  `finance-calc.js` has no network, storage or page access.
* The on-device copy of your deposits and loans is removed when you log out; deleting the account also removes
  unsent saves and the reminder snooze.
* The calculators are estimates. They never move money and store no bank logins or account numbers.

## 4b-4. Before wrapping this as an Android / iPhone app

Not done in this repository; these are the points that change when the site runs inside an app shell:

- [ ] **Ship the web files inside the app** (as now: no code loaded from other websites). Do not point the app at
      a remote URL that could change what runs.
- [ ] **Keep the Content-Security-Policy.** The app's own scheme (for example `capacitor://localhost` or
      `https://localhost`) must be added to `ALLOWED_ORIGINS`, or every function will refuse the app.
- [ ] **Sign-in links**: add the app's deep link to Supabase's Redirect URL allow-list, use PKCE, and open Google
      sign-in in the system browser, not an embedded web view (Google blocks those).
- [ ] **Session storage**: the login token is kept in web storage today. In an app, move it to the platform's
      secure storage (Keychain / Keystore) and consider a biometric lock for opening the app.
- [ ] **Store rules**: Sign in with Apple is required next to Google sign-in; in-app account deletion already
      exists; write a privacy policy that names Supabase, OCR.space, OpenStreetMap, Telegram and (if enabled)
      Google AI; declare camera and location use with clear reasons.
- [ ] **Updates**: an app is not updated by a push to GitHub. Decide how users get security fixes (store release
      or a signed live-update channel) before the first release.
- [ ] **Backups**: exclude web storage from device/cloud backups, or the cached data leaves the phone.
- [ ] Have someone other than the author test the built app (a penetration test) before it handles real users.

## 4b-5. Accounts, lockout, authenticator and admin (v4)

- All sign-up, sign-in and reset go through the `auth-gate` function, which counts wrong passwords per device and per email, limits codes, and gives generic errors. A direct call to Supabase's own token endpoint bypasses the counting on the Free plan; Turnstile and Supabase's built-in rate limits are the mitigation.
- The authenticator is enforced in the database (a restrictive policy, aal2) and in `requireUser`. "Remember me" keeps the aal2 session for the remembered period.
- The admin function checks the caller first, rate-limits, logs every action to an append-only table, and never selects expense or income rows. A password reset is emailed as a code by our own mail; the admin never sees it.
- Known limit: the strong-password rule for Google sign-in users is checked in the browser only.

## 4c. Auto-deploy of the functions

* The workflow runs only on pushes to `main` and manually, **never for pull requests**, so nobody can run code with
  your Supabase token by opening one. Tests run first; the actions and the Supabase CLI version are pinned.
* The access token can manage your whole Supabase account. Store it only as a GitHub secret, protect `main`
  (require a pull request and passing checks) so only reviewed code reaches this workflow, and revoke the token in
  Supabase if it ever leaks.

## 5. What only you can do (checklist)

- [ ] Set the secrets listed in README section 4 (`ALLOWED_ORIGINS` is **required**), run `supabase-schema.sql`,
      `npx supabase functions deploy`, push the site.
- [ ] Press **Send test email to me** as the administrator and confirm it arrives.
- [ ] Supabase → Authentication: turn **Confirm email** on; set the **Site URL** and a short **Redirect URL
      allow-list** (your site only); raise the password minimum; enable **CAPTCHA** (Cloudflare Turnstile or
      hCaptcha) and rate limits; consider MFA for your own account.
- [ ] Supabase Auth also sends sign-up/reset emails. The built-in sender only delivers to team members; under
      Authentication → SMTP Settings enter `smtp.gmail.com`, port `465`, the same Gmail address and app password.
- [ ] Create the Telegram bot token in BotFather yourself and never paste it into a chat; if it leaks, `/revoke` it in BotFather and set the new one.
- [ ] Rotate anything that was ever pasted into a chat or committed: the Telegram bot token and WAQI key from the
      weather-bot project, and delete its `secrets.json`. Revoke and re-create the Gmail app password if it was
      ever shared.
- [ ] GitHub: 2FA on, secret scanning + push protection on, protect the `main` branch (require a pull request
      and the passing test check).
- [ ] Never commit `.env`. The anon key in `config.js` is public by design; the **service role key must never**
      appear in the website or in GitHub.

## 6. Honest limits

* **GitHub Pages cannot send HTTP security headers** (HSTS, `frame-ancestors`, `X-Content-Type-Options`). The
  `<meta>` CSP and the frame guard cover most of this, but a host that sends real headers is stronger. Putting the
  site behind Cloudflare (free) with an HSTS/headers rule is the next upgrade.
* Gmail is a consumer service: ~500 mails/day, "From" is always the Gmail account, and Google may throttle bulk
  mail. For large audiences move to a domain-based sender (the mailer is one file, `_shared/smtp.ts`).
* The row limit and the other database rules for the Plan tab are checked for syntax and by reading; they have
  not been run against a live project by the test suite.
* The tests run against in-memory stand-ins for Supabase and Gmail. They prove the logic; they cannot prove your
  project's settings, secrets or Google's behaviour. The administrator test button is that last check.
* A stolen, unlocked phone or a phished password is outside what code can fix: use strong unique passwords/MFA.

## Reporting a problem

Open a private message to the owner rather than a public issue, with steps to reproduce.
