// PL-04: what needs attention (deposits maturing, loan payments due or missed), the list on Plan and the one pop-up on Home.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useAuth } from '@/app/AuthProvider';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { useI18n } from '@/lib/i18n';
import { formatDate, todayYmd } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { useMoney } from '@/features/money/MoneyContext';
import { useFinanceData } from './data';
import { dueReminders, type Reminder } from './finance';
import { whenText } from './format';
import styles from './finance.module.css';

export function useReminderList(): { list: Reminder[]; loading: boolean } {
  const finance = useFinanceData();
  const today = todayYmd();
  const list = useMemo(() => dueReminders(finance.deposits, finance.loans, today), [finance.deposits, finance.loans, today]);
  return { list, loading: finance.loading };
}

export function ReminderList({ list }: { list: Reminder[] }) {
  const { t } = useI18n();
  const { data } = useMoney();
  return (
    <ul className={styles.reminders} aria-label={t('rem.title')}>
      {list.map((item) => {
        const when = whenText(t, item.daysLeft);
        const text = item.kind === 'fd' ? t('rem.fd', { name: item.name, when }) : item.group === 'overdue' ? t('rem.loanMissed', { name: item.name, n: item.count ?? 1, date: formatDate(item.firstUnpaid ?? item.dueDate, data.dateFormat) }) : t('rem.loan', { name: item.name, when });
        return (
          <li key={`${item.kind}-${item.id}-${item.dueDate}-${item.group}`} className={styles.reminder} data-group={item.group}>
            <span className={styles.reminderText}>
              <strong>{text}</strong>
              <span className={styles.small}>
                {t(`rem.${item.group}`)} · {formatDate(item.dueDate, data.dateFormat)}
              </span>
            </span>
            {item.amount !== undefined ? <span className={styles.reminderAmount}>{formatMoney(item.amount)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

interface ReminderPrefs {
  reminder_snooze_until: string | null;
  reminder_popup: 'auto' | 'always' | 'never';
}

/** One pop-up for everything that is due; "don't show for 24 hours" is kept with the account, so it holds on every device. */
export function ReminderPopup() {
  const { t } = useI18n();
  const { client, session } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = session?.user?.id ?? '';
  const c = client as SupabaseClient;
  const { list } = useReminderList();
  const [closed, setClosed] = useState(false);
  const [openedAt] = useState(() => Date.now()); // when this screen was opened: "is it still snoozed" is judged against that
  const key = ['reminder-prefs', userId];
  const prefs = useQuery({
    queryKey: key,
    enabled: Boolean(userId && client),
    queryFn: async (): Promise<ReminderPrefs> => {
      const { data, error } = await c.from('user_preferences').select('reminder_snooze_until, reminder_popup').eq('user_id', userId).maybeSingle();
      if (error || !data) return { reminder_snooze_until: null, reminder_popup: 'auto' };
      return data as ReminderPrefs;
    },
  });

  const snoozed = Boolean(prefs.data?.reminder_snooze_until && new Date(prefs.data.reminder_snooze_until).getTime() > openedAt);
  const wanted = list.length > 0 && prefs.isSuccess && !snoozed && prefs.data?.reminder_popup !== 'never';
  const open = wanted && !closed;

  const snooze = async () => {
    setClosed(true);
    const until = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    queryClient.setQueryData<ReminderPrefs>(key, (old) => ({ reminder_popup: old?.reminder_popup ?? 'auto', reminder_snooze_until: until }));
    await c.from('user_preferences').upsert({ user_id: userId, reminder_snooze_until: until }, { onConflict: 'user_id' });
  };

  return (
    <Sheet open={open} onClose={() => setClosed(true)} title={t('rem.popupTitle')}>
      <div className={styles.popupBody}>
      <ReminderList list={list} />
      <div className={styles.actions}>
        <Button
          onClick={() => {
            setClosed(true);
            navigate('/app/plan', { state: { tab: list[0]?.kind === 'loan' ? 'loans' : 'deposits' } });
          }}
        >
          {t('rem.open')}
        </Button>
        <Button variant="outline" onClick={() => void snooze()}>
          {t('rem.snooze')}
        </Button>
      </div>
      </div>
    </Sheet>
  );
}
