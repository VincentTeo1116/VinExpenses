# Technical Assessment: ManaDuit v5 (React + TypeScript)

Assessment date: 2026-11-24. Scope: this repository: the React app (`src/`), the Mini App and email-link pages built from it, the build and hosting rules (`vite.config.mts`, `scripts/`, `public/`), and how the app calls the Supabase back end. Method follows the earlier assessments (STRIDE, OWASP Top 10, privacy and data flow, PWA caching, performance, code quality, scorecard).

**What this is:** a code and configuration review plus the automated tests listed below, all run against local stand-ins (`scripts/fake-backend.mjs`) for Supabase, its functions, the receipt reader and Telegram. **What this is not:** a penetration test, a review of the Supabase functions (they were not rewritten; their existing tests were re-run), or a check of any real service. Items that need the real service are marked **Verify**.

## Evidence run for this assessment

| Check | Result |
|---|---|
| ESLint (including security rules: no `innerHTML`, `eval`, inline styles) and strict TypeScript | 0 problems |
| Unit and component tests | 136 pass |
| Browser tests (Chromium, 320 to 1920 px, light and dark, axe accessibility, security, every feature) | 256 pass |
| Backend, parity and build-security tests | 553 pass |
| `npm audit` for code that ships to users | 0 vulnerabilities |
| `npm audit` including build tooling | 4 moderate (`glob`/`minimatch` inside the PWA plugin; build time only, never shipped) |
| Dependency refresh in this pass | PDF reader upgraded 4.10 → 6.5 (it parses untrusted files); all PDF tests pass, including the scanned-PDF path |
| Published files scanned | no secret-shaped values, no source maps, no inline script or style, a policy on every page |
| Code scan for dangerous patterns | no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `document.write`; every `target="_blank"` has `noopener noreferrer`; the one `postMessage(…, '*')` carries only ready/expand/vibrate messages to Telegram |
| First download (gzip) | sign-in 198 KB, signed-in app 195 KB (budget 200 KB) |

## Scorecard

| Area | Score (1–5) | Posture |
|---|---|---|
| Security | 3.8 | Strong controls, each tested. Held back by what could only be tested against stand-ins, token lifetime, and money data stored on the device. |
| Privacy | 3.3 | Data minimised and deletable; third parties receive receipts and reports; no written retention rule; offline queue stays on the device after sign-out. |
| Performance | 4 | Byte budget enforced by a test; screens load in pieces; no chart library. |
| Scalability | 3.5 | Static front end on a CDN. Limits come from the free Supabase plan, not from this code. |
| Code quality | 4 | Strict TypeScript, one test per requirement, ports proven equal to the originals on random inputs, honest gap list. |
| **Overall** | **3.7** | Ready for a **preview deployment and the manual checks**; do not call it production-proven until the Verify items are done. |

## Part 1: Security

### STRIDE

| Threat | Where | State | Rating |
|---|---|---|---|
| Spoofing | Sign-in (`auth-gate`), Mini App (Telegram-signed launch data), admin | Password rules, 5-try device lockout, email-wide cap, identical message for wrong email or password, optional authenticator enforced by the database, admin role checked on every server call, Mini App forwards signed data and never a user id (tested) | Low |
| Spoofing | Session lifetime | An issued access token stays valid until it expires (about 1 hour on Supabase defaults) even if the account is disabled; disabling blocks refresh and sign-in | Medium. **Verify** the token lifetime in Supabase |
| Tampering | Records, schedules, deposits | Row-level security (existing policies); cross-user read, change, delete and forge attempts tested against the stand-in; claim-first posting so a bill or an interest income is never added twice (two-device tests) | Low |
| Tampering | Imports (CSV, receipts, PDFs) | CSV cells starting `= + - @` are protected on export and unprotected on import; sizes, row counts and types are limited; PDFs read with no form scripts and capped image size on a current reader | Low |
| Repudiation | Admin actions | Server writes an append-only audit log; the screen lists it | Low |
| Information disclosure | Browser storage | Session and the offline queue are in `localStorage`. Protected from script by the strict CSP and escaping, not by encryption; queued records stay after sign-out on purpose | Medium |
| Information disclosure | Admin | A static test and a browser test show the admin area never reads or receives money data (distinctive merchant and amount are never in any admin response) | Low |
| Information disclosure | Build output | No secrets, no source maps, only the public URL and public key in the bundle | Low |
| Denial of service | Functions | Server-side limits on codes, lockouts, OCR scans, admin actions, report sends and Mini App calls (existing code); client calls have time limits and retries only where safe | Low to Medium (unchanged server code) |
| Elevation of privilege | Admin and Mini App | Admin 403 from the server even if the screen is bypassed (tested); the Mini App is the only page that may be framed, and only by Telegram | Low |

### OWASP Top 10 (2021/2025 themes)

