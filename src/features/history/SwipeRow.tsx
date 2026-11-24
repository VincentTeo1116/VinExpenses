// TX-04: on a touch screen, swipe a History row right to duplicate it and left to delete it (with Undo). It is an extra way in:
// the row's own buttons and the edit sheet do the same, so nothing depends on being able to swipe.
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { prefersReducedMotion } from '@/lib/motion';
import styles from './SwipeRow.module.css';

const TRIGGER = 120; // how far the row must travel before letting go does something
const LIMIT = 132;

interface Props {
  className: string | undefined;
  kind: string;
  duplicateLabel: string;
  deleteLabel: string;
  onDuplicate: () => void;
  onDelete: () => void | Promise<void>;
  children: ReactNode;
}

export function SwipeRow({ className, kind, duplicateLabel, deleteLabel, onDuplicate, onDelete, children }: Props) {
  const row = useRef<HTMLLIElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; dx: number; active: boolean } | null>(null);
  const swiped = useRef(false);

  const [opened, setOpened] = useState(0);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const slide = useCallback((dx: number, settle = false) => {
    clearTimeout(timer.current);
    const item = row.current;
    const face = item?.querySelector<HTMLElement>('[data-slide]');
    if (!item || !face) return;
    face.style.transition = settle && !prefersReducedMotion() ? 'transform 220ms var(--ease)' : 'none';
    face.style.transform = `translateX(${dx}px)`;
    if (dx) item.setAttribute('data-swipe', dx > 0 ? 'duplicate' : 'delete');
    else item.removeAttribute('data-swipe');
    item.toggleAttribute('data-armed', Math.abs(dx) >= TRIGGER);
    if (dx === 0) {
      // back at rest: once it has settled, leave the row exactly as it was (no inline style), so nothing lingers on it
      if (settle && !prefersReducedMotion()) timer.current = setTimeout(() => face.removeAttribute('style'), 240);
      else face.removeAttribute('style');
    }
  }, []);
  const close = useCallback(() => { setOpened(0); slide(0, true); }, [slide]);
  useEffect(() => {
    if (!opened) return;
    const outside = (event: globalThis.PointerEvent) => {
      if (!busy.current && event.target instanceof Node && !row.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [opened, close]);
  const duplicate = () => { close(); onDuplicate(); };
  const remove = () => {
    if (busy.current) return;
    busy.current = true;
    setOpened(0);
    slide(-(row.current?.offsetWidth ?? 400), true);
    timer.current = setTimeout(() => {
      void Promise.resolve().then(onDelete).finally(() => {
        busy.current = false;
        if (row.current) slide(0, true);
      }).catch(() => undefined);
    }, prefersReducedMotion() ? 0 : 220);
  };

  const onDown = (event: PointerEvent<HTMLLIElement>) => {
    if (busy.current || (event.target as HTMLElement).closest('[data-action]')) return;
    if (event.pointerType === 'mouse') return; // a mouse has the buttons on the row
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, active: false };
    swiped.current = false;
  };
  const onMove = (event: PointerEvent<HTMLLIElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.active) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
        drag.current = null; // the person is scrolling the list
        return;
      }
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      current.active = true;
      swiped.current = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // not every pointer can be captured; the gesture still works while it stays over the row
      }
    }
    current.dx = Math.max(-LIMIT, Math.min(LIMIT, dx + opened));
    slide(current.dx);
  };
  const finish = (act: boolean) => {
    const current = drag.current;
    drag.current = null;
    if (!current?.active) return;
    if (!act) { close(); return; }
    if (current.dx >= TRIGGER) duplicate();
    else if (current.dx <= -TRIGGER) remove();
    else if (Math.abs(current.dx) > 42) {
      const next = current.dx > 0 ? 96 : -96;
      setOpened(next);
      slide(next, true);
    } else close();
  };

  return (
    // the swipe is an extra: the same actions are real buttons inside the row
    <li
      ref={row}
      className={`${className ?? ''} ${styles.swipe}`}
      data-kind={kind}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={() => finish(true)}
      onPointerCancel={() => finish(false)}
      onClickCapture={(event) => {
        // letting go after a swipe must not also open the row
        if (busy.current) { event.preventDefault(); event.stopPropagation(); return; }
        if ((event.target as HTMLElement).closest('[data-action]')) return;
        if (!swiped.current && !opened) return;
        if (!swiped.current && opened) close();
        swiped.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <span className={`${styles.under} ${styles.duplicate}`} aria-hidden={opened !== 96}>
        <button type="button" onKeyDown={(event) => { if (event.key === 'Escape') { close(); row.current?.querySelector<HTMLButtonElement>('[data-slide]')?.focus(); } }} data-action tabIndex={opened === 96 ? 0 : -1} onClick={duplicate}>
        <Icon name="copy" size={18} />
        {duplicateLabel}
        </button>
      </span>
      <span className={`${styles.under} ${styles.delete}`} aria-hidden={opened !== -96}>
        <button type="button" onKeyDown={(event) => { if (event.key === 'Escape') { close(); row.current?.querySelector<HTMLButtonElement>('[data-slide]')?.focus(); } }} data-action tabIndex={opened === -96 ? 0 : -1} onClick={remove}>
        {deleteLabel}
        <Icon name="trash" size={18} />
        </button>
      </span>
      {children}
    </li>
  );
}
