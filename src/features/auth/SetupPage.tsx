// AU-10: a first-time Google sign-in chooses a name and a strong password, then is offered the optional authenticator.
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button } from '@/components/Button';
import { Field, PasswordField } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { useToast } from '@/components/Toast';
import { MfaSetupSheet } from '@/features/mfa/MfaSetupSheet';
import { useAuth } from '@/app/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { setupSchema } from './schemas';
import { AuthLayout } from './ui/AuthLayout';
import { PasswordRules } from './ui/PasswordRules';
import styles from './steps/steps.module.css';

export function SetupPage() {
  const { t } = useI18n();
  const { status, client, refresh, signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [stage, setStage] = useState<'form' | 'offer'>('form');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [mfaOpen, setMfaOpen] = useState(false);
  type Values = z.infer<ReturnType<typeof setupSchema>>;
  const { register, handleSubmit, formState, control, setError } = useForm<Values>({ resolver: zodResolver(setupSchema(t)), mode: 'onTouched', defaultValues: { name: '', password: '', confirm: '' } });
  const password = useWatch({ control, name: 'password' });

  if (status === 'loading') return <div className="sr-only" role="status">{t('common.loading')}</div>;
  if (status === 'signedOut') return <Navigate to="/auth" replace />;
  if (status === 'needsMfa') return <Navigate to="/auth" replace />;
  // Once the profile is saved the person is "signed in"; the offer step must still be shown, so it is kept by `stage`
  if (status === 'signedIn' && stage === 'form') return <Navigate to="/app" replace />;

  const finish = () => {
    toast.show('success', t('setup.ready'));
    navigate('/app', { replace: true });
  };

  const save = handleSubmit(async (values) => {
    if (!client) return;
    setProblem('');
    setBusy(true);
    try {
      const { error } = await client.auth.updateUser({ password: values.password, data: { username: values.name.trim(), setup_complete: true } });
      if (error) {
        if (/same|different/i.test(error.message)) return setError('password', { message: t('setup.sameName') });
        return setProblem(t('reply.generic'));
      }
      setStage('offer'); // set first, so the refresh below does not send the person straight to the app
      await refresh();
    } catch {
      setProblem(t('reply.generic'));
    } finally {
      setBusy(false);
    }
  });

  if (stage === 'offer') {
    return (
      <>
        <AuthLayout title={t('setup.offerTitle')}>
          <div className={styles.form}>
            <div className={styles.pauseIcon} aria-hidden="true">
              <Icon name="shield" size={28} />
            </div>
            <p className={styles.lead}>{t('setup.offerBody')}</p>
            <Button block onClick={() => setMfaOpen(true)}>
              {t('setup.offerStart')}
            </Button>
            <Button variant="outline" block onClick={finish}>
              {t('setup.offerSkip')}
            </Button>
          </div>
        </AuthLayout>
        <MfaSetupSheet
          open={mfaOpen}
          onClose={(enabled) => {
            setMfaOpen(false);
            if (enabled) finish();
          }}
        />
      </>
    );
  }

  return (
    <AuthLayout title={t('setup.title')} subtitle={t('setup.sub')}>
      {problem ? <Notice kind="bad">{problem}</Notice> : null}
      <form onSubmit={save} noValidate className={styles.form}>
        <Field label={t('field.name')} autoComplete="name" error={formState.errors.name?.message} {...register('name')} />
        <PasswordField label={t('field.password')} mode="new" error={formState.errors.password?.message} {...register('password')}>
          <PasswordRules value={password} started={Boolean(password) || formState.touchedFields.password === true} />
        </PasswordField>
        <PasswordField label={t('field.confirmPassword')} mode="new" error={formState.errors.confirm?.message} {...register('confirm')} />
        <Button type="submit" block loading={busy}>
          {busy ? t('setup.saving') : t('setup.btn')}
        </Button>
        <button type="button" className={styles.link} onClick={() => void signOut()}>
          {t('setup.signOut')}
        </button>
      </form>
    </AuthLayout>
  );
}
