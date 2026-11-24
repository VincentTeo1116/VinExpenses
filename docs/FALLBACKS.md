# Fallbacks (what happens when something fails)

Rule: a failure never makes the app more permissive or more reassuring. A failed check becomes more cautious.

| Dependency / risk | Behaviour | Built | Tested |
|---|---|---|---|
| Missing or invalid build settings | "The app is not set up yet" screen; the app never starts with a wrong address (http only allowed on this computer) | `ConfigError`, `readEnv` | `env.test.ts` |
| Supabase unreachable / slow | Calls time out (15 s default), safe calls retry with back-off, then a plain message; nothing hangs | `callFunction` | `api.test.ts` |
| Server refuses (401/403/429/4xx) | Mapped to a code; never retried; the server's message is shown | `ApiError` | `api.test.ts` |
| Reply in an unexpected shape or not JSON | Refused as `invalid_reply`, no crash | schema check | `api.test.ts` |
| Browser offline | Banner explains; calls fail fast with "offline" (no hang) | `OfflineBanner`, `callFunction` | `components.test.tsx`, `fallback.spec.ts` |
| Session store corrupt or blocked | Treated as signed out and sent to sign-in; never a stuck spinner | `AuthProvider` | `routing.test.tsx`, `fallback.spec.ts` |
| Not signed in | Redirect to `/auth`; no app content is drawn | `ProtectedRoute` | `routing.test.tsx`, `fallback.spec.ts` |
| A screen crashes | Calm message with *Try again*; moving to another screen recovers; no technical detail shown, nothing sent anywhere | `ErrorBoundary` | `components.test.tsx` |
| `localStorage` unavailable | English still works; language switch applies for the visit | `I18nProvider` | `fallback.spec.ts` |
| Tampered saved language | Ignored, English used | `isLang` | `i18n.test.tsx`, `notfound.spec.ts` |
| Missing translation key | Falls back to English, then to the key | `translate` | `i18n.test.tsx` |
| Unknown address | Real HTTP 404 with the custom page; back to the previous same-site page or the app | `404.html/js`, `_redirects` | `notfound.spec.ts` |
| Unknown address inside the app (client side) | React 404 screen | `NotFound` | `routing.test.tsx` |
| Page framed by another site | Headers forbid it; a script guard shows only a notice | `_headers`, `main.tsx` | `security.spec.ts` |
| Service worker fails to register | App works online without offline support | `pwa.ts` | by design (try/catch) |
| Old emailed sign-in link | Never read from the address bar | `detectSessionInUrl: false` | `security.spec.ts` |
| Dialog stack | Newest dialog on top, older ones inert, focus returns to the opener | `sheetStack`, `Sheet` | `Sheet.test.tsx`, `a11y.spec.ts` |

Not yet built (later phases): offline write queue, report delivery fallback, OCR fallback, chart-to-table fallback, "database not updated" banner. These are tracked in `docs/REQUIREMENTS-react.md`.

---

## Added in phases 2 to 6

| Dependency or risky step | When it fails | What the person sees and what is kept |
|---|---|---|
| Network while adding an expense or income | offline or the request fails | Saved on the device, shown "Not synced", sent when the connection returns; can be deleted while waiting (`offlineQueue.ts`) |
| Loading the money data | the database is unreachable or not up to date | A warning with "Try again" on Home, History and Plan; the screens still open |
| Recurring bills posting | two devices open at once, or the second step fails | The date is claimed first so a bill is never posted twice; if the posting fails the date is put back |
| Saving a deposit or loan | offline | The calculator keeps working; saving says it needs a connection (not queued) |
| Recording a deposit's interest | the second device already did it, or adding the income fails | "Already recorded" or the flag is put back so it can be tried again; income is never added twice |
| Reminder pop-up preference | the preferences row is missing | Defaults to "when something is due"; "24 hours" is stored with the account |
| Receipt reader service | off, unreadable, daily limit, slow, empty text, offline | A sentence for each case; the form stays usable; a PDF with text still works offline (read on the device) |
| PDF reader code | cannot be downloaded | "Could not load the PDF reader"; manual entry |
| CSV import | wrong file, too large, offline, half-way failure | Explained before anything is added; refused offline; nothing more is added after a failure |
| Telegram service | not available, link not genuine, bot blocked | Status text, the link is never opened unless it is a real `t.me` link, a blocked-bot warning |
| Report service | no channel, limit reached | The server's reason is shown; after two re-sends the admin is offered |
| Deleting the account | offline, or the server refuses | Nothing is deleted; a sentence says why |
| Admin function | not the admin, server down | Refusal shown in words; the screen never shows money; the server checks every call |
| Email link page | made-up or used link, server down, connection drops | "Link not valid" without asking the server, or the server's reason; the button comes back after a dropped connection |
| Mini App | opened outside Telegram, expired or unsigned launch, not linked, too many requests, server or network problem | A full-screen explanation for each, a retry where it helps, and a sample preview outside Telegram |
| Charts | a drawing fails | Every chart is plain SVG with its numbers in text beside it, so there is no chart library to fail |
