// The Plan screen. Recurring bills and budgets come first; deposits and loans join in a later step.
import { useId, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Icon, type IconName } from '@/components/Icon';
import { useI18n } from '@/lib/i18n';
import { ReminderList, useReminderList } from '@/features/finance/Reminders';
import { RecurringPanel } from './RecurringPanel';
import { BudgetsPanel } from './BudgetsPanel';
import { DepositsPanel } from '@/features/finance/DepositsPanel';
import { LoansPanel } from '@/features/finance/LoansPanel';
import styles from './PlanPage.module.css';

type Tab = 'recurring' | 'budgets' | 'deposits' | 'loans';
const TABS: Tab[] = ['recurring', 'budgets', 'deposits', 'loans'];
const TAB_ICON: Record<Tab, IconName> = { recurring: 'repeat', budgets: 'target', deposits: 'bank', loans: 'coin' };

export function PlanPage() {
  const { t } = useI18n();
  const location = useLocation();
  // the dashboard's budget tile opens this screen on the Budgets tab
  const [tab, setTab] = useState<Tab>(TABS.find((value) => value === (location.state as { tab?: Tab } | null)?.tab) ?? 'recurring');
  const base = useId();
  const reminders = useReminderList();
  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.h1}>{t('screen.plan.title')}</h1>
        <p className={styles.sub}>{t('plan.sub')}</p>
      </header>
      <div className={styles.tabs} role="tablist" aria-label={t('plan.tabs')}>
        {TABS.map((value) => (
          <button key={value} type="button" role="tab" id={`${base}-${value}`} aria-selected={tab === value} aria-controls={`${base}-panel`} tabIndex={tab === value ? 0 : -1} className={`${styles.tab} ${tab === value ? styles.on : ''}`} onClick={() => setTab(value)}
            onKeyDown={(event) => {
              const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              if (!step) return;
              const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length] as Tab;
              setTab(next);
              document.getElementById(`${base}-${next}`)?.focus();
            }}>
            <Icon name={TAB_ICON[value]} size={18} />
            <span>{t(`plan.tab.${value}`)}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-${tab}`} className={styles.panel}>
        {tab === 'recurring' ? <RecurringPanel /> : tab === 'budgets' ? <BudgetsPanel /> : tab === 'deposits' ? <DepositsPanel /> : <LoansPanel />}
      </div>
      {reminders.list.length > 0 ? (
        <section className={styles.reminders} aria-labelledby={`${base}-rem`}>
          <h2 id={`${base}-rem`} className={styles.h2}>
            {t('rem.title')}
          </h2>
          <ReminderList list={reminders.list} />
        </section>
      ) : null}
    </div>
  );
}
