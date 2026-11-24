import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { SwipeRow } from './SwipeRow';

vi.mock('@/lib/motion', () => ({ prefersReducedMotion: () => false }));
afterEach(() => vi.useRealTimers());
function setup() {
  const remove = vi.fn();
  const duplicate = vi.fn();
  render(<ul><SwipeRow className="" kind="expense" duplicateLabel="Duplicate" deleteLabel="Delete" onDuplicate={duplicate} onDelete={remove}><button data-slide>Transaction</button></SwipeRow></ul>);
  const row = screen.getByRole('listitem');
  const pointer = (type: string, x: number) => {
    const event = new Event(type, { bubbles: true });
    Object.assign(event, { pointerType: 'touch', pointerId: 1, clientX: x, clientY: 10 });
    fireEvent(row, event);
  };
  return { remove, duplicate, row, pointer };
}
test('a partial swipe reveals a tappable duplicate action without executing it', () => {
  const { pointer, duplicate } = setup();
  pointer('pointerdown', 100); pointer('pointermove', 160); pointer('pointerup', 160);
  expect(duplicate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
  expect(duplicate).toHaveBeenCalledTimes(1);
});
test('full delete waits for the exit animation before deleting', async () => {
  vi.useFakeTimers();
  const { pointer, remove } = setup();
  pointer('pointerdown', 200); pointer('pointermove', 60); pointer('pointerup', 60);
  expect(remove).not.toHaveBeenCalled();
  await act(async () => { vi.advanceTimersByTime(220); });
  expect(remove).toHaveBeenCalledTimes(1);
});
test('a cancelled swipe never deletes and restores the row', () => {
  const { pointer, remove } = setup();
  pointer('pointerdown', 200); pointer('pointermove', 60); pointer('pointercancel', 60);
  expect(remove).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Transaction' }).style.transform).toBe('translateX(0px)');
});
