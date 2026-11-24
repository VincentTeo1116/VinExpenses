// Quick confirmations. Text only (never HTML). Errors are announced assertively; everything else politely.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
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

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, leaving: true } : item));
    setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 220);
  }, []);

  const show = useCallback(
    (type: ToastType, message: string, action?: ToastAction) => {
      counter.current += 1;
      const id = counter.current;
      setItems((current) => [...current.slice(-(MAX_VISIBLE - 1)), { id, type, message, action }]);
      setTimeout(() => dismiss(id), action ? LIFETIME_WITH_ACTION_MS : LIFETIME_MS);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show }), [show]);
  const polite = items.filter((item) => item.type !== 'error');
  const urgent = items.filter((item) => item.type === 'error');

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.host}>
        <div role="status" aria-live="polite" className={styles.stack}>
          {polite.map((item) => (
            <div key={item.id} className={`${styles.toast} ${styles[item.type]} ${item.leaving ? styles.leaving : ''}`}>
              <Icon name={icons[item.type]} size={18} />
              <span>{item.message}</span>
              {item.action ? (
                <button type="button" className={styles.action} disabled={item.leaving} onClick={() => { item.action?.onClick(); dismiss(item.id); }}>
                  {item.action.label}
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <div role="alert" aria-live="assertive" className={styles.stack}>
          {urgent.map((item) => (
            <div key={item.id} className={`${styles.toast} ${styles[item.type]} ${item.leaving ? styles.leaving : ''}`}>
              <Icon name={icons[item.type]} size={18} />
              <span>{item.message}</span>
              {item.action ? (
                <button type="button" className={styles.action} disabled={item.leaving} onClick={() => { item.action?.onClick(); dismiss(item.id); }}>
                  {item.action.label}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}
