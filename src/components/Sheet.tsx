// An accessible dialog: a floating card that rises from the bottom on phones (drag its bar down to close it), a centred card on larger
// screens. Focus stays inside, Esc closes the top dialog only, the page behind is inert, and focus returns to where it came from.
import { useEffect, useId, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { popSheet, pushSheet, useSheetStack } from './sheetStack';
import { useI18n } from '@/lib/i18n';
import styles from './Sheet.module.css';
import { prefersReducedMotion } from '@/lib/motion';

export interface SheetHandle { close: (after?: () => void) => void; }

interface SheetProps {
  ref?: Ref<SheetHandle>;
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Narrow suits forms; the default suits lists. */
  size?: 'narrow' | 'wide';
  /** A dialog that must be answered (a confirmation) is not closed by a tap outside it, nor by dragging. */
  dismissible?: boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const PHONE = '(max-width: 639px)';
/** How far (px) or how fast (px per ms) a downward drag must go to close the pop-up instead of springing back. */
const CLOSE_DISTANCE = 120;
const CLOSE_SPEED = 0.6;

/** A drag that did not go far enough: the card springs back into place. */
function springBack(dialog: HTMLElement, from: number) {
  if (from !== 0 && dialog.animate && !prefersReducedMotion()) {
    dialog.animate([{ transform: dialog.style.transform || 'none' }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.2)' });
  }
  dialog.style.transform = '';
}

export function Sheet({ open, onClose, title, children, size = 'narrow', dismissible = true, ref }: SheetProps) {
  const id = useId();
  const { t } = useI18n();
  const stack = useSheetStack();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const animations = useRef<Animation[]>([]);
  useEffect(() => () => { animations.current.forEach((animation) => animation.cancel()); }, []);
  /** Closes with a short exit; `fromY` continues a drag from where the finger let go. */
  const requestClose = (after?: () => void, fromY = 0) => {
    if (closingRef.current) return;
    const dialog = dialogRef.current;
    const finish = () => { onClose(); after?.(); closingRef.current = false; setClosing(false); };
    if (!dialog || prefersReducedMotion() || !dialog.animate) { finish(); return; }
    closingRef.current = true;
    setClosing(true);
    dialog.focus();
    const phone = window.matchMedia(PHONE).matches;
    const duration = phone ? 260 : 200;
    const motion = dialog.animate(
      phone
        ? [{ transform: `translateY(${fromY}px)` }, { transform: 'translateY(110%)' }]
        : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px) scale(0.96)' }],
      { duration, easing: phone ? 'cubic-bezier(0.4, 0, 1, 1)' : 'ease-in', fill: 'forwards' },
    );
    dialog.style.transform = '';
    const backdrop = dialog.parentElement?.animate([{ opacity: 1 }, { opacity: 0 }], { duration, fill: 'forwards' });
    animations.current = backdrop ? [motion, backdrop] : [motion];
    void motion.finished.then(() => {
      finish();
      animations.current.forEach((animation) => animation.cancel());
      animations.current = [];
    }).catch(() => undefined);
  };
  useImperativeHandle(ref, () => ({ close: requestClose }));
  const returnTo = useRef<Element | null>(null);
  const isTop = open && stack[stack.length - 1] === id;

  // ---- drag the bar down to close (phones, touch or pen; the close button and Esc do the same thing) ----
  const drag = useRef<{ id: number; y: number; dy: number; at: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const onDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dismissible || !isTop || closingRef.current || event.pointerType === 'mouse' || !window.matchMedia(PHONE).matches) return;
    if ((event.target as HTMLElement).closest('button')) return; // the close button is pressed, not dragged
    drag.current = { id: event.pointerId, y: event.clientY, dy: 0, at: performance.now() };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // not every pointer can be captured
    }
  };
  const onDragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    const dialog = dialogRef.current;
    if (!current || current.id !== event.pointerId || !dialog) return;
    const dy = event.clientY - current.y;
    if (!dragging && Math.abs(dy) > 4) setDragging(true);
    current.dy = dy;
    // down follows the finger; up gives a little, like a rubber band
    dialog.style.transform = `translateY(${dy > 0 ? dy : dy / 5}px)`;
  };
  const onDragEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    drag.current = null;
    setDragging(false);
    const dialog = dialogRef.current;
    if (!current || current.id !== event.pointerId || !dialog) return;
    const speed = current.dy / Math.max(1, performance.now() - current.at);
    if (current.dy > CLOSE_DISTANCE || (current.dy > 30 && speed > CLOSE_SPEED)) {
      requestClose(undefined, current.dy);
      return;
    }
    springBack(dialog, current.dy);
  };

  // ---- the same pull from the content itself, when it is scrolled to the top (as native sheets do) ----
  // Touch events, not pointer events: once the browser decides a touch is a scroll it cancels the pointer, but a touch can be held.
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(requestClose);
  useEffect(() => {
    closeRef.current = requestClose;
  });
  useEffect(() => {
    const body = bodyRef.current;
    const dialog = dialogRef.current;
    if (!open || !dismissible || !body || !dialog) return undefined;
    let startX = 0;
    let startY = 0;
    let at = 0;
    let dy = 0;
    let tracking = false;
    let pulling = false;
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      tracking = Boolean(touch) && event.touches.length === 1 && !closingRef.current && body.scrollTop <= 0 && window.matchMedia(PHONE).matches;
      pulling = false;
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!tracking || !touch) return;
      const down = touch.clientY - startY;
      if (!pulling) {
        // only a clear downward pull at the top starts it; anything else is ordinary scrolling or tapping
        if (down < -4 || Math.abs(touch.clientX - startX) > 12 || body.scrollTop > 0) {
          tracking = false;
          return;
        }
        if (down < 10) return;
        pulling = true;
        startY = touch.clientY;
        at = performance.now();
        setDragging(true);
      }
      if (event.cancelable) event.preventDefault(); // the content does not bounce while the card is being pulled
      dy = Math.max(0, touch.clientY - startY);
      dialog.style.transform = `translateY(${dy}px)`;
    };
    const onEnd = () => {
      tracking = false;
      if (!pulling) return;
      pulling = false;
      setDragging(false);
      const speed = dy / Math.max(1, performance.now() - at);
      if (dy > CLOSE_DISTANCE || (dy > 30 && speed > CLOSE_SPEED)) closeRef.current(undefined, dy);
      else springBack(dialog, dy);
      dy = 0;
    };
    body.addEventListener('touchstart', onStart, { passive: true });
    body.addEventListener('touchmove', onMove, { passive: false });
    body.addEventListener('touchend', onEnd);
    body.addEventListener('touchcancel', onEnd);
    return () => {
      body.removeEventListener('touchstart', onStart);
      body.removeEventListener('touchmove', onMove);
      body.removeEventListener('touchend', onEnd);
      body.removeEventListener('touchcancel', onEnd);
    };
  }, [open, dismissible]);

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
      if (dismissible) requestClose();
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
    <div className={styles.overlay} onKeyDown={onKeyDown} inert={!isTop} onMouseDown={(event) => { if (dismissible && isTop && event.target === event.currentTarget) requestClose(); }}>
      <div ref={dialogRef} className={`${styles.sheet} ${size === 'wide' ? styles.wide : ''} ${dragging ? styles.dragging : ''}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1} data-sheet>
        {/* the bar and the title are the drag handle on a phone; it is an extra, so it is hidden from screen readers */}
        <div className={styles.handle} onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd} data-handle>
          <div className={styles.grabber} aria-hidden="true" />
          <div className={styles.head}>
            <h2 id={`${id}-title`} className={styles.title}>
              {title}
            </h2>
            {dismissible ? (
              <button type="button" className={styles.close} disabled={closing} onClick={() => requestClose()} aria-label={t('common.close')}>
                <Icon name="x" />
              </button>
            ) : null}
          </div>
        </div>
        <div ref={bodyRef} className={styles.body} inert={closing}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
