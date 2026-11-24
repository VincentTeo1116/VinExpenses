// AU-12: after the password, ask for the authenticator code. A lost phone can use a one-time recovery code instead,
// which also turns the authenticator off. The session stays "half signed in" (aal1) until the code is right.
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button } from '@/components/Button';
import { Field, PasswordField } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/app/AuthProvider';
import { gate } from '../gate';
import { replyText } from '../replyText';
import { digitsOnly } from '../rules';
import { mfaCodeSchema, mfaRecoverySchema } from '../schemas';
import type { NoticeState } from './types';
import styles from './steps.module.css';

export function MfaStep({ notice, onBlocked }: { notice: (state: NoticeState) => void; onBlocked: (until: number | null, manual: boolean) => void }) {
  const { t } = useI18n();
  const { client, session, refresh, adopt, signOut } = useAuth();
  const toast = useToast();
  const [recovery, setRecovery] = useState(false);
  return (
    <div className={styles.form}>
      <p className={styles.lead}>{recovery ? t('mfa.recoverySub') : t('mfa.sub')}</p>
      {recovery ? (
        <RecoveryForm email={session?.user?.email ?? ''} notice={notice} onBlocked={onBlocked} adopt={adopt} onDone={() => toast.show('info', t('mfa.turnedOff'))} />
      ) : (
        <AppCodeForm client={client} refresh={refresh} notice={notice} />
      )}
      <button type="button" className={styles.link} onClick={() => { notice(null); setRecovery((value) => !value); }}>
        {recovery ? t('mfa.useApp') : t('mfa.lost')}
      </button>
      <button type="button" className={styles.link} onClick={() => void signOut()}>
        {t('mfa.cancel')}
      </button>
    </div>
  );
}

function AppCodeForm({ client, refresh, notice }: { client: ReturnType<typeof useAuth>['client']; refresh: () => Promise<unknown>; notice: (state: NoticeState) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  type Values = z.infer<ReturnType<typeof mfaCodeSchema>>;
  const { control, handleSubmit, setError, setValue, formState } = useForm<Values>({ resolver: zodResolver(mfaCodeSchema(t)), mode: 'onTouched', defaultValues: { code: '' } });

  const submit = handleSubmit(async ({ code }) => {
    notice(null);
    if (!client) return;
    setBusy(true);
    try {
      const factors = await client.auth.mfa.listFactors();
      const factor = factors.data?.totp?.find((item) => item.status === 'verified');
      if (!factor) return notice({ kind: 'bad', text: t('reply.generic') });
      const challenge = await client.auth.mfa.challenge({ factorId: factor.id });
      if (challenge.error || !challenge.data) return notice({ kind: 'bad', text: t('mfaSetup.challengeFailed') });
      const verified = await client.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.data.id, code });
      if (verified.error) {
        setValue('code', '');
        return setError('code', { message: t('mfa.wrongCode') });
      }
      await refresh(); // the page moves on by itself once the session is aal2
    } catch {
      notice({ kind: 'bad', text: t('reply.generic') });
    } finally {
      setBusy(false);
    }
  });

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
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
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the only thing to do on this step is to type the code
            autoFocus
            error={formState.errors.code?.message}
            value={field.value}
            onChange={(event) => field.onChange(digitsOnly(event.target.value))}
            onBlur={field.onBlur}
            ref={field.ref}
          />
        )}
      />
      <Button type="submit" block loading={busy}>
        {t('mfa.verify')}
      </Button>
    </form>
  );
}

function RecoveryForm({ email, notice, onBlocked, adopt, onDone }: { email: string; notice: (state: NoticeState) => void; onBlocked: (until: number | null, manual: boolean) => void; adopt: ReturnType<typeof useAuth>['adopt']; onDone: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  type Values = z.infer<ReturnType<typeof mfaRecoverySchema>>;
  const { register, handleSubmit, setError, formState } = useForm<Values>({ resolver: zodResolver(mfaRecoverySchema(t)), mode: 'onTouched', defaultValues: { code: '', password: '' } });

  const submit = handleSubmit(async (values) => {
    notice(null);
    setBusy(true);
    try {
      const reply = await gate('mfa_recover', { email, password: values.password, code: values.code });
      if (!reply.ok) {
        if (reply.code === 'blocked') return onBlocked(reply.until ? Date.parse(reply.until) : null, Boolean(reply.manual));
        if (reply.code === 'invalid') return setError('code', { message: replyText(reply, t, 'recovery') });
        return notice({ kind: 'bad', text: replyText(reply, t) });
      }
      if (!reply.session) return notice({ kind: 'bad', text: t('auth.sessionFailed') });
      await adopt(reply.session);
      onDone();
    } finally {
      setBusy(false);
    }
  });

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <Field label={t('mfa.recoveryCode')} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="ABCDE-FGHJK" error={formState.errors.code?.message} {...register('code')} />
      <PasswordField label={t('field.password')} error={formState.errors.password?.message} {...register('password')} />
      <Button type="submit" block loading={busy}>
        {t('mfa.verify')}
      </Button>
    </form>
  );
}
