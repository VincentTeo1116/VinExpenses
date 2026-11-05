// The Telegram bot. Telegram calls this address (the "webhook") for every message sent to the bot.
//
// Who can do what:
//   - Anyone can open the bot, but it only answers /start, /help and /language until a chat is LINKED to an app account.
//   - Linking needs a one-time code that only a signed-in user can create (function telegram-link): 10 characters,
//     valid 10 minutes, usable once, stored only as a hash, with a limit on wrong guesses per chat.
//   - After linking, every action is restricted to that one account. The database is reached with the server key
//     (which ignores row-level security), so EVERY query below filters by the linked user id.
//   - Only private chats are served. Groups and channels are ignored.
//
// Telegram only accepts a reply of 200: anything else makes it re-send the message again and again. So once the
// secret header is proven, this function always answers 200 and reports problems to the user in the chat instead.
//
// Fallbacks: every extra (budgets, duplicate check, language, receipts, weekly summary, reactions, category chips,
// favourites, the bottom menu) is optional. If its table, column or service is missing or fails, the core job
// (saving what the person typed) still works.

import { env, projectAccess, safeEqual, sha256Hex, takeQuota, takeReceiptQuota, dailyLimit } from "../_shared/guard.ts";
import { q, rest } from "../_shared/db.ts";
import { cleanSiteUrl } from "../_shared/email-setup.ts";
import { MAX_IMAGE_BYTES, runOcr } from "../_shared/ocr.ts";
import { loadReceiptParser } from "../_shared/receipt-parser-loader.ts";
import { loadSmartEntry } from "../_shared/smart-entry-loader.ts";
import { extractDate } from "../_shared/tg-dates.ts";
import { bar, emojiFor, escapeHtml, type Lang, RULE, ringgit, truncate } from "../_shared/tg-format.ts";
import { asLang, dayLabel, LANG_NAMES, LANGS, menuAction, menuKeyboard, tr } from "../_shared/tg-i18n.ts";
import { aggregate, budgetUsage, loadBudgets, loadExpenses } from "../_shared/tg-reports.ts";
import { buildView, MAX_OFFSET, pagerButtons, type ViewKind, type ViewResult } from "../_shared/tg-views.ts";
import {
  CODE_PATTERN,
  type InlineButton,
  klWindow,
  parseExpense,
  stripTags,
  type TelegramClient,
  telegramClient,
  UUID_PATTERN,
} from "../_shared/telegram.ts";

const MAX_BODY = 30_000;
const PENDING_MINUTES = 15;
const REACTION = "👌"; // one of the emoji Telegram allows as a free reaction
const DEFAULT_CATEGORIES = [
  ["beverages", "Beverages"], ["travel", "Travel"], ["entertain", "Entertain"], ["work", "Work"], ["food", "Food"],
  ["shopping", "Shopping"], ["utilities", "Utilities"], ["car", "Car"], ["health", "Health"], ["other", "Other"],
].map(([key, label]) => ({ key, label, active: true }));
const DEFAULT_PAYMENTS = [["bank", "Bank"], ["card", "Card"], ["ewallet", "E-Wallet"]].map(([key, label]) => ({ key, label, active: true }));

interface Link {
  chat_id: number;
  user_id: string;
  last_expense_id: string | null;
  lang: Lang;
  digest_on: boolean;
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
  created_at?: string;
}
interface HistoryRow {
  merchant: string | null;
  category: string;
  payment: string;
}
type PendingKind = "receipt" | "receipt_amount" | "edit_amount";
interface Pending {
  kind: PendingKind;
  payload: Record<string, unknown>;
}
interface Status {
  icon: string;
  word: string;
}
type Card = { text: string; buttons: InlineButton[][] };

const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
const plain = (status: number) => new Response(null, { status });

/** Runs an optional extra. Whatever goes wrong, the caller gets the fallback and the main job carries on. */
async function safe<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (_error) {
    return fallback;
  }
}

const money = (value: number | string) => ringgit(Number(value));
const klDayStart = (instant: Date) => klWindow("day", instant);
/** Text for places that do NOT understand HTML (button labels, pop-up toasts): no tags, no &amp; leftovers. */
const plainText = (text: string) => stripTags(text);

/** A "🔗 Open VinExpenses" button, only when the website address is configured. */
function siteRow(lang: Lang): InlineButton[][] {
  const site = cleanSiteUrl(env("SITE_URL"));
  return site ? [[{ text: tr(lang, "btn_open"), url: site }]] : [];
}

// ---------------------------------------------------------------- data access (every query is scoped to one user)

async function getLink(chatId: number): Promise<Link | null> {
  const response = await rest(`telegram_links?select=chat_id,user_id,last_expense_id&chat_id=eq.${chatId}`);
  if (!response.ok) throw new Error(`link lookup failed (${response.status})`);
  const row = (await response.json())[0];
  if (!row) return null;
  // Language and weekly-summary settings live in newer columns: if the database update has not been run yet, use defaults.
  const prefs = await safe(async () => {
    const res = await rest(`telegram_links?select=lang,digest_on&chat_id=eq.${chatId}`);
    return res.ok ? (await res.json())[0] ?? {} : {};
  }, {} as { lang?: string; digest_on?: boolean });
  return { ...row, lang: asLang(prefs.lang), digest_on: prefs.digest_on === true };
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
const labeller = (categories: Choice[]) => (key: string) => labelOf(categories, key);

async function getExpense(userId: string, id: string): Promise<ExpenseRow | null> {
  const response = await rest(`expenses?select=id,amount,category,payment,merchant,created_at&id=eq.${q(id)}&user_id=eq.${q(userId)}`);
  return response.ok ? ((await response.json())[0] ?? null) : null;
}

// ---- waiting-for-an-answer state (receipt confirmation, "send the new amount")
async function setPending(chatId: number, kind: PendingKind, payload: Record<string, unknown>): Promise<void> {
  await rest("telegram_pending?on_conflict=chat_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ chat_id: chatId, kind, payload, expires_at: new Date(Date.now() + PENDING_MINUTES * 60_000).toISOString() }),
  });
}
const getPending = (chatId: number): Promise<Pending | null> =>
  safe(async () => {
    const res = await rest(`telegram_pending?select=kind,payload&chat_id=eq.${chatId}&expires_at=gt.${q(new Date().toISOString())}`);
    return res.ok ? ((await res.json())[0] ?? null) : null;
  }, null);
const clearPending = (chatId: number) => safe(async () => { await rest(`telegram_pending?chat_id=eq.${chatId}`, { method: "DELETE" }); }, undefined);

async function recentExpenses(userId: string, limit: number): Promise<HistoryRow[]> {
  return await safe(async () => {
    const res = await rest(`expenses?select=merchant,category,payment&user_id=eq.${q(userId)}&order=created_at.desc&limit=${limit}`);
    return res.ok ? (await res.json()) as HistoryRow[] : [];
  }, [] as HistoryRow[]);
}

// ---------------------------------------------------------------- automatic category

