// SH-04: the moving pill behind the active tab of the bottom bar (and the side rail on tablets): it glides from the old tab to the new one,
// stretching across the gap on the way, and the new tab's icon pops. With "reduce motion" it simply jumps. It never throws: with no tab to point at it hides.
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MOVE_MS = 560;
const ACTIVE = 'a[aria-current="page"]';

/** Where the pill belongs: behind the active tab, filling the bar across (a phone) or the rail along (a tablet); null when there is no active tab or the bar is hidden. */
function measure(nav: HTMLElement): Box | null {
  const active = nav.querySelector<HTMLElement>(ACTIVE);
  if (!active || nav.offsetWidth === 0) return null;
  const style = getComputedStyle(nav);
  if (style.display === 'flex' && style.flexDirection === 'column') return { x: 6, y: active.offsetTop + 2, w: nav.clientWidth - 12, h: active.offsetHeight - 4 };
  return { x: active.offsetLeft + 3, y: 6, w: active.offsetWidth - 6, h: nav.clientHeight - 12 };
}

const frame = (b: Box) => ({ transform: `translate(${b.x}px, ${b.y}px)`, width: `${b.w}px`, height: `${b.h}px` });

/** Puts the pill under the active tab, with the glide when asked and when it makes sense. `last` remembers where the pill was. */
function place(bar: HTMLElement, pill: HTMLElement, last: { current: Box | null }, animate: boolean): void {
  try {
    const next = measure(bar);
    if (!next) {
      pill.dataset.hidden = '';
      last.current = null;
      return;
    }
    const wasHidden = 'hidden' in pill.dataset;
    delete pill.dataset.hidden;
    const from = last.current;
    last.current = next;
    // the final place is set first; the animation only decorates the way there
    const end = frame(next);
    pill.style.transform = end.transform;
    pill.style.width = end.width;
    pill.style.height = end.height;
    const moved = from != null && (Math.abs(from.x - next.x) > 1 || Math.abs(from.y - next.y) > 1 || Math.abs(from.w - next.w) > 1 || Math.abs(from.h - next.h) > 1);
    if (!animate || !from || wasHidden || !moved || prefersReducedMotion() || typeof pill.animate !== 'function') return;
    const x0 = Math.min(from.x, next.x);
    const y0 = Math.min(from.y, next.y);
    const stretched: Box = { x: x0, y: y0, w: Math.max(from.x + from.w, next.x + next.w) - x0, h: Math.max(from.y + from.h, next.y + next.h) - y0 };
    pill.animate([{ ...frame(from), offset: 0 }, { ...frame(stretched), offset: 0.45, easing: 'cubic-bezier(0.3, 0.9, 0.4, 1)' }, { ...end, offset: 1 }], { duration: MOVE_MS, easing: 'cubic-bezier(0.5, 0, 0.3, 1)' });
    bar.querySelector<SVGElement>(`${ACTIVE} svg`)?.animate?.([{ transform: 'scale(0.8)' }, { transform: 'scale(1.18)', offset: 0.55 }, { transform: 'scale(1)' }], { duration: MOVE_MS * 0.9, easing: 'ease-out' });
  } catch {
    pill.dataset.hidden = ''; // a browser that cannot do this still has the tab's own colour to show where you are
  }
}

export function useTabIndicator(nav: RefObject<HTMLElement | null>, indicator: RefObject<HTMLElement | null>, routeKey: string): void {
  const last = useRef<Box | null>(null);

  // a new address: glide to the new tab
  useLayoutEffect(() => {
    if (nav.current && indicator.current) place(nav.current, indicator.current, last, true);
  }, [nav, indicator, routeKey]);

  // the bar changed size (turning the phone, a tablet rail, the font arriving): stay under the right tab without any movement
  useEffect(() => {
    const bar = nav.current;
    if (!bar) return undefined;
    const settle = () => {
      if (nav.current && indicator.current) place(nav.current, indicator.current, last, false);
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(settle) : null;
    observer?.observe(bar);
    void document.fonts?.ready.then(settle);
    window.addEventListener('resize', settle);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', settle);
    };
  }, [nav, indicator]);
}
