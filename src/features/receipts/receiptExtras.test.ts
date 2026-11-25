import { describe, expect, it } from 'vitest';
import { parseReceiptText } from './receiptParser';

const NOW = new Date('2026-11-25T00:00:00');
const parse = (t: string) => parseReceiptText(t, { now: NOW });

describe('scan upgrades (same cases as the server copy)', () => {
  it('reads "Total with Service Tax" as the amount to pay', () => {
    const r = parse('Sample Catering Sdn Bhd\nInvoice\n04 Nov 2026\nSubtotal 971.99\nService Tax 8% 58.33\nInvoice Total with Service Tax RM 1,030.32');
    expect(r.amount).toBe(1030.32);
    expect(r.amountEvidence).toMatch(/1,030\.32/);
  });
  it('takes the negative amount on an e-wallet payment screen', () => {
    const r = parse('Payment successful\n-RM163.92\nPaid with Touch n Go eWallet\n12 Oct 2026');
    expect(r.amount).toBe(163.92);
    expect(r.hints.payment).toBe('ewallet');
  });
  it('does not guess a negative amount without payment wording', () => {
    expect(parse('Credit note\n-RM20.00').amount).toBe(0);
  });
  it('tidies a capitalised merchant', () => {
    expect(parse('THE CONTS SDN BHD (1521322-V)\nTotal RM 10.00\n12 Oct 2026').merchant).toBe('The Conts Sdn Bhd');
  });
});
