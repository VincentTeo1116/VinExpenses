// AU-01, AU-02, AU-03: confirm the address with the 6-digit code (valid 5 minutes), and ask for a new one if needed.
import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/app/AuthProvider';
import { gate } from '../gate';
import { setRemember } from '../device';
import { isCodeLimit, replyText } from '../replyText';
import { digitsOnly, formatCountdown } from '../rules';
import { verifySchema } from '../schemas';
import { captchaEnabled, Turnstile, type TurnstileHandle } from '../ui/Turnstile';
import { useCountdown } from '../ui/useCountdown';
import type { StepProps } from './types';
import styles from './steps.module.css';

interface Props extends Pick<StepProps, 'email' | 'go' | 'notice' | 'openContact'> {
  codeUntil: number | null;
  onNewCode: (minutes: number) => void;
}

export function VerifyStep({ email, go, notice, openContact, codeUntil, onNewCode }: Props) {
  const { t } = useI18n();
  const { adopt } = useAuth();
  const toast = useToast();
  const captcha = useRef<TurnstileHandle>(null);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const left = useCountdown(codeUntil);
  type Values = z.infer<ReturnType<typeof verifySchema>>;
  const { control, handleSubmit, setError, setValue, formState } = useForm<Values>({ resolver: zodResolver(verifySchema(t)), mode: 'onTouched', defaultValues: { code: '' } });

  const submit = handleSubmit(async ({ code }) => {
    notice(null);
    setBusy(true);
    try {
      const reply = await gate('signup_verify', { email, code });
      if (!reply.ok) return setError('code', { message: replyText(reply, t) });
      if (!reply.session) return notice({ kind: 'bad', text: t('auth.sessionFailed') });
      setRemember(true);
      const next = await adopt(reply.session);
      if (next === 'signedOut') notice({ kind: 'bad', text: t('auth.sessionFailed') });
    } finally {
      setBusy(false);
    }
  });

  const resend = async () => {
    notice(null);
    if (captchaEnabled() && !captcha.current?.token()) return notice({ kind: 'bad', text: t('auth.securityFirst') });
    setResending(true);
    try {
      const reply = await gate('signup_resend', { email, captcha: captcha.current?.token() || undefined });
      captcha.current?.reset();
      if (!reply.ok) {
        return notice({
          kind: 'bad',
          text: isCodeLimit(reply) ? (
            <>
              {replyText(reply, t)}{' '}
              <button type="button" className={styles.inlineLink} onClick={() => openContact('code_limit')}>
                {t('common.contactAdmin')}
              </button>
            </>
          ) : (
            replyText(reply, t)
          ),
        });
      }
      setValue('code', '');
      onNewCode(reply.minutes ?? 5);
      toast.show('success', t('verify.resent'));
    } finally {
      setResending(false);
    }
  };

  const expired = codeUntil !== null && left === 0;
  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <p className={styles.lead}>{t('verify.sub', { email })}</p>
      <Controller
        name="code"
        control={control}
        render={({ field }) => (
          <Field
            label={t('field.code')}
            inputMode="numeric"
            autoComplete="one-time-code"
            className={styles.codeField}
            placeholder="123456"
            error={formState.errors.code?.message}
            value={field.value}
            onChange={(event) => field.onChange(digitsOnly(event.target.value))}
            onBlur={field.onBlur}
            ref={field.ref}
          />
        )}
      />
      <p className={`${styles.timer} ${expired ? styles.timerExpired : ''}`} role="timer" aria-live="off">
        {codeUntil === null ? '' : expired ? t('verify.expired') : t('verify.timer', { time: formatCountdown(left) })}
      </p>
      <Turnstile handle={captcha} />
      <Button type="submit" block loading={busy}>
        {busy ? t('verify.checking') : t('verify.btn')}
      </Button>
      <Button variant="outline" block loading={resending} onClick={() => void resend()}>
        {t('verify.resend')}
      </Button>
      <button type="button" className={styles.link} onClick={() => go('start')}>
        {t('verify.otherEmail')}
      </button>
    </form>
  );
}
