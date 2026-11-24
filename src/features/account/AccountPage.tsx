// AC-01 … AC-03, AC-06 (language), AC-08: profile, language, change password, two-step verification, help and sign out.
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button } from '@/components/Button';
import { PasswordField } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { LanguageSelect } from '@/components/LanguageSelect';
import { Notice } from '@/components/Notice';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { ContactSheet } from '@/features/contact/LazyContactSheet';
import { MfaSetupSheet } from '@/features/mfa/MfaSetupSheet';
import { useAuth } from '@/app/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { gate } from '@/features/auth/gate';
import { replyText } from '@/features/auth/replyText';
import { changePasswordSchema, disableMfaSchema } from '@/features/auth/schemas';
import { PreferencesCard } from './PreferencesCard';
import { DataCard } from '@/features/csv/DataCard';
import { useAdminStatus } from '@/features/admin/useAdmin';
import { DeleteAccountCard, ReminderSettingsCard, ReportCard, TelegramCard } from './NotifyCards';
import { PasswordRules } from '@/features/auth/ui/PasswordRules';
import styles from './AccountPage.module.css';

export function AccountPage() {
  const { t } = useI18n();
  const { session, signOut } = useAuth();
  const [contactOpen, setContactOpen] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  // the Home screen's "connect Telegram" button lands on the Telegram card
  const wantTelegram = (location.state as { focus?: string } | null)?.focus === 'telegram';
  useEffect(() => {
    if (wantTelegram) document.getElementById('acc-tg')?.scrollIntoView({ block: 'center' });
  }, [wantTelegram]);
  const { isAdmin } = useAdminStatus();
  const user = session?.user;
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const name = typeof meta.username === 'string' ? meta.username : '';
  const provider = String((user?.app_metadata as Record<string, unknown> | undefined)?.provider ?? 'email');

  return (
    <div className={styles.page}>
      <h1 className={styles.h1}>{t('screen.account.title')}</h1>

      <section className={styles.card} aria-labelledby="acc-profile">
        <h2 id="acc-profile" className={styles.h2}>
          {t('account.profile')}
        </h2>
        <dl className={styles.facts}>
          <div>
            <dt>{t('account.name')}</dt>
            <dd>{name || '—'}</dd>
          </div>
          <div>
            <dt>{t('account.email')}</dt>
            <dd>{user?.email ?? '—'}</dd>
          </div>
          <div>
            <dt>{t('account.method')}</dt>
            <dd>{provider === 'google' ? t('account.method.google') : t('account.method.email')}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.card}>
        <LanguageSelect />
      </section>

      <PreferencesCard />
      {isAdmin ? (
        <section className={styles.card} aria-labelledby="acc-admin">
          <h2 id="acc-admin" className={styles.h2}>
            {t('admin.card')}
          </h2>
          <p className={styles.muted}>{t('admin.cardBody')}</p>
          <Button variant="outline" onClick={() => navigate('/app/admin')}>
            {t('admin.open')}
          </Button>
        </section>
      ) : null}

      <ReminderSettingsCard />
      <TelegramCard />
      <ReportCard />
      <DataCard />
      <SecurityCard />
      <PasswordCard />

      <section className={styles.card} aria-labelledby="acc-help">
        <h2 id="acc-help" className={styles.h2}>
          {t('account.help')}
        </h2>
        <p className={styles.muted}>{t('account.helpBody')}</p>
        <Button variant="outline" onClick={() => setContactOpen(true)}>
          <Icon name="mail" size={18} />
          {t('common.contactAdmin')}
        </Button>
      </section>

      <DeleteAccountCard />

      <section className={styles.card}>
        <Button variant="outline" onClick={() => setConfirmOut(true)}>
          <Icon name="logout" size={18} />
          {t('account.signOut')}
        </Button>
      </section>

      <ContactSheet open={contactOpen} onClose={() => setContactOpen(false)} />
      <Sheet open={confirmOut} onClose={() => setConfirmOut(false)} title={t('account.signOut')}>
        <div className={styles.stack}>
          <p className={styles.muted}>{t('account.signOutBody')}</p>
          <Button variant="danger" block onClick={() => void signOut()}>
            {t('account.signOut')}
          </Button>
          <Button variant="outline" block onClick={() => setConfirmOut(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

// ---- two-step verification (AC-03) ----
function SecurityCard() {
  const { t } = useI18n();
  const { client, session, refresh } = useAuth();
  const toast = useToast();
  const [state, setState] = useState<'loading' | 'on' | 'off' | 'error'>(client ? 'loading' : 'error');
  const [factorId, setFactorId] = useState('');
  const [setupOpen, setSetupOpen] = useState(false);
  const [codesOpen, setCodesOpen] = useState(false);
  const [codesAsk, setCodesAsk] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      const { data, error } = await client.auth.mfa.listFactors();
      if (error) return setState('error');
      const verified = data?.totp?.find((factor) => factor.status === 'verified');
      setFactorId(verified?.id ?? '');
      setState(verified ? 'on' : 'off');
    } catch {
      setState('error');
    }
  }, [client]);

  useEffect(() => {
    // Loading from the server once (the answer arrives after an await, never during the render)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const disable = async (password: string): Promise<string | null> => {
    const email = session?.user?.email ?? '';
    // The password is checked through the same door as sign-in, so wrong guesses are counted and limited
    const reply = await gate('signin', { email, password });
    if (!reply.ok) return reply.code === 'invalid' ? t('account.mfa.wrongPassword') : replyText(reply, t);
    const { error } = await client!.auth.mfa.unenroll({ factorId });
    if (error) return t('reply.generic');
    await refresh();
    await load();
    toast.show('success', t('account.mfa.disabled'));
    return null;
  };

  return (
    <section className={styles.card} aria-labelledby="acc-security">
      <h2 id="acc-security" className={styles.h2}>
        {t('account.security')}
      </h2>
      {state === 'loading' ? <p className={styles.muted}>{t('common.loading')}</p> : null}
      {state === 'error' ? (
        <Notice kind="warn">
          {t('error.network')}{' '}
          <button type="button" className={styles.link} onClick={() => { setState('loading'); void load(); }}>
            {t('common.retry')}
          </button>
        </Notice>
      ) : null}
      {state === 'on' || state === 'off' ? (
        <>
          <div className={styles.status}>
            <span className={`${styles.badge} ${state === 'on' ? styles.badgeOn : ''}`}>
              <Icon name={state === 'on' ? 'shield' : 'lock'} size={16} />
              {state === 'on' ? t('account.mfa.on') : t('account.mfa.off')}
            </span>
          </div>
          <p className={styles.muted}>{state === 'on' ? t('account.mfa.onHint') : t('account.mfa.offHint')}</p>
          <div className={styles.actions}>
            {state === 'off' ? (
              <Button onClick={() => setSetupOpen(true)}>{t('account.mfa.enable')}</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setCodesAsk(true)}>
                  {t('account.mfa.codes')}
                </Button>
                <Button variant="outline" onClick={() => setDisableOpen(true)}>
                  {t('account.mfa.disable')}
                </Button>
              </>
            )}
          </div>
        </>
      ) : null}

      <MfaSetupSheet
        open={setupOpen}
        onClose={() => {
          setSetupOpen(false);
          void load();
        }}
      />
      <Sheet open={codesAsk} onClose={() => setCodesAsk(false)} title={t('account.mfa.codes')}>
        <div className={styles.stack}>
          <Notice kind="warn">{t('account.mfa.codesWarning')}</Notice>
          <Button
            block
            onClick={() => {
              setCodesAsk(false);
              setCodesOpen(true);
            }}
          >
            {t('account.mfa.codes')}
          </Button>
        </div>
      </Sheet>
      <MfaSetupSheet open={codesOpen} mode="codes" onClose={() => setCodesOpen(false)} />
      <DisableSheet open={disableOpen} onClose={() => setDisableOpen(false)} onConfirm={disable} />
    </section>
  );
}

