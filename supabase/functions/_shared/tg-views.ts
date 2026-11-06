// The report "views" of the Telegram bot: Today, Week, Month and Top. Each view is built from one person's data into
// either a PICTURE with a caption (Week = daily bars, Month = category donut) or plain text (Today, Top), plus a
// complete text version used for the "Details" button and as the fallback if a picture cannot be made or sent.
//
// Telegram limits a photo caption to 1,024 characters, so captions are assembled from sections in priority order and
// the lowest-priority sections are left out when they do not fit; nothing is ever cut in the middle of a tag.

import { fetchAll, q } from "./db.ts";
import { bar, categoryRow, emojiFor, escapeHtml, formatDay, formatMonth, type Lang, pct, RULE, ringgit, trend, truncate } from "./tg-format.ts";
import { tr } from "./tg-i18n.ts";
import { renderBarsPng, renderDonutPng, SQUARES } from "./tg-chart.ts";
import {
  alignTable,
  bucketByDay,
  categoryMover,
  DAY_MS,
  daysWithEntries,
  heatStrip,
  type Insight,
  KL_MS,
  klDay,
  mondayBased,
  paceInsight,
  sparkline,
  streakDays,
  weekendInsight,
} from "./tg-insights.ts";
import {
  type Aggregate,
  aggregate,
  budgetUsage,
  type BudgetUsage,
  loadBudgets,
  loadIncomeTotal,
  type Labels,
  renderToday,
} from "./tg-reports.ts";
import { stripTags } from "./telegram.ts";

export type ViewKind = "d" | "w" | "m" | "p";
export const MAX_OFFSET: Record<ViewKind, number> = { d: 366, w: 104, m: 60, p: 60 };
export const CAPTION_LIMIT = 1000; // Telegram allows 1,024; keep a margin

export interface ViewInput {
  userId: string;
  lang: Lang;
  now: Date;
  view: ViewKind;
  offset: number;
  labels: Labels;
  /** The Monday summary uses the friendlier "Your week" title. */
  digest?: boolean;
  /** Picture renderers; only tests pass this (to prove the text fallback works when drawing fails). */
  render?: { donut?: typeof renderDonutPng; bars?: typeof renderBarsPng };
}
export interface ViewResult {
  kind: "photo" | "text";
  /** The message text, or the photo caption. */
  text: string;
  png?: Uint8Array;
  /** The complete text version (used by the Details button, and as the fallback when the picture fails). */
  full: string;
  hasNewer: boolean;
  /** False when nothing was spent in the period (the view is then a plain "No expenses yet" text). */
  hasData: boolean;
}

// ---------------------------------------------------------------- windows (Kuala Lumpur calendar)

const klMidnight = (dayNumber: number) => new Date(dayNumber * DAY_MS - KL_MS);

export function dayWindow(now: Date, offset: number) {
  const day = klDay(now) - offset;
  return { start: klMidnight(day), end: klMidnight(day + 1), day };
}

export function weekWindow(now: Date, offset: number) {
  const today = klDay(now);
  const monday = today - mondayBased(today) - 7 * offset;
  return { start: klMidnight(monday), end: klMidnight(monday + 7), day: monday };
}

