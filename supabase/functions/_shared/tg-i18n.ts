// Every sentence the bot says, in English, Bahasa Melayu and Chinese.
//   {name}    is replaced by the value, HTML-escaped (use this for anything a person typed)
//   {{name}}  is replaced as-is (use only for text we built ourselves, already escaped)
// A missing translation falls back to English, so a new message can never show a blank or a raw key.

import { escapeHtml, formatDay, type Lang } from "./tg-format.ts";

export const LANGS: Lang[] = ["en", "ms", "zh"];
export const LANG_NAMES: Record<Lang, string> = { en: "English", ms: "Bahasa Melayu", zh: "中文" };

type Dict = Record<string, string>;

const en: Dict = {
  help:
    "<b>🤖 VinExpenses bot</b>\n\n" +
    "✍️ <b>Add an expense</b>\n<code>lunch 12.50</code>\n<code>grab rm8.90 ewallet</code>\n<code>yesterday petrol 50</code> · <code>3/11 coffee 6</code>\n" +
    "💰 Income: <code>+3000 salary</code>\n📸 Or send a photo of a receipt.\n\n" +
    "📊 /today · /month · /top\n🧾 /recent  edit or delete\n↩️ /undo  remove the last one\n🌐 /language · 🔔 /digest · 🔌 /unlink",
  welcome: "👋 <b>Hi!</b> To connect, open <b>VinExpenses → Account → Connect Telegram</b> and tap the button there.",
  not_connected: "🔌 This chat isn't connected yet. Open <b>VinExpenses → Account → Connect Telegram</b>.",
  connected_ok: "✅ <b>Connected!</b> Expenses you add here go straight to your VinExpenses account.",
  already_connected: "✅ You're connected.",
  link_limit: "⛔ Too many attempts today. Create a new code in the app tomorrow.",
  link_bad: "🤔 That code doesn't look right. Open VinExpenses → Account → Connect Telegram to get a new one.",
  link_invalid: "⌛ That code is invalid or has expired. Create a new one in the app.",
  link_other: "⚠️ This Telegram chat is already connected to another VinExpenses account. Send /unlink first, then try again.",
  unlinked: "🔌 Disconnected. Your expenses stay in the app. Reconnect any time from Account.",
  no_amount: "🤷 I couldn't find an amount. Try <code>lunch 12.50</code>.\n\n/help",
  too_long: "✂️ That message is too long. Keep it short, like <code>lunch 12.50</code>.",
  add_limit: "⛔ Daily limit reached for adding by chat (100). Use the app, or try again tomorrow.",
  unknown_cmd: "🤔 I don't know that command.\n\n{{help}}",
  went_wrong: "😕 Something went wrong on my side. Please try again in a moment.",
  cant_save: "😕 Sorry, I couldn't save that. Please try again in a moment.",
  date_future: "📅 That date is in the future. Use today or an earlier date.",
  date_old: "📅 That date is more than a year ago. Add old records in the app.",
  photo_unavailable: "📸 Photo reading isn't available right now. Please type the expense, like <code>lunch 12.50</code>.",

  income_saved: "💰 <b>Income saved</b>",
  btn_undo: "↩️ Undo",
  btn_category: "🏷 Category",
  btn_amount: "✏️ Amount",
  btn_delete: "🗑 Delete",
  btn_yes_delete: "🗑 Yes, delete",
  btn_back: "⬅️ Back",
  btn_cancel: "✖ Cancel",
  btn_save: "✅ Save",
  btn_edit_amount: "✏️ Edit amount",
  removed: "↩️ Removed <b>{amount}</b>{what}.",
  undo_none: "🤷 Nothing to undo.",
  gone: "🤷 That expense no longer exists.",
  already_removed: "Already removed.",
  choose_category: "🏷 Choose a category for <b>{amount}</b>{what}",
  confirm_delete: "🗑 Delete <b>{amount}</b>{what}?",
  why_known: "Auto: filed by the built-in knowledge base.",
  why_history: "Auto: filed like your earlier ones.",
  why_none: "No match found, so it is filed under Other. Tap Category to change it.",
  dup_warn: "⚠️ <b>Possible duplicate:</b> you already logged {amount} at {what} that day. Tap Undo if it was a mistake.",
  on_date: "📅 {date}",

  budget_overall: "Overall",
  budget_warn: "⚠️ <b>Heads-up:</b> {pct} of your {name} budget is used.",
  budget_over: "🚨 <b>Over budget:</b> {name} is {amount} above its limit.",
  budget_line: "{{bar}} {pct}  ({used} of {limit})",

  today_title: "📅 <b>Today</b> · {date}",
  month_title: "🗓 <b>{month}</b>",
  top_title: "🏆 <b>Top spending</b> · {month}",
  week_title: "📬 <b>Your week</b> · {range}",
  spent: "💸 Spent",
  income: "💰 Income",
  net: "📈 Net",
  savings: "🏦 Saved",
  expense_count_one: "{n} expense",
  expense_count_many: "{n} expenses",
  no_expenses: "🌱 No expenses yet.",
  vs_last: "vs last {period}",
  period_week: "week",
  period_month: "month",
  top_categories: "<b>Categories</b>",
  top_merchants: "<b>Places</b>",
  biggest: "🥇 Biggest",
  budgets_title: "<b>Budgets</b>",
  digest_tip: "💡 Switch this weekly summary off with /digest off.",

  recent_title: "🧾 <b>Recent expenses</b> · tap one to edit",
  recent_empty: "🌱 Nothing recorded yet.",
  card_title: "🧾 <b>{amount}</b>",
  ask_amount: "✏️ Send the new amount (for example <code>12.50</code>), or /cancel.",
  edit_cancelled: "👌 Cancelled.",
  amount_invalid: "🤔 That doesn't look like an amount. Send a number like <code>12.50</code>, or /cancel.",

  receipt_reading: "🔍 Reading your receipt…",
  receipt_title: "🧾 <b>Receipt found</b>",
  receipt_not_sure: "🤔 I read the receipt{{merchant}} but couldn't find a reliable total. Reply with the amount (for example <code>23.40</code>), or /cancel.",
  receipt_unreadable: "😕 I couldn't read that photo. Try a sharper, well-lit picture, or type the expense.",
  receipt_too_big: "📦 That photo is too large (limit 1 MB). Send a smaller one, or type the expense.",
  receipt_limit: "⛔ You've reached today's receipt-scan limit. Type the expense instead.",
  receipt_expired: "⌛ That receipt expired. Please send the photo again.",
  receipt_cancelled: "👌 Receipt discarded.",
  receipt_foreign: "⚠️ This receipt may not be in RM. Please check the amount.",

  lang_prompt: "🌐 Choose your language:",
  lang_set: "✅ Language set to <b>{name}</b>.",
  digest_on: "🔔 <b>Weekly summary is on.</b> I'll send it every Monday morning (Malaysia time).",
  digest_off: "🔕 Weekly summary is off.",
  digest_status_on: "🔔 Weekly summary is <b>on</b>. Turn it off with /digest off.",
  digest_status_off: "🔕 Weekly summary is <b>off</b>. Turn it on with /digest on.",
  digest_unavailable: "😕 That setting isn't available yet. Ask the administrator to run the latest database update.",
};

