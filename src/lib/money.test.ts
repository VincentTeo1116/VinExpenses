import { describe, expect, it } from 'vitest';
import { formatMoney, formatSigned, toCents } from './money';

describe('money', () => {
  it('rounds to whole cents so floating-point noise never shows', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents('1,234.567')).toBe(123457);
    expect(toCents('abc')).toBe(0);
    expect(toCents(Number.NaN)).toBe(0);
  });

  it('shows ringgit with two decimals and thousands separators', () => {
    expect(formatMoney(0)).toBe('RM 0.00');
    expect(formatMoney('1234.5')).toBe('RM 1,234.50');
    expect(formatMoney(-10)).toBe('−RM 10.00');
  });

  it('income is plus and spending is minus', () => {
    expect(formatSigned(25)).toBe('+ RM 25.00');
    expect(formatSigned(-25)).toBe('− RM 25.00');
    expect(formatSigned(0)).toBe('RM 0.00');
  });
});
