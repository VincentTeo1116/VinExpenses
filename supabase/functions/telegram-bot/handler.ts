// The Telegram bot. Telegram calls this address (the "webhook") for every message sent to the bot.
//
// Who can do what:
//   - Anyone can open the bot, but it only answers /start and /help until a chat is LINKED to an app account.
//   - Linking needs a one-time code that only a signed-in user can create (function telegram-link): 10 characters,
//     valid 10 minutes, usable once, stored only as a hash, with a limit on wrong guesses per chat.
//   - After linking, every action is restricted to that one account. The database is reached with the server key
//     (which ignores row-level security), so EVERY query below filters by the linked user id.
//   - Only private chats are served. Groups and channels are ignored.
//
// Telegram only accepts a reply of 200: anything else makes it re-send the message again and again. So once the
// secret header is proven, this function always answers 200 and reports problems to the user in the chat instead.

import { env, projectAccess, safeEqual, sha256Hex, takeQuota } from "../_shared/guard.ts";
import { fetchAll, q, rest } from "../_shared/db.ts";
import { loadSmartEntry } from "../_shared/smart-entry-loader.ts";
import {
  CODE_PATTERN,
  HELP_TEXT,
  type InlineButton,
  UUID_PATTERN,
  escapeHtml,
  klWindow,
  parseExpense,
  ringgit,
  type TelegramClient,
  telegramClient,
} from "../_shared/telegram.ts";

const MAX_BODY = 30_000;
const DEFAULT_CATEGORIES = [
  ["beverages", "Beverages"], ["travel", "Travel"], ["entertain", "Entertain"], ["work", "Work"], ["food", "Food"],
  ["shopping", "Shopping"], ["utilities", "Utilities"], ["car", "Car"], ["health", "Health"], ["other", "Other"],
].map(([key, label]) => ({ key, label, active: true }));
const DEFAULT_PAYMENTS = [["bank", "Bank"], ["card", "Card"], ["ewallet", "E-Wallet"]].map(([key, label]) => ({ key, label, active: true }));

interface Link {
  chat_id: number;
  user_id: string;
  last_expense_id: string | null;
}
interface Choice {
  key: string;
  label: string;
  active: boolean;
}
interface ExpenseRow {
  id: string;
  amount: number | string;
  category: string;
  payment: string;
  merchant: string | null;
}

const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
const plain = (status: number) => new Response(null, { status });

// ---------------------------------------------------------------- data access (every query is scoped to one user)

async function getLink(chatId: number): Promise<Link | null> {
  const response = await rest(`telegram_links?select=chat_id,user_id,last_expense_id&chat_id=eq.${chatId}`);
  if (!response.ok) throw new Error(`link lookup failed (${response.status})`);
  return (await response.json())[0] ?? null;
}

async function loadChoices(userId: string): Promise<{ categories: Choice[]; payments: Choice[] }> {
  const [catRes, payRes] = await Promise.all([
    rest(`user_categories?select=category_key,label,active&user_id=eq.${q(userId)}&order=sort_order.asc,category_key.asc`),
    rest(`user_payment_methods?select=payment_key,label,active&user_id=eq.${q(userId)}&order=sort_order.asc,payment_key.asc`),
  ]);
  const cats = catRes.ok ? (await catRes.json()) as { category_key: string; label: string; active: boolean }[] : [];
  const pays = payRes.ok ? (await payRes.json()) as { payment_key: string; label: string; active: boolean }[] : [];
  return {
    categories: cats.length ? cats.map((r) => ({ key: r.category_key, label: r.label, active: r.active !== false })) : DEFAULT_CATEGORIES,
    payments: pays.length ? pays.map((r) => ({ key: r.payment_key, label: r.label, active: r.active !== false })) : DEFAULT_PAYMENTS,
  };
}

const labelOf = (choices: Choice[], key: string) => choices.find((c) => c.key === key)?.label ?? key;

function expenseView(row: ExpenseRow, categories: Choice[], payments: Choice[], heading = "✅ Saved"): { text: string; buttons: InlineButton[][] } {
  const lines = [
    `${heading} <b>${escapeHtml(ringgit(Number(row.amount)))}</b>`,
    [labelOf(categories, row.category), row.merchant, labelOf(payments, row.payment)].filter(Boolean).map((part) => escapeHtml(part)).join(" · "),
  ];
  return {
    text: lines.join("\n"),
    buttons: [[{ text: "↩️ Undo", callback_data: `u:${row.id}` }, { text: "🏷 Category", callback_data: `c:${row.id}` }]],
  };
}