const ms: Dict = {
  help:
    "<b>🤖 Bot VinExpenses</b>\n\n" +
    "✍️ <b>Tambah perbelanjaan</b>\n<code>makan tengah hari 12.50</code>\n<code>grab rm8.90 ewallet</code>\n<code>semalam minyak 50</code> · <code>3/11 kopi 6</code>\n" +
    "💰 Pendapatan: <code>+3000 gaji</code>\n📸 Atau hantar foto resit.\n\n" +
    "📊 /today · /month · /top\n🧾 /recent  ubah atau padam\n↩️ /undo  buang yang terakhir\n🌐 /language · 🔔 /digest · 🔌 /unlink",
  welcome: "👋 <b>Hai!</b> Untuk menyambung, buka <b>VinExpenses → Akaun → Connect Telegram</b> dan tekan butang di sana.",
  not_connected: "🔌 Sembang ini belum disambungkan. Buka <b>VinExpenses → Akaun → Connect Telegram</b>.",
  connected_ok: "✅ <b>Berjaya disambung!</b> Perbelanjaan yang anda tambah di sini terus masuk ke akaun VinExpenses anda.",
  already_connected: "✅ Anda sudah disambungkan.",
  link_limit: "⛔ Terlalu banyak percubaan hari ini. Cipta kod baharu dalam aplikasi esok.",
  link_bad: "🤔 Kod itu tidak betul. Buka VinExpenses → Akaun → Connect Telegram untuk kod baharu.",
  link_invalid: "⌛ Kod itu tidak sah atau sudah tamat tempoh. Cipta yang baharu dalam aplikasi.",
  link_other: "⚠️ Sembang Telegram ini sudah disambungkan ke akaun VinExpenses lain. Hantar /unlink dahulu, kemudian cuba lagi.",
  unlinked: "🔌 Sambungan diputuskan. Perbelanjaan anda kekal dalam aplikasi. Sambung semula bila-bila masa dari Akaun.",
  no_amount: "🤷 Saya tidak jumpa jumlah. Cuba <code>makan 12.50</code>.\n\n/help",
  too_long: "✂️ Mesej terlalu panjang. Ringkaskan, contohnya <code>makan 12.50</code>.",
  add_limit: "⛔ Had harian menambah melalui sembang dicapai (100). Guna aplikasi atau cuba esok.",
  unknown_cmd: "🤔 Saya tidak kenal arahan itu.\n\n{{help}}",
  went_wrong: "😕 Berlaku masalah di pihak saya. Sila cuba sebentar lagi.",
  cant_save: "😕 Maaf, saya tidak dapat menyimpannya. Sila cuba sebentar lagi.",
  date_future: "📅 Tarikh itu di masa hadapan. Guna hari ini atau tarikh lebih awal.",
  date_old: "📅 Tarikh itu lebih setahun yang lalu. Tambah rekod lama dalam aplikasi.",
  photo_unavailable: "📸 Bacaan foto tidak tersedia sekarang. Sila taip perbelanjaan, contohnya <code>makan 12.50</code>.",

  income_saved: "💰 <b>Pendapatan disimpan</b>",
  btn_undo: "↩️ Buat asal",
  btn_category: "🏷 Kategori",
  btn_amount: "✏️ Jumlah",
  btn_delete: "🗑 Padam",
  btn_yes_delete: "🗑 Ya, padam",
  btn_back: "⬅️ Kembali",
  btn_cancel: "✖ Batal",
  btn_save: "✅ Simpan",
  btn_edit_amount: "✏️ Ubah jumlah",
  removed: "↩️ Dibuang <b>{amount}</b>{what}.",
  undo_none: "🤷 Tiada apa untuk dibuat asal.",
  gone: "🤷 Perbelanjaan itu sudah tiada.",
  already_removed: "Sudah dibuang.",
  choose_category: "🏷 Pilih kategori untuk <b>{amount}</b>{what}",
  confirm_delete: "🗑 Padam <b>{amount}</b>{what}?",
  why_known: "Auto: dikategorikan oleh pangkalan pengetahuan terbina dalam.",
  why_history: "Auto: dikategorikan seperti rekod anda sebelum ini.",
  why_none: "Tiada padanan, jadi dimasukkan ke Lain-lain. Tekan Kategori untuk menukar.",
  dup_warn: "⚠️ <b>Mungkin pendua:</b> anda sudah merekod {amount} di {what} pada hari itu. Tekan Buat asal jika tersilap.",
  on_date: "📅 {date}",

  budget_overall: "Keseluruhan",
  budget_warn: "⚠️ <b>Peringatan:</b> {pct} bajet {name} anda telah digunakan.",
  budget_over: "🚨 <b>Melebihi bajet:</b> {name} melebihi had sebanyak {amount}.",
  budget_line: "{{bar}} {pct}  ({used} daripada {limit})",

  today_title: "📅 <b>Hari ini</b> · {date}",
  month_title: "🗓 <b>{month}</b>",
  top_title: "🏆 <b>Perbelanjaan teratas</b> · {month}",
  week_title: "📬 <b>Minggu anda</b> · {range}",
  spent: "💸 Belanja",
  income: "💰 Pendapatan",
  net: "📈 Bersih",
  savings: "🏦 Simpanan",
  expense_count_one: "{n} perbelanjaan",
  expense_count_many: "{n} perbelanjaan",
  no_expenses: "🌱 Belum ada perbelanjaan.",
  vs_last: "berbanding {period} lepas",
  period_week: "minggu",
  period_month: "bulan",
  top_categories: "<b>Kategori</b>",
  top_merchants: "<b>Tempat</b>",
  biggest: "🥇 Terbesar",
  budgets_title: "<b>Bajet</b>",
  digest_tip: "💡 Matikan ringkasan mingguan ini dengan /digest off.",

  recent_title: "🧾 <b>Perbelanjaan terkini</b> · tekan untuk ubah",
  recent_empty: "🌱 Belum ada rekod.",
  card_title: "🧾 <b>{amount}</b>",
  ask_amount: "✏️ Hantar jumlah baharu (contoh <code>12.50</code>), atau /cancel.",
  edit_cancelled: "👌 Dibatalkan.",
  amount_invalid: "🤔 Itu bukan jumlah. Hantar nombor seperti <code>12.50</code>, atau /cancel.",

  receipt_reading: "🔍 Membaca resit anda…",
  receipt_title: "🧾 <b>Resit ditemui</b>",
  receipt_not_sure: "🤔 Saya sudah baca resit{{merchant}} tetapi tidak jumpa jumlah yang pasti. Balas dengan jumlah (contoh <code>23.40</code>), atau /cancel.",
  receipt_unreadable: "😕 Saya tidak dapat membaca foto itu. Cuba gambar yang lebih jelas dan terang, atau taip perbelanjaan.",
  receipt_too_big: "📦 Foto terlalu besar (had 1 MB). Hantar yang lebih kecil, atau taip perbelanjaan.",
  receipt_limit: "⛔ Had imbasan resit hari ini dicapai. Taip perbelanjaan sebaliknya.",
  receipt_expired: "⌛ Resit itu telah tamat tempoh. Sila hantar foto semula.",
  receipt_cancelled: "👌 Resit dibuang.",
  receipt_foreign: "⚠️ Resit ini mungkin bukan dalam RM. Sila semak jumlahnya.",

  lang_prompt: "🌐 Pilih bahasa anda:",
  lang_set: "✅ Bahasa ditetapkan kepada <b>{name}</b>.",
  digest_on: "🔔 <b>Ringkasan mingguan dihidupkan.</b> Saya hantar setiap pagi Isnin (waktu Malaysia).",
  digest_off: "🔕 Ringkasan mingguan dimatikan.",
  digest_status_on: "🔔 Ringkasan mingguan <b>hidup</b>. Matikan dengan /digest off.",
  digest_status_off: "🔕 Ringkasan mingguan <b>mati</b>. Hidupkan dengan /digest on.",
  digest_unavailable: "😕 Tetapan itu belum tersedia. Minta pentadbir menjalankan kemas kini pangkalan data terkini.",
};

