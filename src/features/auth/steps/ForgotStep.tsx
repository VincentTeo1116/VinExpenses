// AU-09: ask for a code to reset the password. The answer is the same whether or not the address has an account.
import { useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { useI18n } from '@/lib/i18n';
import { gate } from '../gate';
import { isCodeLimit, replyText } from '../replyText';
import { forgotSchema } from '../schemas';
import { captchaEnabled, Turnstile, type TurnstileHandle } from '../ui/Turnstile';
import type { StepProps } from './types';
import styles from './steps.module.css';

export function ForgotStep({ email, setEmail, go, notice, openContact, onCodeSent }: Pick<StepProps, 'email' | 'setEmail' | 'go' | 'notice' | 'openContact'> & { onCodeSent: (email: string, minutes: number) => void }) {
  const { t } = useI18n();
  const captcha = useRef<TurnstileHandle>(null);
  const [busy, setBusy] = useState(false);
  type Values = z.infer<ReturnType<typeof forgotSchema>>;
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(forgotSchema(t)), mode: 'onTouched', defaultValues: { email } });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    void handleSubmit(async (values) => {
      notice(null);
      const address = values.email.trim().toLowerCase();
      if (captchaEnabled() && !captcha.current?.token()) return notice({ kind: 'bad', text: t('auth.securityFirst') });
      setBusy(true);
      try {
        const reply = await gate('recover', { email: address, captcha: captcha.current?.token() || undefined });
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
        onCodeSent(address, reply.minutes ?? 5);
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
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        error={formState.errors.email?.message}
        {...register('email', { onChange: (event) => setEmail(event.target.value) })}
      />
      <Turnstile handle={captcha} />
      <Button type="submit" block loading={busy}>
        {busy ? t('forgot.sending') : t('forgot.btn')}
      </Button>
      <button type="button" className={styles.link} onClick={() => go('start')}>
        {t('forgot.back')}
      </button>
    </form>
  );
}
