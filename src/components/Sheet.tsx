// An accessible dialog: a bottom sheet on phones, a centred card on larger screens.
// Focus stays inside, Esc closes the top dialog only, the page behind is inert, and focus returns to where it came from.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { popSheet, pushSheet, useSheetStack } from './sheetStack';
import { useI18n } from '@/lib/i18n';
import styles from './Sheet.module.css';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Narrow suits forms; the default suits lists. */
  size?: 'narrow' | 'wide';
  /** A dialog that must be answered (a confirmation) is not closed by a tap outside it. */
  dismissible?: boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({ open, onClose, title, children, size = 'narrow', dismissible = true }: SheetProps) {
  const id = useId();
  const { t } = useI18n();
  const stack = useSheetStack();
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(null);
  const isTop = open && stack[stack.length - 1] === id;

  useEffect(() => {
    if (!open) return undefined;
    returnTo.current = document.activeElement;
    pushSheet(id);
    return () => {
      popSheet(id);
      const target = returnTo.current;
      if (target instanceof HTMLElement && document.contains(target)) target.focus();
    };
  }, [open, id]);

  useEffect(() => {
    if (!isTop) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.contains(document.activeElement)) {
      const first = dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? dialog).focus();
    }
  }, [isTop, open]);

  if (!open) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!isTop) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (dismissible) onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the overlay only handles a tap outside and Esc
    <div className={styles.overlay} onKeyDown={onKeyDown} inert={!isTop} onMouseDown={(event) => { if (dismissible && isTop && event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} className={`${styles.sheet} ${size === 'wide' ? styles.wide : ''}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}>
        <div className={styles.grabber} aria-hidden="true" />
        <div className={styles.head}>
          <h2 id={`${id}-title`} className={styles.title}>
            {title}
          </h2>
          {dismissible ? (
            <button type="button" className={styles.close} onClick={onClose} aria-label={t('common.close')}>
              <Icon name="x" />
            </button>
          ) : null}
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
