// The three calculators on the public guide pages (fixed deposit, loan, bill). They use the same maths as the app; nothing is saved or sent.
import { useId, useState } from 'react';
import { formatMoney } from '@/lib/money';
import { todayYmd } from '@/lib/dates';
import { calcFd, calcLoan, type Payout, type TenureUnit } from '@/features/finance/finance';
import styles from './GuidePage.module.css';
import { calcBill, numbersOnly, splitEvenly, toSen } from './bill';
import { useUi } from './useUi';

const number = (value: string) => value.replace(/,/g, '').trim();
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
  const ui = useUi();
  const t = ui.calc.fd;
  const id = useId();
  const [amount, setAmount] = useState('10000');
  const [rate, setRate] = useState('3.5');
  const [tenure, setTenure] = useState('12');
  const [unit, setUnit] = useState<TenureUnit>('months');
  const [payout, setPayout] = useState<Payout>('maturity');
  const longDate = (ymd: string) => {
    const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d).toLocaleDateString(ui.locale, { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const result = calcFd({ amount: number(amount), rate: number(rate), tenureValue: number(tenure), tenureUnit: unit, startDate: todayYmd(), maturityDate: '', payout, taxRate: 0, dayBasis: 365 });
  const share = result.ok ? Math.round((result.grossInterest / result.maturityAmount) * 100) : 0;
  return (
    <div className={styles.bench}>
      <div className={styles.inputs}>
        <h2 className={styles.inputsTitle}>{t.title}</h2>
        <div className={styles.field}>
          <label htmlFor={`${id}-a`}>{t.amount}</label>
          <div className={styles.money}>
            <span aria-hidden="true">RM</span>
            <input id={`${id}-a`} inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <Chips label={t.quickAmounts} current={amount} onPick={setAmount} options={[5000, 10000, 50000, 100000].map((n) => ({ text: short(n), value: String(n) }))} />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-r`}>{t.rate}</label>
          <input id={`${id}-r`} inputMode="decimal" autoComplete="off" value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-t`}>{t.tenure}</label>
          <div className={styles.pair}>
            <input id={`${id}-t`} inputMode="numeric" autoComplete="off" value={tenure} onChange={(e) => setTenure(e.target.value)} />
            <select aria-label={t.unit} value={unit} onChange={(e) => setUnit(e.target.value as TenureUnit)}>
              <option value="days">{t.days}</option>
              <option value="months">{t.months}</option>
              <option value="years">{t.years}</option>
            </select>
          </div>
          <Chips
            label={t.quickTenures}
            current={unit === 'months' ? tenure : ''}
            onPick={(value) => {
              setUnit('months');
              setTenure(value);
            }}
            options={[3, 6, 12, 24].map((n) => ({ text: t.monthsOf(n), value: String(n) }))}
          />
        </div>
        <label className={styles.field}>
          <span>{t.paid}</span>
          <select value={payout} onChange={(e) => setPayout(e.target.value as Payout)}>
            <option value="maturity">{t.maturity}</option>
            <option value="monthly">{t.monthly}</option>
            <option value="quarterly">{t.quarterly}</option>
            <option value="yearly">{t.yearly}</option>
          </select>
        </label>
      </div>

      <div className={styles.result} aria-live="polite">
        <span className={styles.resultLabel}>{t.result}</span>
        <strong className={styles.big} data-testid="fd-total">
          {result.ok ? formatMoney(result.maturityAmount) : '–'}
        </strong>
        {result.ok ? (
          <>
            <progress className={styles.split} max={100} value={share} aria-label={t.share(share)} />
            <div className={styles.legend}>
              <span>
                {t.yours} {formatMoney(result.principal)}
              </span>
              <span>
                {t.interest} {formatMoney(result.grossInterest)}
              </span>
            </div>
            <dl className={styles.facts}>
              <div>
                <dt>{t.earned}</dt>
                <dd data-testid="fd-interest">{formatMoney(result.grossInterest)}</dd>
              </div>
              <div>
                <dt>{t.matures}</dt>
                <dd>{longDate(result.maturityDate)}</dd>
              </div>
            </dl>
            <p className={styles.working}>
              <b>{t.worked}</b>
              {formatMoney(result.principal)} × {result.rate}% × {result.days} ÷ {result.dayBasis} = {formatMoney(result.grossInterest)}
            </p>
            {result.payouts.length > 1 && (
              <details className={styles.payouts}>
                <summary>{t.payments(result.payouts.length)}</summary>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t.date}</th>
                      <th scope="col">{t.interest}</th>
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
                {result.payouts.length > 24 && <p>{t.first24}</p>}
              </details>
            )}
          </>
        ) : (
          <p className={styles.hintLine}>{t.hint}</p>
        )}
      </div>
    </div>
  );
}

