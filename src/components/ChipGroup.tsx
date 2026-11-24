// A row of choices where exactly one is picked (category, payment, source). Real radio buttons underneath, so the keyboard
// (arrow keys), screen readers and form behaviour all work; the chips are only how they look.
import { useId } from 'react';
import styles from './ChipGroup.module.css';

export interface Chip {
  value: string;
  label: string;
  glyph?: string;
  color?: string;
}

interface Props {
  legend: string;
  name?: string;
  options: Chip[];
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
}

export function ChipGroup({ legend, name, options, value, onChange, error }: Props) {
  const group = useId();
  const field = name ?? group;
  return (
    <fieldset className={styles.set} aria-describedby={error ? `${group}-error` : undefined}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.row}>
        {options.map((option) => (
          <label key={option.value} className={`${styles.chip} ${value === option.value ? styles.on : ''}`}>
            <input type="radio" className={styles.input} name={field} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
            {option.glyph ? (
              <span className={styles.glyph} aria-hidden="true">
                {option.glyph}
              </span>
            ) : null}
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <p id={`${group}-error`} className={`${styles.error} ${error ? '' : styles.empty}`} role="alert">
        {error}
      </p>
    </fieldset>
  );
}