export function monthWindow(now: Date, offset: number) {
  const local = new Date(now.getTime() + KL_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth() - offset;
  const first = Date.UTC(y, m, 1);
  const next = Date.UTC(y, m + 1, 1);
  return { start: new Date(first - KL_MS), end: new Date(next - KL_MS), days: Math.round((next - first) / DAY_MS), day: Math.floor(first / DAY_MS) };
}

// ---------------------------------------------------------------- data

interface DatedLine {
  amount: string | number;
  category: string;
  merchant?: string | null;
  created_at: string;
}

const loadDated = (userId: string, start: Date, end: Date) =>
  fetchAll<DatedLine>(`expenses?select=amount,category,merchant,created_at&user_id=eq.${q(userId)}&created_at=gte.${q(start.toISOString())}&created_at=lt.${q(end.toISOString())}&order=created_at.asc,id.asc`);

const between = (rows: DatedLine[], start: Date, end: Date) =>
  rows.filter((r) => { const t = new Date(r.created_at).getTime(); return t >= start.getTime() && t < end.getTime(); });

const safe = async <T>(work: () => Promise<T>, fallback: T): Promise<T> => {
  try { return await work(); } catch (_error) { return fallback; }
};

// ---------------------------------------------------------------- caption assembly

interface Section {
  compact: string[];
  /** The longer version for the Details text. Defaults to `compact`. */
  full?: string[];
}

const plainLength = (lines: string[]) => stripTags(lines.join("\n")).length;

/** Adds sections in priority order while the caption stays within the limit; sections that do not fit are skipped. */
export function fitCaption(sections: Section[], limit = CAPTION_LIMIT): string {
  let lines: string[] = [];
  sections.forEach((section, index) => {
    if (!section.compact.length) return;
    const candidate = lines.length ? [...lines, RULE, ...section.compact] : [...section.compact];
    if (index === 0 || plainLength(candidate) <= limit) lines = candidate;
  });
  // The first section alone could in theory be too long (huge names): cut plain text rather than send a refused caption.
  return plainLength(lines) > limit ? truncate(stripTags(lines.join("\n")), limit) : lines.join("\n");
}

export const fullText = (sections: Section[]): string =>
  sections.filter((s) => (s.full ?? s.compact).length).map((s) => (s.full ?? s.compact).join("\n")).join(`\n${RULE}\n`);

// ---------------------------------------------------------------- small renderers

const weekdayShort = (day: number, lang: Lang) => {
  try {
    return new Intl.DateTimeFormat({ en: "en-MY", ms: "ms-MY", zh: "zh-CN" }[lang], { weekday: "short", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(day * DAY_MS - KL_MS + 12 * 3600_000));
  } catch (_error) {
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][mondayBased(day)];
  }
};
const dayOfMonth = (day: number) => new Date(day * DAY_MS).getUTCDate();
const dayName = (day: number, lang: Lang) => `${weekdayShort(day, lang)} ${dayOfMonth(day)}`;

const monthShort = (instant: Date, lang: Lang) => {
  try {
    return new Intl.DateTimeFormat({ en: "en-MY", ms: "ms-MY", zh: "zh-CN" }[lang], { month: "short", timeZone: "Asia/Kuala_Lumpur" }).format(instant);
  } catch (_error) {
    return instant.toISOString().slice(5, 7);
  }
};

const countText = (lang: Lang, n: number) => tr(lang, n === 1 ? "expense_count_one" : "expense_count_many", { n });

function insightLine(lang: Lang, insight: Insight, labels: Labels): string {
  switch (insight.kind) {
    case "cat": return tr(lang, insight.up ? "ins_cat_up" : "ins_cat_down", { emoji: emojiFor(insight.key), cat: labels(insight.key), pct: `${insight.pct}%` });
    case "weekend": return tr(lang, insight.weekendHeavy ? "ins_weekend_heavy" : "ins_weekday_heavy", { x: insight.ratio });
    case "pace": {
      const name = insight.key === "all" ? tr(lang, "budget_overall") : labels(insight.key);
      return insight.warn
        ? tr(lang, "ins_pace_warn", { name, pct: `${Math.round(insight.projected * 100)}%` })
        : tr(lang, "ins_pace_ok", { name, used: `${Math.round(insight.used * 100)}%`, day: insight.day });
    }
  }
}

const light = (ratio: number) => (ratio > 1 ? "🔴" : ratio >= 0.8 ? "🟡" : "🟢");

/** One line per budget: traffic light, name, bar and percentage. */
function budgetLines(lang: Lang, usage: BudgetUsage[], labels: Labels, max: number): string[] {
  return usage.slice(0, max).map((u) => {
    const name = u.key === "all" ? tr(lang, "budget_overall") : labels(u.key);
    return `${light(u.ratio)} ${u.key === "all" ? "🎯" : emojiFor(u.key)} ${escapeHtml(truncate(name, 11))} ${bar(u.ratio, 8)} <b>${pct(u.ratio)}</b>`; // 8 blocks: ten wrapped on a phone
  });
}

const streakLine = (lang: Lang, n: number) => (n >= 2 ? [tr(lang, "streak_line", { n })] : []);

// ---------------------------------------------------------------- the four views

async function monthView(input: ViewInput): Promise<ViewResult> {
  const { userId, lang, now, labels } = input;
  const win = monthWindow(now, input.offset);
  const sixStart = monthWindow(now, input.offset + 5).start;
  const rows = await loadDated(userId, sixStart, win.end);
  const current = between(rows, win.start, win.end);
  const prevWin = monthWindow(now, input.offset + 1);
  const agg = aggregate(current);
  const previous = aggregate(between(rows, prevWin.start, prevWin.end));
  const [income, budgetRows] = await Promise.all([safe(() => loadIncomeTotal(userId, win.start.toISOString(), win.end.toISOString()), 0), safe(() => loadBudgets(userId), [])]);
  const usage = budgetUsage(budgetRows, agg);

  const monthLabel = formatMonth(new Date(win.start.getTime() + 12 * 3600_000), lang);
  const hasNewer = input.offset > 0;
  const title = tr(lang, "month_title", { month: monthLabel });
  if (!agg.count) {
    return { kind: "text", text: [title, RULE, tr(lang, "no_expenses")].join("\n"), full: [title, RULE, tr(lang, "no_expenses")].join("\n"), hasNewer, hasData: false };
  }

  const t = previous.count ? trend(agg.total, previous.total) : { arrow: "", text: "", up: false };
  const versus = t.arrow ? `  ${t.up ? "🔺" : "🔻"} ${t.text} <i>${escapeHtml(tr(lang, "vs_last", { period: tr(lang, "period_month") }))}</i>` : "";
  const head = [title, `${tr(lang, "spent")}  <b>${escapeHtml(ringgit(agg.total))}</b>${versus}`];
  if (income > 0) {
    const rate = Math.max(0, (income - agg.total) / income);
    head.push(`${tr(lang, "income")}  <b>${escapeHtml(ringgit(income))}</b>  ·  ${tr(lang, "net")}  <b>${escapeHtml(ringgit(income - agg.total))}</b>`);
    head.push(`${tr(lang, "savings")}  ${bar(rate)} <b>${pct(rate)}</b>`);
  }

  // legend: top 6 in the caption, everything in the details; squares match the picture's slice colours
  const top = agg.byCategory.slice(0, 8);
  const restSum = agg.byCategory.slice(8).reduce((s, [, v]) => s + v, 0);
  const legend = (limit: number) => {
    const out = top.slice(0, limit).map(([key, amount], i) => `${SQUARES[i]} ${emojiFor(key)} ${escapeHtml(truncate(labels(key), 14))}  <b>${escapeHtml(ringgit(amount))}</b> · ${pct(amount / agg.total)}`);
    const hidden = agg.byCategory.slice(limit).reduce((s, [, v]) => s + v, 0);
    if (hidden > 0) out.push(`${SQUARES[8]} ${escapeHtml(tr(lang, "legend_others"))}  <b>${escapeHtml(ringgit(hidden))}</b> · ${pct(hidden / agg.total)}`);
    return out;
  };

  // extras
  const todayIndex = input.offset === 0 ? klDay(now) - win.day : null;
  const daily = bucketByDay(current, win.start, win.days);
  const insights: Insight[] = [];
  const pace = input.offset === 0 ? paceInsight(usage.map((u) => ({ key: u.key, limit: u.limit, used: u.used })), (todayIndex ?? 0) + 1, win.days) : null;
  if (pace?.kind === "pace" && pace.warn) insights.push(pace);
  const mover = previous.count ? categoryMover(agg.byCategory, previous.byCategory) : null;
  if (mover) insights.push(mover);
  const weekend = weekendInsight(win.day, daily, todayIndex === null ? win.days : todayIndex + 1);
  if (weekend) insights.push(weekend);
  if (pace && !(pace.kind === "pace" && pace.warn)) insights.push(pace);
  const insightLines = insights.slice(0, 2).map((i) => insightLine(lang, i, labels));
  const allInsightLines = insights.map((i) => insightLine(lang, i, labels));

  const heat = heatStrip(lang, win.day, daily, todayIndex);
  const heatLines = [tr(lang, "heat_title"), ...heat.lines, tr(lang, "heat_legend")];
  if (heat.biggest) heatLines.push(tr(lang, "heat_biggest", { day: dayName(win.day + heat.biggest.index, lang), amount: ringgit(heat.biggest.amount) }));

  const monthTotals: number[] = [];
  for (let k = 5; k >= 0; k--) {
    const w = monthWindow(now, input.offset + k);
    monthTotals.push(between(rows, w.start, w.end).reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0) / 100);
  }
  const short = (k: number) => monthShort(new Date(monthWindow(now, input.offset + k).start.getTime() + 12 * 3600_000), lang);
  const trendLines = [tr(lang, "trend_title"), tr(lang, "trend_line", { spark: sparkline(monthTotals), from: short(5), to: short(0) })];
  const streak = input.offset === 0 ? streakLine(lang, streakDays(daysWithEntries(rows), klDay(now))) : [];

  const sections: Section[] = [
    { compact: head },
    { compact: legend(6), full: [tr(lang, "top_categories"), ...top.map(([key, amount]) => categoryRow(key, labels(key), amount, agg.total)), ...(restSum > 0 ? [`${SQUARES[8]} ${escapeHtml(tr(lang, "legend_others"))}  <b>${escapeHtml(ringgit(restSum))}</b>`] : [])] },
    { compact: budgetLines(lang, usage, labels, 3), full: usage.length ? [tr(lang, "budgets_title"), ...budgetLines(lang, usage, labels, 12)] : [] },
    { compact: insightLines, full: allInsightLines },
    { compact: heatLines },
    { compact: trendLines },
    { compact: streak },
  ];
  const full = fullText([{ compact: [...head, `🧮 ${countText(lang, agg.count)}`] }, ...sections.slice(1)]);
  const text = fitCaption(sections);
  try {
    const png = await (input.render?.donut ?? renderDonutPng)([...top.map(([, v]) => v), ...(restSum > 0 ? [restSum] : [])]); // "others" is the 9th, grey, slice
    return { kind: "photo", text, png, full, hasNewer, hasData: true };
  } catch (_error) {
    return { kind: "text", text: full, full, hasNewer, hasData: true };
  }
}

