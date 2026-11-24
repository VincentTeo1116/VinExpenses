// All money is shown in ringgit. Values are rounded to whole cents so floating-point noise never reaches the screen.

export function toCents(value: number | string): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function formatMoney(value: number | string): string {
  const cents = toCents(value);
  const sign = cents < 0 ? '−' : '';
  const body = (Math.abs(cents) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}RM ${body}`;
}

/** "+ RM 10.00" or "− RM 10.00": income is plus, spending is minus. */
export function formatSigned(value: number | string): string {
  const cents = toCents(value);
  if (cents === 0) return formatMoney(0);
  return `${cents < 0 ? '−' : '+'} ${formatMoney(Math.abs(cents) / 100)}`;
}
