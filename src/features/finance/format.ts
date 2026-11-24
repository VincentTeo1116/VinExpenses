// Turns the maths module's error codes and day counts into text in the person's language.
import type { MessageKey } from '@/lib/i18n';
import type { FieldError } from './finance';

type T = (key: MessageKey, values?: Record<string, string | number>) => string;
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function errorText(t: T, error: FieldError | undefined): string | undefined {
  if (!error) return undefined;
  const label = error.label ? t(`fin.l.${error.label}` as MessageKey) : '';
  const n = error.n === undefined ? '' : Number(error.n).toLocaleString('en-MY', { maximumFractionDigits: 3 });
  const text = t(`fin.e.${error.code}` as MessageKey, { label, n });
  return error.code === 'required' ? text : capitalise(text);
}

/** "today" / "tomorrow" / "in 3 days" / "2 days ago" */
export function whenText(t: T, daysLeft: number): string {
  if (daysLeft === 0) return t('rem.when.today');
  if (daysLeft === 1) return t('rem.when.tomorrow');
  if (daysLeft === -1) return t('rem.when.yesterday');
  return daysLeft > 0 ? t('rem.when.inDays', { n: daysLeft }) : t('rem.when.ago', { n: -daysLeft });
}
