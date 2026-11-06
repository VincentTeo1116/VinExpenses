// The report "views" of the Telegram bot: Today, Week, Month and Top. Each view is built from one person's data into
// either a PICTURE with a caption (Week = daily bars, Month = category donut) or plain text (Today, Top), plus a
// complete text version used for the "Details" button and as the fallback if a picture cannot be made or sent.
//
// Telegram limits a photo caption to 1,024 characters, so captions are assembled from sections in priority order and
// the lowest-priority sections are left out when they do not fit; nothing is ever cut in the middle of a tag.

import { fetchAll, q } from "./db.ts";
import { bar, categoryRow, emojiFor, escapeHtml, formatDay, formatMonth, type Lang, pct, RULE, ringgit, trend, truncate } from "./tg-format.ts";
import { tr } from "./tg-i18n.ts";
import { renderBarsPng, renderDonutPng, renderProgressPng, SQUARES } from "./tg-chart.ts";
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

/** d = today, w = week, p = top; m / y / b / t = the month's Overview / Days / Budgets / Trend tabs. */
export type ViewKind = "d" | "w" | "m" | "y" | "b" | "t" | "p";
export const MAX_OFFSET: Record<ViewKind, number> = { d: 366, w: 104, m: 60, y: 60, b: 60, t: 60, p: 60 };
const MONTH_VIEWS: ViewKind[] = ["m", "y", "b", "t"];
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
  render?: { donut?: typeof renderDonutPng; bars?: typeof renderBarsPng; progress?: typeof renderProgressPng };
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
    const candidate = lines.length ? [...lines, "", ...section.compact] : [...section.compact];
    if (index === 0 || plainLength(candidate) <= limit) lines = candidate;
  });
  // The first section alone could in theory be too long (huge names): cut plain text rather than send a refused caption.
  return plainLength(lines) > limit ? truncate(stripTags(lines.join("\n")), limit) : lines.join("\n");
}

export const fullText = (sections: Section[]): string =>
  sections.filter((s) => (s.full ?? s.compact).length).map((s) => (s.full ?? s.compact).join("\n")).join("\n\n");

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

// ---- the month: one model, four tabs ------------------------------------------------------------------------------------

interface MonthModel {
  lang: Lang;
  labels: Labels;
  win: ReturnType<typeof monthWindow>;
  monthLabel: string;
  hasNewer: boolean;
  agg: Aggregate;
  previous: Aggregate;
  income: number;
  usage: BudgetUsage[];
  daily: number[];
  todayIndex: number | null;
  streak: number;
  monthTotals: number[]; // the 6 months ending with this one
  monthNames: string[];
  insights: Insight[];
}

async function loadMonth(input: ViewInput): Promise<MonthModel> {
  const { userId, lang, now, labels } = input;
  const win = monthWindow(now, input.offset);
  const rows = await loadDated(userId, monthWindow(now, input.offset + 5).start, win.end);
  const current = between(rows, win.start, win.end);
  const prevWin = monthWindow(now, input.offset + 1);
  const agg = aggregate(current);
  const previous = aggregate(between(rows, prevWin.start, prevWin.end));
  const [income, budgetRows] = await Promise.all([
    safe(() => loadIncomeTotal(userId, win.start.toISOString(), win.end.toISOString()), 0),
    safe(() => loadBudgets(userId), []),
  ]);
  const usage = budgetUsage(budgetRows, agg);
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

  const monthTotals: number[] = [];
  const monthNames: string[] = [];
  for (let k = 5; k >= 0; k--) {
    const w = monthWindow(now, input.offset + k);
    monthTotals.push(between(rows, w.start, w.end).reduce((sum, r) => sum + Math.round(Number(r.amount) * 100), 0) / 100);
    monthNames.push(monthShort(new Date(w.start.getTime() + 12 * 3600_000), lang));
  }
  return {
    lang, labels, win, hasNewer: input.offset > 0, agg, previous, income, usage, daily, todayIndex, insights, monthTotals, monthNames,
    monthLabel: formatMonth(new Date(win.start.getTime() + 12 * 3600_000), lang),
    streak: input.offset === 0 ? streakDays(daysWithEntries(rows), klDay(now)) : 0,
  };
}

