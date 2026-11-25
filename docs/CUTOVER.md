# The single switch from the old site to the React app

The old site (plain JavaScript) is kept in `legacy/` and still deploys to GitHub Pages from `.github/workflows/deploy.yml`. Nothing has been switched. This is the order to do it in, and what to look at before deleting anything.

## Before the switch (nothing changes for users)

1. Deploy the React app to a **preview address** (`docs/DEPLOY-CLOUDFLARE.md`).
2. On that address, sign in with a **test account** and walk the list below on a phone and on a laptop. These are the things the automated tests could **not** run (they used local stand-ins):
   - Register with a real email: the code arrives, sign in, remember me.
   - Google sign-in (if you use it).
   - The authenticator (scan the QR with your phone, sign out, sign in with the code).
   - Add, edit, delete, undo; add one while offline and see it sync.
   - A recurring bill that is due; a budget; a fixed deposit and a loan with a reminder due soon.
   - Scan a **photo** receipt and a **PDF** receipt (the real reader service); import a real bank CSV you are comfortable with.
   - Account → Telegram: connect, then send the bot "lunch 12.50" and see it appear; open the **Mini App** from the bot.
   - Monthly report: turn on, confirm the email address from the email, use "Send again".
   - Admin screen (with the admin account): list, block and unblock a **test** account, messages, system checks.
   - Delete a **test** account.
3. Compare with the old site side by side for anything you use daily. Tell me what feels different or is missing; the known gaps are listed in `docs/VERIFICATION.md` (swipe gestures, saving deposits and loans while offline, "add this loan to recurring", the optional AI receipt helper, the nearby-place lookup).

## The switch

1. Point your domain (or the address you share) at the Cloudflare Pages project.
2. Update the allowed addresses in Supabase, Google, the Edge Function secrets and BotFather (step 2 of `docs/DEPLOY-CLOUDFLARE.md`).
3. Send the old GitHub Pages address to the new site. `.github/workflows/deploy.yml` now publishes a small redirect site instead of the old app (`redirect/`, built by `tools/build-redirect.js`): every old address opens the same page on Cloudflare, keeping the query and the hash (`/` and `index.html` open `/app`; `welcome.html` opens the front page). It also replaces the old service worker, which clears the old cached app on phones and laptops that still have it. The address is `https://vinexpenses.tkqvincent2.workers.dev`; set the repository variable `REDIRECT_TO` (GitHub → Settings → Secrets and variables → Actions → Variables) to change it, or to `off` to publish the old site again. Push to `main` (or run the workflow) to publish it. Sessions are not carried across: each person signs in again on the new address, and anyone who installed the old site as an app should install the new one.
4. Keep `legacy/` for **at least two weeks** after the switch.

## Removing the old site (only when you are sure)

You asked that the backup is removed only after a **double confirmation** ("remove legacy", then a second yes). Nothing depends on `legacy/` any more, so removing it is now only deleting the folder:

- The three shared calculation files are used from `supabase/functions/_shared/` (byte-for-byte the same as the old ones); the sync tool is gone and the functions workflow no longer watches `legacy/`.
- The backend tests load the `_shared/` copies. The parity tests that compared the app with the old CSV reader and Mini App helpers replay the old code's recorded answers (`tests/fixtures/golden/`, made with `GOLDEN_WRITE=1` while the folder existed), so they keep proving the rewrite changed no number.
- The tests of the old site's own pages, the CSP-pinning and vendor tools, and the old Mini App front end were removed; the app's equivalents are in `src/test/security.test.ts`, `tests/build-security.test.js` and `e2e/`.
- GitHub Pages only publishes the redirect to the app (`.github/workflows/deploy.yml`); there is no switch back to the old site.