export function LoanCalculator() {
  const t = useUi().calc.loan;
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
        <h2 className={styles.inputsTitle}>{t.title}</h2>
        <div className={styles.field}>
          <label htmlFor={`${id}-a`}>{t.amount}</label>
          <div className={styles.money}>
            <span aria-hidden="true">RM</span>
            <input id={`${id}-a`} inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <Chips label={t.quickAmounts} current={amount} onPick={setAmount} options={[100000, 300000, 500000, 800000].map((n) => ({ text: short(n), value: String(n) }))} />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-r`}>{t.rate}</label>
          <input id={`${id}-r`} inputMode="decimal" autoComplete="off" value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-y`}>{t.years}</label>
          <input id={`${id}-y`} inputMode="numeric" autoComplete="off" value={years} onChange={(e) => setYears(e.target.value)} />
          <Chips label={t.quickTerms} current={years} onPick={setYears} options={[5, 9, 25, 35].map((n) => ({ text: t.yearsOf(n), value: String(n) }))} />
        </div>
        <label className={styles.field} htmlFor={`${id}-m`}>
          <span>{t.rateIs}</span>
          <select id={`${id}-m`} value={method} onChange={(e) => setMethod(e.target.value as 'reducing' | 'flat')}>
            <option value="reducing">{t.reducing}</option>
            <option value="flat">{t.flat}</option>
          </select>
        </label>
      </div>

      <div className={styles.result} aria-live="polite">
        <span className={styles.resultLabel}>{t.result}</span>
        <strong className={styles.big} data-testid="loan-payment">
          {result.ok ? formatMoney(result.instalment) : '–'}
        </strong>
        {result.ok ? (
          <>
            <progress className={styles.split} max={100} value={share} aria-label={t.share(share)} />
            <div className={styles.legend}>
              <span>
                {t.borrowed} {formatMoney(result.totalPayments - result.totalInterest)}
              </span>
              <span>
                {t.interest} {formatMoney(result.totalInterest)}
              </span>
            </div>
            <dl className={styles.facts}>
              <div>
                <dt>{t.totalInterest}</dt>
                <dd>{formatMoney(result.totalInterest)}</dd>
              </div>
              <div>
                <dt>{t.totalRepaid}</dt>
                <dd>{formatMoney(result.totalPayments)}</dd>
              </div>
            </dl>
            <p className={styles.working}>
              <b>{t.worked}</b>
              {t.working(Number(number(years)) * 12, formatMoney(result.instalment), method === 'flat' ? t.flat : t.reducing)}
            </p>
          </>
        ) : (
          <p className={styles.hintLine}>{t.hint}</p>
        )}
      </div>
    </div>
  );
}

