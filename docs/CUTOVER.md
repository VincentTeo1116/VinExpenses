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

You asked that the backup is removed only after a **double confirmation**. When you are ready, tell me "remove legacy" and I will first list what would be deleted and ask you to confirm once more. Things that still read from `legacy/` and must change first:

- `tools/sync-shared.js` copies **`legacy/finance-calc.js`**, **`legacy/smart-entry.js`** and **`legacy/receipt-parser.js`** into `supabase/functions/_shared/`, which the reminder, report and bot functions use (and `.github/workflows/deploy-functions.yml` redeploys when those three change). Removing the folder means making the copies in `_shared/` the real files (delete the sync step) and updating that workflow. The TypeScript versions in `src/` are tested to give the same answers.
- The tests in `tests/*.test.js` that load `../legacy/...` and the parity tests that compare the new code with the old files (`tests/finance-parity.test.js`, `tests/ports-parity.test.js`). They are the proof that the rewrite did not change any number; keep them until the old files are gone, then keep the new tests that remain.
