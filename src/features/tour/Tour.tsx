// ON-01: the first-time guided tour. A dark layer with a cut-out around one real button at a time, and a small card beside it with
// Previous, Next and Skip. Each step points at whichever copy of the button is on screen (the tab bar on a phone, the sidebar on a computer).
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import { Button } from '@/components/Button';
import { useMoney } from '@/features/money/MoneyContext';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { useAnnouncementBusy } from '@/features/announce/announceStore';
import { isNewAccount, rememberOnThisDevice, seenOnThisDevice, startTour, stopTour, useTourActive } from './tourStore';
import styles from './Tour.module.css';

interface Step {
  target: string;
  title: MessageKey;
  body: MessageKey;
  /** This step shows the Add pop-up (the Scan button lives inside it). */
  addOpen?: boolean;
}
const STEPS: Step[] = [
  { target: 'add', title: 'tour.add.title', body: 'tour.add.body' },
  { target: 'scan', title: 'tour.scan.title', body: 'tour.scan.body', addOpen: true },
  { target: 'summary', title: 'tour.summary.title', body: 'tour.summary.body' },
  { target: 'history', title: 'tour.history.title', body: 'tour.history.body' },
  { target: 'plan', title: 'tour.plan.title', body: 'tour.plan.body' },
];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const PAD = 6;

