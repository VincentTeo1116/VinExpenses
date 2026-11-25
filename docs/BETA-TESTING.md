# Beta testing guide

For inviting the first testers of VinExpenses (https://vinexpenses.tkqvincent2.workers.dev). It has three parts: what you (the owner) should check
before sending the first invite, what to send and ask testers, and what to watch while the beta runs.

Status when this was written (25 Nov 2026): the code is deployed, and the automated tests pass. What has **not** been checked is listed in
section 1, because only you can check it (it needs your accounts or a real phone).

## 1. Owner checklist before the first invite

Tick each one. The first three can stop sign-up for everyone, so do them first.

- [ ] **Sign-up and sign-in work for a stranger.** On a phone that has never used the app (or a private window), register a new email, receive the
      code, finish setup and sign in. Then sign out and sign in again.
      - A read-only look at the live sign-in page found the Turnstile security check loading with no "domain not allowed" (110200) error. That is a
        good sign, but it does not prove the check *passes* for a real person: only a real sign-up proves that.
      - If Turnstile errors again: Cloudflare dashboard, Turnstile, your widget, Hostname Management must list `vinexpenses.tkqvincent2.workers.dev`.
- [ ] **Registration emails arrive** (check spam too). Codes are sent through Gmail, which limits how many emails it sends per day. Check your
      account's limit and keep the first group small enough to stay under it (each person needs at least one code, and codes can be asked for
      up to 3 times a day per person).
- [ ] **Supabase backups.** In the Supabase dashboard, check whether your plan keeps automatic backups. If not, either upgrade before inviting
      people, or tell testers plainly that this is a test and they should export their data (Account, Your data) now and then.
- [ ] **Run the scan statistics SQL** (the `scan_events` section at the end of `supabase-schema.sql`) so Admin can show scan reliability.
- [ ] **Make yourself the administrator** (the `app_admins` table) and open Admin to see Users, Messages and System.
- [ ] **Look at your plan's limits** in the Supabase dashboard (database size, function calls, connections) and note the numbers.
- [ ] **Try on real phones:** one iPhone (Safari) and one Android (Chrome). Add an expense, scan a receipt (photo and PDF), take a photo with the
      camera, switch language, install to the home screen, and run the guided tour.
- [ ] **Open the Messages tab in Admin** and send yourself a test message through "Contact the admin", so you know where feedback arrives.
- [ ] **Decide how long the beta runs** and tell testers (for example 2 weeks), so nobody is surprised if data is reset.

## 2. What to tell testers

### Be honest about three things
1. It is a test. Things may break or change.
2. Receipt scanning can make mistakes. Always check the amount, shop and date before saving.
3. Their records are private to them. They can export everything (Account, Your data) and delete their account at any time.

### Invite message (English)

> Hi! I built a personal expense tracker for Malaysia and I'd love your help testing it.
> It scans receipts (photo or PDF), tracks bills, loans, deposits and budgets, and works in English, Bahasa Malaysia and Chinese.
>
> Link: https://vinexpenses.tkqvincent2.workers.dev
>
> It's a test, so please:
> 1. Sign up and try adding 3 or 4 expenses.
> 2. Scan 2 receipts (a photo and, if you have one, a PDF) and check the amount it fills in.
> 3. Tell me anything confusing, slow or wrong: use "Contact the admin" on the sign-in page, or message me.
>
> Receipt scanning can be wrong, so please check the numbers. You can export or delete your data any time. Thank you!

### Mesej jemputan (Bahasa Malaysia)

> Hai! Saya bina aplikasi penjejak perbelanjaan untuk Malaysia dan saya perlukan bantuan anda untuk mencubanya.
> Ia boleh mengimbas resit (gambar atau PDF), menjejak bil, pinjaman, simpanan tetap dan bajet, dalam Bahasa Malaysia, Inggeris dan Cina.
>
> Pautan: https://vinexpenses.tkqvincent2.workers.dev
>
> Ini ujian, jadi sila:
> 1. Daftar dan cuba tambah 3 atau 4 perbelanjaan.
> 2. Imbas 2 resit dan semak jumlah yang diisi.
> 3. Beritahu saya apa-apa yang mengelirukan, perlahan atau salah: guna "Hubungi pentadbir" di halaman log masuk, atau mesej saya.
>
> Imbasan resit mungkin tersilap, jadi sila semak nombor. Anda boleh eksport atau padam data anda bila-bila masa. Terima kasih!

