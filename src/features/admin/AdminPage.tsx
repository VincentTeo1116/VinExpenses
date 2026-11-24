// AD-01 … AD-07: manage accounts, read messages, check the service. It only ever asks the `admin` server function, which checks
// the role again on every call; this page never reads anyone's expenses, income, budgets or reports.
import { useCallback, useEffect, useId, useState } from 'react';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Field, SelectField } from '@/components/Field';
import { Notice } from '@/components/Notice';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { ApiError } from '@/lib/api';
import { useI18n, type Lang, type MessageKey } from '@/lib/i18n';
import { useServer } from '@/features/account/useServer';
import { useAdminStatus } from './useAdmin';
import styles from './AdminPage.module.css';

const LOCALES: Record<Lang, string> = { en: 'en-MY', ms: 'ms-MY', zh: 'zh-CN' };

interface AdminUser {
  id: string;
  email: string;
  name: string;
  provider: string;
  createdAt: string | null;
  lastExpenseAt: string | null;
  telegram: boolean;
  authenticator: boolean;
  status: 'active' | 'blocked' | 'disabled';
  block: { manual: boolean; until: string | null } | null;
  codesThisMonth: number;
  codeLimited: boolean;
  isAdmin: boolean;
  isYou: boolean;
}
interface ListReply {
  ok: boolean;
  message?: string;
  total: number;
  page: number;
  pages: number;
  counts: { all: number; blocked: number; disabled: number };
  users: AdminUser[];
}
interface Feedback {
  id: number;
  email: string;
  topic: string;
  message: string;
  status: 'open' | 'resolved';
  created_at: string;
}
type Tab = 'users' | 'feedback' | 'system';
type Action = 'send_reset' | 'block' | 'unblock' | 'clear_codes' | 'reset_authenticator' | 'resend_report' | 'enable' | 'disable';

const actionsFor = (u: AdminUser): Action[] => {
  const items: Action[] = ['send_reset'];
  if (u.status === 'blocked') items.push('unblock');
  else if (!u.isYou) items.push('block');
  if (u.codeLimited || u.codesThisMonth > 0) items.push('clear_codes');
  if (u.authenticator) items.push('reset_authenticator');
  items.push('resend_report');
  if (u.status === 'disabled') items.push('enable');
  else if (!u.isYou && !u.isAdmin) items.push('disable');
  return items;
};
const DANGEROUS: Action[] = ['block', 'disable', 'reset_authenticator'];

/** One call to the admin function. A refusal comes back as words, never as an exception to the screen. */
function useAdminCall() {
  const server = useServer();
  const { t } = useI18n();
  return useCallback(
    async <T extends object>(action: string, payload: Record<string, unknown> = {}): Promise<T & { ok: boolean; message?: string; forbidden?: boolean }> => {
      try {
        return (await server<T>('admin', { action, ...payload })) as T & { ok: boolean };
      } catch (error) {
        return { ok: false, forbidden: error instanceof ApiError && error.code === 'forbidden', message: error instanceof ApiError ? error.message : t('admin.failed') } as unknown as T & { ok: boolean; forbidden?: boolean };
      }
    },
    [server, t],
  );
}

export function AdminPage() {
  const { t } = useI18n();
  const base = useId();
  const { isAdmin, known } = useAdminStatus();
  const [tab, setTab] = useState<Tab>('users');
  const tabs: Tab[] = ['users', 'feedback', 'system'];

  if (known && !isAdmin) return <Notice kind="warn">{t('admin.notAllowed')}</Notice>;
  return (
    <div className={styles.page}>
      <h1 className={styles.h1}>{t('screen.admin.title')}</h1>
      <div className={styles.tabs} role="tablist" aria-label={t('admin.tabs')}>
        {tabs.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`${base}-${value}`}
            aria-selected={tab === value}
            aria-controls={`${base}-panel`}
            tabIndex={tab === value ? 0 : -1}
            className={`${styles.tab} ${tab === value ? styles.on : ''}`}
            onClick={() => setTab(value)}
            onKeyDown={(event) => {
              const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              if (!step) return;
              const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length] as Tab;
              setTab(next);
              document.getElementById(`${base}-${next}`)?.focus();
            }}
          >
            {t(`admin.${value}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-${tab}`} className={styles.panel}>
        {tab === 'users' ? <UsersPanel /> : tab === 'feedback' ? <FeedbackPanel /> : <SystemPanel />}
      </div>
    </div>
  );
}

