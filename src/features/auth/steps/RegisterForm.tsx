// AU-01, AU-03, AU-04, AU-05: register with a strong password (live rules) and confirm the address with a code.
import { useRef, useState, type FormEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button } from '@/components/Button';
import { Field, PasswordField } from '@/components/Field';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/app/AuthProvider';
import { gate } from '../gate';
import { setRemember } from '../device';
import { isCodeLimit, replyText } from '../replyText';
import { registerSchema } from '../schemas';
import { PasswordRules } from '../ui/PasswordRules';
import { captchaEnabled, Turnstile, type TurnstileHandle } from '../ui/Turnstile';
import type { StepProps } from './types';
import { GoogleButton } from './GoogleButton';
import styles from './steps.module.css';

export function RegisterForm({ email, setEmail, notice, openContact, onCodeSent, onExists }: Pick<StepProps, 'email' | 'setEmail' | 'notice' | 'openContact'> & { onCodeSent: (email: string, minutes: number) => void; onExists: (email: string) => void }) {
  const { t } = useI18n();
  const { adopt } = useAuth();
  const captcha = useRef<TurnstileHandle>(null);
  const [busy, setBusy] = useState(false);
  type Values = z.infer<ReturnType<typeof registerSchema>>;
  const form = useForm<Values>({ resolver: zodResolver(registerSchema(t)), mode: 'onTouched', defaultValues: { name: '', email, password: '', confirm: '' } });
  const { register, handleSubmit, formState, control } = form;
  const password = useWatch({ control, name: 'password' });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    void handleSubmit(async (values) => {
      notice(null);
      const address = values.email.trim().toLowerCase();
      if (captchaEnabled() && !captcha.current?.token()) return notice({ kind: 'bad', text: t('auth.securityFirst') });
      setBusy(true);
      try {
        const reply = await gate('signup', { email: address, name: values.name.trim(), password: values.password, captcha: captcha.current?.token() || undefined });
        captcha.current?.reset();
        if (!reply.ok) {
          if (reply.code === 'exists') return onExists(address); // AU-05: no code is spent; go and sign in
          if (isCodeLimit(reply)) {
            return notice({
              kind: 'bad',
              text: (
                <>
                  {replyText(reply, t)}{' '}
                  <button type="button" className={styles.inlineLink} onClick={() => openContact('code_limit')}>
                    {t('common.contactAdmin')}
                  </button>
                </>
              ),
            });
          }
          return notice({ kind: 'bad', text: replyText(reply, t) });
        }
        if (reply.step === 'done' && reply.session) {
          // Email confirmation is switched off in this project: the person is already signed in
          setRemember(true);
          await adopt(reply.session);
          return;
        }
        onCodeSent(address, reply.minutes ?? 5);
      } finally {
        setBusy(false);
      }
    })(event);
  };

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <Field label={t('field.name')} autoComplete="name" error={formState.errors.name?.message} {...register('name')} />
      <Field
        label={t('field.email')}
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        error={formState.errors.email?.message}
        {...register('email', { onChange: (event) => setEmail(event.target.value) })}
      />
      <PasswordField label={t('field.password')} mode="new" error={formState.errors.password?.message} {...register('password')}>
        <PasswordRules value={password} started={Boolean(password) || formState.touchedFields.password === true} />
      </PasswordField>
      <PasswordField label={t('field.confirmPassword')} mode="new" error={formState.errors.confirm?.message} {...register('confirm')} />
      <Turnstile handle={captcha} />
      <Button type="submit" block loading={busy}>
        {busy ? t('auth.creating') : t('auth.registerBtn')}
      </Button>
      <p className={styles.note}>{t('auth.codeNote')}</p>
      <GoogleButton notice={notice} />
    </form>
  );
}