/**
 * Automatic category, in this order:
 *   1. the built-in knowledge base (known Malaysian merchants, everyday words like "lunch", "petrol", your own
 *      category names, and a hint from the receipt itself),
 *   2. this person's own history (they filed the same place under a category before),
 *   3. otherwise "Other".
 * Whatever it picks, the card says why, and the category chips change it (which also teaches step 2).
 */
export async function chooseCategory(
  description: string,
  categories: Choice[],
  history: { merchant: string | null; category: string }[],
  fallback: string,
  options: { lang?: Lang; hint?: string } = {},
): Promise<{ key: string; why: string; source: "knowledge" | "history" | "none" }> {
  const lang = options.lang ?? "en";
  const none = { key: fallback, why: tr(lang, "why_none"), source: "none" as const };
  const smart = await loadSmartEntry();
  if (!smart || (!description && !options.hint)) return none;
  const usable = (key: string) => categories.some((c) => c.active && c.key === key);
  const sentence = (reason: string, generic: string) => (lang === "en" ? `Auto: ${reason}.` : tr(lang, generic));
  try {
    const hint = options.hint ? { category: options.hint, reason: "The receipt says what kind of purchase it is" } : null;
    // deno-lint-ignore no-explicit-any
    const known = smart.suggestCategory({ merchant: description, text: description, memory: null, categories, hint } as any);
    if (known && usable(known.key)) return { key: known.key, why: sentence(known.reason, "why_known"), source: "knowledge" };
    const learned = smart.suggestCategory({ merchant: description, text: description, memory: smart.buildMerchantMemory(history), categories });
    if (learned && usable(learned.key)) return { key: learned.key, why: sentence(learned.reason, "why_history"), source: "history" };
  } catch (_error) { /* fall through to Other */ }
  return none;
}

// ---------------------------------------------------------------- cards

/**
 * One-tap category chips for a saved expense: the category it has now (ticked), then the ones this person uses most.
 * Returns null when there are not at least two categories to choose from (the classic buttons are used instead).
 */
export function categoryChips(id: string, categories: Choice[], current: string, history: { category: string }[]): InlineButton[][] | null {
  const list = categories.filter((c) => c.active).slice(0, 20); // the same list, in the same order, the "k" button reads back
  if (list.length < 2) return null;
  const uses = new Map<string, number>();
  for (const h of history) uses.set(h.category, (uses.get(h.category) ?? 0) + 1);
  const order = list.map((_, index) => index).sort((a, b) => {
    if (list[a].key === current) return -1;
    if (list[b].key === current) return 1;
    return (uses.get(list[b].key) ?? 0) - (uses.get(list[a].key) ?? 0) || a - b;
  }).slice(0, 4);
  const chips = order.map((index) => ({
    text: truncate(`${list[index].key === current ? "✓ " : ""}${emojiFor(list[index].key)} ${list[index].label}`, 22),
    callback_data: `k:${id}:${index}`,
  }));
  const rows: InlineButton[][] = [];
  for (let i = 0; i < chips.length; i += 2) rows.push(chips.slice(i, i + 2));
  return rows;
}

function expenseCard(
  lang: Lang,
  row: ExpenseRow,
  categories: Choice[],
  payments: Choice[],
  status: Status,
  mode: "saved" | "detail",
  now: Date,
  extras: { alerts?: string[]; notes?: string[]; chips?: InlineButton[][] | null } = {},
): Card {
  const when = row.created_at ? new Date(row.created_at) : now;
  const lines = [`${status.icon} <b>${escapeHtml(money(row.amount))}</b> · ${emojiFor(row.category)} ${escapeHtml(labelOf(categories, row.category))}`];
  const meta = [
    status.word,
    row.merchant ? truncate(row.merchant, 40) : "",
    `💳 ${labelOf(payments, row.payment)}`,
    `📅 ${dayLabel(when, now, lang)}`,
  ].filter(Boolean).map(escapeHtml);
  lines.push(`<i>${meta.join(" · ")}</i>`);
  if (extras.alerts?.length) lines.push("", ...extras.alerts);
  // The budget bars and the reason for the category are details: tucked into a collapsible quote.
  if (extras.notes?.length) lines.push("", `<blockquote expandable>${extras.notes.join("\n")}</blockquote>`);

  const id = row.id;
  let buttons: InlineButton[][];
  if (mode === "saved") {
    const chips = extras.chips ?? null;
    buttons = [...(chips ?? [])];
    buttons.push(chips
      ? [{ text: tr(lang, "btn_more"), callback_data: `c:${id}` }, { text: tr(lang, "btn_undo"), callback_data: `u:${id}` }, { text: tr(lang, "btn_edit"), callback_data: `v:${id}` }]
      : [{ text: tr(lang, "btn_undo"), callback_data: `u:${id}` }, { text: tr(lang, "btn_category"), callback_data: `c:${id}` }, { text: tr(lang, "btn_edit"), callback_data: `v:${id}` }]);
  } else {
    buttons = [
      [{ text: tr(lang, "btn_amount"), callback_data: `a:${id}` }, { text: tr(lang, "btn_category"), callback_data: `c:${id}` }, { text: tr(lang, "btn_delete"), callback_data: `d:${id}` }],
      [{ text: tr(lang, "btn_back"), callback_data: "b:0" }],
    ];
  }
  return { text: lines.join("\n"), buttons };
}

const whatOf = (row: { merchant?: string | null }) => (row.merchant ? ` · ${row.merchant}` : "");

// ---------------------------------------------------------------- extras that may fail without hurting the main job

/** Budget progress lines for the month the expense belongs to, plus a heads-up when this expense crossed 80% or 100%. */
async function budgetNotes(link: Link, categories: Choice[], category: string, amount: number, when: Date): Promise<{ progress: string[]; alerts: string[] }> {
  return await safe(async () => {
    const budgets = await loadBudgets(link.user_id);
    const relevant = budgets.filter((b) => b.category === category || b.category === "all");
    if (!relevant.length) return { progress: [], alerts: [] };
    const win = klWindow("month", when);
    const agg = aggregate(await loadExpenses(link.user_id, win.start, win.end));
    const progress: string[] = [];
    const alerts: string[] = [];
    const labels = labeller(categories);
    for (const usage of budgetUsage(relevant, agg)) {
      const name = usage.key === "all" ? tr(link.lang, "budget_overall") : labels(usage.key);
      const emoji = usage.key === "all" ? "🎯" : emojiFor(usage.key);
      const before = (usage.used - amount) / usage.limit;
      progress.push(`${emoji} <b>${escapeHtml(truncate(name, 18))}</b> ${tr(link.lang, "budget_line", { bar: bar(usage.ratio), pct: `${Math.round(usage.ratio * 100)}%`, used: ringgit(usage.used), limit: ringgit(usage.limit) })}`);
      if (usage.ratio > 1 && before <= 1) alerts.push(tr(link.lang, "budget_over", { name, amount: ringgit(usage.used - usage.limit) }));
      else if (usage.ratio >= 0.8 && usage.ratio <= 1 && before < 0.8) alerts.push(tr(link.lang, "budget_warn", { name, pct: `${Math.round(usage.ratio * 100)}%` }));
    }
    return { progress, alerts };
  }, { progress: [], alerts: [] });
}

