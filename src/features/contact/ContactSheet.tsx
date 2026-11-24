// PU-01: the contact form. It works for people who cannot sign in, so it uses limits and the security check instead of a login.
import { useRef, useState, type FormEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/Button';
import { Field, SelectField, TextAreaField } from '@/components/Field';
import { Notice } from '@/components/Notice';
import { Sheet } from '@/components/Sheet';
import { ApiError, callFunction } from '@/lib/api';
import { envResult } from '@/lib/env';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/app/AuthProvider';
import { contactSchema, TOPICS, type Topic } from '@/features/auth/schemas';
import { captchaEnabled, Turnstile, type TurnstileHandle } from '@/features/auth/ui/Turnstile';
import styles from './ContactSheet.module.css';

const replySchema = z.object({ ok: z.boolean(), message: z.string().optional(), field: z.string().optional() }).passthrough();

interface Props {
  open: boolean;
  onClose: () => void;
  topic?: Topic | undefined;
  /** The person's own address when signed in: the form then does not ask for it, and the server trusts the sign-in instead. */
  defaultEmail?: string | undefined;
}

/** The body is only mounted while the sheet is open, so every opening starts with an empty form and the suggested topic. */
export function ContactSheet(props: Props) {
  return props.open ? <ContactBody {...props} /> : null;
}

function ContactBody({ open, onClose, topic, defaultEmail }: Props) {
  const { t } = useI18n();
  const { session } = useAuth();
  const signedInEmail = session?.user?.email ?? '';
  const signedIn = Boolean(signedInEmail);
  const captcha = useRef<TurnstileHandle>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  type Values = { email: string; topic: string; message: string };
  const { register, handleSubmit, formState, setError, control } = useForm<Values>({
    resolver: zodResolver(contactSchema(t, signedIn)),
    mode: 'onTouched',
    defaultValues: { email: defaultEmail ?? '', topic: topic ?? '', message: '' },
  });

  const message = useWatch({ control, name: 'message' }) ?? '';

  const submit = (event: FormEvent<HTMLFormElement>) => {
    void handleSubmit(async (values) => {
      setProblem('');
      if (!envResult.ok) return setProblem(t('contact.failed'));
      if (captchaEnabled() && !captcha.current?.token()) return setProblem(t('auth.securityFirst'));
      setBusy(true);
      try {
        const reply = await callFunction(
          'feedback',
          { email: signedIn ? undefined : values.email.trim().toLowerCase(), topic: values.topic, message: values.message.trim(), captcha: captcha.current?.token() || undefined },
          { baseUrl: envResult.env.supabaseUrl, anonKey: envResult.env.supabaseAnonKey, accessToken: session?.access_token, schema: replySchema, timeoutMs: 20_000 },
        );
        captcha.current?.reset();
        if (reply.ok) return setSent(reply.message ?? t('contact.sent'));
        const text = reply.message ?? t('contact.failed');
        if (reply.field === 'email' || reply.field === 'topic' || reply.field === 'message') return setError(reply.field, { message: text });
        setProblem(text);
      } catch (error) {
        setProblem(error instanceof ApiError && error.code === 'offline' ? t('reply.offline') : t('contact.failed'));
      } finally {
        setBusy(false);
      }
    })(event);
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('contact.title')}>
      {sent ? (
        <div className={styles.done}>
          <Notice kind="good">{t('contact.sent')}</Notice>
          <Button block onClick={onClose}>
            {t('contact.again')}
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className={styles.form}>
          <p className={styles.sub}>{t('contact.sub')}</p>
          {signedIn ? null : <Field label={t('contact.email')} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" error={formState.errors.email?.message} {...register('email')} />}
          <SelectField label={t('contact.topic')} error={formState.errors.topic?.message} {...register('topic')}>
            <option value="">{t('contact.topic.choose')}</option>
            {TOPICS.map((key) => (
              <option key={key} value={key}>
                {t(`contact.topic.${key}` as const)}
              </option>
            ))}
          </SelectField>
          <TextAreaField label={t('contact.message')} maxLength={2400} hint={t('contact.count', { n: message.length })} error={formState.errors.message?.message} {...register('message')} />
          <Turnstile handle={captcha} />
          {problem ? <Notice kind="bad">{problem}</Notice> : null}
          <Button type="submit" block loading={busy}>
            {busy ? t('contact.sending') : t('contact.send')}
          </Button>
        </form>
      )}
    </Sheet>
  );
}
