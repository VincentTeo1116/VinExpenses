// Categories, payment methods and income sources: the built-in lists, merged with what the person renamed, hid or added.
import type { MessageKey } from '@/lib/i18n';
import type { CategoryRow, PaymentRow } from './types';

export interface TaxonomyItem {
  key: string;
  label: string;
  color: string;
  glyph: string;
  active: boolean;
  builtin: boolean;
  /** The built-in name was changed by the person. */
  renamed: boolean;
}

interface Builtin {
  key: string;
  label: MessageKey;
  english: string;
  color: string;
  glyph: string;
}

export const BUILTIN_CATEGORIES: Builtin[] = [
  { key: 'beverages', label: 'cat.beverages', english: 'Beverages', color: '#4f46e5', glyph: '☕' },
  { key: 'travel', label: 'cat.travel', english: 'Travel', color: '#06b6d4', glyph: '✈️' },
  { key: 'entertain', label: 'cat.entertain', english: 'Entertain', color: '#f59e0b', glyph: '🎬' },
  { key: 'work', label: 'cat.work', english: 'Work', color: '#10b981', glyph: '💼' },
  { key: 'food', label: 'cat.food', english: 'Food', color: '#ef4444', glyph: '🍽️' },
  { key: 'shopping', label: 'cat.shopping', english: 'Shopping', color: '#8b5cf6', glyph: '🛍️' },
  { key: 'utilities', label: 'cat.utilities', english: 'Utilities', color: '#0ea5e9', glyph: '💡' },
  { key: 'car', label: 'cat.car', english: 'Car', color: '#f97316', glyph: '🚗' },
  { key: 'health', label: 'cat.health', english: 'Health', color: '#ec4899', glyph: '❤️' },
  { key: 'other', label: 'cat.other', english: 'Other', color: '#6b7280', glyph: '•••' },
];

export const BUILTIN_PAYMENTS: Builtin[] = [
  { key: 'bank', label: 'pay.bank', english: 'Bank', color: '#4f46e5', glyph: '🏦' },
  { key: 'card', label: 'pay.card', english: 'Card', color: '#4f46e5', glyph: '💳' },
  { key: 'ewallet', label: 'pay.ewallet', english: 'E-Wallet', color: '#4f46e5', glyph: '📱' },
];

export const INCOME_SOURCES: { key: string; label: MessageKey }[] = [
  { key: 'Salary', label: 'src.salary' },
  { key: 'Freelance', label: 'src.freelance' },
  { key: 'Bonus', label: 'src.bonus' },
  { key: 'Investment', label: 'src.investment' },
];

/** Colours and glyphs the page can show safely: anything else stored in the database is replaced. */
export const safeColor = (value: unknown): string => (typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value) ? value : '#4f46e5');

const FA_GLYPHS: Record<string, string> = {
  'fa-mug-hot': '☕', 'fa-plane': '✈️', 'fa-film': '🎬', 'fa-briefcase': '💼', 'fa-utensils': '🍽️', 'fa-bag-shopping': '🛍️', 'fa-bolt': '💡', 'fa-car': '🚗',
  'fa-heart-pulse': '❤️', 'fa-ellipsis': '•••', 'fa-building-columns': '🏦', 'fa-credit-card': '💳', 'fa-mobile-screen': '📱', 'fa-wallet': '👛', 'fa-tag': '🏷️',
};
const glyphFor = (icon: unknown, fallback: string): string => (typeof icon === 'string' && FA_GLYPHS[icon]) || fallback;

type Translate = (key: MessageKey) => string;

function merge(builtins: Builtin[], rows: { key: string; row: { label: string; icon: string; color: string; active: boolean; is_builtin: boolean; sort_order: number } }[], t: Translate, fallbackGlyph: string): TaxonomyItem[] {
  const byKey = new Map(rows.map((entry) => [entry.key, entry.row]));
  const items: (TaxonomyItem & { order: number })[] = [];
  builtins.forEach((builtin, index) => {
    const row = byKey.get(builtin.key);
    const standard = t(builtin.label);
    items.push({
      key: builtin.key,
      label: row?.label && row.label !== builtin.english ? row.label : standard,
      color: safeColor(row?.color ?? builtin.color),
      glyph: builtin.glyph,
      active: row ? row.active : true,
      builtin: true,
      renamed: Boolean(row?.label && row.label !== builtin.english && row.label !== standard),
      order: row?.sort_order ?? index,
    });
  });
  for (const { key, row } of rows) {
    if (builtins.some((builtin) => builtin.key === key)) continue;
    items.push({ key, label: row.label, color: safeColor(row.color), glyph: glyphFor(row.icon, fallbackGlyph), active: row.active, builtin: false, renamed: false, order: row.sort_order });
  }
  return items.sort((a, b) => a.order - b.order).map((entry) => {
    const { order, ...item } = entry;
    void order;
    return item;
  });
}

export const mergeCategories = (rows: CategoryRow[], t: Translate): TaxonomyItem[] => merge(BUILTIN_CATEGORIES, rows.map((row) => ({ key: row.category_key, row })), t, '🏷️');
export const mergePayments = (rows: PaymentRow[], t: Translate): TaxonomyItem[] => merge(BUILTIN_PAYMENTS, rows.map((row) => ({ key: row.payment_key, row })), t, '👛');

/** A key the database accepts for a new custom item, made from its name. */
export function newKey(label: string, taken: string[]): string {
  const base = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'item';
  let key = `c-${base}`;
  let n = 2;
  while (taken.includes(key)) key = `c-${base}-${n++}`;
  return key;
}