const zh: Dict = {
  help:
    "<b>🤖 VinExpenses 机器人</b>\n\n" +
    "✍️ <b>记一笔支出</b>\n<code>午餐 12.50</code>\n<code>grab rm8.90 ewallet</code>\n<code>昨天 加油 50</code> · <code>3/11 咖啡 6</code>\n" +
    "💰 收入：<code>+3000 工资</code>\n📸 也可以直接发收据照片。\n\n" +
    "📊 /today · /month · /top\n🧾 /recent  修改或删除\n↩️ /undo  撤销上一笔\n🌐 /language · 🔔 /digest · 🔌 /unlink",
  welcome: "👋 <b>你好！</b>要连接账户，请打开 <b>VinExpenses → 账户 → Connect Telegram</b>，然后点击那里的按钮。",
  not_connected: "🔌 此聊天尚未连接。请打开 <b>VinExpenses → 账户 → Connect Telegram</b>。",
  connected_ok: "✅ <b>已连接！</b>你在这里记录的支出会直接进入你的 VinExpenses 账户。",
  already_connected: "✅ 你已经连接了。",
  link_limit: "⛔ 今天尝试次数过多。请明天在应用里重新生成代码。",
  link_bad: "🤔 这个代码不对。请打开 VinExpenses → 账户 → Connect Telegram 获取新代码。",
  link_invalid: "⌛ 这个代码无效或已过期。请在应用里生成新的。",
  link_other: "⚠️ 此 Telegram 聊天已连接到另一个 VinExpenses 账户。请先发送 /unlink，再重试。",
  unlinked: "🔌 已断开连接。你的支出仍保留在应用中。可随时在账户里重新连接。",
  no_amount: "🤷 我没找到金额。试试 <code>午餐 12.50</code>。\n\n/help",
  too_long: "✂️ 消息太长了。请简短一点，例如 <code>午餐 12.50</code>。",
  add_limit: "⛔ 今天通过聊天记账已达上限（100）。请使用应用，或明天再试。",
  unknown_cmd: "🤔 我不认识这个命令。\n\n{{help}}",
  went_wrong: "😕 我这边出了点问题，请稍后再试。",
  cant_save: "😕 抱歉，无法保存。请稍后再试。",
  date_future: "📅 这个日期在未来。请用今天或更早的日期。",
  date_old: "📅 这个日期超过一年了。旧记录请在应用里添加。",
  photo_unavailable: "📸 暂时无法读取照片。请直接输入支出，例如 <code>午餐 12.50</code>。",

  income_saved: "💰 <b>收入已保存</b>",
  btn_undo: "↩️ 撤销",
  btn_category: "🏷 分类",
  btn_amount: "✏️ 金额",
  btn_delete: "🗑 删除",
  btn_yes_delete: "🗑 确认删除",
  btn_back: "⬅️ 返回",
  btn_cancel: "✖ 取消",
  btn_save: "✅ 保存",
  btn_edit_amount: "✏️ 修改金额",
  removed: "↩️ 已删除 <b>{amount}</b>{what}。",
  undo_none: "🤷 没有可撤销的内容。",
  gone: "🤷 这笔支出已不存在。",
  already_removed: "已经删除了。",
  choose_category: "🏷 为 <b>{amount}</b>{what} 选择分类",
  confirm_delete: "🗑 删除 <b>{amount}</b>{what}？",
  why_known: "自动：由内置知识库归类。",
  why_history: "自动：与你之前的记录一致。",
  why_none: "没有匹配，已归入“其他”。点“分类”可修改。",
  dup_warn: "⚠️ <b>可能重复：</b>你当天已在 {what} 记录过 {amount}。如果记错了，点“撤销”。",
  on_date: "📅 {date}",

  budget_overall: "总预算",
  budget_warn: "⚠️ <b>提醒：</b>{name}预算已用 {pct}。",
  budget_over: "🚨 <b>超出预算：</b>{name}超出上限 {amount}。",
  budget_line: "{{bar}} {pct}  （{used} / {limit}）",

  today_title: "📅 <b>今天</b> · {date}",
  month_title: "🗓 <b>{month}</b>",
  top_title: "🏆 <b>支出排行</b> · {month}",
  week_title: "📬 <b>你的一周</b> · {range}",
  spent: "💸 支出",
  income: "💰 收入",
  net: "📈 结余",
  savings: "🏦 储蓄率",
  expense_count_one: "{n} 笔支出",
  expense_count_many: "{n} 笔支出",
  no_expenses: "🌱 还没有支出。",
  vs_last: "对比上{period}",
  period_week: "周",
  period_month: "月",
  top_categories: "<b>分类</b>",
  top_merchants: "<b>商家</b>",
  biggest: "🥇 最大一笔",
  budgets_title: "<b>预算</b>",
  digest_tip: "💡 发送 /digest off 可关闭每周摘要。",

  recent_title: "🧾 <b>最近的支出</b> · 点击可修改",
  recent_empty: "🌱 还没有记录。",
  card_title: "🧾 <b>{amount}</b>",
  ask_amount: "✏️ 请发送新的金额（例如 <code>12.50</code>），或发送 /cancel。",
  edit_cancelled: "👌 已取消。",
  amount_invalid: "🤔 这不像金额。请发送数字，例如 <code>12.50</code>，或发送 /cancel。",

  receipt_reading: "🔍 正在读取收据…",
  receipt_title: "🧾 <b>已识别收据</b>",
  receipt_not_sure: "🤔 我读了这张收据{{merchant}}，但没找到可靠的总额。请回复金额（例如 <code>23.40</code>），或发送 /cancel。",
  receipt_unreadable: "😕 无法读取这张照片。请换一张更清晰、光线更好的，或直接输入支出。",
  receipt_too_big: "📦 照片太大（上限 1 MB）。请发小一点的，或直接输入支出。",
  receipt_limit: "⛔ 今天的收据扫描次数已用完。请直接输入支出。",
  receipt_expired: "⌛ 这张收据已过期。请重新发送照片。",
  receipt_cancelled: "👌 已放弃这张收据。",
  receipt_foreign: "⚠️ 这张收据可能不是令吉。请核对金额。",

  lang_prompt: "🌐 请选择语言：",
  lang_set: "✅ 语言已设为 <b>{name}</b>。",
  digest_on: "🔔 <b>每周摘要已开启。</b>我会在每周一早上（马来西亚时间）发送。",
  digest_off: "🔕 每周摘要已关闭。",
  digest_status_on: "🔔 每周摘要<b>已开启</b>。发送 /digest off 可关闭。",
  digest_status_off: "🔕 每周摘要<b>已关闭</b>。发送 /digest on 可开启。",
  digest_unavailable: "😕 该设置暂不可用。请联系管理员运行最新的数据库更新。",
};


