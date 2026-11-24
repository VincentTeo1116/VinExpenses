// Two small charts drawn as SVG (no chart library): nothing to download, nothing inline for the page policy to block,
// and each one has its numbers in text right next to it, so the picture is never the only way to read them.
// Pointing at (or pressing) a part shows its details, the way the previous version's charts did.
import { useRef, useState, type PointerEvent } from 'react';
import styles from './charts.module.css';
import { safeColor } from '@/features/money/taxonomy';
import { useGrown } from '@/lib/motion';

export interface DonutSlice {
  key: string;
  color: string;
  percent: number;
  /** Read out and shown as the native tooltip, for example "Food: RM 127.00". */
  label: string;
  /** Shown in the middle of the ring while the slice is pointed at. */
  name: string;
  amount: string;
}

const R = 70;
const C = 2 * Math.PI * R;

/**
 * The ring. Pointing at a slice (or tapping it on a touch screen) lifts it, dims the others and puts its name, amount and share in
 * the middle. On a touch screen the first tap shows the details and a second tap on the same slice opens its transactions;
 * a mouse click opens them straight away. `highlight` lets the list beside the ring light up a slice too.
 */
export function Donut({ slices, centre, caption, label, onPick, highlight = null }: { slices: DonutSlice[]; centre: string; caption: string; label: string; onPick?: (key: string) => void; highlight?: string | null }) {
  const grown = useGrown(); // starts as an empty ring and sweeps round to its shares
  const [pointed, setPointed] = useState<string | null>(null);
  const lastPointer = useRef<string>('mouse');
  const shown = pointed ?? highlight;
  const active = slices.find((slice) => slice.key === shown) ?? null;
  // where each slice starts, worked out up front so rendering stays free of side effects
  const starts = slices.map((_, i) => slices.slice(0, i).reduce((total, s) => total + (Math.max(0, s.percent) / 100) * C, 0));
  const onSlicePointer = (event: PointerEvent, key: string) => {
    lastPointer.current = event.pointerType;
    if (event.pointerType === 'mouse') setPointed(key);
  };
  const onSliceClick = (key: string) => {
    // a touch shows the details first; a second tap (or a mouse click) opens the transactions
    if (lastPointer.current !== 'mouse' && pointed !== key) {
      setPointed(key);
      return;
    }
    onPick?.(key);
  };
  return (
    <div className={`${styles.donut} ${active ? styles.focused : ''}`} onPointerLeave={(event) => { if (event.pointerType === 'mouse') setPointed(null); }}>
      <svg viewBox="0 0 200 200" role="img" aria-label={label} className={styles.donutSvg}>
        <circle cx="100" cy="100" r={R} fill="none" className={styles.track} strokeWidth="26" />
        {slices.map((slice, i) => {
          const length = grown ? Math.max(0, (Math.max(0, slice.percent) / 100) * C - 1.5) : 0;
          const offset = grown ? -(starts[i] ?? 0) : 0;
          return (
            // a click on a slice is a shortcut for the pointer: the list beside the ring has the same thing as real buttons
            <circle
              key={slice.key}
              className={`${styles.slice} ${shown === slice.key ? styles.lit : ''}`}
              cx="100"
              cy="100"
              r={R}
              fill="none"
              stroke={safeColor(slice.color)}
              strokeWidth="26"
              strokeDasharray={`${length} ${C - length}`}
              strokeDashoffset={offset}
              transform="rotate(-90 100 100)"
              data-slice={slice.key}
              onPointerEnter={(event) => onSlicePointer(event, slice.key)}
              onPointerDown={(event) => onSlicePointer(event, slice.key)}
              onClick={() => onSliceClick(slice.key)}
            >
              <title>{slice.label}</title>
            </circle>
          );
        })}
      </svg>
      {/* the middle shows the total, or the slice being pointed at; a new key replays the little fade */}
      <div className={styles.centre} key={active?.key ?? 'total'} data-testid="donut-centre">
        {active ? (
          <>
            <strong>{active.amount}</strong>
            <span className={styles.centreName}>{active.name}</span>
            <span>{Math.round(active.percent)}%</span>
          </>
        ) : (
          <>
            <strong>{centre}</strong>
            <span>{caption}</span>
          </>
        )}
      </div>
    </div>
  );
}

export interface BarPoint {
  key: string;
  /** Short month under the bars ("Nov"). */
  label: string;
  /** Long month at the top of the details bubble ("November 2026"). */
  title: string;
  spent: number;
  income: number;
  spentText: string;
  incomeText: string;
  aria: string;
  active: boolean;
}

/**
 * Two bars per month (spent and income), each a button that jumps to that month. Pointing at a month, focusing it with the keyboard,
 * or pressing it shows a bubble with its spending and income.
 */
export function TrendBars({ points, onPick, spentWord, incomeWord }: { points: BarPoint[]; onPick: (key: string) => void; spentWord: string; incomeWord: string }) {
  const max = Math.max(1, ...points.flatMap((point) => [point.spent, point.income]));
  const height = (value: number) => (value > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0);
  const grown = useGrown(); // the bars rise from the baseline
  const [shown, setShown] = useState<string | null>(null);
  return (
    <div className={styles.trend} onPointerLeave={(event) => { if (event.pointerType === 'mouse') setShown(null); }}>
      {points.map((point, index) => (
        <button
          key={point.key}
          type="button"
          className={`${styles.col} ${point.active ? styles.active : ''} ${shown === point.key ? styles.pointed : ''}`}
          onClick={() => onPick(point.key)}
          onPointerEnter={(event) => { if (event.pointerType === 'mouse') setShown(point.key); }}
          onPointerDown={() => setShown(point.key)}
          onFocus={() => setShown(point.key)}
          onBlur={() => setShown((current) => (current === point.key ? null : current))}
          aria-pressed={point.active}
          title={point.aria}
          data-month={point.key}
        >
          {shown === point.key ? (
            <span className={`${styles.tip} ${index === 0 ? styles.tipStart : index === points.length - 1 ? styles.tipEnd : ''}`} aria-hidden="true" data-testid="trend-tip">
              <span className={styles.tipTitle}>{point.title}</span>
              <span className={styles.tipRow}>
                <span className={styles.tipDotSpent} />
                {spentWord}
                <b>{point.spentText}</b>
              </span>
              <span className={styles.tipRow}>
                <span className={styles.tipDotIncome} />
                {incomeWord}
                <b>{point.incomeText}</b>
              </span>
            </span>
          ) : null}
          <svg viewBox="0 0 40 100" preserveAspectRatio="none" className={`${styles.bars} ${grown ? styles.grown : ''}`} aria-hidden="true">
            <rect x="3" y={100 - height(point.spent)} width="15" height={height(point.spent)} rx="3" className={styles.spent} />
            <rect x="22" y={100 - height(point.income)} width="15" height={height(point.income)} rx="3" className={styles.income} />
          </svg>
          <span className={styles.month}>{point.label}</span>
          <span className="sr-only"> {point.aria}</span>
        </button>
      ))}
    </div>
  );
}
