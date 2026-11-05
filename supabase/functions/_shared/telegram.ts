// Telegram helpers: a small API client, the expense-message parser, and message formatting.
// The bot token is part of every Telegram API address, so these functions never log, return or throw an address.

import { escapeHtml, ringgit } from "./email-templates.ts";

export { escapeHtml, ringgit };

export interface InlineButton {
  text: string;
  callback_data: string;
}
export interface SendOptions {
  buttons?: InlineButton[][];
}

export interface TelegramClient {
  send(chatId: number, html: string, options?: SendOptions): Promise<void>;
  /** Like send, but says what happened: "blocked" means the person blocked the bot or deleted the chat (stop sending). */
  sendChecked(chatId: number, html: string): Promise<"ok" | "blocked" | "failed">;
  edit(chatId: number, messageId: number, html: string, options?: SendOptions): Promise<void>;
  answer(callbackId: string, text?: string): Promise<void>;
  /** Downloads a photo/file the user sent. `too_large` when it is bigger than maxBytes, `failed` for anything else. */
  fileBytes(fileId: string, maxBytes: number): Promise<{ bytes: Uint8Array } | { error: "too_large" | "failed" }>;
}

/** The real client. Failures are logged by status only and never stop the webhook from answering Telegram. */
export function telegramClient(token: string, fetchImpl: typeof fetch = fetch): TelegramClient {
  const call = async (method: string, payload: Record<string, unknown>) => {
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) console.error(`telegram ${method} failed with status ${response.status}`);
    } catch (_error) {
      console.error(`telegram ${method} failed (network)`);
    }
  };
  const markup = (options?: SendOptions) => (options?.buttons ? { reply_markup: { inline_keyboard: options.buttons } } : {});
  return {
    async sendChecked(chatId, html) {
      try {
        const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) return "ok";
        console.error(`telegram sendMessage failed with status ${response.status}`);
        return response.status === 403 ? "blocked" : "failed";
      } catch (_error) {
        console.error("telegram sendMessage failed (network)");
        return "failed";
      }
    },
    send: (chatId, html, options) => call("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true, ...markup(options) }),
    edit: (chatId, messageId, html, options) =>
      call("editMessageText", { chat_id: chatId, message_id: messageId, text: html, parse_mode: "HTML", disable_web_page_preview: true, ...markup(options) }),
    answer: (callbackId, text) => call("answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text: text.slice(0, 180) } : {}) }),
    async fileBytes(fileId, maxBytes) {
      try {
        const info = await fetchImpl(`https://api.telegram.org/bot${token}/getFile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_id: fileId }),
          signal: AbortSignal.timeout(8000),
        });
        if (!info.ok) return { error: "failed" };
        const meta = (await info.json())?.result;
        const path = typeof meta?.file_path === "string" ? meta.file_path : "";
        if (!/^[A-Za-z0-9_\-./]{1,200}$/.test(path) || path.includes("..")) return { error: "failed" };
        if (typeof meta.file_size === "number" && meta.file_size > maxBytes) return { error: "too_large" };
        const file = await fetchImpl(`https://api.telegram.org/file/bot${token}/${path}`, { signal: AbortSignal.timeout(15000) });
        if (!file.ok) return { error: "failed" };
        const bytes = new Uint8Array(await file.arrayBuffer());
        return bytes.length > maxBytes ? { error: "too_large" } : { bytes };
      } catch (_error) {
        console.error("telegram file download failed (network)");
        return { error: "failed" };
      }
    },
  };
}

// ---------------------------------------------------------------- parsing "lunch 12.50 grab card"

export const MAX_AMOUNT = 1_000_000;

export interface ParsedExpense {
  amount: number;
  /** Everything that is not the amount or a payment word, e.g. "lunch grab". */
  description: string;
  paymentWord: string | null;
}

const AMOUNT_TOKEN = /^(rm|myr)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{1,7}(?:[.,]\d{1,2})?)$/i;

/** Keeps letters, digits and ordinary punctuation; drops control and invisible characters. */
export function cleanText(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f​-‏\u2028-‮⁠﻿]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Finds the amount and the description in a free-form message. The amount is, in order of preference:
 * a number written with RM/MYR, then a number with decimals, then the last plain number.
 * "7-eleven 5.50" -> 5.50 (the 7 is part of a name), "rm12 petrol" -> 12.
 * `paymentWords` are the user's payment-method names; one match is removed from the description and reported.
 */
export function parseExpense(text: string, paymentWords: string[] = []): ParsedExpense | null {
  const spaced = cleanText(text, 500).replace(/([\u3400-\u9fff])(?=[\d])/g, "$1 ").replace(/(\d)(?=[\u3400-\u9fff])/g, "$1 ");
  const tokens = spaced.split(" ").filter(Boolean);
  const candidates = tokens
    .map((token, index) => ({ index, match: AMOUNT_TOKEN.exec(token.replace(/[,;]+$/, "")) }))
    .filter((entry) => entry.match);
  if (!candidates.length) return null;
  const withRm = candidates.find((c) => c.match![1]);
  const withDecimals = candidates.find((c) => /[.,]\d{1,2}$/.test(c.match![2]));
  const chosen = withRm ?? withDecimals ?? candidates[candidates.length - 1];
  const raw = chosen.match![2];
  const thousands = /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(raw); // "1,200.50" (thousands) vs "12,50" (decimal comma)
  const amount = Math.round(Number(thousands ? raw.replace(/,/g, "") : raw.replace(",", ".")) * 100) / 100;
  if (!Number.isFinite(amount) || amount < 0.01 || amount > MAX_AMOUNT) return null;

  const rest = tokens.filter((_, index) => index !== chosen.index);
  let paymentWord: string | null = null;
  const lowered = paymentWords.map((word) => word.toLowerCase()).filter(Boolean);
  const kept = rest.filter((token) => {
    const bare = token.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!paymentWord && bare && lowered.includes(bare)) { paymentWord = bare; return false; }
    return true;
  });
  return { amount, description: kept.join(" ").slice(0, 80), paymentWord };
}

// ---------------------------------------------------------------- time windows (Kuala Lumpur, UTC+8)

const KL_OFFSET_MS = 8 * 60 * 60 * 1000;

export function klWindow(kind: "day" | "month", now: Date): { start: string; end: string; label: string } {
  const local = new Date(now.getTime() + KL_OFFSET_MS); // shifted so the UTC getters read Kuala Lumpur time
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  const startLocal = kind === "day" ? Date.UTC(y, m, d) : Date.UTC(y, m, 1);
  const endLocal = kind === "day" ? Date.UTC(y, m, d + 1) : Date.UTC(y, m + 1, 1);
  const label = kind === "day"
    ? new Date(startLocal).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    : new Date(startLocal).toLocaleDateString("en-MY", { month: "long", year: "numeric", timeZone: "UTC" });
  return { start: new Date(startLocal - KL_OFFSET_MS).toISOString(), end: new Date(endLocal - KL_OFFSET_MS).toISOString(), label };
}

// ---------------------------------------------------------------- link codes

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I: easy to read out or retype
export const CODE_PATTERN = /^[A-Z2-9]{10}$/;

export function newLinkCode(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => CODE_ALPHABET[byte % 32]).join(""); // 256 is a multiple of 32: no bias
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