// ---- Phase 1 UX additions --------------------------------------------------------------------------------------
Object.assign(en, {
  st_income: "Income saved", st_saved: "Saved", st_updated: "Updated", st_amount: "Amount updated", st_receipt: "Saved from receipt", st_repeat: "Saved again",
  today_word: "Today", yesterday_word: "Yesterday",
  menu_add: "➕ Add", menu_today: "📊 Today", menu_month: "🗓 Month", menu_recent: "🧾 Recent", menu_settings: "⚙️ Settings",
  menu_ready: "👇 Use the menu below, or just type an expense like <code>lunch 12.50</code>.",
  onboard:
    "🎉 <b>You're connected!</b>\n\nAdd an expense by typing it. Tap an example to copy it, then send:\n" +
    "<code>lunch 12.50</code>\n<code>kopi 4 ewallet</code>\n<code>yesterday petrol 50</code>\n\n" +
    "📸 You can also send a photo of a receipt.\n👇 The menu below is always there.",
  add_prompt: "➕ <b>What did you spend?</b>\nType it like <code>lunch 12.50</code>, or send a receipt photo.",
  add_favs: "\n\n⭐ Or tap one of your usual ones:",
  btn_repeat: "🔁 Repeat last: {what}",
  btn_more: "➕ More",
  btn_edit: "✏️ Edit",
  btn_open: "🔗 Open VinExpenses",
  settings_title: "⚙️ <b>Settings</b>",
  settings_lang: "🌐 Language: <b>{name}</b>",
  settings_digest_on: "🔔 Weekly summary: <b>on</b>",
  settings_digest_off: "🔕 Weekly summary: <b>off</b>",
  btn_set_lang: "🌐 Language",
  btn_digest_on: "🔔 Turn on weekly summary",
  btn_digest_off: "🔕 Turn off weekly summary",
  btn_unlink: "🔌 Disconnect",
  btn_yes_unlink: "Yes, disconnect",
  unlink_confirm: "🔌 Disconnect this chat from your VinExpenses account?\nYour expenses stay in the app.",
  toast_undone: "Undone ✓", toast_moved: "Moved to {cat} ✓", toast_same: "Already in {cat}", toast_deleted: "Deleted ✓",
  toast_saved: "Saved ✓", toast_unavailable: "Not available yet",
});
Object.assign(ms, {
  st_income: "Pendapatan disimpan", st_saved: "Disimpan", st_updated: "Dikemas kini", st_amount: "Jumlah dikemas kini", st_receipt: "Disimpan daripada resit", st_repeat: "Disimpan semula",
  today_word: "Hari ini", yesterday_word: "Semalam",
  menu_add: "➕ Tambah", menu_today: "📊 Hari ini", menu_month: "🗓 Bulan ini", menu_recent: "🧾 Terkini", menu_settings: "⚙️ Tetapan",
  menu_ready: "👇 Guna menu di bawah, atau taip terus perbelanjaan seperti <code>makan 12.50</code>.",
  onboard:
    "🎉 <b>Berjaya disambung!</b>\n\nTambah perbelanjaan dengan menaipnya. Tekan contoh untuk salin, kemudian hantar:\n" +
    "<code>makan tengah hari 12.50</code>\n<code>kopi 4 ewallet</code>\n<code>semalam minyak 50</code>\n\n" +
    "📸 Anda juga boleh hantar foto resit.\n👇 Menu di bawah sentiasa ada.",
  add_prompt: "➕ <b>Apa yang anda belanjakan?</b>\nTaip seperti <code>makan 12.50</code>, atau hantar foto resit.",
  add_favs: "\n\n⭐ Atau tekan salah satu yang biasa:",
  btn_repeat: "🔁 Ulang yang terakhir: {what}",
  btn_more: "➕ Lagi",
  btn_edit: "✏️ Ubah",
  btn_open: "🔗 Buka VinExpenses",
  settings_title: "⚙️ <b>Tetapan</b>",
  settings_lang: "🌐 Bahasa: <b>{name}</b>",
  settings_digest_on: "🔔 Ringkasan mingguan: <b>hidup</b>",
  settings_digest_off: "🔕 Ringkasan mingguan: <b>mati</b>",
  btn_set_lang: "🌐 Bahasa",
  btn_digest_on: "🔔 Hidupkan ringkasan mingguan",
  btn_digest_off: "🔕 Matikan ringkasan mingguan",
  btn_unlink: "🔌 Putuskan sambungan",
  btn_yes_unlink: "Ya, putuskan",
  unlink_confirm: "🔌 Putuskan sambungan sembang ini daripada akaun VinExpenses anda?\nPerbelanjaan anda kekal dalam aplikasi.",
  toast_undone: "Dibuat asal ✓", toast_moved: "Dialih ke {cat} ✓", toast_same: "Sudah dalam {cat}", toast_deleted: "Dipadam ✓",
  toast_saved: "Disimpan ✓", toast_unavailable: "Belum tersedia",
});
Object.assign(zh, {
  st_income: "收入已保存", st_saved: "已保存", st_updated: "已更新", st_amount: "金额已更新", st_receipt: "已从收据保存", st_repeat: "已再次保存",
  today_word: "今天", yesterday_word: "昨天",
  menu_add: "➕ 记一笔", menu_today: "📊 今天", menu_month: "🗓 本月", menu_recent: "🧾 最近", menu_settings: "⚙️ 设置",
  menu_ready: "👇 使用下方菜单，或直接输入支出，例如 <code>午餐 12.50</code>。",
  onboard:
    "🎉 <b>连接成功！</b>\n\n直接输入就能记账。点一下示例即可复制，然后发送：\n" +
    "<code>午餐 12.50</code>\n<code>咖啡 4 ewallet</code>\n<code>昨天 加油 50</code>\n\n" +
    "📸 也可以发收据照片。\n👇 下方菜单会一直在。",
  add_prompt: "➕ <b>花了什么？</b>\n像这样输入 <code>午餐 12.50</code>，或发一张收据照片。",
  add_favs: "\n\n⭐ 或点一下常用的：",
  btn_repeat: "🔁 重复上一笔：{what}",
  btn_more: "➕ 更多",
  btn_edit: "✏️ 编辑",
  btn_open: "🔗 打开 VinExpenses",
  settings_title: "⚙️ <b>设置</b>",
  settings_lang: "🌐 语言：<b>{name}</b>",
  settings_digest_on: "🔔 每周摘要：<b>开</b>",
  settings_digest_off: "🔕 每周摘要：<b>关</b>",
  btn_set_lang: "🌐 语言",
  btn_digest_on: "🔔 开启每周摘要",
  btn_digest_off: "🔕 关闭每周摘要",
  btn_unlink: "🔌 断开连接",
  btn_yes_unlink: "是，断开",
  unlink_confirm: "🔌 要断开此聊天与你的 VinExpenses 账户的连接吗？\n你的支出仍保留在应用中。",
  toast_undone: "已撤销 ✓", toast_moved: "已移到 {cat} ✓", toast_same: "已经是 {cat}", toast_deleted: "已删除 ✓",
  toast_saved: "已保存 ✓", toast_unavailable: "暂不可用",
});

