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
* The tests run against in-memory stand-ins for Supabase and Gmail. They prove the logic; they cannot prove your
  project's settings, secrets or Google's behaviour. The administrator test button is that last check.
* A stolen, unlocked phone or a phished password is outside what code can fix: use strong unique passwords/MFA.

## Reporting a problem

Open a private message to the owner rather than a public issue, with steps to reproduce.
