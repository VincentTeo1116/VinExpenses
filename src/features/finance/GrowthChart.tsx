// The deposit's interest growing over time, drawn as SVG (no chart library). Its numbers are also in the results next to it.
import styles from './finance.module.css';

export function GrowthChart({ points, label }: { points: { day: number; value: number }[]; label: string }) {
  if (points.length < 2) return null;
  const maxDay = Math.max(1, ...points.map((p) => p.day));
  const maxValue = Math.max(0.01, ...points.map((p) => p.value));
  const x = (day: number) => 4 + (day / maxDay) * 192;
  const y = (value: number) => 76 - (value / maxValue) * 68;
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.day).toFixed(2)} ${y(p.value).toFixed(2)}`).join(' ');
  const area = `${line} L${x(maxDay).toFixed(2)} 76 L4 76 Z`;
  return (
    <svg className={styles.chart} viewBox="0 0 200 80" preserveAspectRatio="none" role="img" aria-label={label}>
      <path d={area} className={styles.chartArea} />
      <path d={line} className={styles.chartLine} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
