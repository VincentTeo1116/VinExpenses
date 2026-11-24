// AC-04 (Telegram), AC-05 (monthly report), AC-06 (reminder settings), AC-07 (delete account). The server decides everything that
// matters (who may link, what is sent, what is erased); these cards only ask and show what it answers.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useAuth } from '@/app/AuthProvider';
import { Button } from '@/components/Button';
import { Field, SelectField } from '@/components/Field';
import { Notice } from '@/components/Notice';
import { useToast } from '@/components/Toast';
import { ApiError } from '@/lib/api';
import { useI18n, type Lang } from '@/lib/i18n';
import { formatDate } from '@/lib/dates';
import { clearQueue } from '@/features/money/offlineQueue';
import { useMoney } from '@/features/money/MoneyContext';
import { ContactSheet } from '@/features/contact/LazyContactSheet';
import { useServer } from './useServer';
import { useTelegramStatus, type TelegramStatus } from './useTelegram';
import styles from './NotifyCards.module.css';

const EMAIL = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const LOCALES: Record<Lang, string> = { en: 'en-MY', ms: 'ms-MY', zh: 'zh-CN' };

export function TelegramCard() {
  const { t } = useI18n();
  const toast = useToast();
  const { session } = useAuth();
  const server = useServer();
  const queryClient = useQueryClient();
  const userId = session?.user?.id ?? '';
  const { status, failed, refetch } = useTelegramStatus();
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<'create' | 'unlink' | ''>('');
  const [problem, setProblem] = useState('');

  const connect = async () => {
    if (!navigator.onLine) return setProblem(t('tg.offline'));
    setBusy('create');
    setProblem('');
    try {
      const reply = await server<{ link?: string }>('telegram-link', { action: 'create' });
      // only ever open a genuine t.me start link with a well-formed code
      if (!/^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}\?start=[A-Z2-9]{10}$/.test(String(reply.link))) throw new Error('bad link');
      setLink(String(reply.link));
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : t('tg.badLink'));
    } finally {
      setBusy('');
    }
  };
  const unlink = async () => {
    if (!navigator.onLine) return setProblem(t('tg.offline'));
    setBusy('unlink');
    setProblem('');
    try {
      const reply = await server<TelegramStatus>('telegram-link', { action: 'unlink' });
      queryClient.setQueryData(['telegram', userId], { linked: Boolean(reply.linked) });
      setLink('');
      toast.show('success', t('tg.unlinked'));
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : t('tg.unavailable'));
    } finally {
      setBusy('');
    }
  };

  return (
    <section className={styles.card} aria-labelledby="acc-tg">
      <h2 id="acc-tg" className={styles.h2}>
        {t('tg.title')}
      </h2>
      <p className={styles.muted}>{t('tg.sub')}</p>
      <p data-testid="tg-status" role="status">
        {status === null ? (failed ? t('tg.unavailable') : '…') : status.linked ? t('tg.on') : t('tg.off')}
      </p>
      {status?.linked && status.remindersBlocked ? <Notice kind="warn">{t('tg.blocked')}</Notice> : null}
      {link ? (
        <div className={styles.stack}>
          <p className={styles.muted}>{t('tg.created')}</p>
          <div className={styles.actions}>
            <a className={styles.linkButton} href={link} target="_blank" rel="noopener noreferrer">
              {t('tg.open')}
            </a>
            <Button variant="outline" onClick={() => void refetch()}>
              {t('tg.check')}
            </Button>
          </div>
        </div>
      ) : null}
      {problem ? <Notice kind="bad">{problem}</Notice> : null}
      <div className={styles.actions}>
        {status && !status.linked && !link ? (
          <Button loading={busy === 'create'} onClick={() => void connect()}>
            {t('tg.connect')}
          </Button>
        ) : null}
        {status?.linked ? (
          <Button variant="outline" loading={busy === 'unlink'} onClick={() => void unlink()}>
            {t('tg.unlink')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

interface ReportPref {
  enabled: boolean;
  channel: 'auto' | 'email';
  recipient_email: string | null;
  verified_email: string | null;
  last_status: 'sent' | 'failed' | null;
  last_channel: 'telegram' | 'email' | null;
  last_month: string | null;
  last_attempt_at: string | null;
  resend_count: number | null;
}

export function ReportCard() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { client, session } = useAuth();
  const server = useServer();
  const queryClient = useQueryClient();
  const { data: money } = useMoney();
  const { status: telegram } = useTelegramStatus();
  const userId = session?.user?.id ?? '';
  const c = client as SupabaseClient;
  const key = ['report-pref', userId];
  const pref = useQuery({
    queryKey: key,
    enabled: Boolean(userId && client),
    queryFn: async (): Promise<ReportPref | null> => {
      const { data, error } = await c.from('monthly_report_preferences').select('*').eq('user_id', userId).maybeSingle();
      if (error) return null;
      return (data as ReportPref | null) ?? null;
    },
  });
  const saved = pref.data ?? null;
  const [edits, setEdits] = useState<{ enabled?: boolean; channel?: 'auto' | 'email'; email?: string }>({});
  const enabled = edits.enabled ?? saved?.enabled ?? false;
  const channel = edits.channel ?? saved?.channel ?? 'auto';
  const email = edits.email ?? saved?.recipient_email ?? session?.user?.email ?? '';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'save' | 'verify' | 'resend' | ''>('');
  const pendingKey = `et_report_pending_${userId}`;
  const [pendingUntil, setPendingUntil] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(pendingKey) ?? 0);
    } catch {
      return 0;
    }
  });
  const [openedAt] = useState(() => Date.now());
  const waiting = pendingUntil > openedAt;

  const linked = telegram?.linked === true;
  const needsEmail = channel === 'email' || !linked;
  const verified = Boolean(saved?.verified_email && String(saved.recipient_email ?? '').trim().toLowerCase() === saved.verified_email);
  const hint = channel === 'email' ? t('rep.hint.email') : linked ? t('rep.hint.linked') : telegram ? t('rep.hint.unlinked') : t('rep.hint.unknown');

  const save = async () => {
    const trimmed = email.trim();
    if (enabled && ((needsEmail && !EMAIL.test(trimmed)) || (trimmed && !EMAIL.test(trimmed)))) {
      setError(t('rep.emailBad'));
      return;
    }
    setError('');
    setBusy('save');
    const { data, error: failure } = await c.from('monthly_report_preferences').upsert({ user_id: userId, recipient_email: trimmed ? trimmed.toLowerCase() : null, enabled, channel }, { onConflict: 'user_id' }).select('*').single();
    setBusy('');
    if (failure) return setError(t('save.failed'));
    queryClient.setQueryData(key, data as ReportPref);
    setEdits({});
    toast.show('success', t('rep.saved'));
  };

  const confirmEmail = async () => {
    setBusy('verify');
    try {
      const reply = await server<{ status?: string }>('email-verify', {});
      toast.show('success', reply.status === 'verified' ? t('rep.alreadyConfirmed') : t('rep.confirmSent'));
      await pref.refetch();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : t('save.failed'));
    } finally {
      setBusy('');
    }
  };

  const resend = async () => {
    if (!navigator.onLine) return toast.show('error', t('save.offline'));
    setBusy('resend');
    try {
      const reply = await server<{ ok?: boolean; message?: string }>('report-resend', {});
      if (reply.ok) {
        const until = Date.now() + 15 * 60_000;
        setPendingUntil(until);
        try {
          localStorage.setItem(pendingKey, String(until));
        } catch {
          /* optional */
        }
        toast.show('success', t('rep.resendOk'));
      } else toast.show('error', reply.message || t('rep.resendFail'));
      await pref.refetch();
    } catch (failure) {
      toast.show('error', failure instanceof ApiError ? failure.message : t('rep.resendFail'));
    } finally {
      setBusy('');
    }
  };

  const left = Math.max(0, 2 - Number(saved?.resend_count ?? 0));
  const month = saved?.last_month ? new Intl.DateTimeFormat(LOCALES[lang], { month: 'long', year: 'numeric' }).format(new Date(`${String(saved.last_month).slice(0, 7)}-01T12:00:00`)) : t('rep.lastMonth');
  const how = saved?.last_channel === 'telegram' ? t('rep.how.telegram') : t('rep.how.email');
  const [contactOpen, setContactOpen] = useState(false);

  return (
    <section className={styles.card} aria-labelledby="acc-report">
      <h2 id="acc-report" className={styles.h2}>
        {t('rep.title')}
      </h2>
      <p className={styles.muted}>{t('rep.sub')}</p>
      <label className={styles.check}>
        <input className="animated-switch" type="checkbox" role="switch" checked={enabled} onChange={(event) => setEdits((e) => ({ ...e, enabled: event.target.checked }))} />
        {t('rep.on')}
      </label>
      <div className={styles.seg} role="group" aria-label={t('rep.channel')}>
        {(['auto', 'email'] as const).map((value) => (
          <button key={value} type="button" aria-pressed={channel === value} onClick={() => setEdits((e) => ({ ...e, channel: value }))}>
            {t(value === 'auto' ? 'rep.auto' : 'rep.email')}
          </button>
        ))}
      </div>
      <p className={styles.muted}>{hint}</p>
      <Field label={needsEmail ? t('rep.address') : t('rep.addressBackup')} type="email" autoComplete="email" value={email} onChange={(event) => setEdits((e) => ({ ...e, email: event.target.value }))} error={error || undefined} />
      {saved ? (
        <p className={verified ? styles.good : styles.warnText} data-testid="report-verified">
          {verified ? t('rep.confirmed') : t('rep.unconfirmed')}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button loading={busy === 'save'} onClick={() => void save()}>
          {t('rep.save')}
        </Button>
        {saved && !verified ? (
          <Button variant="outline" loading={busy === 'verify'} onClick={() => void confirmEmail()}>
            {t('rep.sendConfirm')}
          </Button>
        ) : null}
      </div>

      {saved?.enabled && waiting ? (
        <Notice kind="info">{t('rep.pending')}</Notice>
      ) : saved?.enabled && saved.last_status === 'failed' ? (
        <div className={styles.stack} data-testid="report-last">
          <Notice kind="bad">{t('rep.failed', { month })}</Notice>
          {left > 0 ? (
            <Button variant="outline" loading={busy === 'resend'} onClick={() => void resend()}>
              {t('rep.again', { n: left })}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setContactOpen(true)}>
              {t('rep.contact')}
            </Button>
          )}
        </div>
      ) : saved?.enabled && saved.last_status === 'sent' ? (
        <div className={styles.stack} data-testid="report-last">
          <Notice kind="good">
            {t('rep.sent', { month, how })}
            {saved.last_attempt_at ? ` ${formatDate(saved.last_attempt_at.slice(0, 10), money.dateFormat)}` : ''}
          </Notice>
          {left > 0 ? (
            <Button variant="ghost" loading={busy === 'resend'} onClick={() => void resend()}>
              {t('rep.againSent')}
              {left < 2 ? ` (${left})` : ''}
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setContactOpen(true)}>
              {t('rep.contact')}
            </Button>
          )}
        </div>
      ) : null}
      <ContactSheet open={contactOpen} onClose={() => setContactOpen(false)} />
    </section>
  );
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export function ReminderSettingsCard() {
  const { t } = useI18n();
  const toast = useToast();
  const { client, session } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user?.id ?? '';
  const c = client as SupabaseClient;
  const key = ['reminder-settings', userId];
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(userId && client),
    queryFn: async () => {
      const { data } = await c.from('user_preferences').select('reminder_hour, reminder_popup, reminder_hide_amounts').eq('user_id', userId).maybeSingle();
      const row = (data ?? {}) as { reminder_hour?: number; reminder_popup?: string; reminder_hide_amounts?: boolean };
      return { hour: Number.isInteger(row.reminder_hour) ? (row.reminder_hour as number) : 9, popup: ['auto', 'always', 'never'].includes(String(row.reminder_popup)) ? (row.reminder_popup as 'auto' | 'always' | 'never') : 'auto', hide: Boolean(row.reminder_hide_amounts) };
    },
  });
  const [edits, setEdits] = useState<{ hour?: number; popup?: 'auto' | 'always' | 'never'; hide?: boolean }>({});
  const [busy, setBusy] = useState(false);
  const hour = edits.hour ?? query.data?.hour ?? 9;
  const popup = edits.popup ?? query.data?.popup ?? 'auto';
  const hide = edits.hide ?? query.data?.hide ?? false;

  const save = async () => {
    setBusy(true);
    const { error } = await c.from('user_preferences').upsert({ user_id: userId, reminder_hour: hour, reminder_popup: popup, reminder_hide_amounts: hide }, { onConflict: 'user_id' });
    setBusy(false);
    if (error) return toast.show('error', t('save.failed'));
    queryClient.setQueryData(key, { hour, popup, hide });
    void queryClient.invalidateQueries({ queryKey: ['reminder-prefs', userId] });
    setEdits({});
    toast.show('success', t('remset.saved'));
  };

  return (
    <section className={styles.card} aria-labelledby="acc-rem">
      <h2 id="acc-rem" className={styles.h2}>
        {t('remset.title')}
      </h2>
      <p className={styles.muted}>{t('remset.sub')}</p>
      <div className={styles.two}>
        <SelectField label={t('remset.hour')} value={String(hour)} onChange={(event) => setEdits((e) => ({ ...e, hour: Number(event.target.value) }))}>
          {HOURS.map((h) => (
            <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>
          ))}
        </SelectField>
        <SelectField label={t('remset.popup')} value={popup} onChange={(event) => setEdits((e) => ({ ...e, popup: event.target.value as 'auto' | 'always' | 'never' }))}>
          <option value="auto">{t('remset.popup.auto')}</option>
          <option value="always">{t('remset.popup.always')}</option>
          <option value="never">{t('remset.popup.never')}</option>
        </SelectField>
      </div>
      <label className={styles.check}>
        <input type="checkbox" checked={hide} onChange={(event) => setEdits((e) => ({ ...e, hide: event.target.checked }))} />
        {t('remset.hide')}
      </label>
      <div className={styles.actions}>
        <Button loading={busy} onClick={() => void save()}>
          {t('remset.save')}
        </Button>
      </div>
    </section>
  );
}