async function getExpense(userId: string, id: string): Promise<ExpenseRow | null> {
  const response = await rest(`expenses?select=id,amount,category,payment,merchant&id=eq.${q(id)}&user_id=eq.${q(userId)}`);
  return response.ok ? ((await response.json())[0] ?? null) : null;
}

// ---------------------------------------------------------------- commands

async function linkAccount(tg: TelegramClient, chatId: number, rawCode: string): Promise<void> {
  const code = rawCode.trim().toUpperCase();
  if (!(await takeQuota(`tg-link:${chatId}`, 10))) {
    return tg.send(chatId, "Too many attempts today. Create a new code in the app tomorrow.");
  }
  if (!CODE_PATTERN.test(code)) return tg.send(chatId, "That code doesn't look right. Open VinExpenses → Account → Connect Telegram to get a new one.");

  const hash = await sha256Hex(`${env("TELEGRAM_WEBHOOK_SECRET")}:${code}`);
  // Deleting the row IS the check: it can only succeed once, and only before it expires.
  const used = await rest(`telegram_link_codes?code_hash=eq.${hash}&expires_at=gt.${q(new Date().toISOString())}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  const rows = used.ok ? (await used.json()) as { user_id: string }[] : [];
  if (rows.length !== 1) return tg.send(chatId, "That code is invalid or has expired. Create a new one in the app.");

  const userId = rows[0].user_id;
  const existing = await getLink(chatId);
  if (existing && existing.user_id !== userId) {
    return tg.send(chatId, "This Telegram chat is already connected to another VinExpenses account. Send /unlink first, then try again.");
  }
  await rest(`telegram_links?user_id=eq.${q(userId)}`, { method: "DELETE" }); // one chat per account
  const created = await rest("telegram_links", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ chat_id: chatId, user_id: userId }) });
  if (!created.ok) throw new Error(`could not save link (${created.status})`);
  await tg.send(chatId, `✅ <b>Connected.</b> Your expenses added here go straight to your VinExpenses account.\n\n${HELP_TEXT}`);
}

async function addExpense(tg: TelegramClient, link: Link, text: string): Promise<void> {
  const { categories, payments } = await loadChoices(link.user_id);
  const words = payments.flatMap((p) => [p.key, p.label.toLowerCase().replace(/[^a-z0-9-]/g, "")]);
  const parsed = parseExpense(text, words);
  if (!parsed) return tg.send(link.chat_id, "I couldn't find an amount. Try <code>lunch 12.50</code>.\n\n/help");
  if (!(await takeQuota(`tg-add:${link.chat_id}`, 100))) return tg.send(link.chat_id, "Daily limit reached for adding expenses by chat (100). Use the app, or try again tomorrow.");

  const recentRes = await rest(`expenses?select=merchant,category,payment&user_id=eq.${q(link.user_id)}&order=created_at.desc&limit=300`);
  const recent = recentRes.ok ? (await recentRes.json()) as { merchant: string | null; category: string; payment: string }[] : [];

  const activePayments = payments.filter((p) => p.active);
  const byWord = parsed.paymentWord
    ? payments.find((p) => p.active && (p.key === parsed.paymentWord || p.label.toLowerCase().replace(/[^a-z0-9-]/g, "") === parsed.paymentWord))
    : undefined;
  const lastUsed = activePayments.find((p) => p.key === recent[0]?.payment);
  const payment = (byWord ?? lastUsed ?? activePayments[0])?.key ?? "bank";

  const smart = await loadSmartEntry();
  const activeCategories = categories.filter((c) => c.active);
  let category = (activeCategories.find((c) => c.key === "other") ?? activeCategories[0])?.key ?? "other";
  if (smart && parsed.description) {
    try {
      const guess = smart.suggestCategory({ merchant: parsed.description, text: parsed.description, memory: smart.buildMerchantMemory(recent), categories });
      if (guess && activeCategories.some((c) => c.key === guess.key)) category = guess.key;
    } catch (_error) { /* keep the default category */ }
  }

  const created = await rest("expenses", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ user_id: link.user_id, amount: parsed.amount, category, payment, merchant: parsed.description || null, note: "via Telegram" }),
  });
  const row = created.ok ? ((await created.json()) as ExpenseRow[])[0] : undefined;
  if (!row) return tg.send(link.chat_id, "Sorry, I couldn't save that. Please try again in a moment.");
  await rest(`telegram_links?chat_id=eq.${link.chat_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_expense_id: row.id }) });
  const view = expenseView(row, categories, payments);
  await tg.send(link.chat_id, view.text, { buttons: view.buttons });
}