### 邀请信息 (中文)

> 你好！我做了一个适合马来西亚的个人开销记账应用，想请你帮忙测试。
> 它可以扫描收据（照片或 PDF），记录账单、贷款、定期存款和预算，支持英文、马来文和中文。
>
> 链接：https://vinexpenses.tkqvincent2.workers.dev
>
> 这是测试版，请你：
> 1. 注册并试着记 3 到 4 笔开销。
> 2. 扫描 2 张收据，并核对自动填入的金额。
> 3. 有任何不清楚、太慢或有误的地方，请告诉我：可在登录页点“联系管理员”，或直接发消息给我。
>
> 收据扫描可能出错，请核对数字。你可以随时导出或删除自己的数据。谢谢！

### What to ask testers to try (a one-page checklist to send)

| # | Try this | What I want to know |
|---|---|---|
| 1 | Sign up with your email and finish setup | Did the code arrive? How long did it take? |
| 2 | Take the short guided tour that starts on Home | Was it clear? Did it point at the right buttons on your phone? |
| 3 | Add an expense by hand | Was anything slow or confusing? Did the category suggestion make sense? |
| 4 | Scan a photo of a receipt | Were the amount, shop and date right? How long did it take? |
| 5 | Scan a PDF receipt or a screenshot | Same questions |
| 6 | Scan a receipt in another currency, if you have one | Did the conversion and the alert make sense? |
| 7 | Add a monthly bill under Plan | Did it post on the right dates? |
| 8 | Look at Home and History on your phone | Is anything hard to read, tap or find? |
| 9 | Try Malay or Chinese | Any wrong or odd wording? |
| 10 | Export your data (Account, Your data) | Did the file open properly? |

### Questions to ask at the end (keep it short)
1. What did you try to do, and did it work?
2. What was the most confusing or annoying moment?
3. Would you use it again next week? Why or why not?
4. What is one thing it is missing?
5. Which phone and browser did you use?

## 3. What to watch while the beta runs

Check these every day for the first week, then every few days.

| Where | Look for |
|---|---|
| Admin, Messages | New feedback and sign-up problems. Reply to people. |
| Admin, System, Receipt scanning | Success rate, typical time and the reasons scans fail (for example "busy" means the free OCR service is overloaded). |
| Admin, System, Health checks | Email, Telegram and database checks all OK. |
| Admin, Users | How many people signed up, and whether anyone is stuck or locked out. |
| Supabase dashboard | Database size, function calls, and any errors in the function logs. |
| Cloudflare dashboard | Traffic to the site and any deploy problems. |
| GitHub, Actions | The "Web app checks" and "Deploy to Cloudflare" runs stay green. |

### Warning signs, and what to do
- **Many people say they never got the sign-up code:** you may have hit Gmail's daily limit. Pause invites, and ask people to try again tomorrow.
- **Scans fail with "busy" a lot:** the free OCR service is overloaded. The app falls back to reading on the phone, which is slower. Consider a paid OCR plan.
- **The site is slow or erroring:** check the Supabase dashboard for hitting a limit, and the function logs for the cause.
- **Someone reports seeing another person's data:** treat as urgent. Take the site down (disable the deploy), check the database policies, and tell the affected people.
- **A bad release:** revert the last commit in GitHub and let the checks and deploy run again.

### Keep the beta safe
- Invite in waves: 10 to 20 people first, then more once the first wave is smooth.
- Do not promise accuracy for scanning, or advice about tax or money.
- Fix and tell people: when you fix something a tester reported, tell them, because it keeps them testing.

## 4. Known limits to mention if asked
- Receipt scanning is a draft the person must check. Photos of crumpled or glared paper are the hardest.
- The backup reader (used when the online one is busy) works in English only and is slower.
- Foreign-currency conversion uses official daily rates (European Central Bank), which differ from a bank's or card's own rate and fees.
- The Telegram bot warns about foreign-currency receipts but does not convert them.
- The tax-relief tracker, the bill splitter and PDF bank-statement import are not built yet.
- This is a personal-record tool. It does not hold or move money and is not financial or tax advice.
