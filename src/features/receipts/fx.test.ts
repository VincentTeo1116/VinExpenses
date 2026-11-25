import { describe, expect, it } from 'vitest';
import { originalNote, toRinggit } from './fx';

describe('fx helpers', () => {
  it('converts to the sen', () => {
    expect(toRinggit(25, 4.2)).toBe(105);
    expect(toRinggit(19.99, 4.4521)).toBe(89);
    expect(toRinggit(0.01, 4.4)).toBe(0.04);
  });
  it('writes the original into the note', () => {
    expect(originalNote('USD', 25, { rate: 4.2, date: '2026-10-12', fallback: false })).toBe('Original: USD 25.00 at 4.2000 (rate of 2026-10-12)');
  });
});

import { formatRate, withOriginal } from './fx';
describe('fx notes and rates', () => {
  it('shows small rates with enough digits', () => {
    expect(formatRate(4.2)).toBe('4.2000');
    expect(formatRate(0.000271)).toBe('0.00027100');
    expect(formatRate(150.234)).toBe('150.23');
  });
  it('replaces an earlier original line instead of adding a second, and keeps the note short enough', () => {
    const one = 'Original: USD 25.00 at 4.2000 (rate of 2026-10-12)';
    expect(withOriginal('', one)).toBe(one);
    expect(withOriginal('team lunch', one)).toBe('team lunch · ' + one);
    expect(withOriginal('team lunch · ' + one, one)).toBe('team lunch · ' + one);
    expect(withOriginal(one, one)).toBe(one);
    const long = withOriginal('x'.repeat(190), one);
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.endsWith(one)).toBe(true);
  });
});
