// Two small charts drawn as SVG (no chart library): nothing to download, nothing inline for the page policy to block,
// and each one has its numbers in text right next to it, so the picture is never the only way to read them.
import styles from './charts.module.css';
import { safeColor } from '@/features/money/taxonomy';

export interface DonutSlice {
  key: string;
  color: string;
  percent: number;
  label: string;
}

const R = 70;
const C = 2 * Math.PI * R;

export function Donut({ slices, centre, caption, label }: { slices: DonutSlice[]; centre: string; caption: string; label: string }) {
  // where each slice starts, worked out up front so rendering stays free of side effects
  const starts = slices.map((_, i) => slices.slice(0, i).reduce((total, s) => total + (Math.max(0, s.percent) / 100) * C, 0));
  return (
    <div className={styles.donut}>
      <svg viewBox="0 0 200 200" role="img" aria-label={label} className={styles.donutSvg}>
        <circle cx="100" cy="100" r={R} fill="none" className={styles.track} strokeWidth="26" />
        {slices.map((slice, i) => {
          const length = (Math.max(0, slice.percent) / 100) * C;
          const offset = -(starts[i] ?? 0);
          return <circle key={slice.key} cx="100" cy="100" r={R} fill="none" stroke={safeColor(slice.color)} strokeWidth="26" strokeDasharray={`${Math.max(0, length - 1.5)} ${C - Math.max(0, length - 1.5)}`} strokeDashoffset={offset} transform="rotate(-90 100 100)" />;
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
  return (
    <div className={styles.trend}>
      {points.map((point) => (
        <button key={point.key} type="button" className={`${styles.col} ${point.active ? styles.active : ''}`} onClick={() => onPick(point.key)} aria-pressed={point.active}>
          <svg viewBox="0 0 40 100" preserveAspectRatio="none" className={styles.bars} aria-hidden="true">
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