async function weekView(input: ViewInput): Promise<ViewResult> {
  const { userId, lang, now, labels } = input;
  const win = weekWindow(now, input.offset);
  const prev = weekWindow(now, input.offset + 1);
  const rows = await loadDated(userId, prev.start, win.end);
  const current = between(rows, win.start, win.end);
  const agg = aggregate(current);
  const previous = aggregate(between(rows, prev.start, prev.end));
  const range = `${formatDay(win.start, lang)} – ${formatDay(new Date(win.end.getTime() - DAY_MS), lang)}`;
  const title = tr(lang, input.digest ? "week_title" : "week_view_title", { range });
  const hasNewer = input.offset > 0;
  if (!agg.count) return { kind: "text", text: [title, RULE, tr(lang, "no_expenses")].join("\n"), full: [title, RULE, tr(lang, "no_expenses")].join("\n"), hasNewer, hasData: false };

  const daily = bucketByDay(current, win.start, 7);
  const todayIndex = input.offset === 0 ? klDay(now) - win.day : null;
  const topDay = daily.reduce((best, v, i) => (v > daily[best] ? i : best), 0);
  const t = previous.count ? trend(agg.total, previous.total) : { arrow: "", text: "", up: false };
  const versus = t.arrow ? `  ${t.up ? "🔺" : "🔻"} ${t.text} <i>${escapeHtml(tr(lang, "vs_last", { period: tr(lang, "period_week") }))}</i>` : "";
  const head = [title, `${tr(lang, "spent")}  <b>${escapeHtml(ringgit(agg.total))}</b>${versus}  ·  🧮 ${countText(lang, agg.count)}`, tr(lang, "week_biggest", { day: dayName(win.day + topDay, lang), amount: ringgit(daily[topDay]) })];
  const table = alignTable(daily.map((v, i) => [dayName(win.day + i, lang), v > 0 ? ringgit(v).replace(/ /g, " ") : "-"]), ["l", "r"]);
  const days = [`<pre>${escapeHtml(table.join("\n"))}</pre>`];
  const cats = agg.byCategory.slice(0, 3).map(([key, amount]) => categoryRow(key, labels(key), amount, agg.total));
  const allCats = agg.byCategory.slice(0, 8).map(([key, amount]) => categoryRow(key, labels(key), amount, agg.total));
  // budgets are monthly: show the ones this week pushed to 80% or more (optional, silently skipped on any problem)
  const budgetAlerts = await safe(async () => {
    const budgets = await loadBudgets(userId);
    if (!budgets.length) return [] as string[];
    const month = monthWindow(new Date(win.end.getTime() - 1), 0);
    const monthRows = await loadDated(userId, month.start, win.end);
    const hot = budgetUsage(budgets, aggregate(monthRows)).filter((u) => u.ratio >= 0.8);
    return hot.length ? [tr(lang, "budgets_title"), ...budgetLines(lang, hot, labels, 3)] : [];
  }, [] as string[]);
  const sections: Section[] = [{ compact: head }, { compact: days }, { compact: cats, full: allCats }, { compact: budgetAlerts }];
  const text = fitCaption(sections);
  const full = fullText(sections);
  try {
    const png = await (input.render?.bars ?? renderBarsPng)(daily, {
      highlight: daily[topDay] > 0 ? topDay : undefined,
      marker: todayIndex !== null && todayIndex >= 0 && todayIndex < 7 ? todayIndex : undefined,
      muted: todayIndex === null ? undefined : daily.map((_, i) => i > todayIndex),
    });
    return { kind: "photo", text, png, full, hasNewer, hasData: true };
  } catch (_error) {
    return { kind: "text", text: full, full, hasNewer, hasData: true };
  }
}

