# Assumptions

Made while building Phase 0. Correct any that are wrong.

1. The React app lives at the repository root and the previous site was moved to `legacy/` (your instruction). It still deploys to GitHub Pages from there until the single switch.
2. Chinese means Simplified Chinese (`zh-Hans`).
3. The first deploy target for React is Cloudflare Pages at `*.pages.dev`, built from the repository root with `npm run build`. The project name is not chosen yet.
4. The Telegram Mini App will be a second Vite entry in this codebase (D-14), built in Phase 6.
5. `*.pages.dev` is served over HTTPS, so `Strict-Transport-Security` in `_headers` is safe to send.
6. `Permissions-Policy` allows the camera and location for this site only, for receipt scanning and nearby places later; microphone and payment are off.
7. Test settings (`VITE_SUPABASE_URL=http://127.0.0.1:54321`, a fake key) are used only by the end-to-end build. No real project or key is used in tests.
8. Initial JavaScript is about 178 KB gzip (budget 200 KB). Vendor splitting and route-level lazy loading will be added as screens arrive.