/** An earlier expense the same day with the same amount and place (or, with no place, the same category). */
async function duplicateOf(link: Link, row: ExpenseRow, when: Date): Promise<ExpenseRow | null> {
  return await safe(async () => {
    const win = klDayStart(when);
    const res = await rest(
      `expenses?select=id,amount,merchant,category&user_id=eq.${q(link.user_id)}&id=neq.${q(row.id)}&created_at=gte.${q(win.start)}&created_at=lt.${q(win.end)}&limit=300`,
    );
    if (!res.ok) return null;
    const smart = await loadSmartEntry();
    const norm = (value: string | null | undefined) => {
      const text = (value ?? "").trim();
      // deno-lint-ignore no-explicit-any
      const fn = (smart as any)?.normalizeMerchant;
      return (typeof fn === "function" ? fn(text) : text.toLowerCase()) as string;
    };
    const cents = Math.round(Number(row.amount) * 100);
    const mine = norm(row.merchant);
    const same = ((await res.json()) as ExpenseRow[]).find((other) => {
      if (Math.round(Number(other.amount) * 100) !== cents) return false;
      const theirs = norm(other.merchant);
      if (mine && theirs) return mine === theirs || mine.startsWith(theirs + " ") || theirs.startsWith(mine + " ");
      return other.category === row.category;
    });
    return same ?? null;
  }, null);
}

// ---------------------------------------------------------------- saving

interface NewExpense {
  amount: number;
  merchant: string | null;
  category: string;
  payment: string;
  createdAt: Date | null;
  note: string;
}