| Item | State |
|---|---|
| Broken access control | Row-level security and server-side admin checks; tested for cross-user and non-admin access. **Verify** on the real database |
| Cryptographic failures | TLS and HSTS; no custom crypto; no secrets in the client |
| Injection | React escapes all text; no HTML sinks; admin messages shown as plain text (tested with `<img onerror>`); no search text in database queries from the Mini App (server filters in code) |
| Insecure design | Fail-closed design (Turnstile, unknown link, unsigned launch); limits on every expensive path |
| Security misconfiguration | CSP `default-src 'none'`, no `unsafe-inline` or `unsafe-eval`, framing banned, HSTS, nosniff, referrer and permissions policies, COOP/CORP; only the app addresses exist as pages (no rewrite rules), so anything else is a real 404. Checked on the built files and a local host that behaves like Cloudflare. **Verify** on the live host |
| Vulnerable components | 0 known in shipped code; exact versions pinned; install scripts disabled; CI audit fails on high severity |
| Identification and authentication failures | See Spoofing above |
| Software and data integrity | Lockfile and exact versions; CI actions pinned to commits; the preview and production build use public values only |
| Logging and monitoring | Server audit log for admin actions; the browser logs nothing sensitive. No alerting is set up |
| SSRF / request forgery | No server code in this repo that fetches user-supplied addresses; the Telegram link is opened only if it matches a strict `t.me` pattern |

### PWA and caching

Only the app shell and static files are cached by the service worker. API and function responses are never cached (`runtimeCaching: []`). Sign-out removes the session; the offline queue is intentionally kept per person so no record is lost.

## Part 2: Privacy and data flow

| Data | Where | Who else receives it |
|---|---|---|
| Account, expenses, incomes, budgets, deposits, loans, preferences | Supabase (row-level security) | The hosting provider of the database |
| Receipt photos / scanned PDFs | Sent to the OCR service for reading; not stored by the app | The OCR provider |
| Receipts that are PDFs with text | Read on the device | Nobody |
| Reports and reminders | Telegram or email | Telegram / the mail provider |
| Sign-in protection | Cloudflare Turnstile (optional) | Cloudflare |
| Offline records | The person's browser, per account | Nobody |

Good: collection is minimal, no analytics or tracking is added, the account and all data can be deleted by the person (typed confirmation, server erase, tested), CSV export gives a full copy. Gaps: no written retention or backup rule, the third-party terms were not checked (**Verify**), and queued offline money records remain on a shared computer after sign-out.

## Part 3: Performance and scalability

Static front end; first download held at or under 200 KB by a test (sign-in 198 KB, app 195 KB); every screen, the PDF reader, the add sheet, the contact form and the other language texts load on demand. Scalability is bounded by the free Supabase plan (database size, function calls, emails), not by this code. Headroom under the byte budget is thin: new code on the sign-in or Home path must be lazy.

## Part 4: Code quality

Strict TypeScript with the React compiler lint rules and custom security rules; one test per requirement (86 requirements traced in `TRACEABILITY.md`); the parity tests prove the new code matches the original on thousands of random inputs; tests were repeatedly broken on purpose to prove they can fail. Weak spots: the stand-in is written by the same author as the app (it can share a misunderstanding of the real service), some end-to-end tests are long walk-throughs, and English reasons for category suggestions are not translated.

## Findings

| ID | Finding | Severity | Status |
|---|---|---|---|
| V1 | The real Supabase, Cloudflare, email, Telegram, Google, OCR and Turnstile were never run against | High (as a risk to the claim, not a known bug) | **Open: Verify.** Do `docs/CUTOVER.md` on a preview address |
| V2 | Access token stays valid until expiry after an account is disabled | Medium | **Open: Verify** token lifetime in Supabase (keep it at 1 hour or less) |
| V3 | Queued offline money records stay in browser storage after sign-out | Medium | Accepted by design; documented. Consider a "clear this device" button on shared computers |
| V4 | Session and queue are readable by any script that runs in the page | Medium | Mitigated by the CSP and escaping (tested); not encrypted |
| V5 | Project folder (with the git-ignored `.env`) lives inside OneDrive | Medium | **Open (yours):** move the folder out of OneDrive or exclude `.env`; rotate keys if the folder was ever shared |
| V6 | Preview deployments must not carry production secrets | Medium | Only public values are used by the front end; keep Edge Function secrets in Supabase only |
| V7 | Receipt images go to a third party | Low to Medium | Documented in the privacy page; **Verify** the provider's retention terms |
| V8 | No retention policy or alerting | Low | Open |
| V9 | PDF reader was two major versions behind | Medium | **Fixed in this pass** (4.10 → 6.5, tests pass) |
| V10 | 4 moderate advisories in build tooling | Low | Not shipped; update `vite-plugin-pwa` when a compatible release is available |
| V11 | Optional features not built (swipe, loan to recurring, AI receipt helper, nearby place, PU-05, offline saving of deposits, loans and imports) | n/a | Listed in `VERIFICATION.md` |

No finding is Critical. Nothing here is a remote code execution path or a practical cross-user read in the tested code.

## Roadmap before production

1. **Preview deployment** on Cloudflare Pages and the manual checklist in `docs/CUTOVER.md` (closes V1).
2. In Supabase: confirm token lifetime, email confirmation required, no public sign-up beyond the app's own flow, MFA setting, backups, region, redirect URLs (V2). Set `ALLOWED_ORIGINS`, `SITE_URL`, the Mini App address.
3. Move the project out of OneDrive or exclude `.env` (V5).
4. Check the OCR, Telegram and mail providers' retention terms and write a short retention note in the privacy page (V7, V8).
5. Optional: independent review or a pen test before real money data from many users.
6. After deployment: run `securityheaders.com` and the browser console check from `docs/DEPLOY-CLOUDFLARE.md`.

## Verdict

**Pass for a preview deployment.** Pass for production only after items 1 to 3 above are done, because the strongest claims (row-level security, the framing rule on the live host, token lifetime) have been proved only on stand-ins.
