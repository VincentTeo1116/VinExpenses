// GD-01: the bill maths: service charge, SST, the 5-sen rounding of the total, and an exact split between people.
import { describe, expect, it } from 'vitest';
import { calcBill, numbersOnly, percentOf, roundingFor, splitEvenly, toSen } from './bill';

describe('5-sen rounding (Bank Negara: 1 and 2 down, 3 and 4 up, 6 and 7 down, 8 and 9 up)', () => {
  it('rounds every last digit the way the notice says', () => {
    const expected: Record<number, number> = { 0: 0, 1: -1, 2: -2, 3: 2, 4: 1, 5: 0, 6: -1, 7: -2, 8: 2, 9: 1 };
    for (const [digit, adjust] of Object.entries(expected)) expect(roundingFor(2430 + Number(digit)), `ends in ${digit}`).toBe(adjust);
  });
  it('the examples in the notice (RM82.01 to RM82.09)', () => {
    const rounded = (cents: number) => cents + roundingFor(cents);
    expect([8201, 8202, 8203, 8204, 8206, 8207, 8208, 8209].map(rounded)).toEqual([8200, 8200, 8205, 8205, 8205, 8205, 8210, 8210]);
  });
});

describe('a bill', () => {
  it('RM21.00 with 10% service charge and 6% SST (on the price without the service charge) is RM24.36, rounded to RM24.35', () => {
    expect(calcBill({ itemsCents: 2100, servicePercent: 10, sstPercent: 6 })).toEqual({ itemsCents: 2100, serviceCents: 210, sstCents: 126, beforeRoundingCents: 2436, roundingCents: -1, totalCents: 2435 });
  });
  it('some shops charge SST on the service charge too: that adds 13 sen here', () => {
    const bill = calcBill({ itemsCents: 2100, servicePercent: 10, sstPercent: 6, sstOnService: true });
    expect(bill.sstCents).toBe(139);
    expect(bill.beforeRoundingCents).toBe(2449);
    expect(bill.totalCents).toBe(2450);
  });
  it('a shop without service charge or SST: 0 means not charged, and rounding can be switched off', () => {
    expect(calcBill({ itemsCents: 2103, servicePercent: 0, sstPercent: 0, round: false })).toMatchObject({ serviceCents: 0, sstCents: 0, roundingCents: 0, totalCents: 2103 });
    expect(calcBill({ itemsCents: 2103, servicePercent: 0, sstPercent: 0 }).totalCents).toBe(2105);
  });
  it('rounds each percentage half up to a whole sen', () => {
    expect(percentOf(105, 10)).toBe(11); // 10.5 sen
    expect(percentOf(1, 6)).toBe(0);
    expect(percentOf(1000, 8.5)).toBe(85);
  });
  it('never goes below zero and ignores a nonsense amount', () => {
    expect(calcBill({ itemsCents: -500, servicePercent: 10, sstPercent: 6 }).totalCents).toBe(0);
  });
});

describe('splitting', () => {
  it('the shares always add up to the exact total', () => {
    for (const [total, people] of [[2435, 4], [2435, 3], [100, 7], [0, 5], [999, 1]] as const) {
      const { each, extra } = splitEvenly(total, people);
      expect(each * people + extra, `${total} between ${people}`).toBe(total);
      expect(extra).toBeLessThan(people);
    }
  });
  it('RM24.35 between 4 people is RM6.08 each and three of them pay one sen more', () => {
    expect(splitEvenly(2435, 4)).toEqual({ each: 608, extra: 3 });
  });
  it('treats zero or a fraction of people as one', () => {
    expect(splitEvenly(500, 0)).toEqual({ each: 500, extra: 0 });
    expect(splitEvenly(500, 2.9)).toEqual({ each: 250, extra: 0 });
  });
});

describe('the number pad filter', () => {
  it('keeps digits and one dot only', () => {
    expect(numbersOnly('12abc.5.7')).toBe('12.57');
    expect(numbersOnly('-5,00')).toBe('500');
    expect(numbersOnly('1e5')).toBe('15');
    expect(numbersOnly('  ')).toBe('');
    expect(numbersOnly('.5')).toBe('.5');
  });
  it('whole numbers only for a head count', () => {
    expect(numbersOnly('3.5 people', false)).toBe('35');
  });
  it('turns text into sen, and anything unreadable into 0', () => {
    expect(toSen('12.5')).toBe(1250);
    expect(toSen('')).toBe(0);
    expect(toSen('.')).toBe(0);
    expect(toSen('0.005')).toBe(1);
  });
});