function DisableSheet({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: (password: string) => Promise<string | null> }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  type Values = z.infer<ReturnType<typeof disableMfaSchema>>;
  const { register, handleSubmit, formState, setError, reset } = useForm<Values>({ resolver: zodResolver(disableMfaSchema(t)), mode: 'onTouched', defaultValues: { password: '' } });
  useEffect(() => {
    if (open) reset({ password: '' });
  }, [open, reset]);
  const submit = handleSubmit(async ({ password }) => {
    setBusy(true);
    try {
      const problem = await onConfirm(password);
      if (problem) setError('password', { message: problem });
      else onClose();
    } finally {
      setBusy(false);
    }
  });
  return (
    <Sheet open={open} onClose={onClose} title={t('account.mfa.disable')}>
      <form onSubmit={submit} noValidate className={styles.stack}>
        <p className={styles.muted}>{t('account.mfa.disableBody')}</p>
        <PasswordField label={t('field.password')} data-autofocus error={formState.errors.password?.message} {...register('password')} />
        <Button type="submit" variant="danger" block loading={busy}>
          {t('account.mfa.disableConfirm')}
        </Button>
      </form>
    </Sheet>
  );
}

// ---- change password (AC-02) ----
function PasswordCard() {
  const { t } = useI18n();
  const { client, session } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  type Values = z.infer<ReturnType<typeof changePasswordSchema>>;
  const { register, handleSubmit, formState, setError, reset, control } = useForm<Values>({ resolver: zodResolver(changePasswordSchema(t)), mode: 'onTouched', defaultValues: { current: '', password: '', confirm: '' } });
  const next = useWatch({ control, name: 'password' });

  const submit = handleSubmit(async (values) => {
    setProblem('');
    if (!client) return;
    setBusy(true);
    try {
      // The current password is checked through the sign-in door, so wrong guesses are counted and limited
      const check = await gate('signin', { email: session?.user?.email ?? '', password: values.current });
      if (!check.ok) {
        if (check.code === 'invalid') return setError('current', { message: t('account.password.wrongCurrent') });
        return setProblem(replyText(check, t));
      }
      if (values.password === values.current) return setError('password', { message: t('setup.sameName') });
      const { error } = await client.auth.updateUser({ password: values.password });
      if (error) {
        if (/same|different/i.test(error.message)) return setError('password', { message: t('setup.sameName') });
        return setProblem(t('reply.generic'));
      }
      reset({ current: '', password: '', confirm: '' });
      toast.show('success', t('account.password.done'));
    } catch {
      setProblem(t('reply.generic'));
    } finally {
      setBusy(false);
    }
  });

  return (
    <section className={styles.card} aria-labelledby="acc-password">
      <h2 id="acc-password" className={styles.h2}>
        {t('account.password.title')}
      </h2>
      <form onSubmit={submit} noValidate className={styles.stack}>
        <PasswordField label={t('field.currentPassword')} error={formState.errors.current?.message} {...register('current')} />
        <PasswordField label={t('field.newPassword')} mode="new" error={formState.errors.password?.message} {...register('password')}>
          <PasswordRules value={next} started={Boolean(next) || formState.touchedFields.password === true} />
        </PasswordField>
        <PasswordField label={t('field.confirmPassword')} mode="new" error={formState.errors.confirm?.message} {...register('confirm')} />
        {problem ? <Notice kind="bad">{problem}</Notice> : null}
        <div className={styles.actions}>
          <Button type="submit" loading={busy}>
            {busy ? t('account.password.saving') : t('account.password.btn')}
          </Button>
        </div>
      </form>
    </section>
  );
}