function relative(t: (k: MessageKey, v?: Record<string, string | number>) => string, lang: Lang, value: string | null): string {
  if (!value) return t('admin.f.noExpense');
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  if (days <= 0) return t('admin.f.today');
  if (days === 1) return t('admin.f.yesterday');
  if (days < 31) return t('admin.f.daysAgo', { n: days });
  return new Intl.DateTimeFormat(LOCALES[lang], { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}
const shortDate = (lang: Lang, value: string | null, never: string) => (value ? new Intl.DateTimeFormat(LOCALES[lang], { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : never);

function lastMonths(lang: Lang): { value: string; label: string }[] {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (i + 1), 1);
    return { value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: new Intl.DateTimeFormat(LOCALES[lang], { month: 'long', year: 'numeric' }).format(d) };
  });
}

function UsersPanel() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const call = useAdminCall();
  const [search, setSearch] = useState('');
  const [typed, setTyped] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [reply, setReply] = useState<ListReply | null>(null);
  const [problem, setProblem] = useState('');
  const [managing, setManaging] = useState<AdminUser | null>(null);
  const [confirming, setConfirming] = useState<{ user: AdminUser; action: Action } | null>(null);
  const [picking, setPicking] = useState<AdminUser | null>(null);
  const [month, setMonth] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  // search waits a moment after typing stops
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(typed.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [typed]);

  useEffect(() => {
    let cancelled = false;
    void call<ListReply>('list', { search, status, page }).then((answer) => {
      if (cancelled) return;
      if (answer.ok) {
        setReply(answer);
        setProblem('');
      } else setProblem(answer.message ?? t('admin.failed'));
    });
    return () => {
      cancelled = true;
    };
  }, [call, search, status, page, version, t]);

  const run = async (user: AdminUser, action: Action, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    const answer = await call(action, { userId: user.id, ...extra });
    setBusy(false);
    setConfirming(null);
    setPicking(null);
    if (answer.ok) {
      toast.show('success', answer.message || t('admin.done'));
      setVersion((v) => v + 1);
    } else toast.show('error', answer.message || t('admin.failed'));
  };

  const choose = (user: AdminUser, action: Action) => {
    setManaging(null);
    if (action === 'resend_report') {
      setMonth(lastMonths(lang)[0]?.value ?? '');
      setPicking(user);
    } else setConfirming({ user, action });
  };

  const lock = (u: AdminUser) => (u.block ? (u.block.manual ? t('admin.blockedManual') : t('admin.blockedUntil', { time: new Intl.DateTimeFormat(LOCALES[lang], { hour: 'numeric', minute: '2-digit' }).format(new Date(u.block.until ?? 0)) })) : '');

  return (
    <div className={styles.stack}>
      <div className={styles.filters}>
        <Field label={t('admin.search')} type="search" autoComplete="off" value={typed} onChange={(event) => setTyped(event.target.value)} />
        <SelectField
          label={t('admin.statusFilter')}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('admin.st.all')}</option>
          <option value="active">{t('admin.st.active')}</option>
          <option value="blocked">{t('admin.st.blocked')}</option>
          <option value="disabled">{t('admin.st.disabled')}</option>
        </SelectField>
      </div>
      {problem ? (
        <Notice kind="warn">
          {problem}{' '}
          <button type="button" className={styles.link} onClick={() => setVersion((v) => v + 1)}>
            {t('admin.retry')}
          </button>
        </Notice>
      ) : null}
      {reply ? (
        <>
          <p className={styles.muted} data-testid="admin-summary">
            {t('admin.summary', { all: reply.counts.all, blocked: reply.counts.blocked, disabled: reply.counts.disabled })}
          </p>
          {reply.users.length === 0 ? (
            <EmptyState icon="info" title={t('admin.users')}>
              {search || status ? t('admin.none') : t('admin.noneYet')}
            </EmptyState>
          ) : (
            <ul className={styles.list} aria-label={t('admin.users')}>
              {reply.users.map((u) => (
                <li key={u.id} className={styles.user} data-user={u.email}>
                  <div className={styles.userHead}>
                    <div className={styles.who}>
                      <strong>{u.name || u.email}</strong>
                      {u.isYou ? <span className={styles.badge}>{t('admin.you')}</span> : u.isAdmin ? <span className={styles.badge}>{t('admin.isAdmin')}</span> : null}
                      <span className={styles.muted}>{u.email}</span>
                    </div>
                    <span className={styles.status} data-status={u.status}>
                      {t(`admin.st.${u.status}`)}
                    </span>
                  </div>
                  <dl className={styles.facts}>
                    <div>
                      <dt>{t('admin.f.lastExpense')}</dt>
                      <dd>{relative(t, lang, u.lastExpenseAt)}</dd>
                    </div>
                    <div>
                      <dt>{t('admin.f.joined')}</dt>
                      <dd>{shortDate(lang, u.createdAt, t('admin.f.never'))}</dd>
                    </div>
                    <div>
                      <dt>{t('admin.f.telegram')}</dt>
                      <dd>{u.telegram ? t('admin.f.linked') : t('admin.f.no')}</dd>
                    </div>
                    <div>
                      <dt>{t('admin.f.auth')}</dt>
                      <dd>{u.authenticator ? t('admin.f.on') : t('admin.f.off')}</dd>
                    </div>
                    <div>
                      <dt>{t('admin.f.signin')}</dt>
                      <dd>{u.provider === 'google' ? t('admin.f.google') : t('admin.f.email')}</dd>
                    </div>
                  </dl>
                  {u.codesThisMonth ? (
                    <p className={styles.muted}>
                      {t('admin.f.codes', { n: u.codesThisMonth })}
                      {u.codeLimited ? ` (${t('admin.f.limit')})` : ''}
                    </p>
                  ) : null}
                  {lock(u) ? <p className={styles.warn}>{lock(u)}</p> : null}
                  <div>
                    <Button variant="outline" onClick={() => setManaging(u)} aria-label={t('admin.manageTitle', { who: u.email })}>
                      {t('admin.manage')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.pager}>
            <Button variant="outline" disabled={reply.page <= 1} onClick={() => setPage(reply.page - 1)}>
              ‹
            </Button>
            <span className={styles.muted}>{reply.pages <= 1 ? t('admin.total', { total: reply.total }) : t('admin.page', { n: reply.page, m: reply.pages, total: reply.total })}</span>
            <Button variant="outline" disabled={reply.page >= reply.pages} onClick={() => setPage(reply.page + 1)}>
              ›
            </Button>
          </div>
        </>
      ) : problem ? null : (
        <p className={styles.muted} role="status">
          {t('admin.loading')}
        </p>
      )}

      {/* AD-07: the actions are a bottom sheet (no dropdown), so they are easy to reach on a phone */}
      <Sheet open={managing !== null} onClose={() => setManaging(null)} title={t('admin.manageTitle', { who: managing?.email ?? '' })}>
        <ul className={styles.actions}>
          {managing
            ? actionsFor(managing).map((action) => (
                <li key={action}>
                  <button type="button" className={`${styles.action} ${DANGEROUS.includes(action) ? styles.danger : ''}`} onClick={() => choose(managing, action)}>
                    {t(`admin.a.${action}`)}
                  </button>
                </li>
              ))
            : null}
        </ul>
      </Sheet>

      <Sheet open={confirming !== null} onClose={() => setConfirming(null)} title={confirming ? t(`admin.c.${confirming.action}.t` as MessageKey) : ''}>
        {confirming ? (
          <div className={styles.stack}>
            <p>{t(`admin.c.${confirming.action}.m` as MessageKey, { email: confirming.user.email })}</p>
            <div className={styles.row}>
              <Button variant={DANGEROUS.includes(confirming.action) ? 'danger' : 'primary'} loading={busy} onClick={() => void run(confirming.user, confirming.action)}>
                {t(`admin.c.${confirming.action}.ok` as MessageKey)}
              </Button>
              <Button variant="outline" onClick={() => setConfirming(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>

      <Sheet open={picking !== null} onClose={() => setPicking(null)} title={t('admin.month.title')}>
        {picking ? (
          <div className={styles.stack}>
            <p>{t('admin.month.body', { email: picking.email })}</p>
            <SelectField label={t('admin.month.label')} value={month} onChange={(event) => setMonth(event.target.value)}>
              {lastMonths(lang).map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </SelectField>
            <div className={styles.row}>
              <Button loading={busy} onClick={() => void run(picking, 'resend_report', { month })}>
                {t('admin.month.send')}
              </Button>
              <Button variant="outline" onClick={() => setPicking(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

function FeedbackPanel() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const call = useAdminCall();
  const [view, setView] = useState<'open' | 'resolved'>('open');
  const [items, setItems] = useState<Feedback[] | null>(null);
  const [problem, setProblem] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void call<{ items: Feedback[] }>('feedback_list', { status: view }).then((answer) => {
      if (cancelled) return;
      if (answer.ok) {
        setItems(answer.items);
        setProblem('');
      } else setProblem(answer.message ?? t('admin.failed'));
    });
    return () => {
      cancelled = true;
    };
  }, [call, view, version, t]);

  const resolve = async (item: Feedback) => {
    const answer = await call('feedback_resolve', { id: item.id, resolved: item.status === 'open' });
    if (!answer.ok) return toast.show('error', answer.message || t('admin.failed'));
    setVersion((v) => v + 1);
  };

  return (
    <div className={styles.stack}>
      <div className={styles.seg} role="group" aria-label={t('admin.fb.view')}>
        {(['open', 'resolved'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            onClick={() => {
              setItems(null);
              setView(value);
            }}
          >
            {t(value === 'open' ? 'admin.fb.open' : 'admin.fb.resolved')}
          </button>
        ))}
      </div>
      {problem ? <Notice kind="warn">{problem}</Notice> : null}
      {items === null ? (
        problem ? null : (
          <p className={styles.muted} role="status">
            {t('admin.loading')}
          </p>
        )
      ) : items.length === 0 ? (
        <EmptyState icon="info" title={t('admin.feedback')}>
          {view === 'open' ? t('admin.fb.emptyOpen') : t('admin.fb.emptyResolved')}
        </EmptyState>
      ) : (
        <ul className={styles.list} aria-label={t('admin.feedback')}>
          {items.map((item) => (
            <li key={item.id} className={styles.user}>
              <strong>{t(`admin.fb.${item.topic}` as MessageKey)}</strong>
              <span className={styles.muted}>
                <a href={`mailto:${item.email}`}>{item.email}</a> · {shortDate(lang, item.created_at, '')}
              </span>
              {/* the message is shown as plain text: React never turns it into markup */}
              <p className={styles.message}>{item.message}</p>
              <div>
                <Button variant="outline" onClick={() => void resolve(item)}>
                  {item.status === 'open' ? t('admin.fb.resolve') : t('admin.fb.reopen')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SystemPanel() {
  const { t, lang } = useI18n();
  const call = useAdminCall();
  const server = useServer();
  const [checks, setChecks] = useState<Record<string, boolean> | null>(null);
  const [log, setLog] = useState<{ id: number; action: string; detail: string | null; created_at: string }[] | null>(null);
  const [problem, setProblem] = useState('');
  const [version, setVersion] = useState(0);
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<{ text: string; bad: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([call<{ checks: Record<string, boolean> }>('health'), call<{ items: { id: number; action: string; detail: string | null; created_at: string }[] }>('log')]).then(([h, l]) => {
      if (cancelled) return;
      if (h.ok) setChecks(h.checks);
      else setProblem(h.message ?? t('admin.failed'));
      if (l.ok) setLog(l.items);
    });
    return () => {
      cancelled = true;
    };
  }, [call, version, t]);

  const sendTest = async () => {
    setTesting(true);
    setTestNote(null);
    try {
      const reply = await server<{ ok?: boolean; sentTo?: string; stage?: string; reason?: string; checks?: Record<string, boolean> }>('admin-email-test', { action: 'send_test' }, 40_000);
      if (reply.checks) setChecks(reply.checks);
      setTestNote(reply.ok ? { text: t('admin.sys.testOk', { to: reply.sentTo ?? '' }), bad: false } : { text: t('admin.sys.testFail', { stage: reply.stage ?? '', reason: reply.reason ?? '' }), bad: true });
    } catch (error) {
      setTestNote({ text: error instanceof ApiError ? error.message : t('admin.failed'), bad: true });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className={styles.stack}>
      <section className={styles.card} aria-labelledby="sys-health">
        <h2 id="sys-health" className={styles.h2}>
          {t('admin.sys.health')}
        </h2>
        {problem ? <Notice kind="warn">{problem}</Notice> : null}
        {checks ? (
          <ul className={styles.checks} aria-label={t('admin.sys.health')}>
            {Object.entries(checks).map(([name, ok]) => (
              <li key={name} data-ok={ok}>
                {name}: {ok ? t('admin.sys.ok') : t('admin.sys.bad')}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>{t('admin.loading')}</p>
        )}
        <div className={styles.row}>
          <Button variant="outline" onClick={() => setVersion((v) => v + 1)}>
            {t('admin.sys.refresh')}
          </Button>
          <Button variant="outline" loading={testing} onClick={() => void sendTest()}>
            {t('admin.sys.test')}
          </Button>
        </div>
        {testNote ? <Notice kind={testNote.bad ? 'bad' : 'good'}>{testNote.text}</Notice> : null}
      </section>
      <section className={styles.card} aria-labelledby="sys-log">
        <h2 id="sys-log" className={styles.h2}>
          {t('admin.sys.log')}
        </h2>
        {log && log.length > 0 ? (
          <ul className={styles.log} aria-label={t('admin.sys.log')}>
            {log.map((entry) => (
              <li key={entry.id}>
                <strong>{t(`admin.log.${entry.action}` as MessageKey)}</strong>
                <span className={styles.muted}>{entry.detail ?? ''}</span>
                <time dateTime={entry.created_at}>{new Intl.DateTimeFormat(LOCALES[lang], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(entry.created_at))}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>{t('admin.sys.logEmpty')}</p>
        )}
      </section>
    </div>
  );
}
