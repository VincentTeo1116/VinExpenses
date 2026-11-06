// A person's categories and payment methods (with the built-in lists as a fallback if the tables are empty or unreadable).

import { q, rest } from "./db.ts";

export interface Choice {
  key: string;
  label: string;
  color: string;
  active: boolean;
}

const BUILTIN_COLORS: Record<string, string> = {
  beverages: "#4f46e5", travel: "#06b6d4", entertain: "#f59e0b", work: "#10b981", food: "#ef4444",
  shopping: "#8b5cf6", utilities: "#0ea5e9", car: "#f97316", health: "#ec4899", other: "#6b7280",
};
export const DEFAULT_CATEGORIES: Choice[] = [
  ["beverages", "Beverages"], ["travel", "Travel"], ["entertain", "Entertain"], ["work", "Work"], ["food", "Food"],
  ["shopping", "Shopping"], ["utilities", "Utilities"], ["car", "Car"], ["health", "Health"], ["other", "Other"],
].map(([key, label]) => ({ key, label, color: BUILTIN_COLORS[key], active: true }));
export const DEFAULT_PAYMENTS: Choice[] = [["bank", "Bank"], ["card", "Card"], ["ewallet", "E-Wallet"]]
  .map(([key, label]) => ({ key, label, color: "#4f46e5", active: true }));

const safeColor = (value: unknown, fallback: string) => (typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback);

export async function loadChoices(userId: string): Promise<{ categories: Choice[]; payments: Choice[] }> {
  const [categoryResponse, paymentResponse] = await Promise.all([
    rest(`user_categories?select=category_key,label,color,active&user_id=eq.${q(userId)}&order=sort_order.asc,category_key.asc`),
    rest(`user_payment_methods?select=payment_key,label,color,active&user_id=eq.${q(userId)}&order=sort_order.asc,payment_key.asc`),
  ]);
  const categories = categoryResponse.ok ? await categoryResponse.json() as { category_key: string; label: string; color: string; active: boolean }[] : [];
  const payments = paymentResponse.ok ? await paymentResponse.json() as { payment_key: string; label: string; color: string; active: boolean }[] : [];
  return {
    categories: categories.length
      ? categories.map((r) => ({ key: String(r.category_key), label: String(r.label), color: safeColor(r.color, "#6b7280"), active: r.active !== false }))
      : DEFAULT_CATEGORIES,
    payments: payments.length
      ? payments.map((r) => ({ key: String(r.payment_key), label: String(r.label), color: safeColor(r.color, "#4f46e5"), active: r.active !== false }))
      : DEFAULT_PAYMENTS,
  };
}
