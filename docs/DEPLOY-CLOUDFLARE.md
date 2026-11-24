# Putting the React app on Cloudflare Pages (free plan)

Nothing here has been done for you: it needs your Cloudflare and GitHub accounts. It takes about 15 minutes. Do it as a **preview first**; the old site keeps running until you decide to switch (see `docs/CUTOVER.md`).

## 1. Create the project

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → choose this repository.
2. Build settings:
   - Framework preset: **None**
   - Build command: `npm ci && npm run build`
   - Build output directory: `dist`
   - Root directory: (leave empty)
   - Environment variable `NODE_VERSION` = `24`
3. Environment variables (Production **and** Preview). These are **public** values (they are sent to the browser anyway):
   - `VITE_SUPABASE_URL` = your project address (`https://xxxx.supabase.co`)
   - `VITE_SUPABASE_ANON_KEY` = the public "anon" key
   - `VITE_TURNSTILE_SITE_KEY` = optional, the Turnstile **site** key
   - Never add the service-role key, the Telegram token, the OCR key or any password here.
4. Save and deploy. You get a `https://<project>.pages.dev` address.

## 2. Tell the back end about the new address

In Supabase (and the Edge Function secrets) the allowed website list must include the new address, or sign-in and every function call will be refused:

- Authentication → URL configuration: add `https://<project>.pages.dev` as the Site URL / a Redirect URL (Google sign-in comes back here).
- Edge Function secrets: add the address to `ALLOWED_ORIGINS`, set `SITE_URL` to it (emails link to `/email-action.html`), and set the Mini App address (`MINIAPP_URL`) to `https://<project>.pages.dev/miniapp/` if you use it.
- Telegram bot (BotFather): the Mini App button should point to that same `/miniapp/` address.
- Google Cloud (OAuth client): add the new address to the authorised origins.

## 3. What the build gives Cloudflare

`dist/` contains the app, `miniapp/`, `email-action.html`, the public pages, and two plain files Cloudflare reads:

- `_headers`: the Content-Security-Policy, framing ban, HSTS, cache rules, and the **one exception**: `/miniapp/*` may be framed, by Telegram's web apps only.
- `_redirects`: the exact addresses of the app (`/app`, `/app/history`, … `/auth`, `/auth/setup`, `/app/admin`, `/app/report`). Any other address gets the real **404 page with a 404 status**. A test keeps this list and `src/app/paths.ts` identical.

## 4. Check it yourself (10 minutes)

- Open `/` (welcome page), `/auth`, then register or sign in. Open the browser's developer tools → Console: there should be **no red errors** and no "Content Security Policy" messages.
- Type a made-up address such as `/nothing-here`: you should see the friendly 404 page (and the tab should say 404 in the Network panel).
- On a phone: add to home screen, open it, turn on airplane mode, add an expense, turn it off: it should show "not synced" and then sync.
- Open `/miniapp/?demo=1`: the sample preview.
- Check `https://securityheaders.com` for your address (expect an A).

## 5. Later: your own domain

Cloudflare Pages → Custom domains. When the domain changes, repeat step 2 with the new address.

## Limits you should know about

- Free plan: 500 builds a month, unlimited bandwidth for static files. Nothing here uses Cloudflare Workers or paid features.
- Cloudflare Web Analytics and any other tracking are **not** added (the privacy policy says no tracking).
