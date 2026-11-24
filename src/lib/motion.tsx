// The app's moving parts, as the previous version had them: amounts that count to their value, bars and rings that grow in.
// Everything here stands still for people who ask their device for less motion.
import { useEffect, useRef, useState } from 'react';
import { formatMoney } from '@/lib/money';

/** True when motion should be skipped (the person asked for less, or the browser cannot tell us). */
export const prefersReducedMotion = (): boolean => typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A number that glides to its value: from 0 the first time, then from wherever it was (600ms, easing out). */
export function useCountUp(target: number, duration = 600): number {
  const still = prefersReducedMotion();
  const [shown, setShown] = useState(0);
  const current = useRef(0);
  useEffect(() => {
    if (still) return undefined;
    const from = current.current;
    if (from === target) return undefined;
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const value = from + (target - from) * (1 - Math.pow(1 - t, 3));
      current.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    // animation frames pause in a background tab: the real value always lands
    const finish = setTimeout(() => {
      current.current = target;
      setShown(target);
    }, duration + 300);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(finish);
    };
  }, [target, duration, still]);
  return still ? target : shown;
}

/** False for the very first paint, then true: lets a bar or ring start empty and grow to its size. */
export function useGrown(): boolean {
  const still = prefersReducedMotion();
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    if (still) return undefined;
    const frame = requestAnimationFrame(() => setGrown(true));
    const fallback = setTimeout(() => setGrown(true), 300);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(fallback);
    };
  }, [still]);
  return still || grown;
}

/** An amount in ringgit that counts to its value. */
export function CountMoney({ value }: { value: number }) {
  const shown = useCountUp(Math.round(value * 100));
  return <>{formatMoney(Math.round(shown) / 100)}</>;
}
