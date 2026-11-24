// AU-06, AU-07, AU-08, AU-14: sign in with a password (no code), remember me, lockout handling.
import { useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button } from '@/components/Button';
import { Field, PasswordField } from '@/components/Field';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/app/AuthProvider';
import { gate } from '../gate';
import { setRemember } from '../device';
import { replyText } from '../replyText';
import { signInSchema } from '../schemas';
import { captchaEnabled, Turnstile, type TurnstileHandle } from '../ui/Turnstile';
import type { StepProps } from './types';
import { GoogleButton } from './GoogleButton';
import styles from './steps.module.css';

export function SignInForm({ email, setEmail, go, notice, onBlocked, onUnverified }: Pick<StepProps, 'email' | 'setEmail' | 'go' | 'notice'> & { onBlocked: (until: number | null, manual: boolean) => void; onUnverified: (email: string) => void }) {
  const { t } = useI18n();
  const { adopt } = useAuth();
  const captcha = useRef<TurnstileHandle>(null);
  const [busy, setBusy] = useState(false);
  type Values = z.infer<ReturnType<typeof signInSchema>>;
  const form = useForm<Values>({ resolver: zodResolver(signInSchema(t)), mode: 'onTouched', defaultValues: { email, password: '', remember: true } });
  const { register, handleSubmit, formState, setError } = form;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    void handleSubmit(async (values) => {
      notice(null);
      const address = values.email.trim().toLowerCase();
      if (captchaEnabled() && !captcha.current?.token()) return notice({ kind: 'bad', text: t('auth.securityFirst') });
      setBusy(true);
      try {
        const reply = await gate('signin', { email: address, password: values.password, captcha: captcha.current?.token() || undefined });
        captcha.current?.reset();
        if (!reply.ok) {
          if (reply.code === 'unconfirmed') return onUnverified(address);
          if (reply.code === 'blocked') return onBlocked(reply.until ? Date.parse(reply.until) : null, Boolean(reply.manual));
          if (reply.code === 'invalid') return setError('password', { message: replyText(reply, t) });
          return notice({ kind: 'bad', text: replyText(reply, t) });
        }
        setRemember(values.remember);
        if (!reply.session) return notice({ kind: 'bad', text: t('auth.sessionFailed') });
        const next = await adopt(reply.session);
        if (next === 'signedOut') notice({ kind: 'bad', text: t('auth.sessionFailed') });
        // Otherwise the page moves on by itself: to the app, the setup screen, or the authenticator step
      } finally {
        setBusy(false);
      }
    })(event);
  };

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <Field
        label={t('field.email')}
        type="email"
        icon="mail"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        error={formState.errors.email?.message}
        {...register('email', { onChange: (event) => setEmail(event.target.value) })}
      />
      <PasswordField label={t('field.password')} icon="lock" error={formState.errors.password?.message} {...register('password')} />
      <div className={styles.row}>
        <label className={styles.check}>
          <input type="checkbox" {...register('remember')} />
          <span>{t('auth.remember')}</span>
        </label>
        <button type="button" className={styles.link} onClick={() => go('forgot')}>
          {t('auth.forgot')}
        </button>
      </div>
      <Turnstile handle={captcha} />
      <Button type="submit" block loading={busy}>
        {busy ? t('auth.signingIn') : t('auth.signinBtn')}
      </Button>
      <GoogleButton notice={notice} />
    </form>
  );
}