async function undoExpense(tg: TelegramClient, link: Link, id: string | null): Promise<string | null> {
  if (!id || !UUID_PATTERN.test(id)) { await tg.send(link.chat_id, "Nothing to undo."); return null; }
  const removed = await rest(`expenses?id=eq.${q(id)}&user_id=eq.${q(link.user_id)}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
  const rows = removed.ok ? (await removed.json()) as ExpenseRow[] : [];
  if (link.last_expense_id === id) {
    await rest(`telegram_links?chat_id=eq.${link.chat_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_expense_id: null }) });
  }
  if (!rows.length) return null;
  return `↩️ Removed <b>${escapeHtml(ringgit(Number(rows[0].amount)))}</b>${rows[0].merchant ? ` · ${escapeHtml(rows[0].merchant)}` : ""}.`;
}

async function sendSummary(tg: TelegramClient, link: Link, kind: "day" | "month", now: Date): Promise<void> {
  const win = klWindow(kind, now);
  const range = `created_at=gte.${q(win.start)}&created_at=lt.${q(win.end)}`;
  const [expenses, incomes, { categories }] = await Promise.all([
    fetchAll<{ amount: string | number; category: string }>(`expenses?select=amount,category&user_id=eq.${q(link.user_id)}&${range}&order=created_at.asc,id.asc`),
    kind === "month"
      ? fetchAll<{ amount: string | number }>(`incomes?select=amount&user_id=eq.${q(link.user_id)}&${range}&order=created_at.asc,id.asc`)
      : Promise.resolve([] as { amount: string | number }[]),
    loadChoices(link.user_id),
  ]);
  const total = expenses.reduce((sum, row) => sum + Number(row.amount), 0);
  const byCategory = new Map<string, number>();
  for (const row of expenses) byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + Number(row.amount));
  const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const lines = [`<b>${kind === "day" ? "Today" : escapeHtml(win.label)}</b>`, ""];
  if (kind === "month") {
    const income = incomes.reduce((sum, row) => sum + Number(row.amount), 0);
    lines.push(`Income  ${escapeHtml(ringgit(income))}`, `Spent   <b>${escapeHtml(ringgit(total))}</b>`, `Net     ${escapeHtml(ringgit(income - total))}`);
  } else {
    lines.push(`Spent <b>${escapeHtml(ringgit(total))}</b> (${expenses.length} ${expenses.length === 1 ? "expense" : "expenses"})`);
  }
  if (top.length) {
    lines.push("", ...top.map(([key, amount]) => `${escapeHtml(labelOf(categories, key))}  ${escapeHtml(ringgit(amount))}`));
  } else {
    lines.push("", "No expenses yet.");
  }
  await tg.send(link.chat_id, lines.join("\n"));
}

// ---------------------------------------------------------------- dispatch

async function onText(tg: TelegramClient, chatId: number, rawText: string, now: Date): Promise<void> {
  const text = rawText.trim();
  if (!text) return;
  if (text.length > 500) return tg.send(chatId, "That message is too long. Keep it short, like <code>lunch 12.50</code>.");
  const command = /^\/([a-z_]{1,32})(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);
  const name = command?.[1].toLowerCase();
  const arg = (command?.[2] ?? "").trim();

  if (name === "start" || name === "link") {
    if (arg) return linkAccount(tg, chatId, arg);
    const link = await getLink(chatId);
    return tg.send(chatId, link ? `You're connected.\n\n${HELP_TEXT}` : "👋 Hi! To connect, open <b>VinExpenses → Account → Connect Telegram</b> and tap the button there.");
  }
  if (name === "help") return tg.send(chatId, HELP_TEXT);

  const link = await getLink(chatId);
  if (!link) return tg.send(chatId, "This chat isn't connected yet. Open <b>VinExpenses → Account → Connect Telegram</b>.");

  switch (name) {
    case "today": return sendSummary(tg, link, "day", now);
    case "month": return sendSummary(tg, link, "month", now);
    case "undo": {
      const message = await undoExpense(tg, link, link.last_expense_id);
      if (message) await tg.send(chatId, message);
      return;
    }
    case "unlink":
      await rest(`telegram_links?chat_id=eq.${chatId}`, { method: "DELETE" });
      return tg.send(chatId, "Disconnected. Your expenses stay in the app. Reconnect any time from Account.");
    case undefined: return addExpense(tg, link, text);
    default: return tg.send(chatId, `I don't know that command.\n\n${HELP_TEXT}`);
  }
}

interface CallbackQuery {
  id?: string;
  data?: string;
  message?: { message_id?: number; chat?: { id?: number; type?: string } };
}

