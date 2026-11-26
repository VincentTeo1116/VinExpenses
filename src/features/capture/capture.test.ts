// CP-01, CP-02: reading payments from notifications; every sample below is invented, not real app wording.
import { describe, expect, it } from 'vitest';
import { addCandidate, dropOld, DUPLICATE_WINDOW_MS, KEEP_MS, MAX_ITEMS, parseStored, removeCandidate } from './inbox';
import { amountsIn, localDate, plain, RULES, readNotification, toCents, type Candidate, type RawNotification, type Rules } from './engine';

const AT = new Date(2026, 10, 25, 13, 5).getTime(); // 25 Nov 2026, 13:05 local

const TEST_RULES: Rules = {
  ...RULES,
  apps: [
    { id: 'demo', label: 'Demo Wallet', packages: ['test.demo.wallet'], verified: true, spend: ['\\byou paid\\b', '\\bpayment (successful|made)\\b', '已付款'], amount: '(?:paid|payment[^\\n]*?|付款)\\s*(?:RM|MYR)\\s?(?<amount>[\\d,]+(?:\\.\\d{1,2})?)', merchant: '\\bto (?<merchant>[^\\n.]+?)(?: on | at |\\.|\\n|$)' },
    { id: 'plain', label: 'Plain Bank', packages: ['test.plain.bank'], verified: true, spend: ['\\bspent\\b'] },
    { id: 'draft', label: 'Draft App', packages: ['test.draft.app'], verified: false, spend: ['\\bpaid\\b'] },
  ],
};
const note = (packageName: string, title: string, text: string, postedAt = AT): RawNotification => ({ packageName, title, text, postedAt });
const demo = (text: string, title = 'Payment') => readNotification(note('test.demo.wallet', title, text), TEST_RULES);

describe('which apps are read at all', () => {
  it('the shipped rules read nothing yet: no app is verified with a spend pattern until real samples exist', () => {
    for (const app of RULES.apps) {
      expect(app.verified && app.spend.length > 0, app.id).toBe(false);
      expect(readNotification(note(app.packages[0] as string, 'x', 'You paid RM 5.00 to Shop'))).toEqual({ ok: false, reason: 'no-rule' });
    }
  });
  it('another app is ignored, and so is an app whose rules are not verified', () => {
    expect(readNotification(note('com.some.game', 'Win', 'You paid RM 5.00 to X'), TEST_RULES)).toEqual({ ok: false, reason: 'not-watched' });
    expect(readNotification(note('test.draft.app', 'x', 'You paid RM 5.00'), TEST_RULES)).toEqual({ ok: false, reason: 'no-rule' });
  });
});

describe('a payment', () => {
  it('is read: amount, shop and the phone\'s local date', () => {
    const result = demo('You paid RM 12.50 to Kopitiam Ah Seng on 25 Nov.');
    expect(result).toMatchObject({ ok: true, candidate: { app: 'demo', amount: 12.5, merchant: 'Kopitiam Ah Seng', currency: 'MYR', date: '2026-11-25', confidence: 'high' } });
  });
  it('reads thousands separators, short cents, and Chinese wording', () => {
    expect(demo('You paid RM 1,234.5 to Big Shop.')).toMatchObject({ ok: true, candidate: { amount: 1234.5 } });
    expect(demo('You paid RM5 to Stall.')).toMatchObject({ ok: true, candidate: { amount: 5 } });
    expect(demo('已付款 付款 RM 8.90 to 茶餐室.')).toMatchObject({ ok: true, candidate: { amount: 8.9 } });
  });
  it('without a shop name still counts, marked low confidence so the person fills the shop in', () => {
    expect(demo('You paid RM 7.00')).toMatchObject({ ok: true, candidate: { merchant: '', confidence: 'low' } });
  });
  it('the date is the phone\'s local day of posting, not UTC (just after midnight in Malaysia is still that day)', () => {
    const late = new Date(2026, 10, 26, 0, 20).getTime();
    expect(localDate(late)).toBe('2026-11-26');
    expect(readNotification(note('test.demo.wallet', 'Payment', 'You paid RM 3.00 to Stall.', late), TEST_RULES)).toMatchObject({ ok: true, candidate: { date: '2026-11-26' } });
  });
  it('keeps nothing from the notification except the facts: no card digits, balance or names appear in the result', () => {
    const result = demo('You paid RM 12.50 to Cafe. Card ending 4821, balance RM 900.00, Hi Aisyah binti Ahmad', 'Payment');
    expect(result.ok).toBe(true);
    const serialised = JSON.stringify(result);
    for (const secret of ['4821', '900.00', 'Aisyah', 'Ahmad']) expect(serialised, secret).not.toContain(secret);
  });
  it('the same notification posted twice gets the same id', () => {
    const a = demo('You paid RM 9.00 to Stall.');
    const b = demo('You paid RM 9.00 to Stall.');
    expect(a.ok && b.ok && a.candidate.id === b.candidate.id).toBe(true);
  });
});