async function insertExpense(link: Link, e: NewExpense): Promise<ExpenseRow | null> {
  const created = await rest("expenses", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: link.user_id, amount: e.amount, category: e.category, payment: e.payment, merchant: e.merchant, note: e.note,
      ...(e.createdAt ? { created_at: e.createdAt.toISOString() } : {}),
    }),
  });
  const row = created.ok ? ((await created.json()) as ExpenseRow[])[0] : undefined;
  if (!row) return null;
  await safe(async () => {
    await rest(`telegram_links?chat_id=eq.${link.chat_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_expense_id: row.id }) });
  }, undefined);
  return row;
}

/** The "Saved" card: headline, duplicate warning and budget alerts up front; budget bars and the reason in a collapsible quote. */
async function savedMessage(
  link: Link, row: ExpenseRow, categories: Choice[], payments: Choice[], now: Date, why: string, status: Status, history?: HistoryRow[],
): Promise<Card> {
  const when = row.created_at ? new Date(row.created_at) : now;
  const [dup, budget, recent] = await Promise.all([
    duplicateOf(link, row, when),
    budgetNotes(link, categories, row.category, Number(row.amount), when),
    history ? Promise.resolve(history) : recentExpenses(link.user_id, 300),
  ]);
  const alerts: string[] = [];
  if (dup) alerts.push(tr(link.lang, "dup_warn", { amount: money(row.amount), what: dup.merchant || labelOf(categories, dup.category) }));
  alerts.push(...budget.alerts);
  const notes = [...budget.progress];
  if (why) notes.push(`<i>${escapeHtml(why)}</i>`);
  return expenseCard(link.lang, row, categories, payments, status, "saved", now, { alerts, notes, chips: categoryChips(row.id, categories, row.category, recent) });
}

/** A saved-style card without the slower extras (used after a quick edit, where only the buttons matter). */
async function quickCard(link: Link, row: ExpenseRow, categories: Choice[], payments: Choice[], now: Date, status: Status): Promise<Card> {
  const history = await recentExpenses(link.user_id, 300);
  return expenseCard(link.lang, row, categories, payments, status, "saved", now, { chips: categoryChips(row.id, categories, row.category, history) });
}

const bare = (text: string) => text.toLowerCase().replace(/[^a-z0-9-]/g, "");

function paymentFor(payments: Choice[], word: string | null, recent: { payment: string }[]): string {
  const active = payments.filter((p) => p.active);
  const byWord = word ? active.find((p) => p.key === word || bare(p.label) === word) : undefined;
  const lastUsed = active.find((p) => p.key === recent[0]?.payment);
  return (byWord ?? lastUsed ?? active[0])?.key ?? "bank";
}

async function addExpense(tg: TelegramClient, link: Link, text: string, now: Date, messageId?: number): Promise<void> {
  const lang = link.lang;
  const date = extractDate(text, now);
  if (date.error) return void await tg.send(link.chat_id, tr(lang, date.error === "future" ? "date_future" : "date_old"));
  const { categories, payments } = await loadChoices(link.user_id);
  const words = payments.flatMap((p) => [p.key, bare(p.label)]);
  const parsed = parseExpense(date.text, words);
  if (!parsed) return void await tg.send(link.chat_id, tr(lang, "no_amount"));
  if (!(await takeQuota(`tg-add:${link.chat_id}`, 100))) return void await tg.send(link.chat_id, tr(lang, "add_limit"));

  const recent = await recentExpenses(link.user_id, 300);
  const activeCategories = categories.filter((c) => c.active);
  const fallback = (activeCategories.find((c) => c.key === "other") ?? activeCategories[0])?.key ?? "other";
  const decision = await chooseCategory(parsed.description, categories, recent, fallback, { lang });

  const row = await insertExpense(link, {
    amount: parsed.amount, merchant: parsed.description || null, category: decision.key,
    payment: paymentFor(payments, parsed.paymentWord, recent), createdAt: date.at, note: "via Telegram",
  });
  if (!row) return void await tg.send(link.chat_id, tr(lang, "cant_save"));
  // Instant "got it" on the person's own message, before the card is built.
  if (messageId) await safe(() => tg.react(link.chat_id, messageId, REACTION), undefined);
  const view = await savedMessage(link, row, categories, payments, now, decision.why, { icon: "✅", word: tr(lang, "st_saved") }, recent);
  await tg.send(link.chat_id, view.text, { buttons: view.buttons });
}

const INCOME_PREFIX = /^\s*(?:\+|(?:income|pendapatan|收入)(?=\s*(?:rm|myr)?\s*\d))\s*/i;
const INCOME_SOURCES: [RegExp, string][] = [
  [/^(salary|gaji|工资|薪水)$/i, "Salary"], [/^(freelance|projek)$/i, "Freelance"],
  [/^(bonus|奖金)$/i, "Bonus"], [/^(invest\w*|dividend\w*|saham|投资)$/i, "Investment"],
];

async function addIncome(tg: TelegramClient, link: Link, text: string, now: Date, messageId?: number): Promise<void> {
  const lang = link.lang;
  const date = extractDate(text.replace(INCOME_PREFIX, ""), now);
  if (date.error) return void await tg.send(link.chat_id, tr(lang, date.error === "future" ? "date_future" : "date_old"));
  const parsed = parseExpense(date.text, []);
  if (!parsed) return void await tg.send(link.chat_id, tr(lang, "no_amount"));
  if (!(await takeQuota(`tg-add:${link.chat_id}`, 100))) return void await tg.send(link.chat_id, tr(lang, "add_limit"));
  const word = parsed.description.trim();
  const source = INCOME_SOURCES.find(([pattern]) => pattern.test(word))?.[1] ?? (word ? word.charAt(0).toUpperCase() + word.slice(1, 40) : "Salary");
  const created = await rest("incomes", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ user_id: link.user_id, amount: parsed.amount, source, ...(date.at ? { created_at: date.at.toISOString() } : {}) }),
  });
  const row = created.ok ? ((await created.json()) as { id: string }[])[0] : undefined;
  if (!row) return void await tg.send(link.chat_id, tr(lang, "cant_save"));
  if (messageId) await safe(() => tg.react(link.chat_id, messageId, REACTION), undefined);
  const when = date.at ?? now;
  await tg.send(link.chat_id, `💰 <b>${escapeHtml(money(parsed.amount))}</b> · ${escapeHtml(source)}\n<i>${escapeHtml(tr(lang, "st_income"))} · 📅 ${escapeHtml(dayLabel(when, now, lang))}</i>`, {
    buttons: [[{ text: tr(lang, "btn_undo"), callback_data: `i:${row.id}` }]],
  });
}

// ---------------------------------------------------------------- the "Add" prompt: repeat the last one, or a favourite

interface Favourites {
  last: ExpenseRow | null;
  favs: ExpenseRow[];
}

/** The most recent expense, and up to 4 "usual" ones: the same place and amount logged at least twice. */
async function favouritesFor(userId: string): Promise<Favourites> {
  return await safe(async () => {
    const res = await rest(`expenses?select=id,amount,category,payment,merchant&user_id=eq.${q(userId)}&order=created_at.desc&limit=300`);
    if (!res.ok) return { last: null, favs: [] };
    const rows = (await res.json()) as ExpenseRow[];
    const smart = await loadSmartEntry();
    // deno-lint-ignore no-explicit-any
    const normalise = (smart as any)?.normalizeMerchant;
    const key = (r: ExpenseRow) => {
      const name = (r.merchant ?? "").trim();
      const place = name ? (typeof normalise === "function" ? normalise(name) : name.toLowerCase()) : `~${r.category}`;
      return `${place}|${Math.round(Number(r.amount) * 100)}`;
    };
    const groups = new Map<string, { row: ExpenseRow; n: number }>();
    for (const r of rows) {
      const k = key(r);
      const g = groups.get(k);
      if (g) g.n += 1; else groups.set(k, { row: r, n: 1 }); // the first seen is the most recent
    }
    const last = rows[0] ?? null;
    const favs = [...groups.values()].filter((g) => g.n >= 2).sort((a, b) => b.n - a.n).map((g) => g.row)
      .filter((r) => !last || key(r) !== key(last)).slice(0, 4);
    return { last, favs };
  }, { last: null, favs: [] } as Favourites);
}

async function sendAddPrompt(tg: TelegramClient, link: Link, messageId?: number): Promise<void> {
  const lang = link.lang;
  const { categories } = await loadChoices(link.user_id);
  const { last, favs } = await favouritesFor(link.user_id);
  const label = (r: ExpenseRow) => truncate(`${emojiFor(r.category)} ${r.merchant || labelOf(categories, r.category)} ${money(r.amount)}`, 34);
  const buttons: InlineButton[][] = [];
  if (last) buttons.push([{ text: truncate(`${tr(lang, "btn_repeat", { what: "" })}${label(last)}`, 60), callback_data: `f:${last.id}` }]);
  for (let i = 0; i < favs.length; i += 2) buttons.push(favs.slice(i, i + 2).map((r) => ({ text: label(r), callback_data: `f:${r.id}` })));
  const text = tr(lang, "add_prompt") + (favs.length ? tr(lang, "add_favs") : "");
  if (messageId) await tg.edit(link.chat_id, messageId, text, buttons.length ? { buttons } : undefined);
  else await tg.send(link.chat_id, text, buttons.length ? { buttons } : undefined);
}

// ---------------------------------------------------------------- receipts

function receiptCard(lang: Lang, p: Record<string, unknown>, categories: Choice[], payments: Choice[], now: Date): Card {
  const when = typeof p.date === "string" && p.date ? new Date(`${p.date}T12:00:00+08:00`) : null;
  const lines = [
    tr(lang, "receipt_title"),
    RULE,
    `${emojiFor(String(p.category))} <b>${escapeHtml(money(Number(p.amount)))}</b> · ${escapeHtml(labelOf(categories, String(p.category)))}`,
    [
      p.merchant ? `📍 ${escapeHtml(truncate(String(p.merchant), 40))}` : "",
      `💳 ${escapeHtml(labelOf(payments, String(p.payment)))}`,
      `📅 ${escapeHtml(dayLabel(when ?? now, now, lang))}`,
    ].filter(Boolean).join("   "),
  ];
  if (p.why) lines.push(`<i>${escapeHtml(String(p.why))}</i>`);
  if (p.foreign) lines.push(tr(lang, "receipt_foreign"));
  const buttons: InlineButton[][] = [[
    { text: tr(lang, "btn_save"), callback_data: "r:s" },
    { text: tr(lang, "btn_edit_amount"), callback_data: "r:e" },
    { text: tr(lang, "btn_cancel"), callback_data: "r:x" },
  ]];
  return { text: lines.join("\n"), buttons };
}

async function onPhoto(
  tg: TelegramClient,
  link: Link,
  message: { photo?: { file_id?: string; file_size?: number }[]; document?: { file_id?: string; file_size?: number; mime_type?: string } },
  now: Date,
): Promise<void> {
  const lang = link.lang;
  const apiKey = env("OCR_SPACE_API_KEY");
  if (!apiKey) return void await tg.send(link.chat_id, tr(lang, "photo_unavailable"));

  // The best picture that fits OCR.space's 1 MB limit: the largest size that is small enough.
  let fileId: string | undefined;
  if (Array.isArray(message.photo) && message.photo.length) {
    const sizes = message.photo.filter((p) => typeof p?.file_id === "string");
    const fits = sizes.filter((p) => typeof p.file_size !== "number" || p.file_size <= MAX_IMAGE_BYTES);
    fileId = (fits.length ? fits[fits.length - 1] : sizes[0])?.file_id;
  } else if (message.document && /^image\/(jpeg|png|webp)$/i.test(message.document.mime_type ?? "")) {
    if ((message.document.file_size ?? 0) > MAX_IMAGE_BYTES) return void await tg.send(link.chat_id, tr(lang, "receipt_too_big"));
    fileId = message.document.file_id;
  }
  if (!fileId) return void await tg.send(link.chat_id, tr(lang, "receipt_unreadable"));

  if (!(await takeReceiptQuota(link.user_id, dailyLimit("SCAN_DAILY_LIMIT", 30)))) return void await tg.send(link.chat_id, tr(lang, "receipt_limit"));

  // ONE live message: "Reading…" becomes the result (or the explanation) instead of leaving several messages behind.
  await safe(() => tg.action(link.chat_id), undefined);
  const progress = await tg.send(link.chat_id, tr(lang, "receipt_reading"));
  const show = async (text: string, options?: { buttons?: InlineButton[][] }) => {
    if (typeof progress === "number") await tg.edit(link.chat_id, progress, text, options);
    else await tg.send(link.chat_id, text, options);
  };

  const file = await tg.fileBytes(fileId, MAX_IMAGE_BYTES);
  if ("error" in file) return show(tr(lang, file.error === "too_large" ? "receipt_too_big" : "receipt_unreadable"));
  const ocr = await runOcr(apiKey, file.bytes);
  if (!ocr.ok) {
    const key = ocr.reason === "too_large" ? "receipt_too_big" : ocr.reason === "service" ? "photo_unavailable" : "receipt_unreadable";
    return show(tr(lang, key));
  }
  const parser = await loadReceiptParser();
  if (!parser) return show(tr(lang, "photo_unavailable"));
  const parsed = parser.parseBest([ocr.text], { now });

  const merchant = (parsed.merchant ?? "").trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) && extractDate(parsed.date, now).error === null ? parsed.date : "";
  const { categories, payments } = await loadChoices(link.user_id);
  const recent = await recentExpenses(link.user_id, 300);
  const activeCategories = categories.filter((c) => c.active);
  const fallback = (activeCategories.find((c) => c.key === "other") ?? activeCategories[0])?.key ?? "other";
  const decision = await chooseCategory(merchant, categories, recent, fallback, { lang, hint: parsed.hints?.category });
  const payload = {
    amount: parsed.amount > 0 ? parsed.amount : 0, merchant, date, category: decision.key, why: decision.why,
    payment: paymentFor(payments, null, recent), foreign: (parsed.warnings ?? []).length > 0,
  };
  if (!(payload.amount > 0)) {
    await setPending(link.chat_id, "receipt_amount", payload);
    return show(tr(lang, "receipt_not_sure", { merchant: merchant ? ` (${escapeHtml(merchant)})` : "" }));
  }
  await setPending(link.chat_id, "receipt", payload);
  const card = receiptCard(lang, payload, categories, payments, now);
  await show(card.text, { buttons: card.buttons });
}

// ---------------------------------------------------------------- settings

async function sendSettings(tg: TelegramClient, link: Link, messageId?: number): Promise<void> {
  const lang = link.lang;
  const text = [tr(lang, "settings_title"), RULE, tr(lang, "settings_lang", { name: LANG_NAMES[lang] }), tr(lang, link.digest_on ? "settings_digest_on" : "settings_digest_off")].join("\n");
  const buttons: InlineButton[][] = [
    [{ text: tr(lang, "btn_set_lang"), callback_data: "s:lang" }],
    [{ text: tr(lang, link.digest_on ? "btn_digest_off" : "btn_digest_on"), callback_data: "s:dg" }],
    ...siteRow(lang),
    [{ text: tr(lang, "btn_unlink"), callback_data: "s:ul" }],
  ];
  if (messageId) await tg.edit(link.chat_id, messageId, text, { buttons });
  else await tg.send(link.chat_id, text, { buttons });
}

// ---------------------------------------------------------------- commands

async function linkAccount(tg: TelegramClient, chatId: number, rawCode: string, guessLang: Lang): Promise<void> {
  const code = rawCode.trim().toUpperCase();
  if (!(await takeQuota(`tg-link:${chatId}`, 10))) return void await tg.send(chatId, tr(guessLang, "link_limit"));
  if (!CODE_PATTERN.test(code)) return void await tg.send(chatId, tr(guessLang, "link_bad"));

  const hash = await sha256Hex(`${env("TELEGRAM_WEBHOOK_SECRET")}:${code}`);
  // Deleting the row IS the check: it can only succeed once, and only before it expires.
  const used = await rest(`telegram_link_codes?code_hash=eq.${hash}&expires_at=gt.${q(new Date().toISOString())}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  const rows = used.ok ? (await used.json()) as { user_id: string }[] : [];
  if (rows.length !== 1) return void await tg.send(chatId, tr(guessLang, "link_invalid"));

  const userId = rows[0].user_id;
  const existing = await getLink(chatId);
  if (existing && existing.user_id !== userId) return void await tg.send(chatId, tr(guessLang, "link_other"));
  await rest(`telegram_links?user_id=eq.${q(userId)}`, { method: "DELETE" }); // one chat per account
  let created = await rest("telegram_links", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ chat_id: chatId, user_id: userId, lang: guessLang }) });
  if (!created.ok) created = await rest("telegram_links", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ chat_id: chatId, user_id: userId }) });
  if (!created.ok) throw new Error(`could not save link (${created.status})`);
  // Welcome message + the always-visible menu (the language is the one chosen at link time).
  await tg.send(chatId, tr(guessLang, "onboard"), { keyboard: menuKeyboard(guessLang) });
}

