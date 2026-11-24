// AU-14: the Cloudflare security check. Shown only when a site key was built in; the page policy allows the Cloudflare
// address only in that case. When the script cannot load, the person gets a clear message and a retry (never a silent pass).
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { envResult } from '@/lib/env';
import { useI18n } from '@/lib/i18n';
import styles from './Turnstile.module.css';

interface TurnstileApi {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export const captchaEnabled = (): boolean => envResult.ok && Boolean(envResult.env.turnstileSiteKey);

let loading: Promise<boolean> | null = null;
function loadScript(): Promise<boolean> {
  if (window.turnstile) return Promise.resolve(true);
  if (!loading) {
    loading = new Promise<boolean>((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = () => resolve(Boolean(window.turnstile));
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
      setTimeout(() => resolve(Boolean(window.turnstile)), 12_000);
    }).then((ok) => {
      if (!ok) loading = null; // a failed load can be tried again
      return ok;
    });
  }
  return loading;
}

export interface TurnstileHandle {
  /** The current token, or '' when the check has not been passed. */
  token: () => string;
  reset: () => void;
}

export function Turnstile({ handle }: { handle?: Ref<TurnstileHandle> }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const tokenRef = useRef('');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useImperativeHandle(handle, () => ({
    token: () => tokenRef.current,
    reset: () => {
      tokenRef.current = '';
      if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
    },
  }));

  const mount = useCallback(async () => {
    if (!envResult.ok || !envResult.env.turnstileSiteKey || !box.current) return;
    const ok = await loadScript();
    if (!ok || !window.turnstile || !box.current) {
      setFailed(true);
      return;
    }
    setFailed(false);
    widget.current = window.turnstile.render(box.current, {
      sitekey: envResult.env.turnstileSiteKey,
      theme: 'auto',
      size: 'flexible',
      callback: (token: string) => {
        tokenRef.current = token;
      },
      'expired-callback': () => {
        tokenRef.current = '';
      },
      'error-callback': () => {
        tokenRef.current = '';
      },
    });
  }, []);

  useEffect(() => {
    void mount();
    return () => {
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
      tokenRef.current = '';
    };
  }, [mount, attempt]);

  if (!captchaEnabled()) return null;
  return (
    <div className={styles.wrap}>
      <div ref={box} aria-label={t('auth.securityLabel')} />
      {failed ? (
        <p className={styles.error} role="alert">
          {t('auth.securityFailed')}{' '}
          <button type="button" className={styles.link} onClick={() => setAttempt((n) => n + 1)}>
            {t('auth.securityRetry')}
          </button>
        </p>
      ) : null}
    </div>
  );
}