// ---- Phase 2: charts, navigation, insights ------------------------------------------------------------------------
Object.assign(en, {
  nav_today: "📅 Today", nav_week: "📊 Week", nav_month: "🗓 Month", nav_top: "🏆 Top",
  nav_prev: "◀ Earlier", nav_next: "Later ▶", nav_details: "📋 Details",
  week_view_title: "📊 <b>Week</b> · {range}",
  week_biggest: "🥇 Biggest day: <b>{day}</b> · {amount}",
  heat_title: "<b>Daily spending</b> <i>(each column = a week)</i>",
  heat_legend: "🟩 light · 🟨 medium · 🟧 heavy · 🟥 heaviest",
  heat_biggest: "🥇 Busiest day: <b>{day}</b> · {amount}",
  trend_title: "📈 <b>Last 6 months</b>",
  trend_line: "{{spark}}  {from} → {to}",
  streak_line: "🔥 <b>{n}</b> days in a row",
  legend_others: "Others",
  ins_cat_up: "{emoji} {cat} is up <b>{pct}</b> vs last month",
  ins_cat_down: "{emoji} {cat} is down <b>{pct}</b> vs last month 👏",
  ins_weekend_heavy: "🎉 Weekend days cost <b>{x}×</b> your weekdays",
  ins_weekday_heavy: "💼 Weekdays cost <b>{x}×</b> your weekends",
  ins_pace_warn: "⚠️ At this pace {name} will reach <b>{pct}</b> of its budget",
  ins_pace_ok: "🎯 On track: {used} of your {name} budget used by day {day}",
  view_limit: "⛔ Too many report views today. Try again tomorrow.",
  view_failed: "😕 Couldn't update that view. Try again.",
});
Object.assign(ms, {
  nav_today: "📅 Hari ini", nav_week: "📊 Minggu", nav_month: "🗓 Bulan", nav_top: "🏆 Teratas",
  nav_prev: "◀ Lebih awal", nav_next: "Lebih baharu ▶", nav_details: "📋 Butiran",
  week_view_title: "📊 <b>Minggu</b> · {range}",
  week_biggest: "🥇 Hari terbesar: <b>{day}</b> · {amount}",
  heat_title: "<b>Perbelanjaan harian</b> <i>(setiap lajur = seminggu)</i>",
  heat_legend: "🟩 ringan · 🟨 sederhana · 🟧 tinggi · 🟥 tertinggi",
  heat_biggest: "🥇 Hari paling sibuk: <b>{day}</b> · {amount}",
  trend_title: "📈 <b>6 bulan lepas</b>",
  trend_line: "{{spark}}  {from} → {to}",
  streak_line: "🔥 <b>{n}</b> hari berturut-turut",
  legend_others: "Lain-lain",
  ins_cat_up: "{emoji} {cat} naik <b>{pct}</b> berbanding bulan lepas",
  ins_cat_down: "{emoji} {cat} turun <b>{pct}</b> berbanding bulan lepas 👏",
  ins_weekend_heavy: "🎉 Hujung minggu <b>{x}×</b> lebih mahal daripada hari bekerja",
  ins_weekday_heavy: "💼 Hari bekerja <b>{x}×</b> lebih mahal daripada hujung minggu",
  ins_pace_warn: "⚠️ Dengan kadar ini {name} akan mencecah <b>{pct}</b> daripada bajetnya",
  ins_pace_ok: "🎯 Mengikut landasan: {used} bajet {name} digunakan setakat hari ke-{day}",
  view_limit: "⛔ Terlalu banyak paparan laporan hari ini. Cuba lagi esok.",
  view_failed: "😕 Tidak dapat mengemas kini paparan itu. Cuba lagi.",
});
Object.assign(zh, {
  nav_today: "📅 今天", nav_week: "📊 本周", nav_month: "🗓 本月", nav_top: "🏆 排行",
  nav_prev: "◀ 更早", nav_next: "更近 ▶", nav_details: "📋 详情",
  week_view_title: "📊 <b>本周</b> · {range}",
  week_biggest: "🥇 花得最多的一天：<b>{day}</b> · {amount}",
  heat_title: "<b>每日支出</b> <i>（每列代表一周）</i>",
  heat_legend: "🟩 少 · 🟨 中 · 🟧 多 · 🟥 最多",
  heat_biggest: "🥇 花得最多的一天：<b>{day}</b> · {amount}",
  trend_title: "📈 <b>最近 6 个月</b>",
  trend_line: "{{spark}}  {from} → {to}",
  streak_line: "🔥 连续记账 <b>{n}</b> 天",
  legend_others: "其他",
  ins_cat_up: "{emoji} {cat} 比上个月增加 <b>{pct}</b>",
  ins_cat_down: "{emoji} {cat} 比上个月减少 <b>{pct}</b> 👏",
  ins_weekend_heavy: "🎉 周末的花费是工作日的 <b>{x}×</b>",
  ins_weekday_heavy: "💼 工作日的花费是周末的 <b>{x}×</b>",
  ins_pace_warn: "⚠️ 照这个速度，{name}将达到预算的 <b>{pct}</b>",
  ins_pace_ok: "🎯 进度良好：到第 {day} 天，{name}预算已用 {used}",
  view_limit: "⛔ 今天查看报告的次数过多。请明天再试。",
  view_failed: "😕 无法更新该视图，请重试。",
});