export function BillCalculator() {
  const t = useUi().calc.bill;
  const id = useId();
  const [food, setFood] = useState('21');
  const [service, setService] = useState('10');
  const [sst, setSst] = useState('6');
  const [people, setPeople] = useState('1');
  const [sstOnService, setSstOnService] = useState(false);
  const [round, setRound] = useState(true);
  const percent = (value: string) => Math.min(100, Number(value) || 0);
  const count = Math.min(100, Math.max(1, Number(people) || 1));
  const bill = calcBill({ itemsCents: toSen(food), servicePercent: percent(service), sstPercent: percent(sst), sstOnService, round });
  const { each, extra } = splitEvenly(bill.totalCents, count);
  const money = (cents: number) => formatMoney(cents / 100);
  const adjust = `${bill.roundingCents < 0 ? '−' : '+'} ${money(Math.abs(bill.roundingCents))}`;
  const keypad = (set: (value: string) => void, decimals = true) => (event: { target: { value: string } }) => set(numbersOnly(event.target.value, decimals));
  return (
    <div className={styles.bench}>
      <div className={styles.inputs}>
        <h2 className={styles.inputsTitle}>{t.title}</h2>
        <div className={styles.field}>
          <label htmlFor={`${id}-f`}>{t.food}</label>
          <div className={styles.money}>
            <span aria-hidden="true">RM</span>
            <input id={`${id}-f`} inputMode="decimal" enterKeyHint="done" autoComplete="off" maxLength={9} value={food} onChange={keypad(setFood)} />
          </div>
        </div>
        <div className={styles.pair}>
          <div className={styles.field}>
            <label htmlFor={`${id}-s`}>{t.service}</label>
            <input id={`${id}-s`} inputMode="decimal" enterKeyHint="done" autoComplete="off" maxLength={5} value={service} onChange={keypad(setService)} />
          </div>
          <div className={styles.field}>
            <label htmlFor={`${id}-t`}>{t.sst}</label>
            <input id={`${id}-t`} inputMode="decimal" enterKeyHint="done" autoComplete="off" maxLength={5} value={sst} onChange={keypad(setSst)} />
          </div>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-p`}>{t.people}</label>
          <input id={`${id}-p`} inputMode="numeric" enterKeyHint="done" autoComplete="off" maxLength={3} value={people} onChange={keypad(setPeople, false)} />
        </div>
        <label className={styles.check}>
          <input type="checkbox" checked={sstOnService} onChange={(e) => setSstOnService(e.target.checked)} />
          <span>{t.sstOnService}</span>
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={round} onChange={(e) => setRound(e.target.checked)} />
          <span>{t.round}</span>
        </label>
        <p className={styles.hint}>{t.note}</p>
      </div>

      <div className={styles.result} aria-live="polite">
        <span className={styles.resultLabel}>{t.result}</span>
        <strong className={styles.big} data-testid="bill-total">
          {bill.itemsCents > 0 ? money(bill.totalCents) : '–'}
        </strong>
        {bill.itemsCents > 0 ? (
          <>
            <dl className={styles.rows}>
              <div>
                <dt>{t.items}</dt>
                <dd>{money(bill.itemsCents)}</dd>
              </div>
              <div>
                <dt>
                  {t.serviceRow} {percent(service)}%
                </dt>
                <dd>{money(bill.serviceCents)}</dd>
              </div>
              <div>
                <dt>
                  {t.sstRow} {percent(sst)}%
                </dt>
                <dd>{money(bill.sstCents)}</dd>
              </div>
              {round && (
                <>
                  <div>
                    <dt>{t.before}</dt>
                    <dd>{money(bill.beforeRoundingCents)}</dd>
                  </div>
                  <div>
                    <dt>{t.rounding}</dt>
                    <dd data-testid="bill-rounding">{adjust}</dd>
                  </div>
                </>
              )}
            </dl>
            {count > 1 && (
              <p className={styles.each} data-testid="bill-each">
                <b>{t.each}</b> {money(each)}
                {extra > 0 ? ` (${t.eachExtra(extra, money(each + 1))})` : ''}
              </p>
            )}
            <p className={styles.working}>
              <b>{t.worked}</b>
              {money(bill.itemsCents)} + {money(bill.serviceCents)} + {money(bill.sstCents)} = {money(bill.beforeRoundingCents)}
              {round && bill.roundingCents !== 0 ? ` → ${money(bill.totalCents)}` : ''}
            </p>
          </>
        ) : (
          <p className={styles.hintLine}>{t.hint}</p>
        )}
      </div>
    </div>
  );
}