// ---------------------------------------------------------------- reports: Today / Week / Month / Top

/**
 * Shows a report. Week and Month are a picture with a caption; Today and Top are text. Every report carries the same
 * navigation buttons. When a button is pressed (`existing`), the SAME message is updated in place if the new view is
 * the same kind (picture to picture, text to text); otherwise the new view is sent and the old message removed.
 * Fallbacks: a picture that cannot be drawn or sent becomes the text report; an edit that fails becomes a new message.
 * Returns a short pop-up text when something worth telling the person happened.
 */
async function showView(
  tg: TelegramClient, link: Link, view: ViewKind, offset: number, now: Date, existing?: { messageId: number; isPhoto: boolean },
): Promise<string | undefined> {
  const lang = link.lang;
  const chat = link.chat_id;
  if (!(await takeQuota(`tg-view:${chat}`, 300))) {
    if (existing) return plainText(tr(lang, "view_limit"));
    await tg.send(chat, tr(lang, "view_limit"));
    return;
  }
  await safe(() => tg.action(chat), undefined);
  let result: ViewResult;
  try {
    const { categories } = await loadChoices(link.user_id);
    result = await buildView({ userId: link.user_id, lang, now, view, offset, labels: labeller(categories) });
  } catch (_error) {
    if (existing) return plainText(tr(lang, "view_failed"));
    await tg.send(chat, tr(lang, "went_wrong"));
    return;
  }
  const siteUrl = cleanSiteUrl(env("SITE_URL"));
  const photo = result.kind === "photo" && result.png ? result.png : null;
  const buttons = pagerButtons(lang, view, offset, { details: photo !== null, siteUrl });

  // A new message: the picture if there is one, otherwise (or if Telegram refuses it) the complete text report.
  const sendNew = async (): Promise<number | null> => {
    if (photo) {
      const id = await safe(() => tg.sendPhoto(chat, photo, result.text, { buttons }), null);
      if (typeof id === "number") return id;
      const textButtons = pagerButtons(lang, view, offset, { details: false, siteUrl });
      return (await tg.send(chat, result.full, { buttons: textButtons })) ?? null;
    }
    return (await tg.send(chat, result.text, { buttons })) ?? null;
  };

  if (!existing) { await sendNew(); return; }
  if (photo && existing.isPhoto) {
    if (await safe(() => tg.editPhoto(chat, existing.messageId, photo, result.text, { buttons }), false)) return;
  } else if (!photo && !existing.isPhoto) {
    await tg.edit(chat, existing.messageId, result.text, { buttons });
    return;
  }
  // A different kind of message (or the edit failed): send the new view, and only then remove the old one.
  const id = await sendNew();
  if (id !== null) await safe(() => tg.remove(chat, existing.messageId), undefined);
}

