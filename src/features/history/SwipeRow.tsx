// TX-04: on a touch screen, swipe a History row right to duplicate it and left to delete it (with Undo). It is an extra way in:
// the row's own buttons and the edit sheet do the same, so nothing depends on being able to swipe.
import { useRef, type PointerEvent, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import styles from './SwipeRow.module.css';

const TRIGGER = 84; // how far the row must travel before letting go does something
const LIMIT = 132;

interface Props {
  className: string | undefined;
  kind: string;
  duplicateLabel: string;
  deleteLabel: string;
  onDuplicate: () => void;
  onDelete: () => void;
  children: ReactNode;
}

export function SwipeRow({ className, kind, duplicateLabel, deleteLabel, onDuplicate, onDelete, children }: Props) {
  const row = useRef<HTMLLIElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; dx: number; active: boolean } | null>(null);
  const swiped = useRef(false);

  // the row is moved through the DOM directly, and left exactly as it was found (no style attribute stays behind)
  const slide = (dx: number) => {
    const item = row.current;
    const face = item?.querySelector<HTMLElement>('[data-slide]');
    if (!item || !face) return;
    if (dx === 0) {
      face.style.removeProperty('transform');
      if (!face.getAttribute('style')) face.removeAttribute('style');
      item.removeAttribute('data-swipe');
      item.removeAttribute('data-armed');
      return;
    }
    face.style.transform = `translateX(${dx}px)`;
    item.setAttribute('data-swipe', dx > 0 ? 'duplicate' : 'delete');
    item.toggleAttribute('data-armed', Math.abs(dx) >= TRIGGER);
  };

  const onDown = (event: PointerEvent<HTMLLIElement>) => {
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
    current.dx = Math.max(-LIMIT, Math.min(LIMIT, dx));
    slide(current.dx);
  };
  const finish = (act: boolean) => {
    const current = drag.current;
    drag.current = null;
    if (!current?.active) return;
    slide(0);
    if (!act) return;
    if (current.dx >= TRIGGER) onDuplicate();
    else if (current.dx <= -TRIGGER) onDelete();
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
        if (!swiped.current) return;
        swiped.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <span className={`${styles.under} ${styles.duplicate}`} aria-hidden="true">
        <Icon name="copy" size={18} />
        {duplicateLabel}
      </span>
      <span className={`${styles.under} ${styles.delete}`} aria-hidden="true">
        {deleteLabel}
        <Icon name="trash" size={18} />
      </span>
      {children}
    </li>
  );
}
