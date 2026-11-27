// SP-16: the way in to the split-the-bill page: a card with a small drawn receipt for the home screen (it can be hidden) and a compact one for the Add sheet.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import { BetaBadge } from '@/components/BetaBadge';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import styles from './SplitCard.module.css';

/** A receipt with three rows, two ticked, and a highlighted share: shapes only, so it needs no translation. */
function MiniReceipt() {
  return (
    <svg className={styles.art} viewBox="0 0 88 104" aria-hidden="true" focusable="false">
      <path className={styles.paper} d="M6 4h76v92l-9.5-6-9.5 6-9.5-6-9.5 6-9.5-6-9.5 6-9.5-6z" />
      {[0, 1, 2].map((row) => (
        <g key={row} transform={`translate(0 ${row * 20})`}>
          <rect className={row === 1 ? styles.box : styles.boxOn} x="14" y="14" width="12" height="12" rx="3" />
          {row === 1 ? null : <path className={styles.tick} d="M17 20.5l3 3 5-6" pathLength={14} data-row={row} />}
          <rect className={styles.bar} x="32" y="17" width={row === 1 ? 26 : 34} height="4" rx="2" />
          <rect className={styles.bar} x="62" y="17" width="12" height="4" rx="2" />
        </g>
      ))}
      <rect className={styles.share} x="14" y="76" width="60" height="9" rx="4.5" />
    </svg>
  );
}

interface Props {
  variant: 'home' | 'sheet';
  /** For the sheet: close the sheet, then go to the page. */
  onOpen?: () => void;
}

export function SplitCard({ variant, onOpen }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const { session } = useAuth();
  const key = `et_split_card_${session?.user?.id ?? ''}`;
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });

  if (variant === 'sheet') {
    return (
      <button type="button" className={styles.sheetCard} data-testid="split-link" onClick={onOpen}>
        <Icon name="receipt" size={22} />
        <span className={styles.sheetText}>
          <strong>
            {t('split.card.title')} <BetaBadge />
          </strong>
          <small>{t('split.link')}</small>
        </span>
        <span className={styles.chevron}>
          <Icon name="back" size={18} />
        </span>
      </button>
    );
  }

  if (hidden) return null;
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(key, '1');
    } catch {
      /* hidden for this visit only */
    }
    toast.show('info', t('split.card.hidden'));
  };
  return (
    <section className={styles.wrap} aria-labelledby="split-card-title" data-testid="split-card">
      <Link to="/app/split" className={styles.card} data-testid="split-card-link">
        <MiniReceipt />
        <span className={styles.text}>
          <strong id="split-card-title" className={styles.title}>
            {t('split.card.title')} <BetaBadge />
          </strong>
          <span className={styles.body}>{t('split.card.body')}</span>
          <span className={styles.cta}>
            {t('split.card.cta')}
            <span className={styles.chevron}>
              <Icon name="back" size={16} />
            </span>
          </span>
        </span>
      </Link>
      <button type="button" className={styles.dismiss} aria-label={t('split.card.hide')} data-testid="split-card-dismiss" onClick={hide}>
        <Icon name="x" size={16} />
      </button>
    </section>
  );
}
