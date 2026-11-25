// The two calculators on the public guide pages. They use the same deposit and loan maths as the app's Plan screen; nothing is saved or sent.
import { useId, useState } from 'react';
import { formatMoney } from '@/lib/money';
import { todayYmd } from '@/lib/dates';
import { calcFd, calcLoan, type Payout, type TenureUnit } from '@/features/finance/finance';
import styles from './GuidePage.module.css';
import { GuidePage } from './GuidePage';
import { guideBySlug } from './content';

const number = (value: string) => value.replace(/,/g, '').trim();
const longDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const short = (n: number) => `RM ${n.toLocaleString('en-US')}`;

/** A row of quick picks under a field: one tap fills it. */
function Chips({ label, options, current, onPick }: { label: string; options: { text: string; value: string }[]; current: string; onPick: (value: string) => void }) {
  return (
    <div className={styles.chips} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={styles.chip} aria-pressed={number(current) === o.value} onClick={() => onPick(o.value)}>
          {o.text}
        </button>
      ))}
    </div>
  );
}

export function FdCalculator() {
  const id = useId();
  const [amount, setAmount] = useState('10000');
  const [rate, setRate] = useState('3.5');
  const [tenure, setTenure] = useState('12');
  const [unit, setUnit] = useState<TenureUnit>('months');
  const [payout, setPayout] = useState<Payout>('maturity');
  const today = todayYmd();
  const result = calcFd({ amount: number(amount), rate: number(rate), tenureValue: number(tenure), tenureUnit: unit, startDate: today, maturityDate: '', payout, taxRate: 0, dayBasis: 365 });
  const share = result.ok ? Math.round((result.grossInterest / result.maturityAmount) * 100) : 0;
  return (
    <div className={styles.bench}>
      <div className={styles.inputs}>
        <h2 className={styles.inputsTitle}>Your deposit</h2>
        <div className={styles.field}>
          <label htmlFor={`${id}-a`}>Amount (RM)</label>
          <div className={styles.money}>
            <span aria-hidden="true">RM</span>
            <input id={`${id}-a`} inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <Chips label="Quick amounts" current={amount} onPick={setAmount} options={[5000, 10000, 50000, 100000].map((n) => ({ text: short(n), value: String(n) }))} />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-r`}>Interest rate a year (%)</label>
          <input id={`${id}-r`} inputMode="decimal" autoComplete="off" value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-t`}>Tenure</label>
          <div className={styles.pair}>
            <input id={`${id}-t`} inputMode="numeric" autoComplete="off" value={tenure} onChange={(e) => setTenure(e.target.value)} />
            <select aria-label="Tenure unit" value={unit} onChange={(e) => setUnit(e.target.value as TenureUnit)}>
              <option value="days">days</option>
              <option value="months">months</option>
              <option value="years">years</option>
            </select>
          </div>
          <Chips
            label="Quick tenures"
            current={unit === 'months' ? tenure : ''}
            onPick={(value) => {
              setUnit('months');
              setTenure(value);
            }}
            options={[3, 6, 12, 24].map((n) => ({ text: `${n} months`, value: String(n) }))}
          />
        </div>
        <label className={styles.field}>
          <span>Interest is paid</span>
          <select value={payout} onChange={(e) => setPayout(e.target.value as Payout)}>
            <option value="maturity">at maturity</option>
            <option value="monthly">every month</option>
            <option value="quarterly">every 3 months</option>
            <option value="yearly">every year</option>
          </select>
        </label>
      </div>

      <div className={styles.result} aria-live="polite">
        <span className={styles.resultLabel}>You would get back at maturity</span>
        <strong className={styles.big} data-testid="fd-total">
          {result.ok ? formatMoney(result.maturityAmount) : '–'}
        </strong>
        {result.ok ? (
          <>
            <progress className={styles.split} max={100} value={share} aria-label={`Of the total, ${share}% is interest`} />
            <div className={styles.legend}>
              <span>Your money {formatMoney(result.principal)}</span>
              <span>Interest {formatMoney(result.grossInterest)}</span>
            </div>
            <dl className={styles.facts}>
              <div>
                <dt>Interest earned</dt>
                <dd data-testid="fd-interest">{formatMoney(result.grossInterest)}</dd>
              </div>
              <div>
                <dt>Matures on</dt>
                <dd>{longDate(result.maturityDate)}</dd>
              </div>
            </dl>
            <p className={styles.working}>
              <b>How this was worked out</b>
              {formatMoney(result.principal)} × {result.rate}% × {result.days} ÷ {result.dayBasis} = {formatMoney(result.grossInterest)}
            </p>
            {result.payouts.length > 1 && (
              <details className={styles.payouts}>
                <summary>{result.payouts.length} payments</summary>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Interest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.payouts.slice(0, 24).map((p) => (
                      <tr key={p.n}>
                        <td>{longDate(p.date)}</td>
                        <td>{formatMoney(p.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.payouts.length > 24 && <p>The first 24 payments are shown.</p>}
              </details>
            )}
          </>
        ) : (
          <p className={styles.hintLine}>Enter an amount, a rate and a tenure to see the result.</p>
        )}
      </div>
    </div>
  );
}

export function LoanCalculator() {
  const id = useId();
  const [amount, setAmount] = useState('300000');
  const [rate, setRate] = useState('4.2');
  const [years, setYears] = useState('25');
  const [method, setMethod] = useState<'reducing' | 'flat'>('reducing');
  const result = calcLoan({ amount: number(amount), rate: number(rate), termValue: number(years), termUnit: 'years', method, firstPaymentDate: '2030-01-15', fees: 0 });
  const share = result.ok ? Math.round((result.totalInterest / result.totalPayments) * 100) : 0;
  return (
    <div className={styles.bench}>
      <div className={styles.inputs}>
        <h2 className={styles.inputsTitle}>Your loan</h2>
        <div className={styles.field}>
          <label htmlFor={`${id}-a`}>Loan amount (RM)</label>
          <div className={styles.money}>
            <span aria-hidden="true">RM</span>
            <input id={`${id}-a`} inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <Chips label="Quick amounts" current={amount} onPick={setAmount} options={[100000, 300000, 500000, 800000].map((n) => ({ text: short(n), value: String(n) }))} />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-r`}>Interest rate a year (%)</label>
          <input id={`${id}-r`} inputMode="decimal" autoComplete="off" value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-y`}>Years to repay</label>
          <input id={`${id}-y`} inputMode="numeric" autoComplete="off" value={years} onChange={(e) => setYears(e.target.value)} />
          <Chips label="Quick terms" current={years} onPick={setYears} options={[5, 9, 25, 35].map((n) => ({ text: `${n} years`, value: String(n) }))} />
        </div>
        <label className={styles.field} htmlFor={`${id}-m`}>
          <span>The rate is</span>
          <select id={`${id}-m`} value={method} onChange={(e) => setMethod(e.target.value as 'reducing' | 'flat')}>
            <option value="reducing">reducing balance</option>
            <option value="flat">flat</option>
          </select>
        </label>
      </div>

      <div className={styles.result} aria-live="polite">
        <span className={styles.resultLabel}>You would pay each month</span>
        <strong className={styles.big} data-testid="loan-payment">
          {result.ok ? formatMoney(result.instalment) : '–'}
        </strong>
        {result.ok ? (
          <>
            <progress className={styles.split} max={100} value={share} aria-label={`Of everything you repay, ${share}% is interest`} />
            <div className={styles.legend}>
              <span>Borrowed {formatMoney(result.totalPayments - result.totalInterest)}</span>
              <span>Interest {formatMoney(result.totalInterest)}</span>
            </div>
            <dl className={styles.facts}>
              <div>
                <dt>Total interest</dt>
                <dd>{formatMoney(result.totalInterest)}</dd>
              </div>
              <div>
                <dt>Total repaid</dt>
                <dd>{formatMoney(result.totalPayments)}</dd>
              </div>
            </dl>
            <p className={styles.working}>
              <b>How this was worked out</b>
              {Number(number(years)) * 12} monthly payments of about {formatMoney(result.instalment)} ({method === 'flat' ? 'flat rate' : 'reducing balance'})
            </p>
          </>
        ) : (
          <p className={styles.hintLine}>Enter an amount, a rate and the years to see the result.</p>
        )}
      </div>
    </div>
  );
}

export function FdCalculatorPage() {
  const guide = guideBySlug('fd-calculator');
  return guide ? (
    <GuidePage guide={guide}>
      <FdCalculator />
    </GuidePage>
  ) : null;
}

export function LoanCalculatorPage() {
  const guide = guideBySlug('loan-calculator');
  return guide ? (
    <GuidePage guide={guide}>
      <LoanCalculator />
    </GuidePage>
  ) : null;
}