/** Everything the Mini App needs to draw a month, as plain numbers (the bot's reports use exactly the same model). */
export interface MonthData {
  offset: number;
  start: string; // ISO instant of the first moment of the month in Kuala Lumpur
  end: string;
  days: number;
  /** 0 = Monday ... 6 = Sunday, for the first day of the month (so a calendar can be laid out). */
  firstWeekday: number;
  total: number;
  count: number;
  previousTotal: number;
  previousCount: number;
  income: number;
  byCategory: [string, number][];
  daily: number[];
  todayIndex: number | null;
  budgets: { key: string; limit: number; used: number }[];
  monthTotals: number[];
  monthStarts: string[];
  streak: number;
  insights: Insight[];
}

export async function monthData(userId: string, now: Date, offset: number): Promise<MonthData> {
  const clamped = Math.max(0, Math.min(MAX_OFFSET.m, Math.floor(offset)));
  const m = await loadMonth({ userId, lang: "en", now, view: "m", offset: clamped, labels: (key) => key });
  return {
    offset: clamped,
    start: m.win.start.toISOString(),
    end: m.win.end.toISOString(),
    days: m.win.days,
    firstWeekday: mondayBased(m.win.day),
    total: m.agg.total,
    count: m.agg.count,
    previousTotal: m.previous.total,
    previousCount: m.previous.count,
    income: m.income,
    byCategory: m.agg.byCategory,
    daily: m.daily,
    todayIndex: m.todayIndex,
    budgets: m.usage.map((u) => ({ key: u.key, limit: u.limit, used: u.used })),
    monthTotals: m.monthTotals,
    monthStarts: [5, 4, 3, 2, 1, 0].map((k) => monthWindow(now, clamped + k).start.toISOString()),
    streak: m.streak,
    insights: m.insights,
  };
}

const passedDays = (m: MonthModel) => (m.todayIndex === null ? m.win.days : m.todayIndex + 1);

/** The one thing worth knowing first: a blown budget, then a risky pace, then a nearly-full budget, then a trend. */
function highlightLines(m: MonthModel): string[] {
  const { lang, labels } = m;
  const name = (key: string) => (key === "all" ? tr(lang, "budget_overall") : labels(key));
  const out: string[] = [];
  const over = m.usage.find((u) => u.ratio > 1);
  if (over) out.push(tr(lang, "hl_over", { name: name(over.key), pct: pct(over.ratio) }));
  const pace = m.insights.find((i) => i.kind === "pace" && i.warn);
  if (pace) out.push(insightLine(lang, pace, labels));
  const near = m.usage.find((u) => u.ratio >= 0.8 && u.ratio <= 1);
  if (near) out.push(tr(lang, "hl_near", { name: name(near.key), pct: pct(near.ratio) }));
  for (const i of m.insights) if (i.kind === "cat" || i.kind === "weekend") out.push(insightLine(lang, i, labels));
  out.push(...streakLine(lang, m.streak >= 7 ? m.streak : 0));
  return out;
}

function overviewSections(m: MonthModel): { sections: Section[]; top: [string, number][]; rest: { count: number; amount: number } } {
  const { lang, labels, agg } = m;
  const t = m.previous.count ? trend(agg.total, m.previous.total) : { arrow: "", text: "", up: false };
  const versus = t.arrow ? `  ${t.up ? "🔺" : "🔻"} ${t.text} <i>${escapeHtml(tr(lang, "vs_last", { period: tr(lang, "period_month") }))}</i>` : "";
  const head = [tr(lang, "month_title", { month: m.monthLabel }), `${tr(lang, "spent")}  <b>${escapeHtml(ringgit(agg.total))}</b>${versus}`];
  if (m.income > 0) {
    const rate = Math.max(0, (m.income - agg.total) / m.income);
    head.push(tr(lang, "month_cash", { income: ringgit(m.income), net: ringgit(m.income - agg.total), rate: pct(rate) }));
  }
  const top = agg.byCategory.slice(0, 5);
  const restList = agg.byCategory.slice(5);
  const rest = { count: restList.length, amount: restList.reduce((s, [, v]) => s + v, 0) };
  const legend = top.map(([key, amount], i) => `${SQUARES[i]} ${escapeHtml(truncate(labels(key), 16))}  <b>${escapeHtml(ringgit(amount))}</b> · ${pct(amount / agg.total)}`);
  if (rest.count) legend.push(`${SQUARES[8]} ${escapeHtml(tr(lang, "legend_others"))} (${rest.count})  <b>${escapeHtml(ringgit(rest.amount))}</b> · ${pct(rest.amount / agg.total)}`);
  // the complete text lists up to 12 categories and sums the rest (60 category rows would not fit one Telegram message)
  const allLegend = agg.byCategory.slice(0, 12).map(([key, amount]) => categoryRow(key, labels(key), amount, agg.total));
  const tail = agg.byCategory.slice(12);
  if (tail.length) allLegend.push(`${SQUARES[8]} ${escapeHtml(tr(lang, "legend_others"))} (${tail.length})  <b>${escapeHtml(ringgit(tail.reduce((sum, [, v]) => sum + v, 0)))}</b>`);
  const hl = highlightLines(m);
  return { sections: [{ compact: head }, { compact: legend, full: [tr(lang, "top_categories"), ...allLegend] }, { compact: hl.slice(0, 1), full: hl }], top, rest };
}

