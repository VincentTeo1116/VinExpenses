// The words of the public guide pages (fixed deposit and loan calculators). Plain data and plain functions with no React, no CSS and no
// "@/" imports, because the build also reads this file to write the same text into each page's HTML (see scripts/guide-pages.mts), so
// search engines and link previews see it without running any script. Every number in the examples comes from the app's own maths.
import { calcFd, calcLoan } from '../finance/finance';

export interface GuideSection {
  id: string;
  heading: string;
  paragraphs: string[];
}
export interface GuideTable {
  caption: string;
  head: string[];
  rows: string[][];
  note: string;
}
export interface Guide {
  slug: 'fd-calculator' | 'loan-calculator';
  path: string;
  /** The tab title and the search-result title. */
  title: string;
  /** The search-result description and the share-card text. */
  description: string;
  heading: string;
  /** The short name for the breadcrumb. */
  shortName: string;
  /** A short direct answer shown above the calculator. */
  answer: string;
  sections: GuideSection[];
  table: GuideTable;
  related: ('fd-calculator' | 'loan-calculator')[];
  /** The call to action under the guide. */
  cta: { title: string; text: string };
  /** The line under every calculator result. */
  disclaimer: string;
}

/** 1234.5 -> "RM 1,234.50" (written here so this file needs no helper from the app). */
export function rm(value: number): string {
  const [whole, cents] = value.toFixed(2).split('.') as [string, string];
  return `RM ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}

const START = '2026-01-01'; // the examples start on a fixed day so the page never changes between builds

function fdInterest(amount: number, rate: number, months: number): number {
  const r = calcFd({ amount, rate, tenureValue: months, tenureUnit: 'months', startDate: START, maturityDate: '', payout: 'maturity', taxRate: 0, dayBasis: 365 });
  return r.ok ? r.grossInterest : 0;
}
function fdDays(months: number): number {
  const r = calcFd({ amount: 10000, rate: 3.5, tenureValue: months, tenureUnit: 'months', startDate: START, maturityDate: '', payout: 'maturity', taxRate: 0, dayBasis: 365 });
  return r.ok ? r.days : 0;
}
function loanPayment(amount: number, rate: number, years: number, method: 'reducing' | 'flat') {
  const r = calcLoan({ amount, rate, termValue: years, termUnit: 'years', method, firstPaymentDate: '2030-01-15', fees: 0 });
  return r.ok ? r : null;
}

const FD_RATE = 3.5;
const FD_AMOUNTS = [5000, 10000, 50000];
const FD_MONTHS = [3, 6, 12];
const yearInterest = fdInterest(10000, FD_RATE, 12);
const ninety = fdInterest(10000, FD_RATE, 3);

const LOAN_RATE = 4.2;
const LOAN_AMOUNTS = [100000, 300000, 500000];
const LOAN_YEARS = [5, 10, 25];
const flat = loanPayment(100000, 4, 5, 'flat');
const reducing = loanPayment(100000, 4, 5, 'reducing');

export const GUIDES: Guide[] = [
  {
    slug: 'fd-calculator',
    path: '/fd-calculator',
    title: 'Fixed Deposit Calculator Malaysia: Interest and Maturity | VinExpenses',
    description: 'Free fixed deposit (FD) calculator for Malaysia. Enter the amount, rate and tenure to see your interest and the total at maturity. Nothing is saved or sent.',
    heading: 'Fixed deposit calculator for Malaysia',
    shortName: 'FD calculator',
    answer: `A fixed deposit earns simple interest: amount × rate × days ÷ 365. ${rm(10000)} at ${FD_RATE}% a year for 12 months earns ${rm(yearInterest)}, so you get back ${rm(10000 + yearInterest)}. Type your own figures below.`,
    sections: [
      {
        id: 'how',
        heading: 'How fixed deposit interest is worked out',
        paragraphs: [
          'Most Malaysian fixed deposits pay simple interest, not compound interest. The bank multiplies the amount you place by the yearly rate, then by the number of days the money stays, and divides by 365. Some banks divide by 360, so check which one your bank uses.',
          `Example: ${rm(10000)} at ${FD_RATE}% a year for 3 months (${fdDays(3)} days) earns ${rm(10000)} × ${FD_RATE}% × ${fdDays(3)} ÷ 365 = ${rm(ninety)}. For 12 months (${fdDays(12)} days) the same deposit earns ${rm(yearInterest)}.`,
          'The calculator rounds each amount to the sen, the way a statement does, so the figures add up exactly.',
        ],
      },
      {
        id: 'payout',
        heading: 'Interest at maturity, monthly, quarterly or yearly',
        paragraphs: [
          'You can choose when the interest is paid. Paid at maturity, you receive it with your money on the last day. Paid monthly, quarterly or yearly, you receive a part of it on each date and the rest on the last day.',
          'The total interest is the same either way, because the interest is simple. What changes is when the money reaches your account. The calculator lists each payment date when you choose a regular payout.',
        ],
      },
      {
        id: 'tax',
        heading: 'Tax on fixed deposit interest',
        paragraphs: [
          'Several Malaysian guides say that interest from bank deposits is generally not taxed for individuals who live in Malaysia. Rules can differ for companies and for people who live abroad, and rules change. Check with the Inland Revenue Board (LHDN) or your bank before relying on this.',
          'The calculator assumes no tax. If you need to see the effect of a tax rate, the VinExpenses app lets you enter one.',
        ],
      },
      {
        id: 'islamic',
        heading: 'Islamic term deposits',
        paragraphs: ['An Islamic term deposit pays a profit rate instead of an interest rate. The profit rate your bank quotes is usually an expected rate, so the calculator gives an estimate, and your bank’s final figure can differ.'],
      },
    ],
    table: {
      caption: `Interest earned at ${FD_RATE}% a year, paid at maturity`,
      head: ['Amount', ...FD_MONTHS.map((m) => `${m} months`)],
      rows: FD_AMOUNTS.map((a) => [rm(a), ...FD_MONTHS.map((m) => rm(fdInterest(a, FD_RATE, m)))]),
      note: `Deposits placed on 1 January 2026, 365-day year, no tax. Your own rate and dates will give different figures.`,
    },
    related: ['loan-calculator'],
    cta: { title: 'Keep track of your deposits', text: 'Save each fixed deposit in VinExpenses and get a reminder before it matures. It is free, and there are no ads.' },
    disclaimer: 'An estimate, not financial advice. Your bank’s own figures are the final ones.',
  },
  {
    slug: 'loan-calculator',
    path: '/loan-calculator',
    title: 'Loan Calculator Malaysia: Monthly Payment and Interest | VinExpenses',
    description: 'Free loan calculator for Malaysia. See your monthly payment, total interest and total repaid for a home, car or personal loan. Nothing is saved or sent.',
    heading: 'Loan calculator for Malaysia',
    shortName: 'Loan calculator',
    answer: `On a reducing-balance loan, a ${rm(300000)} loan at ${LOAN_RATE}% for 25 years costs ${rm(loanPayment(300000, LOAN_RATE, 25, 'reducing')?.instalment ?? 0)} a month. Change the figures below to try your own loan.`,
    sections: [
      {
        id: 'how',
        heading: 'How the monthly payment is worked out',
        paragraphs: [
          'Most home and car loans in Malaysia charge interest on the balance you still owe, which is called a reducing balance. Each month you pay a fixed amount. Early on, most of it is interest. Later, most of it pays off what you borrowed.',
          'The payment follows a standard formula that uses the amount borrowed, the monthly interest rate (the yearly rate divided by 12) and the number of monthly payments. The calculator rounds to the sen.',
        ],
      },
      {
        id: 'flat',
        heading: 'Flat rate and reducing balance are different',
        paragraphs: [
          'A flat rate charges interest on the full amount for the whole loan, even though you keep paying part of it back. That makes a flat rate cost more than the same number quoted as a reducing-balance rate.',
          flat && reducing
            ? `Example: ${rm(100000)} over 5 years at 4%. As a flat rate you pay ${rm(flat.instalment)} a month and ${rm(flat.totalInterest)} in interest. As a reducing-balance rate you pay ${rm(reducing.instalment)} a month and ${rm(reducing.totalInterest)} in interest. The calculator has a switch for both.`
            : 'The calculator has a switch for both.',
          'Before you compare two offers, check which kind of rate each one quotes.',
        ],
      },
      {
        id: 'fees',
        heading: 'What the monthly payment leaves out',
        paragraphs: ['The payment shown here covers the amount borrowed and its interest only. Legal fees, stamp duty, insurance and processing fees come on top, and they differ from bank to bank. Ask your bank for the total cost before you sign.'],
      },
    ],
    table: {
      caption: `Monthly payment at ${LOAN_RATE}% a year, reducing balance`,
      head: ['Loan amount', ...LOAN_YEARS.map((y) => `${y} years`)],
      rows: LOAN_AMOUNTS.map((a) => [rm(a), ...LOAN_YEARS.map((y) => rm(loanPayment(a, LOAN_RATE, y, 'reducing')?.instalment ?? 0))]),
      note: 'Fees, stamp duty and insurance are not included. Your own rate and term will give different figures.',
    },
    related: ['fd-calculator'],
    cta: { title: 'See every payment, and never miss one', text: 'Save your loan in VinExpenses to see the full repayment plan and get a reminder before each payment is due. It is free, and there are no ads.' },
    disclaimer: 'An estimate for a reducing-balance or flat-rate loan. Not financial advice; your bank’s figures can differ.',
  },
];

export const guideBySlug = (slug: string): Guide | undefined => GUIDES.find((g) => g.slug === slug);
