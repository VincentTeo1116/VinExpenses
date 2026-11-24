// AU-09: the code from the email plus a new strong password. Every device is signed out when it works.
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button } from '@/components/Button';
import { Field, PasswordField } from '@/components/Field';
import { useI18n } from '@/lib/i18n';
import { gate } from '../gate';
import { replyText } from '../replyText';
import { digitsOnly, formatCountdown } from '../rules';
import { resetSchema } from '../schemas';
import { PasswordRules } from '../ui/PasswordRules';
import { useCountdown } from '../ui/useCountdown';
import type { StepProps } from './types';
import styles from './steps.module.css';

interface Props extends Pick<StepProps, 'email' | 'go' | 'notice'> {
  codeUntil: number | null;
  onDone: () => void;
}

export function ResetStep({ email, go, notice, codeUntil, onDone }: Props) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const left = useCountdown(codeUntil);
  type Values = z.infer<ReturnType<typeof resetSchema>>;
  const { control, register, handleSubmit, formState, setError } = useForm<Values>({ resolver: zodResolver(resetSchema(t)), mode: 'onTouched', defaultValues: { code: '', password: '', confirm: '' } });
  const password = useWatch({ control, name: 'password' });

  const submit = handleSubmit(async (values) => {
    notice(null);
    setBusy(true);
    try {
      const reply = await gate('reset', { email, code: values.code, password: values.password });
      if (reply.ok) return onDone();
      const text = replyText(reply, t);
      if (reply.code === 'bad_code' || reply.code === 'slow_down') return setError('code', { message: text });
      if (reply.code === 'weak_password' || reply.code === 'same_password') return setError('password', { message: text });
      notice({ kind: 'bad', text });
    } finally {
      setBusy(false);
    }
  });

  const expired = codeUntil !== null && left === 0;
  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <p className={styles.lead}>{t('reset.sub', { email })}</p>
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
      <PasswordField label={t('field.newPassword')} mode="new" error={formState.errors.password?.message} {...register('password')}>
        <PasswordRules value={password} started={Boolean(password) || formState.touchedFields.password === true} />
      </PasswordField>
      <PasswordField label={t('field.confirmPassword')} mode="new" error={formState.errors.confirm?.message} {...register('confirm')} />
      <Button type="submit" block loading={busy}>
        {busy ? t('reset.saving') : t('reset.btn')}
      </Button>
      <button type="button" className={styles.link} onClick={() => go('forgot')}>
        {t('reset.newCode')}
      </button>
      <button type="button" className={styles.link} onClick={() => go('start')}>
        {t('forgot.back')}
      </button>
    </form>
  );
}
