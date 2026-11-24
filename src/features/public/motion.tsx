// Small, careful motion for the public pages. Everything here switches itself off for people who ask for less motion
// (prefers-reduced-motion), and when the browser cannot watch scrolling the content simply stays visible.
import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';
import styles from './motion.module.css';

export const calm = (): boolean => typeof window === 'undefined' || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** True once the element has scrolled into view (always true when motion is off). */
export function useInView<T extends Element>(once = true): [React.RefObject<T | null>, boolean, boolean] {
  const ref = useRef<T | null>(null);
  const [armed] = useState(() => !calm());
  const [seen, setSeen] = useState(() => calm());
  useEffect(() => {
    const el = ref.current;
    if (!armed || !el) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setSeen(true);
            if (once) observer.disconnect();
          } else if (!once) setSeen(false);
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [armed, once]);
  return [ref, seen, armed];
}

/** Fades and lifts its content in when it scrolls into view. `delay` (1 to 6) staggers neighbours. */
export function Reveal({ as, delay = 0, className = '', children }: { as?: ElementType; delay?: 0 | 1 | 2 | 3 | 4 | 5 | 6; className?: string; children: ReactNode }) {
  const Tag = (as ?? 'div') as ElementType;
  const [ref, seen, armed] = useInView<HTMLElement>();
  return (
    <Tag ref={ref} className={`${armed ? styles.reveal : ''} ${armed && seen ? styles.in : ''} ${delay ? styles[`d${delay}`] : ''} ${className}`.trim()}>
      {children}
    </Tag>
  );
}

/** A number that counts up to its value the first time it is seen. With less motion it just shows the value. */
export function Counter({ to, suffix = '', prefix = '' }: { to: number; suffix?: string; prefix?: string }) {
  const [ref, seen] = useInView<HTMLSpanElement>();
  const [value, setValue] = useState(0);
  const still = calm(); // with less motion (or no scroll watching) the final number is simply shown
  useEffect(() => {
    if (!seen || still) return undefined;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 1100);
      setValue(Math.round(to * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    // a tab in the background pauses animation frames: the number still ends up right
    const finish = setTimeout(() => setValue(to), 1400);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(finish);
    };
  }, [seen, still, to]);
  return (
    <span ref={ref}>
      {prefix}
      {still ? to : value}
      {suffix}
    </span>
  );
}
