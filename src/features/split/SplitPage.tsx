// SP-11: the split page: read or type a receipt, tick what is yours, check the figures, and take your share to an expense.
import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import { BetaBadge } from '@/components/BetaBadge';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { envResult } from '@/lib/env';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { todayYmd } from '@/lib/dates';
import { useMoney } from '@/features/money/MoneyContext';
import { scanReceipt } from '@/features/receipts/scan';
import { allocate } from './allocate';
import { audit } from './audit';
import { lineNet } from './compute';
import { billFromDraft, blankDraft, blankLine, draftFromBill, explain, numberText, type Draft, type LineDraft, type TotalsDraft } from './draft';
import { placedWords, recentScan, rememberScan } from './lastScan';
import { readOnDeviceModes } from '@/features/receipts/localOcr';
import { bestReading, readReceipt, scoreOf, type Regions } from './read';
import { ReceiptPhoto } from './ReceiptPhoto';
import type { Box } from './rows';
import styles from './SplitPage.module.css';

const money = (cents: number) => formatMoney(cents / 100);

export function SplitPage() {
  const { t } = useI18n();
  const { session } = useAuth();
  const { openAdd } = useMoney();
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [meta, setMeta] = useState({ merchant: '', date: '' });
  const [busy, setBusy] = useState<MessageKey | null>(null);
  const [problem, setProblem] = useState<MessageKey | ''>('');
  const remembered = recentScan();
  const [loadedFromScan, setLoadedFromScan] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [regions, setRegions] = useState<Regions>({});
  const [scanned, setScanned] = useState(false);
  const [reads, setReads] = useState<{ text: string; words: ReturnType<typeof placedWords> }[]>([]);
  const [again, setAgain] = useState<'' | 'better' | 'same' | 'failed'>('');

  const bill = useMemo(() => billFromDraft(draft), [draft]);
  const result = useMemo(() => audit(bill), [bill]);
  const picked = useMemo(() => new Set(draft.lines.filter((l) => l.mine).map((l) => l.id)), [draft.lines]);
  const share = useMemo(() => allocate(bill, result.fit, picked), [bill, result.fit, picked]);
  const said = useMemo(() => explain(result, bill, money), [result, bill]);
  const failing = useMemo(() => new Set([...said.flatMap((s) => s.lineIds), ...(result.suggestion ? [result.suggestion.lineId] : [])]), [said, result.suggestion]);

  const load = (text: string, words: ReturnType<typeof placedWords>, merchant: string, date: string, image: string | null) => {
    const reading = readReceipt(text, words, { merchant });
    const next = draftFromBill(reading.parsed.bill);
    setDraft(next);
    setPhoto(image);
    setReads([{ text, words }]);
    setAgain('');
    setBoxes(reading.boxes);
    setRegions(reading.regions);
    setActiveId(null);
    setScanned(true);
    setMeta({ merchant, date });
    setProblem(next.lines.length === 0 ? 'split.unreadable' : '');
  };

  const useLast = () => {
    if (!remembered) return;
    load(remembered.text, remembered.words, remembered.merchant, remembered.date, remembered.image ?? null);
    setLoadedFromScan(true);
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !envResult.ok) return;
    setBusy('split.scanning');
    setProblem('');
    try {
      let shown: string | null = null;
      const read = await scanReceipt(file, { baseUrl: envResult.env.supabaseUrl, anonKey: envResult.env.supabaseAnonKey, accessToken: session?.access_token }, undefined, (src) => {
        shown = src;
        setPhoto(src); // the photo is on screen while it is being read
      }, { prepare: true });
      rememberScan({ text: read.text, words: placedWords(read.words), merchant: read.merchant, date: read.date, image: shown ?? undefined });
      load(read.text, placedWords(read.words), read.merchant, read.date, shown);
    } catch {
      setProblem('split.failed');
    } finally {
      setBusy(null);
    }
  };

  const readAgain = async () => {
    if (!photo) return;
    setBusy('split.againBusy');
    setAgain('');
    try {
      const local = await readOnDeviceModes(photo);
      const extra = local.map((r) => ({ text: r.text, words: placedWords(r.words) }));
      const before = bestReading(reads, { merchant: meta.merchant });
      const all = [...reads, ...extra];
      const after = bestReading(all, { merchant: meta.merchant });
      const gained = scoreOf(after.audit, after.parsed.bill.lines.length) > scoreOf(before.audit, before.parsed.bill.lines.length);
      if (gained) {
        setDraft(draftFromBill(after.parsed.bill));
        setBoxes(after.boxes);
        setRegions(after.regions);
        setReads(all);
        setActiveId(null);
      }
      setAgain(gained ? 'better' : 'same');
    } catch {
      setAgain('failed');
    } finally {
      setBusy(null);
    }
  };

  const setLine = (id: string, patch: Partial<LineDraft>) => setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const setTotals = (patch: Partial<TotalsDraft>) => setDraft((d) => ({ ...d, totals: { ...d.totals, ...patch } }));
  const tickAll = (mine: boolean) => setDraft((d) => ({ ...d, lines: d.lines.map((l) => ({ ...l, mine })) }));

  const suggestion = result.suggestion;
  const suggested = suggestion ? bill.lines.find((l) => l.id === suggestion.lineId) : null;
  const applyFix = () => {
    if (suggestion) setLine(suggestion.lineId, { gross: (suggestion.to / 100).toFixed(2) });
  };

  const mine = share.mine;
  const use = () => {
    const count = bill.lines.length;
    const note = t('split.note', { total: money(share.whole.totalCents), n: String(picked.size), count: String(count) });
    openAdd({ kind: 'expense', prefill: { amount: mine.totalCents / 100, merchant: meta.merchant, date: meta.date && meta.date <= todayYmd() ? meta.date : todayYmd(), note } });
  };

  const statusKey = `split.status.${result.status}` as MessageKey;
  const empty = draft.lines.length === 0;
  const mismatch = bill.totalCents != null && share.whole.totalCents !== bill.totalCents ? { found: money(share.whole.totalCents), expected: money(bill.totalCents) } : null;

  const numberInput = (value: string, onChange: (v: string) => void, label: string, signed = false) => (
    <input className={styles.input} inputMode="decimal" enterKeyHint="done" autoComplete="off" aria-label={label} value={value} onChange={(e) => onChange(numberText(e.target.value, signed))} />
  );
  const field = (key: MessageKey, id: keyof TotalsDraft, signed = false) => (
    <label className={styles.field}>
      <span>{t(key)}</span>
      {numberInput(draft.totals[id], (v) => setTotals({ [id]: v }), t(key), signed)}
    </label>
  );

  return (
    <div className={styles.page}>
      <Link to="/app" className={styles.back}>
        <Icon name="back" size={18} /> {t('split.back')}
      </Link>
      <h1 className={styles.h1}>
        {t('split.title')} <BetaBadge />
      </h1>
      <p className={styles.intro}>{t('split.intro')}</p>
      <Notice kind="info">{t('split.beta')}</Notice>

      <div className={styles.sources}>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className={styles.hidden} tabIndex={-1} aria-hidden="true" data-testid="split-file" onChange={onFile} />
        <Button loading={busy != null} onClick={() => fileInput.current?.click()}>
          {busy ? t(busy) : t('split.scan')}
        </Button>
        {remembered && empty && !loadedFromScan ? (
          <Button variant="outline" data-testid="split-last" onClick={useLast}>
            {t('split.useLast')}
          </Button>
        ) : null}
        {empty ? (
          <Button variant="outline" data-testid="split-type" onClick={() => setDraft((d) => ({ ...d, lines: [blankLine()] }))}>
            {t('split.type')}
          </Button>
        ) : null}
      </div>
      <p className={styles.hint}>{t('split.privacy')}</p>
      {problem ? <Notice kind="warn">{t(problem)}</Notice> : null}

      {empty && !photo ? (
        <p className={styles.empty}>{t('split.empty')}</p>
      ) : (
        <div className={`${styles.workspace} ${photo ? styles.withPhoto : styles.single}`}>
          {photo ? (
            <aside className={styles.photoCol}>
              <ReceiptPhoto image={photo} boxes={boxes} regions={regions} activeId={activeId} failing={failing} />
            </aside>
          ) : null}
          <div className={styles.mainCol}>
            {scanned && !photo && !empty ? <p className={styles.hint}>{t('split.photo.none')}</p> : null}
            {empty ? <p className={styles.empty}>{t('split.empty')}</p> : null}
            {empty ? null : (
      <>
        <section className={`${styles.status} ${styles[result.status]}`} aria-live="polite" data-testid="split-status" data-status={result.status}>
          <strong>{t(statusKey)}</strong>
          {result.status === 'verified' ? <p>{t('split.status.verifiedHelp')}</p> : null}
          {result.status === 'unverified' ? <p>{t('split.status.unverifiedHelp')}</p> : null}
          {photo && result.status !== 'verified' ? (
            <div className={styles.again}>
              <Button variant="outline" data-testid="split-again" loading={busy === 'split.againBusy'} disabled={busy != null} onClick={readAgain}>
                {busy === 'split.againBusy' ? t('split.againBusy') : t('split.again')}
              </Button>
              <p className={styles.hint}>{t('split.againHelp')}</p>
            </div>
          ) : null}
          {again ? <p className={styles.hint} data-testid="split-again-result">{t(`split.again.${again}` as MessageKey)}</p> : null}
          {said.length > 0 ? (
            <ul>
              {said.map((s) => (
                <li key={s.id}>{t(s.key, s.params)}</li>
              ))}
            </ul>
          ) : null}
          {suggestion && suggested ? (
            <div className={styles.fix} data-testid="split-fix">
              <span>{t('split.fix', { to: money(suggestion.to), name: suggested.name, from: money(suggestion.from) })}</span>
              <Button variant="outline" onClick={applyFix}>
                {t('split.fix.apply', { to: money(suggestion.to) })}
              </Button>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="split-items">
          <div className={styles.head}>
            <h2 id="split-items" className={styles.h2}>
              {t('split.items')}
            </h2>
            <div className={styles.tick}>
              <button type="button" onClick={() => tickAll(true)}>
                {t('split.selectAll')}
              </button>
              <button type="button" onClick={() => tickAll(false)}>
                {t('split.selectNone')}
              </button>
            </div>
          </div>
          <div className={styles.cols} aria-hidden="true">
            <span>{t('split.mine')}</span>
            <span>{t('split.qty')}</span>
            <span>{t('split.name')}</span>
            <span>{t('split.price')}</span>
            <span>{t('split.discount')}</span>
            <span>{t('split.net')}</span>
            <span />
          </div>
          <ul className={styles.lines}>
            {draft.lines.map((line, i) => {
              const parsed = bill.lines[i];
              const net = parsed ? lineNet(parsed) : 0;
              const label = line.name || String(i + 1);
              return (
                <li key={line.id} className={`${styles.line} ${failing.has(line.id) ? styles.bad : ''}`} data-testid="split-line" data-active={line.id === activeId} onFocus={() => setActiveId(line.id)}>
                  <label className={styles.mine}>
                    <input type="checkbox" checked={line.mine} onChange={(e) => setLine(line.id, { mine: e.target.checked })} aria-label={`${t('split.mine')}: ${label}`} />
                  </label>
                  <label className={styles.qty}>
                    <span className={styles.cap}>{t('split.qty')}</span>
                    <input className={styles.input} inputMode="numeric" autoComplete="off" aria-label={`${t('split.qty')}: ${label}`} value={line.qty} onChange={(e) => setLine(line.id, { qty: numberText(e.target.value).replace('.', '') })} />
                  </label>
                  <label className={styles.name}>
                    <span className={styles.cap}>{t('split.name')}</span>
                    <input className={styles.input} autoComplete="off" aria-label={`${t('split.name')} ${i + 1}`} value={line.name} onChange={(e) => setLine(line.id, { name: e.target.value })} />
                  </label>
                  <label className={styles.price}>
                    <span className={styles.cap}>{t('split.price')}</span>
                    {numberInput(line.gross, (v) => setLine(line.id, { gross: v }), `${t('split.price')}: ${label}`)}
                  </label>
                  <label className={styles.disc}>
                    <span className={styles.cap}>{t('split.discount')}</span>
                    {numberInput(line.discount, (v) => setLine(line.id, { discount: v }), `${t('split.discount')}: ${label}`)}
                  </label>
                  <span className={styles.net} data-testid="split-net">
                    <span className={styles.cap}>{t('split.net')}</span>
                    {money(net)}
                  </span>
                  <button type="button" className={styles.remove} aria-label={t('split.remove', { name: label })} onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((l) => l.id !== line.id) }))}>
                    <Icon name="x" size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
          <Button variant="outline" onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, blankLine()] }))}>
            {t('split.addLine')}
          </Button>
        </section>

        <section className={styles.charges} aria-labelledby="split-charges">
          <h2 id="split-charges" className={styles.h2}>
            {t('split.charges')}
          </h2>
          <div className={styles.grid}>
            {field('split.subtotal', 'subtotal')}
            {field('split.billDiscount', 'billDiscount')}
            {field('split.servicePercent', 'servicePercent')}
            {field('split.serviceAmount', 'serviceAmount')}
            {field('split.sstPercent', 'sstPercent')}
            {field('split.sstAmount', 'sstAmount')}
            {field('split.rounding', 'rounding', true)}
            {field('split.total', 'total')}
          </div>
        </section>

        <section className={styles.summary} aria-labelledby="split-summary" data-testid="split-summary">
          <h2 id="split-summary" className={styles.h2}>
            {t('split.summary')}
          </h2>
          {picked.size === 0 ? (
            <p>{t('split.noneTicked')}</p>
          ) : (
            <dl className={styles.rows}>
              <div>
                <dt>{t('split.row.items')}</dt>
                <dd>{money(mine.grossCents)}</dd>
              </div>
              {mine.itemDiscountCents > 0 ? (
                <div>
                  <dt>{t('split.row.itemDiscounts')}</dt>
                  <dd>− {money(mine.itemDiscountCents)}</dd>
                </div>
              ) : null}
              {mine.billDiscountCents > 0 ? (
                <div>
                  <dt>{t('split.row.billDiscount')}</dt>
                  <dd>− {money(mine.billDiscountCents)}</dd>
                </div>
              ) : null}
              {mine.serviceCents > 0 ? (
                <div>
                  <dt>{t('split.row.service')}</dt>
                  <dd>{money(mine.serviceCents)}</dd>
                </div>
              ) : null}
              {mine.sstCents > 0 ? (
                <div>
                  <dt>{t('split.row.sst')}</dt>
                  <dd>{money(mine.sstCents)}</dd>
                </div>
              ) : null}
              {mine.roundingCents !== 0 ? (
                <div>
                  <dt>{t('split.row.rounding')}</dt>
                  <dd>
                    {mine.roundingCents < 0 ? '−' : '+'} {money(Math.abs(mine.roundingCents))}
                  </dd>
                </div>
              ) : null}
              <div className={styles.final}>
                <dt>{t('split.row.mine')}</dt>
                <dd data-testid="split-mine">{money(mine.totalCents)}</dd>
              </div>
              <div className={styles.dim}>
                <dt>{t('split.row.others')}</dt>
                <dd data-testid="split-others">{money(share.others.totalCents)}</dd>
              </div>
              <div className={styles.dim}>
                <dt>{t('split.row.whole')}</dt>
                <dd data-testid="split-whole">{money(share.whole.totalCents)}</dd>
              </div>
            </dl>
          )}
          {mismatch ? <Notice kind="solid">{t('split.mismatch', mismatch)}</Notice> : null}
          <details className={styles.how}>
            <summary>{t('split.how')}</summary>
            <p>{t('split.howText')}</p>
          </details>
        </section>

      </>
          )}
        </div>
      </div>
    )}

    {empty ? null : (
        <div className={`${styles.shareBar} ${photo ? styles.barRight : styles.barCentre}`} role="region" aria-label={t('split.summary')} data-testid="split-bar">
          <div className={styles.shareText}>
            {picked.size === 0 ? (
              <span className={styles.shareHint}>{t('split.bar.hint')}</span>
            ) : (
              <>
                <span className={styles.shareLabel}>{t('split.bar.share')}</span>
                <strong className={styles.shareAmount} data-testid="split-bar-amount">
                  {money(mine.totalCents)}
                </strong>
                <span className={styles.shareCount}>{t('split.bar.items', { n: String(picked.size), count: String(bill.lines.length) })}</span>
              </>
            )}
          </div>
          <Button disabled={picked.size === 0 || mine.totalCents <= 0} onClick={use} data-testid="split-use">
            {t('split.bar.add')}
          </Button>
        </div>
      )}
    </div>
  );
}

