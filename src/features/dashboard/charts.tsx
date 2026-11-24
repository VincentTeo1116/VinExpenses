// Two small charts drawn as SVG (no chart library): nothing to download, nothing inline for the page policy to block,
// and each one has its numbers in text right next to it, so the picture is never the only way to read them.
import styles from './charts.module.css';
import { safeColor } from '@/features/money/taxonomy';
import { useGrown } from '@/lib/motion';

export interface DonutSlice {
  key: string;
  color: string;
  percent: number;
  label: string;
}

const R = 70;
const C = 2 * Math.PI * R;

export function Donut({ slices, centre, caption, label, onPick }: { slices: DonutSlice[]; centre: string; caption: string; label: string; onPick?: (key: string) => void }) {
  const grown = useGrown(); // starts as an empty ring and sweeps round to its shares
  // where each slice starts, worked out up front so rendering stays free of side effects
  const starts = slices.map((_, i) => slices.slice(0, i).reduce((total, s) => total + (Math.max(0, s.percent) / 100) * C, 0));
  return (
    <div className={styles.donut}>
      <svg viewBox="0 0 200 200" role="img" aria-label={label} className={styles.donutSvg}>
        <circle cx="100" cy="100" r={R} fill="none" className={styles.track} strokeWidth="26" />
        {slices.map((slice, i) => {
          const length = grown ? Math.max(0, (Math.max(0, slice.percent) / 100) * C - 1.5) : 0;
          const offset = grown ? -(starts[i] ?? 0) : 0;
          return (
            // a click on a slice is a shortcut for the mouse: the list beside the ring has the same thing as real buttons
            <circle key={slice.key} className={styles.slice} cx="100" cy="100" r={R} fill="none" stroke={safeColor(slice.color)} strokeWidth="26" strokeDasharray={`${length} ${C - length}`} strokeDashoffset={offset} transform="rotate(-90 100 100)" onClick={onPick ? () => onPick(slice.key) : undefined}>
              <title>{slice.label}</title>
            </circle>
          );
        })}
      </svg>
      <div className={styles.centre}>
        <strong>{centre}</strong>
        <span>{caption}</span>
      </div>
    </div>
  );
}

export interface BarPoint {
  key: string;
  label: string;
  spent: number;
  income: number;
  aria: string;
  active: boolean;
}

/** Two bars per month (spent and income), each a button that jumps to that month. */
export function TrendBars({ points, onPick }: { points: BarPoint[]; onPick: (key: string) => void }) {
  const max = Math.max(1, ...points.flatMap((point) => [point.spent, point.income]));
  const height = (value: number) => (value > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0);
  const grown = useGrown(); // the bars rise from the baseline
  return (
    <div className={styles.trend}>
      {points.map((point) => (
        <button key={point.key} type="button" className={`${styles.col} ${point.active ? styles.active : ''}`} onClick={() => onPick(point.key)} aria-pressed={point.active} title={point.aria}>
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