async function onCallback(tg: TelegramClient, cb: CallbackQuery): Promise<void> {
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  if (typeof cb.id !== "string") return;
  await tg.answer(cb.id);
  if (cb.message?.chat?.type !== "private" || !Number.isSafeInteger(chatId) || !Number.isSafeInteger(messageId)) return;
  const link = await getLink(chatId as number);
  if (!link) return;

  const match = /^([ucxk]):([0-9a-f-]{36})(?::(\d{1,2}))?$/i.exec(String(cb.data ?? ""));
  if (!match || !UUID_PATTERN.test(match[2])) return;
  const [, action, id, index] = match;
  const { categories, payments } = await loadChoices(link.user_id);

  if (action === "u") {
    const message = await undoExpense(tg, link, id);
    return tg.edit(chatId as number, messageId as number, message ?? "Already removed.");
  }
  const row = await getExpense(link.user_id, id);
  if (!row) return tg.edit(chatId as number, messageId as number, "That expense no longer exists.");

  if (action === "c") {
    const options = categories.filter((c) => c.active).slice(0, 20);
    const buttons: InlineButton[][] = [];
    options.forEach((c, i) => {
      if (i % 2 === 0) buttons.push([]);
      buttons[buttons.length - 1].push({ text: c.label.slice(0, 24), callback_data: `k:${id}:${i}` });
    });
    buttons.push([{ text: "Cancel", callback_data: `x:${id}` }]);
    return tg.edit(chatId as number, messageId as number, `Choose a category for <b>${escapeHtml(ringgit(Number(row.amount)))}</b>${row.merchant ? ` · ${escapeHtml(row.merchant)}` : ""}`, { buttons });
  }
  if (action === "k") {
    const chosen = categories.filter((c) => c.active).slice(0, 20)[Number(index)];
    if (!chosen) return;
    await rest(`expenses?id=eq.${q(id)}&user_id=eq.${q(link.user_id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ category: chosen.key }) });
    row.category = chosen.key;
  }
  const view = expenseView(row, categories, payments, action === "k" ? "🏷 Updated" : "✅ Saved");
  return tg.edit(chatId as number, messageId as number, view.text, { buttons: view.buttons });
}

async function markSeen(updateId: number): Promise<boolean> {
  const response = await rest("telegram_seen?on_conflict=update_id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({ update_id: updateId }),
  });
  if (!response.ok) throw new Error(`seen-check failed (${response.status})`);
  return (await response.json()).length === 1; // empty = Telegram re-sent an update we already handled
}

export async function handle(request: Request, now = new Date(), clientOverride?: TelegramClient): Promise<Response> {
  if (request.method !== "POST") return plain(405);

  const secret = env("TELEGRAM_WEBHOOK_SECRET") ?? "";
  const token = env("TELEGRAM_BOT_TOKEN") ?? "";
  if (secret.length < 24 || !token || !projectAccess()) {
    console.error("telegram-bot: TELEGRAM_WEBHOOK_SECRET (24+ chars), TELEGRAM_BOT_TOKEN or the database settings are missing");
    return plain(503);
  }
  if (!safeEqual(request.headers.get("x-telegram-bot-api-secret-token") ?? "", secret)) return plain(401);

  let update: { update_id?: number; message?: Record<string, unknown>; callback_query?: CallbackQuery };
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return ok();
    update = JSON.parse(raw);
  } catch (_error) {
    return ok();
  }
  if (!Number.isSafeInteger(update?.update_id)) return ok();

  const tg = clientOverride ?? telegramClient(token);
  try {
    if (!(await markSeen(update.update_id as number))) return ok();
    if (Math.random() < 0.02) {
      await rest(`telegram_seen?seen_at=lt.${q(new Date(Date.now() - 86_400_000).toISOString())}`, { method: "DELETE" });
      await rest(`telegram_link_codes?expires_at=lt.${q(new Date().toISOString())}`, { method: "DELETE" });
    }
    if (update.callback_query) {
      await onCallback(tg, update.callback_query);
      return ok();
    }
    const message = update.message as { chat?: { id?: number; type?: string }; text?: unknown; photo?: unknown; document?: unknown } | undefined;
    const chatId = message?.chat?.id;
    if (!message || message.chat?.type !== "private" || !Number.isSafeInteger(chatId)) return ok();
    if (!(await takeQuota(`tg-msg:${chatId}`, 300))) return ok();
    if (typeof message.text === "string") {
      await onText(tg, chatId as number, message.text, now);
    } else if (message.photo || message.document) {
      await tg.send(chatId as number, "Photos and files aren't supported yet. Type the expense instead, like <code>lunch 12.50</code>.");
    }
  } catch (error) {
    console.error("telegram-bot: update failed", error instanceof Error ? error.message : "unknown");
    const chatId = (update.message as { chat?: { id?: number } } | undefined)?.chat?.id;
    if (Number.isSafeInteger(chatId)) await tg.send(chatId as number, "Something went wrong on my side. Please try again in a moment.");
  }
  return ok();
}