async function todayView(input: ViewInput): Promise<ViewResult> {
  const { userId, lang, now, labels } = input;
  const win = dayWindow(now, input.offset);
  // Looking at today also needs the last two months of days for the "days in a row" streak: one query serves both.
  const since = input.offset === 0 ? klMidnight(klDay(now) - 60) : win.start;
  const rows = await loadDated(userId, since, win.end);
  const agg = aggregate(between(rows, win.start, win.end));
  const streak = input.offset === 0 ? streakLine(lang, streakDays(daysWithEntries(rows), klDay(now))) : [];
  const base = renderToday({ lang, now: new Date(win.start.getTime() + 12 * 3600_000), agg, labels });
  const text = streak.length ? `${base}\n${RULE}\n${streak.join("\n")}` : base;
  return { kind: "text", text, full: text, hasNewer: input.offset > 0, hasData: agg.count > 0 };
}

async function topView(input: ViewInput): Promise<ViewResult> {
  const { userId, lang, now, labels } = input;
  const win = monthWindow(now, input.offset);
  const agg = aggregate(between(await loadDated(userId, win.start, win.end), win.start, win.end));
  const monthLabel = formatMonth(new Date(win.start.getTime() + 12 * 3600_000), lang);
  const lines = [tr(lang, "top_title", { month: monthLabel }), RULE];
  if (!agg.count) {
    lines.push(tr(lang, "no_expenses"));
  } else {
    const cats = alignTable(agg.byCategory.slice(0, 5).map(([key, amount], i) => [String(i + 1), labels(key), ringgit(amount).replace(/ /g, " "), pct(amount / agg.total)]), ["r", "l", "r", "r"], [0, 14, 0, 0]);
    lines.push(tr(lang, "top_categories"), `<pre>${escapeHtml(cats.join("\n"))}</pre>`);
    if (agg.byMerchant.length) {
      const places = alignTable(agg.byMerchant.slice(0, 5).map((p, i) => [String(i + 1), p.n > 1 ? `${p.name} ×${p.n}` : p.name, ringgit(p.amount).replace(/ /g, " ")]), ["r", "l", "r"], [0, 20, 0]);
      lines.push(RULE, tr(lang, "top_merchants"), `<pre>${escapeHtml(places.join("\n"))}</pre>`);
    }
  }
  const text = lines.join("\n");
  return { kind: "text", text, full: text, hasNewer: input.offset > 0, hasData: agg.count > 0 };
}