// ---- Phase 2b: month tabs (Overview / Days / Budgets / Trend) --------------------------------------------------------
Object.assign(en, {
  tab_overview: "🍩 Overview", tab_days: "📅 Days", tab_budgets: "🎯 Budgets", tab_trend: "📈 Trend",
  month_cash: "💰 <b>{income}</b> in  ·  📈 <b>{net}</b> net  ·  🏦 <b>{rate}</b> saved",
  days_title: "📅 <b>{month}</b> · daily spending",
  days_average: "📊 Average <b>{amount}</b> a day · {active} of {total} days with spending",
  budgets_view_title: "🎯 <b>Budgets</b> · {month}",
  budgets_none: "🎯 No budgets yet. Set one in VinExpenses → Budget and it will appear here with a progress bar.",
  budget_left: "{amount} left", budget_over_by: "{amount} over",
  hl_over: "🔴 {name} is over budget ({pct})",
  hl_near: "🟡 {name} is at {pct} of its budget",
  trend_avg: "📊 Average <b>{amount}</b> a month",
  trend_best: "🥇 Highest: <b>{month}</b> · {amount}",
});
Object.assign(ms, {
  tab_overview: "🍩 Ringkasan", tab_days: "📅 Harian", tab_budgets: "🎯 Bajet", tab_trend: "📈 Aliran",
  month_cash: "💰 <b>{income}</b> masuk  ·  📈 <b>{net}</b> bersih  ·  🏦 <b>{rate}</b> simpanan",
  days_title: "📅 <b>{month}</b> · perbelanjaan harian",
  days_average: "📊 Purata <b>{amount}</b> sehari · {active} daripada {total} hari berbelanja",
  budgets_view_title: "🎯 <b>Bajet</b> · {month}",
  budgets_none: "🎯 Belum ada bajet. Tetapkan dalam VinExpenses → Bajet dan ia akan dipaparkan di sini dengan bar kemajuan.",
  budget_left: "{amount} berbaki", budget_over_by: "{amount} melebihi",
  hl_over: "🔴 {name} melebihi bajet ({pct})",
  hl_near: "🟡 {name} mencecah {pct} daripada bajetnya",
  trend_avg: "📊 Purata <b>{amount}</b> sebulan",
  trend_best: "🥇 Tertinggi: <b>{month}</b> · {amount}",
});
Object.assign(zh, {
  tab_overview: "🍩 概览", tab_days: "📅 每日", tab_budgets: "🎯 预算", tab_trend: "📈 趋势",
  month_cash: "💰 收入 <b>{income}</b>  ·  📈 结余 <b>{net}</b>  ·  🏦 储蓄率 <b>{rate}</b>",
  days_title: "📅 <b>{month}</b> · 每日支出",
  days_average: "📊 日均 <b>{amount}</b> · {total} 天中有 {active} 天有支出",
  budgets_view_title: "🎯 <b>预算</b> · {month}",
  budgets_none: "🎯 还没有预算。在 VinExpenses → 预算 中设置后，会连同进度条显示在这里。",
  budget_left: "剩余 {amount}", budget_over_by: "超出 {amount}",
  hl_over: "🔴 {name}已超出预算（{pct}）",
  hl_near: "🟡 {name}已用预算的 {pct}",
  trend_avg: "📊 月均 <b>{amount}</b>",
  trend_best: "🥇 最高：<b>{month}</b> · {amount}",
});