/** The complete text version of a picture report (the Details button): a new message, so the picture stays. */
async function showDetails(tg: TelegramClient, link: Link, view: ViewKind, offset: number, now: Date): Promise<string | undefined> {
  const lang = link.lang;
  if (!(await takeQuota(`tg-view:${link.chat_id}`, 300))) return plainText(tr(lang, "view_limit"));
  try {
    const { categories } = await loadChoices(link.user_id);
    const result = await buildView({ userId: link.user_id, lang, now, view, offset, labels: labeller(categories) });
    await tg.send(link.chat_id, result.full);
  } catch (_error) {
    return plainText(tr(lang, "view_failed"));
  }
}

const VIEW_OF_COMMAND: Record<string, ViewKind> = { today: "d", week: "w", month: "m", top: "p" };

async function sendRecent(tg: TelegramClient, link: Link, messageId?: number): Promise<void> {
  const lang = link.lang;
  const res = await rest(`expenses?select=id,amount,category,merchant,created_at&user_id=eq.${q(link.user_id)}&order=created_at.desc&limit=6`);
  const rows = res.ok ? (await res.json()) as ExpenseRow[] : [];
  if (!rows.length) {
    const empty = tr(lang, "recent_empty");
    if (messageId) await tg.edit(link.chat_id, messageId, empty); else await tg.send(link.chat_id, empty);
    return;
  }
  const { categories } = await loadChoices(link.user_id);
  const now = new Date();
  const buttons = rows.map((r) => [{
    text: truncate(`${emojiFor(r.category)} ${money(r.amount)} · ${r.merchant || labelOf(categories, r.category)} · ${dayLabel(new Date(r.created_at ?? Date.now()), now, lang)}`, 56),
    callback_data: `v:${r.id}`,
  }]);
  const text = tr(lang, "recent_title");
  if (messageId) await tg.edit(link.chat_id, messageId, text, { buttons }); else await tg.send(link.chat_id, text, { buttons });
}

async function undoExpense(link: Link, id: string | null): Promise<string | null> {
  if (!id || !UUID_PATTERN.test(id)) return null;
  const removed = await rest(`expenses?id=eq.${q(id)}&user_id=eq.${q(link.user_id)}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
  const rows = removed.ok ? (await removed.json()) as ExpenseRow[] : [];
  if (link.last_expense_id === id) {
    await safe(async () => {
      await rest(`telegram_links?chat_id=eq.${link.chat_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_expense_id: null }) });
    }, undefined);
  }
  if (!rows.length) return null;
  return tr(link.lang, "removed", { amount: money(rows[0].amount), what: whatOf(rows[0]) });
}