/** The copy of a target that is actually on screen (a phone and a computer each have their own). */
function findTarget(name: string): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`));
  return (
    all.find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    }) ?? null
  );
}

export function TourHost() {
  const active = useTourActive();
  const { session, client } = useAuth();
  const location = useLocation();
  const meta = (session?.user?.user_metadata ?? {}) as Record<string, unknown>;
  const userId = session?.user?.id;
  const eligible = Boolean(userId) && meta.tour_seen !== true && !seenOnThisDevice() && isNewAccount(session?.user?.created_at);
  const onHome = location.pathname.replace(/\/+$/, '') === '/app';
  const announcing = useAnnouncementBusy(); // the announcement comes first; the tour starts when it is closed

  // a brand-new account is welcomed once, on Home, when nothing else is open
  useEffect(() => {
    if (!eligible || !onHome || announcing) return;
    const timer = setTimeout(() => {
      if (!document.querySelector('[role="dialog"]')) startTour();
    }, 1200);
    return () => clearTimeout(timer);
  }, [eligible, onHome, announcing]);

  const finish = useCallback(async () => {
    stopTour();
    rememberOnThisDevice();
    try {
      await client?.auth.updateUser({ data: { tour_seen: true } });
    } catch {
      /* the copy on this device is enough */
    }
  }, [client]);

  return active ? <TourRun onFinish={() => void finish()} /> : null;
}

function TourRun({ onFinish }: { onFinish: () => void }) {
  const { t } = useI18n();
  const { openAdd, closeAdd } = useMoney();
  const navigate = useNavigate();
  const location = useLocation();
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const card = useRef<HTMLDivElement>(null);
  const maskId = `tour-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const step = STEPS[index] as Step;
  const last = index === STEPS.length - 1;

  // the tour starts on Home, where the summary is
  useEffect(() => {
    if (location.pathname.replace(/\/+$/, '') !== '/app') navigate('/app');
  }, [location.pathname, navigate]);

  // each step shows what it points at: the Add pop-up for the Scan step, nothing extra for the others
  useEffect(() => {
    if (step.addOpen) openAdd();
    else closeAdd();
  }, [step, openAdd, closeAdd]);

  // find the target (it may still be loading or opening), then follow it as the screen changes
  useEffect(() => {
    let frame = 0;
    let stop = false;
    let started = performance.now();
    let found: HTMLElement | null = null;
    const measure = () => {
      if (stop) return;
      const el = found && document.contains(found) ? found : findTarget(step.target);
      if (el) {
        if (el !== found) {
          found = el;
          const r0 = el.getBoundingClientRect();
          if (r0.top < 0 || r0.bottom > window.innerHeight) el.scrollIntoView({ block: 'center', behavior: 'auto' });
        }
        const r = el.getBoundingClientRect();
        setBox((old) => (old && Math.abs(old.x - r.left) < 0.5 && Math.abs(old.y - r.top) < 0.5 && Math.abs(old.w - r.width) < 0.5 && Math.abs(old.h - r.height) < 0.5 ? old : { x: r.left, y: r.top, w: r.width, h: r.height }));
        started = performance.now();
      } else if (performance.now() - started > 2500) {
        // the thing this step points at is not on this screen: move on instead of leaving the person stuck
        setIndex((i) => (i < STEPS.length - 1 ? i + 1 : i));
        return;
      }
      frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => {
      stop = true;
      cancelAnimationFrame(frame);
    };
  }, [step]);

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // put the card beside the target, inside the screen (set from code: inline styles in the page are not allowed)
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const margin = 12;
    const width = Math.min(340, size.w - margin * 2);
    el.style.width = `${width}px`;
    const height = el.offsetHeight;
    let left = size.w / 2 - width / 2;
    let top = size.h / 2 - height / 2;
    if (box) {
      const below = box.y + box.h + PAD + margin;
      const above = box.y - PAD - margin - height;
      top = below + height <= size.h - margin ? below : above >= margin ? above : Math.max(margin, size.h - height - margin);
      left = Math.min(Math.max(margin, box.x + box.w / 2 - width / 2), size.w - width - margin);
    }
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }, [box, size, index]);

  useEffect(() => {
    card.current?.querySelector<HTMLElement>('[data-testid="tour-next"]')?.focus({ preventScroll: true });
  }, [index]);

  const skip = useCallback(() => {
    closeAdd();
    onFinish();
  }, [closeAdd, onFinish]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      skip();
    } else if (event.key === 'Tab') {
      const focusable = Array.from(card.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
      const first = focusable[0];
      const lastEl = focusable[focusable.length - 1];
      if (!first || !lastEl) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  // outside the app root: a pop-up that is open (the Scan step shows one) makes the rest of the page inert, and the tour must stay usable
  return createPortal(
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the layer only handles Esc and keeps Tab inside the card
    <div className={styles.layer} onKeyDown={onKeyDown} data-testid="tour">
      <svg className={styles.dim} width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true">
        <defs>
          <mask id={maskId}>
            <rect x="0" y="0" width={size.w} height={size.h} fill="white" />
            {box ? <rect className={styles.hole} x={box.x - PAD} y={box.y - PAD} width={box.w + PAD * 2} height={box.h + PAD * 2} rx="14" fill="black" /> : null}
          </mask>
        </defs>
        <rect x="0" y="0" width={size.w} height={size.h} className={styles.shade} mask={`url(#${maskId})`} />
        {box ? <rect className={styles.ring} x={box.x - PAD} y={box.y - PAD} width={box.w + PAD * 2} height={box.h + PAD * 2} rx="14" /> : null}
      </svg>
      <div ref={card} className={styles.card} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
        <p className={styles.count}>
          {t('tour.step', { n: String(index + 1), total: String(STEPS.length) })}
        </p>
        <h2 id="tour-title" className={styles.title}>
          {t(step.title)}
        </h2>
        <p id="tour-body" className={styles.body}>
          {t(step.body)}
        </p>
        <div className={styles.dots} aria-hidden="true">
          {STEPS.map((_, i) => (
            <span key={i} className={`${styles.dot} ${i === index ? styles.dotOn : ''}`} />
          ))}
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" onClick={skip}>
            {t('tour.skip')}
          </Button>
          <span className={styles.spacer} />
          <Button variant="outline" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
            {t('tour.prev')}
          </Button>
          <Button onClick={() => (last ? skip() : setIndex((i) => i + 1))} data-testid="tour-next">
            {last ? t('tour.done') : t('tour.next')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