function daysSections(m: MonthModel): Section[] {
  const { lang, daily } = m;
  const passed = passedDays(m);
  const active = daily.slice(0, passed).filter((v) => v > 0).length;
  const head = [tr(lang, "days_title", { month: m.monthLabel })];
  const heat = heatStrip(lang, m.win.day, daily, m.todayIndex);
  if (heat.biggest) head.push(tr(lang, "heat_biggest", { day: dayName(m.win.day + heat.biggest.index, lang), amount: ringgit(heat.biggest.amount) }));
  head.push(tr(lang, "days_average", { amount: ringgit(m.agg.total / passed), active, total: passed }));
  for (const i of m.insights) if (i.kind === "weekend") head.push(insightLine(lang, i, m.labels));
  head.push(...streakLine(lang, m.streak));
  return [{ compact: head }, { compact: [tr(lang, "heat_title"), ...heat.lines, tr(lang, "heat_legend")] }];
}

function budgetsSections(m: MonthModel): Section[] {
  const { lang, labels } = m;
  const name = (key: string) => (key === "all" ? tr(lang, "budget_overall") : labels(key));
  const rows = (limit: number) => m.usage.slice(0, limit).flatMap((u) => [
    `${light(u.ratio)} ${escapeHtml(truncate(name(u.key), 12))} ${bar(u.ratio, 8)} <b>${pct(u.ratio)}</b>`,
    `<i>${escapeHtml(ringgit(u.used))} / ${escapeHtml(ringgit(u.limit))} · ${tr(lang, u.ratio > 1 ? "budget_over_by" : "budget_left", { amount: ringgit(Math.abs(u.limit - u.used)) })}</i>`,
  ]);
  const pace = m.insights.filter((i) => i.kind === "pace").map((i) => insightLine(lang, i, labels));
  return [{ compact: [tr(lang, "budgets_view_title", { month: m.monthLabel })] }, { compact: rows(5), full: rows(12) }, { compact: pace }];
}

function trendSections(m: MonthModel): Section[] {
  const { lang } = m;
  const rows = m.monthTotals.map((v, i) => {
    const before = i > 0 ? m.monthTotals[i - 1] : 0;
    const change = before > 0 ? trend(v, before) : null;
    return [m.monthNames[i], ringgit(v).replace(/\u00a0/g, " "), change && change.arrow ? `${change.arrow} ${change.text}` : ""];
  });
  const table = `<pre>${escapeHtml(alignTable(rows, ["l", "r", "r"]).join("\n"))}</pre>`;
  const best = m.monthTotals.reduce((b, v, i) => (v > m.monthTotals[b] ? i : b), 0);
  const summary = [tr(lang, "trend_avg", { amount: ringgit(m.monthTotals.reduce((a, b) => a + b, 0) / m.monthTotals.length) })];
  if (m.monthTotals[best] > 0) summary.push(tr(lang, "trend_best", { month: m.monthNames[best], amount: ringgit(m.monthTotals[best]) }));
  return [{ compact: [tr(lang, "trend_title")] }, { compact: [table] }, { compact: summary }];
}

