import type { ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './Notice.module.css';

/** 'solid' is a warning for a coloured card (not the page): an opaque panel with an amber edge, so it reads on every colour theme. */
type Kind = 'info' | 'good' | 'bad' | 'warn' | 'solid';

/** A message inside a screen. Bad news is announced right away; the rest politely. */
export function Notice({ kind = 'info', children }: { kind?: Kind; children: ReactNode }) {
  const icon = kind === 'good' ? 'check' : kind === 'info' ? 'info' : 'alert';
  return (
    <div className={`${styles.notice} ${styles[kind]}`} role={kind === 'bad' || kind === 'warn' || kind === 'solid' ? 'alert' : 'status'}>
      <Icon name={icon} size={18} />
      <div>{children}</div>
    </div>
  );
}