describe('what is never a payment', () => {
  const reason = (text: string, title = 'Payment') => (demo(text, title) as { reason?: string }).reason;
  it('one-time codes, in English, Malay and Chinese', () => {
    expect(reason('Your OTP is 482913. You paid RM 5 to X')).toBe('otp');
    expect(reason('Kod TAC anda 123456. You paid RM 5')).toBe('otp');
    expect(reason('验证码 654321 payment made RM 5')).toBe('otp');
    expect(reason('Use code 8842 to confirm. You paid RM 5')).toBe('otp');
  });
  it('login and security alerts', () => {
    expect(reason('New device login detected. You paid RM 5')).toBe('security');
    expect(reason('Your password was changed. Payment made RM 5')).toBe('security');
    expect(reason('检测到可疑登录 payment made RM 5')).toBe('security');
  });
  it('adverts, including "% off" and Chinese ones', () => {
    expect(reason('Enjoy 20% off! You paid RM 5 to X')).toBe('promo');
    expect(reason('Voucher waiting. Payment made RM 5')).toBe('promo');
    expect(reason('优惠 payment made RM 5')).toBe('promo');
  });
  it('refunds, top-ups, transfers to yourself and money received are not spending', () => {
    expect(reason('Refund RM 10 for your payment made earlier')).toBe('refund');
    expect(reason('Top up RM 50 successful. Payment made')).toBe('topup');
    expect(reason('Payment made: transfer to your own account')).toBe('transfer');
    expect(reason('You received RM 100 from Ali. Payment made')).toBe('income');
    expect(reason('收到 RM 20, payment made')).toBe('income');
  });
  it('something that is not a payment at all', () => {
    expect(reason('Your statement is ready')).toBe('not-payment');
  });
  it('two different amounts with no rule naming the right one are refused instead of guessed', () => {
    expect(readNotification(note('test.plain.bank', 'Card', 'You spent RM 20.00. Balance RM 480.00'), TEST_RULES)).toEqual({ ok: false, reason: 'ambiguous-amount' });
    expect(readNotification(note('test.plain.bank', 'Card', 'You spent RM 20.00. Thanks'), TEST_RULES)).toMatchObject({ ok: true, candidate: { amount: 20, merchant: '', confidence: 'low' } });
  });
  it('a missing, zero or absurd amount is refused', () => {
    expect(readNotification(note('test.plain.bank', 'Card', 'You spent money'), TEST_RULES)).toEqual({ ok: false, reason: 'no-amount' });
    expect(readNotification(note('test.plain.bank', 'Card', 'You spent RM 0.00'), TEST_RULES)).toEqual({ ok: false, reason: 'no-amount' });
    expect(readNotification(note('test.plain.bank', 'Card', 'You spent RM 5,000,000.00'), TEST_RULES)).toEqual({ ok: false, reason: 'no-amount' });
  });
});

describe('amount helpers', () => {
  it('finds each distinct RM amount once', () => {
    expect(amountsIn('RM 5.00 and MYR 5.00 and RM1,200 and RM 0.5')).toEqual([500, 120000, 50]);
  });
  it('turns text into cents only when it is a sane number', () => {
    expect(toCents('1,234.50')).toBe(123450);
    expect(toCents('RM 7')).toBe(700);
    expect(toCents('7.5')).toBe(750);
    expect(toCents('abc')).toBeNull();
    expect(toCents('1.234')).toBeNull();
  });
  it('plain() makes look-alike characters ordinary', () => {
    expect(plain('RM 12.50  ')).toBe('RM 12.50');
    expect(plain('ＲＭ１２')).toBe('RM12');
  });
});

describe('the review inbox', () => {
  const item = (over: Partial<Candidate> = {}): Candidate => ({ id: 'a', app: 'demo', appLabel: 'Demo', amount: 10, currency: 'MYR', merchant: 'Shop', date: '2026-11-25', postedAt: AT, confidence: 'high', ...over });

  it('adds the newest first', () => {
    const list = addCandidate(addCandidate([], item({ id: 'a', amount: 10 })), item({ id: 'b', amount: 20, postedAt: AT + DUPLICATE_WINDOW_MS * 3 }));
    expect(list.map((i) => i.id)).toEqual(['b', 'a']);
  });
  it('the wallet and the bank announcing one payment within minutes make one entry, not two', () => {
    const first = addCandidate([], item({ id: 'wallet', app: 'tng' }));
    const second = addCandidate(first, item({ id: 'bank', app: 'mae', postedAt: AT + 90_000 }));
    expect(second).toBe(first);
  });
  it('the same amount much later, or a different amount at the same time, is a separate payment', () => {
    const base = [item({ id: 'a' })];
    expect(addCandidate(base, item({ id: 'b', postedAt: AT + DUPLICATE_WINDOW_MS + 1000 }))).toHaveLength(2);
    expect(addCandidate(base, item({ id: 'c', amount: 10.01 }))).toHaveLength(2);
  });
  it('is capped, so a flood of notifications cannot fill the phone', () => {
    let list: Candidate[] = [];
    for (let n = 0; n < MAX_ITEMS + 30; n += 1) list = addCandidate(list, item({ id: `i${n}`, amount: n + 1, postedAt: AT + n * DUPLICATE_WINDOW_MS * 2 }));
    expect(list).toHaveLength(MAX_ITEMS);
  });
  it('removes one entry (confirm or dismiss) and drops entries nobody looked at for a month', () => {
    const list = [item({ id: 'a' }), item({ id: 'b', amount: 99, postedAt: AT - KEEP_MS - 1 })];
    expect(removeCandidate(list, 'a').map((i) => i.id)).toEqual(['b']);
    expect(dropOld(list, AT).map((i) => i.id)).toEqual(['a']);
  });
  it('reads stored data defensively: junk, wrong shapes and bad rows never get in', () => {
    expect(parseStored(null)).toEqual([]);
    expect(parseStored('not json')).toEqual([]);
    expect(parseStored('{"a":1}')).toEqual([]);
    const good = item();
    const text = JSON.stringify([good, { id: 'x', amount: -5, postedAt: 1, merchant: '', date: '2026-01-01' }, { id: 'y', amount: 5, postedAt: 1, merchant: '', date: 'bad' }, 7, null]);
    expect(parseStored(text)).toEqual([good]);
  });
});
