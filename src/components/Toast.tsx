// Quick confirmations. Text only (never HTML). Errors are announced assertively; everything else politely.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import styles from './Toast.module.css';

type ToastType = 'success' | 'error' | 'info';
export interface ToastAction {
  label: string;
  onClick: () => void;
}
interface ToastItem {
  id: number;
  leaving?: boolean;
  type: ToastType;
  message: string;
  action?: ToastAction | undefined;
}

interface ToastApi {
  /** `action` adds one button, such as Undo. A toast with a button stays a little longer. */
  show: (type: ToastType, message: string, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const icons: Record<ToastType, IconName> = { success: 'check', error: 'alert', info: 'info' };
const MAX_VISIBLE = 3;
const LIFETIME_MS = 4500;
const LIFETIME_WITH_ACTION_MS = 8000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const exits = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = exits.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, leaving: true } : item));
    const timer = setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
      exits.current.delete(timer);
    }, 220);
    exits.current.add(timer);
  }, []);

  const show = useCallback(
    (type: ToastType, message: string, action?: ToastAction) => {
      counter.current += 1;
      const id = counter.current;
      setItems((current) => [...current.slice(-(MAX_VISIBLE - 1)), { id, type, message, action }]);
    },
    [],
  );

  const api = useMemo(() => ({ show }), [show]);
  const polite = items.filter((item) => item.type !== 'error');
  const urgent = items.filter((item) => item.type === 'error');

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.host}>
        <div role="status" aria-live="polite" className={styles.stack}>
          {polite.map((item) => <ToastMessage key={item.id} item={item} dismiss={dismiss} />)}
        </div>
        <div role="alert" aria-live="assertive" className={styles.stack}>
          {urgent.map((item) => <ToastMessage key={item.id} item={item} dismiss={dismiss} />)}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastMessage({ item, dismiss }: { item: ToastItem; dismiss: (id: number) => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [touching, setTouching] = useState(false);
  const remaining = useRef(item.action ? LIFETIME_WITH_ACTION_MS : LIFETIME_MS);
  const paused = hovered || focused || touching;
  useEffect(() => {
    if (paused || item.leaving) return;
    const start = Date.now();
    const timer = setTimeout(() => dismiss(item.id), remaining.current);
    return () => { clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - start)); };
  }, [paused, item.id, item.leaving, dismiss]);
  return (
    <div className={`${styles.slot} ${item.leaving ? styles.collapsing : ''}`}>
      <div className={styles.clip}>
        <div className={`${styles.toast} ${styles[item.type]} ${item.leaving ? styles.leaving : ''}`}
          onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
          onFocus={() => setFocused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
          onPointerDown={() => setTouching(true)} onPointerUp={() => setTouching(false)} onPointerCancel={() => setTouching(false)} onPointerLeave={() => setTouching(false)}>
          <Icon name={icons[item.type]} size={18} />
          <span className={styles.message}>{item.message}</span>
          {item.action ? <button type="button" className={styles.action} disabled={item.leaving} onClick={() => { dismiss(item.id); item.action?.onClick(); }}>{item.action.label}</button> : null}
        </div>
      </div>
    </div>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}
