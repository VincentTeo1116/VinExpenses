// The sign-in page: sign in, register, confirm the address, forgot password, authenticator and the "sign-in is paused" screen.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Notice } from '@/components/Notice';
import { ContactSheet } from '@/features/contact/LazyContactSheet';
import { useAuth } from '@/app/AuthProvider';
import { useI18n } from '@/lib/i18n';
import type { Topic } from './schemas';
import { AuthLayout } from './ui/AuthLayout';
import { BlockedStep } from './steps/BlockedStep';
import { ForgotStep } from './steps/ForgotStep';
import { MfaStep } from './steps/MfaStep';
import { RegisterForm } from './steps/RegisterForm';
import { ResetStep } from './steps/ResetStep';
import { SignInForm } from './steps/SignInForm';
import { VerifyStep } from './steps/VerifyStep';
import type { NoticeState, Step } from './steps/types';
import styles from './steps/steps.module.css';

type Tab = 'signin' | 'register';
const OLD_LINK = /access_token|type=recovery|type=signup|error_description/;

/** Splits "text {token} text" and puts a node in place of each {token}. Used for sentences that contain links. */
function withNodes(template: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/g).map((part, index) => {
    const token = /^\{(\w+)\}$/.exec(part);
    const node = token ? nodes[token[1] ?? ''] : undefined;
    return node !== undefined ? <span key={index}>{node}</span> : part;
  });
}

export function AuthPage() {
  const { t } = useI18n();
  const { status } = useAuth();
  const location = useLocation();
  const [tab, setTab] = useState<Tab>('signin');
  const [step, setStep] = useState<Step>('start');
  const [email, setEmail] = useState('');
  const [codeUntil, setCodeUntil] = useState<number | null>(null);
  const [blocked, setBlocked] = useState<{ until: number | null; manual: boolean }>({ until: null, manual: false });
  const [notice, setNotice] = useState<NoticeState>(() => (OLD_LINK.test(window.location.hash) ? { kind: 'info', text: t('auth.oldLink') } : null));
  const [contact, setContact] = useState<{ open: boolean; topic?: Topic | undefined }>({ open: false });

  // AU-16: an old emailed link must never sign anyone in. It is explained, and removed from the address bar.
  useEffect(() => {
    if (OLD_LINK.test(window.location.hash)) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }, []);

  if (status === 'loading') return <div className="sr-only" role="status">{t('common.loading')}</div>;
  if (status === 'signedIn') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from.startsWith('/app') ? from : '/app'} replace />;
  }
  if (status === 'needsSetup') return <Navigate to="/auth/setup" replace />;

  const openContact = (topic?: Topic) => setContact({ open: true, topic });
  const go = (next: Step) => {
    setNotice(null);
    setStep(next);
  };
  const codeSent = (address: string, minutes: number) => {
    setEmail(address);
    setCodeUntil(Date.now() + minutes * 60_000);
  };
  const onBlocked = (until: number | null, manual: boolean) => {
    setBlocked({ until, manual });
    go('blocked');
  };
  const common = { email, setEmail, go, notice: setNotice, openContact };

  let title = t('auth.welcome');
  let subtitle: string | undefined = t('auth.welcomeSub');
  let content: ReactNode;
  let footer: ReactNode = (
    <>
      <p className={styles.agree}>
        {withNodes(t('auth.agree'), {
          terms: <Link to="/terms">{t('auth.terms')}</Link>,
          privacy: <Link to="/privacy">{t('auth.privacy')}</Link>,
        })}
      </p>
      <p>
        {t('auth.help')}{' '}
        <button type="button" className={styles.inlineLink} onClick={() => openContact()}>
          {t('common.contactAdmin')}
        </button>
      </p>
    </>
  );

  if (status === 'needsMfa') {
    title = t('mfa.title');
    subtitle = undefined;
    footer = null;
    content = <MfaStep notice={setNotice} onBlocked={onBlocked} />;
  } else if (step === 'verify') {
    title = t('verify.title');
    subtitle = undefined;
    content = <VerifyStep {...common} codeUntil={codeUntil} onNewCode={(minutes) => setCodeUntil(Date.now() + minutes * 60_000)} />;
  } else if (step === 'forgot') {
    title = t('forgot.title');
    subtitle = t('forgot.sub');
    content = <ForgotStep {...common} onCodeSent={(address, minutes) => { codeSent(address, minutes); go('reset'); }} />;
  } else if (step === 'reset') {
    title = t('reset.title');
    subtitle = undefined;
    content = (
      <ResetStep
        {...common}
        codeUntil={codeUntil}
        onDone={() => {
          setTab('signin');
          setStep('start');
          setNotice({ kind: 'good', text: t('auth.passwordChanged') });
        }}
      />
    );
  } else if (step === 'blocked') {
    title = t('blocked.title');
    subtitle = undefined;
    footer = null;
    content = (
      <BlockedStep
        until={blocked.until}
        manual={blocked.manual}
        onReset={() => go('forgot')}
        onContact={() => openContact('locked_out')}
        onBack={() => go('start')}
      />
    );
  } else {
    if (tab === 'register') {
      title = t('auth.create');
      subtitle = t('auth.createSub');
    }
    content = (
      <>
        <div className={styles.tabs} role="group" aria-label={t('auth.tabs')}>
          <button type="button" className={`${styles.tab} ${tab === 'signin' ? styles.tabActive : ''}`} aria-pressed={tab === 'signin'} onClick={() => { setNotice(null); setTab('signin'); }}>
            {t('auth.tab.signin')}
          </button>
          <button type="button" className={`${styles.tab} ${tab === 'register' ? styles.tabActive : ''}`} aria-pressed={tab === 'register'} onClick={() => { setNotice(null); setTab('register'); }}>
            {t('auth.tab.register')}
          </button>
        </div>
        {tab === 'signin' ? (
          <SignInForm
            key="signin"
            {...common}
            onBlocked={onBlocked}
            onUnverified={(address) => {
              setEmail(address);
              setCodeUntil(null);
              setStep('verify');
              setNotice({ kind: 'info', text: t('verify.unverified') });
            }}
          />
        ) : (
          <RegisterForm
            key="register"
            email={email}
            setEmail={setEmail}
            notice={setNotice}
            openContact={openContact}
            onCodeSent={(address, minutes) => {
              codeSent(address, minutes);
              go('verify');
            }}
            onExists={(address) => {
              setEmail(address);
              setTab('signin');
              setNotice({ kind: 'info', text: t('auth.existsNotice') });
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <AuthLayout title={title} subtitle={subtitle} footer={footer}>
        {notice ? <Notice kind={notice.kind}>{notice.text}</Notice> : null}
        {content}
      </AuthLayout>
      <ContactSheet open={contact.open} topic={contact.topic} defaultEmail={email} onClose={() => setContact({ open: false })} />
    </>
  );
}