async function monthFamilyView(input: ViewInput): Promise<ViewResult> {
  const m = await loadMonth(input);
  const { lang } = m;
  const hasData = m.agg.count > 0;
  const plainResult = (lines: string[]): ViewResult => {
    const text = lines.join("\n");
    return { kind: "text", text, full: text, hasNewer: m.hasNewer, hasData };
  };
  const empty = [tr(lang, "month_title", { month: m.monthLabel }), RULE, tr(lang, "no_expenses")];

  let sections: Section[];
  let draw: () => Promise<Uint8Array>;
  switch (input.view) {
    case "y":
      if (!hasData) return plainResult(empty);
      sections = daysSections(m);
      draw = () => (input.render?.bars ?? renderBarsPng)(m.daily, {
        highlight: m.daily.some((v) => v > 0) ? m.daily.indexOf(Math.max(...m.daily)) : undefined,
        marker: m.todayIndex ?? undefined,
        muted: m.todayIndex === null ? undefined : m.daily.map((_, i) => i > (m.todayIndex as number)),
      });
      break;
    case "b":
      if (!m.usage.length) return plainResult([tr(lang, "budgets_view_title", { month: m.monthLabel }), RULE, tr(lang, "budgets_none")]);
      sections = budgetsSections(m);
      draw = () => (input.render?.progress ?? renderProgressPng)(m.usage.slice(0, 8).map((u) => u.ratio));
      break;
    case "t":
      if (!m.monthTotals.some((v) => v > 0)) return plainResult(empty);
      sections = trendSections(m);
      draw = () => (input.render?.bars ?? renderBarsPng)(m.monthTotals, { highlight: m.monthTotals.indexOf(Math.max(...m.monthTotals)), marker: m.monthTotals.length - 1 });
      break;
    default: {
      if (!hasData) return plainResult(empty);
      const overview = overviewSections(m);
      sections = overview.sections;
      const values = [...overview.top.map(([, v]) => v), 0, 0, 0, 0, 0].slice(0, 5); // slices 1-5
      draw = () => (input.render?.donut ?? renderDonutPng)([...values, 0, 0, 0, overview.rest.amount]); // the grey 9th slice = "others"
    }
  }
  const text = fitCaption(sections);
  const full = fullText(sections);
  try {
    return { kind: "photo", text, png: await draw(), full, hasNewer: m.hasNewer, hasData };
  } catch (_error) {
    return { kind: "text", text: full, full, hasNewer: m.hasNewer, hasData };
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
    case "m": case "y": case "b": case "t": return monthFamilyView(request);
    case "w": return weekView(request);
    case "p": return topView(request);
    default: return todayView(request);
  }
}

// ---------------------------------------------------------------- navigation buttons

export type NavButton = { text: string; callback_data: string } | { text: string; url: string } | { text: string; web_app: { url: string } };

/** Where the Mini App lives on the website (a folder of the same GitHub Pages site). */
export function miniAppUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/miniapp/`;
}

/**
 * [Today | Week | Month | Top]; for the month also its tabs [Overview | Days | Budgets | Trend]; then Earlier / Later
 * and Open VinExpenses; the week also gets a Details button. The current view and tab are marked with a dot.
 */
export function pagerButtons(lang: Lang, view: ViewKind, offset: number, options: { details: boolean; siteUrl: string | null }): NavButton[][] {
  const family: ViewKind = MONTH_VIEWS.includes(view) ? "m" : view;
  const top: [ViewKind, string][] = [["d", "nav_today"], ["w", "nav_week"], ["m", "nav_month"], ["p", "nav_top"]];
  const rows: NavButton[][] = [top.map(([v, key]) => ({ text: `${v === family ? "• " : ""}${tr(lang, key)}`, callback_data: `n:${v}:0` }))];
  if (family === "m") {
    const tabs: [ViewKind, string][] = [["m", "tab_overview"], ["y", "tab_days"], ["b", "tab_budgets"], ["t", "tab_trend"]];
    rows.push(tabs.map(([v, key]) => ({ text: `${v === view ? "• " : ""}${tr(lang, key)}`, callback_data: `n:${v}:${offset}` })));
  }
  const step: NavButton[] = [];
  if (offset < MAX_OFFSET[view]) step.push({ text: tr(lang, "nav_prev"), callback_data: `n:${view}:${offset + 1}` });
  if (offset > 0) step.push({ text: tr(lang, "nav_next"), callback_data: `n:${view}:${offset - 1}` });
  if (options.siteUrl) step.push({ text: tr(lang, "btn_open"), url: options.siteUrl });
  if (step.length) rows.push(step);
  if (options.details && view === "w") rows.push([{ text: tr(lang, "nav_details"), callback_data: `n:fw:${offset}` }]);
  if (options.siteUrl) rows.push([{ text: tr(lang, "btn_dashboard"), web_app: { url: miniAppUrl(options.siteUrl) } }]);
  return rows;
}
