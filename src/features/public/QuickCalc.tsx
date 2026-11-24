// "Try it": the real loan maths from the app (the same code the Plan screen uses), with three sliders. Nothing is saved or sent.
import { useId, useState } from 'react';
import { formatMoney } from '@/lib/money';
import { calcLoan } from '@/features/finance/finance';
import styles from './QuickCalc.module.css';

export function QuickCalc() {
  const base = useId();
  const [amount, setAmount] = useState(300000);
  const [rate, setRate] = useState(4.2);
  const [years, setYears] = useState(25);
  const result = calcLoan({ amount, rate, termValue: years, termUnit: 'years', method: 'reducing', firstPaymentDate: '2030-01-15', fees: 0 });
  const ok = result.ok;
  const interestShare = ok ? Math.round((result.totalInterest / result.totalPayments) * 100) : 0;
  return (
    <div className={styles.calc}>
      <div className={styles.controls}>
        <label htmlFor={`${base}-a`}>
          <span>Loan amount</span>
          <output htmlFor={`${base}-a`}>{formatMoney(amount)}</output>
        </label>
        <input id={`${base}-a`} type="range" min={50000} max={1500000} step={10000} value={amount} onChange={(event) => setAmount(Number(event.target.value))} />
        <label htmlFor={`${base}-r`}>
          <span>Interest rate a year</span>
          <output htmlFor={`${base}-r`}>{rate.toFixed(1)}%</output>
        </label>
        <input id={`${base}-r`} type="range" min={1} max={10} step={0.1} value={rate} onChange={(event) => setRate(Number(event.target.value))} />
        <label htmlFor={`${base}-y`}>
          <span>Years to repay</span>
          <output htmlFor={`${base}-y`}>{years} years</output>
        </label>
        <input id={`${base}-y`} type="range" min={1} max={35} step={1} value={years} onChange={(event) => setYears(Number(event.target.value))} />
      </div>
      <div className={styles.result} aria-live="polite">
        <span className={styles.label}>You would pay each month</span>
        <strong className={styles.big} data-testid="quick-payment">
          {ok ? formatMoney(result.instalment) : '–'}
        </strong>
        <div className={styles.split} role="img" aria-label={`Of everything you repay, ${interestShare}% is interest`}>
          <progress className={styles.bar} max={100} value={interestShare} aria-hidden="true" />
        </div>
        <dl className={styles.facts}>
          <div>
            <dt>Total interest</dt>
            <dd>{ok ? formatMoney(result.totalInterest) : '–'}</dd>
          </div>
          <div>
            <dt>Total repaid</dt>
            <dd>{ok ? formatMoney(result.totalPayments) : '–'}</dd>
          </div>
        </dl>
        <p className={styles.note}>An estimate for a reducing-balance loan. Not financial advice; your bank&apos;s figures can differ.</p>
      </div>
    </div>
  );
}