export function DeleteAccountCard() {
  const { t } = useI18n();
  const toast = useToast();
  const { session, signOut } = useAuth();
  const server = useServer();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const userId = session?.user?.id ?? '';

  const remove = async () => {
    if (typed.trim() !== 'DELETE') return;
    if (!navigator.onLine) return setProblem(t('del.offline'));
    setBusy(true);
    setProblem('');
    try {
      await server('delete-account', {}, 30_000);
      clearQueue(userId); // anything still waiting on this device belonged to the deleted account
      try {
        localStorage.removeItem(`et_report_pending_${userId}`);
      } catch {
        /* storage may be blocked */
      }
      toast.show('success', t('del.done'));
      await signOut();
    } catch (error) {
      setProblem(error instanceof ApiError && error.code !== 'offline' ? error.message : t('del.failed'));
      setBusy(false);
    }
  };

  return (
    <section className={`${styles.card} ${styles.danger}`} aria-labelledby="acc-del">
      <h2 id="acc-del" className={styles.h2}>
        {t('del.title')}
      </h2>
      <p className={styles.muted}>{t('del.warn')}</p>
      <Field label={t('del.type')} autoComplete="off" autoCapitalize="characters" value={typed} onChange={(event) => setTyped(event.target.value)} />
      {problem ? <Notice kind="bad">{problem}</Notice> : null}
      <div className={styles.actions}>
        <Button variant="danger" disabled={typed.trim() !== 'DELETE'} loading={busy} onClick={() => void remove()}>
          {busy ? t('del.working') : t('del.button')}
        </Button>
      </div>
    </section>
  );
}