async function onText(tg: TelegramClient, chatId: number, rawText: string, now: Date, guessLang: Lang, messageId?: number): Promise<void> {
  const text = rawText.trim();
  if (!text) return;
  if (text.length > 500) return void await tg.send(chatId, tr(guessLang, "too_long"));
  const menu = menuAction(text); // the bottom-menu buttons arrive as plain text, in any language
  const command = menu ? null : /^\/([a-z_]{1,32})(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);
  const name = menu ?? command?.[1].toLowerCase();
  const arg = (command?.[2] ?? "").trim();

  if (name === "start" || name === "link") {
    if (arg) return linkAccount(tg, chatId, arg, guessLang);
    const link = await getLink(chatId);
    if (link) await tg.send(chatId, `${tr(link.lang, "already_connected")}\n\n${tr(link.lang, "help")}`, { keyboard: menuKeyboard(link.lang) });
    else await tg.send(chatId, tr(guessLang, "welcome"));
    return;
  }
  if (name === "help") {
    const link = await safe(() => getLink(chatId), null);
    await tg.send(chatId, tr(link?.lang ?? guessLang, "help"), link ? { keyboard: menuKeyboard(link.lang) } : undefined);
    return;
  }

  const link = await getLink(chatId);
  if (!link) return void await tg.send(chatId, tr(guessLang, "not_connected"));
  const lang = link.lang;

  if (name === "cancel") {
    await clearPending(chatId);
    return void await tg.send(chatId, tr(lang, "edit_cancelled"));
  }
  if (name) await clearPending(chatId); // any other command abandons "send me the amount"

  switch (name) {
    case "today": case "week": case "month": case "top": await showView(tg, link, VIEW_OF_COMMAND[name], 0, now); return;
    case "recent": return sendRecent(tg, link);
    case "add": return sendAddPrompt(tg, link);
    case "settings": return sendSettings(tg, link);
    case "menu": await tg.send(chatId, tr(lang, "menu_ready"), { keyboard: menuKeyboard(lang) }); return;
    case "undo": {
      const message = await undoExpense(link, link.last_expense_id);
      await tg.send(chatId, message ?? tr(lang, "undo_none"));
      return;
    }
    case "language": case "lang":
      await tg.send(chatId, tr(lang, "lang_prompt"), { buttons: [LANGS.map((code) => ({ text: LANG_NAMES[code], callback_data: `l:${code}` }))] });
      return;
    case "digest": {
      const want = arg.toLowerCase();
      if (want !== "on" && want !== "off") return void await tg.send(chatId, tr(lang, link.digest_on ? "digest_status_on" : "digest_status_off"));
      const res = await rest(`telegram_links?chat_id=eq.${chatId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ digest_on: want === "on" }) });
      return void await tg.send(chatId, tr(lang, res.ok ? (want === "on" ? "digest_on" : "digest_off") : "digest_unavailable"));
    }
    case "unlink":
      await rest(`telegram_links?chat_id=eq.${chatId}`, { method: "DELETE" });
      return void await tg.send(chatId, tr(lang, "unlinked"));
    case undefined: break;
    default: return void await tg.send(chatId, tr(lang, "unknown_cmd", { help: tr(lang, "help") }));
  }

  // ---- plain text. First: is the person answering a question the bot asked?
  const pending = await getPending(chatId);
  if (pending && (pending.kind === "edit_amount" || pending.kind === "receipt_amount")) {
    const asAmount = parseExpense(text, []);
    const onlyAmount = asAmount && !asAmount.description && !asAmount.paymentWord;
    if (onlyAmount) {
      const { categories, payments } = await loadChoices(link.user_id);
      if (pending.kind === "receipt_amount") {
        const payload = { ...pending.payload, amount: asAmount.amount };
        await setPending(chatId, "receipt", payload);
        const card = receiptCard(lang, payload, categories, payments, now);
        return void await tg.send(chatId, card.text, { buttons: card.buttons });
      }
      const id = String(pending.payload.id ?? "");
      if (!UUID_PATTERN.test(id)) { await clearPending(chatId); return void await tg.send(chatId, tr(lang, "gone")); }
      const patched = await rest(`expenses?id=eq.${q(id)}&user_id=eq.${q(link.user_id)}`, {
        method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ amount: asAmount.amount }),
      });
      const row = patched.ok ? ((await patched.json()) as ExpenseRow[])[0] : undefined;
      await clearPending(chatId);
      if (!row) return void await tg.send(chatId, tr(lang, "gone"));
      if (messageId) await safe(() => tg.react(chatId, messageId, REACTION), undefined);
      const card = await quickCard(link, row, categories, payments, now, { icon: "✏️", word: tr(lang, "st_amount") });
      return void await tg.send(chatId, card.text, { buttons: card.buttons });
    }
    if (!asAmount) return void await tg.send(chatId, tr(lang, "amount_invalid")); // keep waiting for a proper amount
    await clearPending(chatId); // they typed a whole new expense instead: forget the question
  }

  if (INCOME_PREFIX.test(text) && /\d/.test(text)) return addIncome(tg, link, text, now, messageId);
  return addExpense(tg, link, text, now, messageId);
}

// ---------------------------------------------------------------- buttons

interface CallbackQuery {
  id?: string;
  data?: string;
  message?: { message_id?: number; chat?: { id?: number; type?: string }; photo?: unknown[] };
}

/** Runs a button press and always acknowledges it; the returned text (if any) pops up as a small toast. */
async function onCallback(tg: TelegramClient, cb: CallbackQuery, now: Date): Promise<void> {
  if (typeof cb.id !== "string") return;
  let toast: string | undefined;
  try {
    toast = await runCallback(tg, cb, now);
  } finally {
    await tg.answer(cb.id, toast);
  }
}

async function runCallback(tg: TelegramClient, cb: CallbackQuery, now: Date): Promise<string | undefined> {
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  if (cb.message?.chat?.type !== "private" || !Number.isSafeInteger(chatId) || !Number.isSafeInteger(messageId)) return;
  const chat = chatId as number;
  const msg = messageId as number;
  const link = await getLink(chat);
  if (!link) return;
  const lang = link.lang;
  const data = String(cb.data ?? "");
  const edit = (text: string, options?: { buttons?: InlineButton[][] }) => tg.edit(chat, msg, text, options);

  // ---- language picker
  const pick = /^l:(en|ms|zh)$/.exec(data);
  if (pick) {
    const newLang = pick[1] as Lang;
    const res = await rest(`telegram_links?chat_id=eq.${chat}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ lang: newLang }) });
    if (!res.ok) { await edit(tr(lang, "digest_unavailable")); return; }
    await edit(tr(newLang, "lang_set", { name: LANG_NAMES[newLang] }));
    // The bottom menu is in the old language: replace it.
    await tg.send(chat, tr(newLang, "menu_ready"), { keyboard: menuKeyboard(newLang) });
    return;
  }
  if (data === "b:0") { await sendRecent(tg, link, msg); return; }

  // ---- settings
  const setting = /^s:(lang|dg|ul|uy|back)$/.exec(data);
  if (setting) {
    switch (setting[1]) {
      case "lang":
        await edit(tr(lang, "lang_prompt"), { buttons: [LANGS.map((code) => ({ text: LANG_NAMES[code], callback_data: `l:${code}` }))] });
        return;
      case "dg": {
        const res = await rest(`telegram_links?chat_id=eq.${chat}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ digest_on: !link.digest_on }) });
        if (!res.ok) return plainText(tr(lang, "toast_unavailable"));
        link.digest_on = !link.digest_on;
        await sendSettings(tg, link, msg);
        return;
      }
      case "ul":
        await edit(tr(lang, "unlink_confirm"), { buttons: [[{ text: tr(lang, "btn_yes_unlink"), callback_data: "s:uy" }, { text: tr(lang, "btn_cancel"), callback_data: "s:back" }]] });
        return;
      case "uy":
        await rest(`telegram_links?chat_id=eq.${chat}`, { method: "DELETE" });
        await edit(tr(lang, "unlinked"));
        return;
      default:
        await sendSettings(tg, link, msg);
        return;
    }
  }

  // ---- report navigation: n:<view>:<offset> switches or pages in place, n:f<view>:<offset> shows the full text
  const nav = /^n:([dwmp]):(\d{1,3})$/.exec(data);
  if (nav) {
    const kind = nav[1] as ViewKind;
    const offset = Number(nav[2]);
    if (offset > MAX_OFFSET[kind]) return;
    return await showView(tg, link, kind, offset, now, { messageId: msg, isPhoto: Array.isArray(cb.message?.photo) && cb.message!.photo!.length > 0 });
  }
  const more = /^n:f([wm]):(\d{1,3})$/.exec(data);
  if (more) {
    const kind = more[1] as ViewKind;
    if (Number(more[2]) > MAX_OFFSET[kind]) return;
    return await showDetails(tg, link, kind, Number(more[2]), now);
  }

  // ---- receipt confirmation
  const receipt = /^r:([sex])$/.exec(data);
  if (receipt) {
    const pending = await getPending(chat);
    if (!pending || pending.kind !== "receipt") { await edit(tr(lang, "receipt_expired")); return; }
    const { categories, payments } = await loadChoices(link.user_id);
    if (receipt[1] === "x") { await clearPending(chat); await edit(tr(lang, "receipt_cancelled")); return; }
    if (receipt[1] === "e") {
      await setPending(chat, "receipt_amount", pending.payload);
      await edit(tr(lang, "ask_amount"));
      return;
    }
    const p = pending.payload;
    const when = typeof p.date === "string" && p.date ? new Date(`${p.date}T12:00:00+08:00`) : null;
    const row = await insertExpense(link, {
      amount: Number(p.amount), merchant: p.merchant ? String(p.merchant) : null, category: String(p.category),
      payment: String(p.payment), createdAt: when && klDayStart(when).start !== klDayStart(now).start ? when : null, note: "via Telegram receipt",
    });
    if (!row) { await edit(tr(lang, "cant_save")); return; }
    await clearPending(chat);
    const view = await savedMessage(link, row, categories, payments, now, String(p.why ?? ""), { icon: "🧾", word: tr(lang, "st_receipt") });
    await edit(view.text, { buttons: view.buttons });
    return plainText(tr(lang, "toast_saved"));
  }

  const match = /^([ucxkvadify]):([0-9a-f-]{36})(?::(\d{1,2}))?$/i.exec(data);
  if (!match || !UUID_PATTERN.test(match[2])) return;
  const [, action, id, index] = match;

  if (action === "i") {
    const removed = await rest(`incomes?id=eq.${q(id)}&user_id=eq.${q(link.user_id)}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
    const rows = removed.ok ? (await removed.json()) as { amount: string | number }[] : [];
    await edit(rows.length ? tr(lang, "removed", { amount: money(rows[0].amount), what: "" }) : tr(lang, "already_removed"));
    return rows.length ? plainText(tr(lang, "toast_undone")) : undefined;
  }
  if (action === "u" || action === "y") {
    const message = await undoExpense(link, id);
    await edit(message ?? tr(lang, "already_removed"));
    return message ? plainText(tr(lang, action === "y" ? "toast_deleted" : "toast_undone")) : undefined;
  }

  const { categories, payments } = await loadChoices(link.user_id);

  // ---- repeat a usual expense: save a fresh copy, keep the Add prompt where it is
  if (action === "f") {
    const template = await getExpense(link.user_id, id);
    if (!template) { await edit(tr(lang, "gone")); return; }
    if (!(await takeQuota(`tg-add:${chat}`, 100))) return plainText(tr(lang, "add_limit"));
    const active = categories.filter((c) => c.active);
    const category = active.some((c) => c.key === template.category) ? template.category : (active.find((c) => c.key === "other") ?? active[0])?.key ?? template.category;
    const row = await insertExpense(link, { amount: Number(template.amount), merchant: template.merchant, category, payment: template.payment, createdAt: null, note: "via Telegram (repeat)" });
    if (!row) return plainText(tr(lang, "cant_save"));
    const view = await savedMessage(link, row, categories, payments, now, "", { icon: "🔁", word: tr(lang, "st_repeat") });
    await tg.send(chat, view.text, { buttons: view.buttons });
    return plainText(tr(lang, "toast_saved"));
  }

  const row = await getExpense(link.user_id, id);
  if (!row) { await edit(tr(lang, "gone")); return; }

  switch (action) {
    case "v": {
      const card = expenseCard(lang, row, categories, payments, { icon: "🧾", word: "" }, "detail", now);
      await edit(card.text, { buttons: card.buttons });
      return;
    }
    case "a":
      await setPending(chat, "edit_amount", { id });
      await edit(`${tr(lang, "card_title", { amount: money(row.amount) })}${escapeHtml(whatOf(row))}\n\n${tr(lang, "ask_amount")}`);
      return;
    case "d":
      await edit(tr(lang, "confirm_delete", { amount: money(row.amount), what: whatOf(row) }), {
        buttons: [[{ text: tr(lang, "btn_yes_delete"), callback_data: `y:${id}` }, { text: tr(lang, "btn_cancel"), callback_data: `v:${id}` }]],
      });
      return;
    case "c": {
      const options = categories.filter((c) => c.active).slice(0, 20);
      const buttons: InlineButton[][] = [];
      options.forEach((c, i) => {
        if (i % 2 === 0) buttons.push([]);
        buttons[buttons.length - 1].push({ text: truncate(`${emojiFor(c.key)} ${c.label}`, 26), callback_data: `k:${id}:${i}` });
      });
      buttons.push([{ text: tr(lang, "btn_cancel"), callback_data: `x:${id}` }]);
      await edit(tr(lang, "choose_category", { amount: money(row.amount), what: whatOf(row) }), { buttons });
      return;
    }
    case "k": {
      const chosen = categories.filter((c) => c.active).slice(0, 20)[Number(index)];
      if (!chosen) return;
      if (chosen.key === row.category) return plainText(tr(lang, "toast_same", { cat: chosen.label }));
      await rest(`expenses?id=eq.${q(id)}&user_id=eq.${q(link.user_id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ category: chosen.key }) });
      row.category = chosen.key;
      const card = await quickCard(link, row, categories, payments, now, { icon: "🏷", word: tr(lang, "st_updated") });
      await edit(card.text, { buttons: card.buttons });
      return plainText(tr(lang, "toast_moved", { cat: chosen.label }));
    }
    default: { // "x": back to the normal card
      const card = await quickCard(link, row, categories, payments, now, { icon: "✅", word: tr(lang, "st_saved") });
      await edit(card.text, { buttons: card.buttons });
      return;
    }
  }
}

// ---------------------------------------------------------------- the door

async function markSeen(updateId: number): Promise<boolean> {
  const response = await rest("telegram_seen?on_conflict=update_id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({ update_id: updateId }),
  });
  if (!response.ok) throw new Error(`seen-check failed (${response.status})`);
  return (await response.json()).length === 1; // empty = Telegram re-sent an update we already handled
}

/** Telegram tells us the person's app language ("ms", "zh-hans"...): used for the first greeting and the first link. */
const guessLanguage = (code: unknown): Lang => {
  const value = typeof code === "string" ? code.toLowerCase() : "";
  return value.startsWith("zh") ? "zh" : value === "ms" || value.startsWith("ms-") ? "ms" : "en";
};

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
      await safe(async () => {
        await rest(`telegram_seen?seen_at=lt.${q(new Date(Date.now() - 86_400_000).toISOString())}`, { method: "DELETE" });
        await rest(`telegram_link_codes?expires_at=lt.${q(new Date().toISOString())}`, { method: "DELETE" });
        await rest(`telegram_pending?expires_at=lt.${q(new Date().toISOString())}`, { method: "DELETE" });
      }, undefined);
    }
    if (update.callback_query) {
      await onCallback(tg, update.callback_query, now);
      return ok();
    }
    const message = update.message as {
      message_id?: number;
      chat?: { id?: number; type?: string };
      from?: { language_code?: string };
      text?: unknown;
      photo?: { file_id?: string; file_size?: number }[];
      document?: { file_id?: string; file_size?: number; mime_type?: string };
    } | undefined;
    const chatId = message?.chat?.id;
    if (!message || message.chat?.type !== "private" || !Number.isSafeInteger(chatId)) return ok();
    if (!(await takeQuota(`tg-msg:${chatId}`, 300))) return ok();
    const guess = guessLanguage(message.from?.language_code);
    const messageId = Number.isSafeInteger(message.message_id) ? message.message_id : undefined;
    if (typeof message.text === "string") {
      await onText(tg, chatId as number, message.text, now, guess, messageId);
    } else if (message.photo || message.document) {
      const link = await getLink(chatId as number);
      if (!link) await tg.send(chatId as number, tr(guess, "not_connected"));
      else await onPhoto(tg, link, message, now);
    }
  } catch (error) {
    console.error("telegram-bot: update failed", error instanceof Error ? error.message : "unknown");
    const chatId = (update.message as { chat?: { id?: number } } | undefined)?.chat?.id;
    const guess = guessLanguage((update.message as { from?: { language_code?: string } } | undefined)?.from?.language_code);
    if (Number.isSafeInteger(chatId)) await safe(() => tg.send(chatId as number, tr(guess, "went_wrong")), undefined);
  }
  return ok();
}
