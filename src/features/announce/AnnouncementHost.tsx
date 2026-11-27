// AN-04: shows the live announcement when the app is opened, above everything else, once per browser session, until the person ticks "don't show me again".
// Nothing about it can stop the app: no announcement, no connection or any error simply means nothing is shown. The guided tour waits for it, then starts.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/AuthProvider';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { useI18n } from '@/lib/i18n';
import { AnnouncementView } from './AnnouncementView';
import { markShownThisSession, pickText, readOnThisDevice, rememberRead, shownThisSession, textsOf, type AnnouncementRow } from './announce';
import { setAnnouncementBusy } from './announceStore';

export function AnnouncementHost() {
  const { t, lang } = useI18n();
  const { client, session } = useAuth();
  const userId = session?.user?.id;
  const [row, setRow] = useState<AnnouncementRow | null>(null);
  const [tick, setTick] = useState(false);

  useEffect(() => {
    if (!client || !userId) return undefined;
    let cancelled = false;
    setAnnouncementBusy(true); // the tour waits while this is looked up
    const done = () => setAnnouncementBusy(false);
    void (async () => {
      try {
        const { data } = await client.from('announcements').select('*').eq('status', 'published').limit(1);
        const found = (data?.[0] ?? null) as AnnouncementRow | null;
        if (cancelled) return;
        if (!found || readOnThisDevice(userId, found.id) || shownThisSession(userId, found.id)) {
          done();
          return;
        }
        const reads = await client.from('announcement_reads').select('announcement_id').eq('user_id', userId).eq('announcement_id', found.id).limit(1);
        if (cancelled) return;
        if (reads.data && reads.data.length > 0) {
          rememberRead(userId, found.id);
          done();
          return;
        }
        markShownThisSession(userId, found.id);
        setRow(found); // it stays "busy" until it is closed
      } catch {
        if (!cancelled) done();
      }
    })();
    return () => {
      cancelled = true;
      done();
    };
  }, [client, userId]);

  const close = useCallback(() => {
    if (!row || !userId) return;
    if (tick) {
      rememberRead(userId, row.id);
      void (async () => {
        try {
          await client?.from('announcement_reads').insert({ user_id: userId, announcement_id: row.id });
        } catch {
          /* the copy on this device is enough */
        }
      })();
    }
    setRow(null);
    setTick(false);
    setAnnouncementBusy(false);
  }, [client, row, tick, userId]);

  if (!row) return null;
  const text = pickText(textsOf(row), lang);
  return (
    <Sheet
      open
      top
      dismissible
      size="narrow"
      title={text.title}
      onClose={close}
      footer={
        <Button block onClick={close} data-testid="announcement-close">
          {t('ann.gotIt')}
        </Button>
      }
    >
      <AnnouncementView body={text.body} tick={tick} onTick={setTick} onLink={close} />
    </Sheet>
  );
}
