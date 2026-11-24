import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'outline' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  block?: boolean;
  children: ReactNode;
}

/** Always a real <button>. `loading` blocks double submits and tells screen readers the action is busy. */
export function Button({ variant = 'primary', loading = false, block = false, disabled, className, children, type = 'button', ...rest }: ButtonProps) {
  const classes = [styles.btn, styles[variant], block ? styles.block : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button {...rest} type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined}>
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