/** Builds a view. Never returns a picture without a text fallback; throws only if the database cannot be read. */
export async function buildView(input: ViewInput): Promise<ViewResult> {
  const offset = Math.max(0, Math.min(MAX_OFFSET[input.view], Math.floor(input.offset)));
  const request = { ...input, offset };
  switch (input.view) {
    case "m": return monthView(request);
    case "w": return weekView(request);
    case "p": return topView(request);
    default: return todayView(request);
  }
}

// ---------------------------------------------------------------- navigation buttons

export type NavButton = { text: string; callback_data: string } | { text: string; url: string };

/** [Today | Week | Month | Top], then Earlier / Later, then Details (picture views) and Open VinExpenses. */
export function pagerButtons(lang: Lang, view: ViewKind, offset: number, options: { details: boolean; siteUrl: string | null }): NavButton[][] {
  const labels: [ViewKind, string][] = [["d", "nav_today"], ["w", "nav_week"], ["m", "nav_month"], ["p", "nav_top"]];
  const rows: NavButton[][] = [labels.map(([v, key]) => ({ text: `${v === view ? "• " : ""}${tr(lang, key)}`, callback_data: `n:${v}:0` }))];
  const step: NavButton[] = [];
  if (offset < MAX_OFFSET[view]) step.push({ text: tr(lang, "nav_prev"), callback_data: `n:${view}:${offset + 1}` });
  if (offset > 0) step.push({ text: tr(lang, "nav_next"), callback_data: `n:${view}:${offset - 1}` });
  if (step.length) rows.push(step);
  const extra: NavButton[] = [];
  if (options.details && (view === "w" || view === "m")) extra.push({ text: tr(lang, "nav_details"), callback_data: `n:f${view}:${offset}` });
  if (options.siteUrl) extra.push({ text: tr(lang, "btn_open"), url: options.siteUrl });
  if (extra.length) rows.push(extra);
  return rows;
}