/** "Today", "Yesterday", or the date: friendlier than always printing a date. Days follow Kuala Lumpur time. */
export function dayLabel(date: Date, now: Date, lang: Lang): string {
  const day = (d: Date) => Math.floor((d.getTime() + 8 * 3600_000) / 86_400_000);
  const diff = day(now) - day(date);
  if (diff === 0) return tr(lang, "today_word");
  if (diff === 1) return tr(lang, "yesterday_word");
  return formatDay(date, lang);
}

/** The persistent menu at the bottom of the chat, in the person's language. */
export function menuKeyboard(lang: Lang): string[][] {
  return [
    [tr(lang, "menu_add"), tr(lang, "menu_today")],
    [tr(lang, "menu_month"), tr(lang, "menu_recent")],
    [tr(lang, "menu_settings")],
  ];
}

/** Which menu button a message is (in ANY language, so switching language never strands the old buttons). */
export function menuAction(text: string): "add" | "today" | "month" | "recent" | "settings" | null {
  const wanted = text.trim();
  for (const lang of LANGS) {
    const pairs: [string, "add" | "today" | "month" | "recent" | "settings"][] = [
      ["menu_add", "add"], ["menu_today", "today"], ["menu_month", "month"], ["menu_recent", "recent"], ["menu_settings", "settings"],
    ];
    for (const [key, action] of pairs) if (tr(lang, key) === wanted) return action;
  }
  return null;
}

const DICTS: Record<Lang, Dict> = { en, ms, zh };

export function asLang(value: unknown): Lang {
  return value === "ms" || value === "zh" ? value : "en";
}

/** Looks up a sentence and fills in {values}. Unknown key -> English -> the key itself (never throws). */
export function tr(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const template = DICTS[lang]?.[key] ?? en[key] ?? key;
  return template
    .replace(/\{\{(\w+)\}\}/g, (_match, name) => (name in vars ? String(vars[name]) : ""))
    .replace(/\{(\w+)\}/g, (_match, name) => (name in vars ? escapeHtml(String(vars[name])) : ""));
}

export const hasKey = (key: string): boolean => key in en;
export const allKeys = (): string[] => Object.keys(en);
export const keysOf = (lang: Lang): string[] => Object.keys(DICTS[lang]);
