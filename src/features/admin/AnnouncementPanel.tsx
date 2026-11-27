// AN-05: the administrator's announcement editor: English (required) and optional Malay and Chinese, warnings for what is missing, a preview of exactly what
// people will see (with a language switch), and Publish with a confirmation. One announcement is live at a time; publishing replaces it.
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { Field, TextAreaField } from '@/components/Field';
import { Notice } from '@/components/Notice';
import { useToast } from '@/components/Toast';
import { useI18n, type Lang, type MessageKey } from '@/lib/i18n';
import { AnnouncementView } from '@/features/announce/AnnouncementView';
import { BODY_MAX, TITLE_MAX, emptyTexts, gaps, pickText, readiness, textsOf, type AnnouncementRow, type Texts } from '@/features/announce/announce';
import { useAdminCall } from './useAdminCall';
import styles from './AnnouncementPanel.module.css';

interface State {
  published: AnnouncementRow | null;
  draft: AnnouncementRow | null;
  reads: number;
}

const LANGS: Lang[] = ['en', 'ms', 'zh'];
const LOCALES: Record<Lang, string> = { en: 'en-MY', ms: 'ms-MY', zh: 'zh-CN' };
const payloadOf = (texts: Texts) => ({ titleEn: texts.en.title, bodyEn: texts.en.body, titleMs: texts.ms.title, bodyMs: texts.ms.body, titleZh: texts.zh.title, bodyZh: texts.zh.body });

export function AnnouncementPanel() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const call = useAdminCall();
  const [state, setState] = useState<State | null>(null);
  const [problem, setProblem] = useState('');
  const [texts, setTexts] = useState<Texts>(emptyTexts);
  const [previewLang, setPreviewLang] = useState<Lang>('en');
  const [confirming, setConfirming] = useState<'publish' | 'retire' | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void call<State>('announcement_state').then((answer) => {
      if (cancelled) return;
      if (answer.ok) {
        setState({ published: answer.published ?? null, draft: answer.draft ?? null, reads: answer.reads ?? 0 });
        setProblem('');
        if (version === 0) setTexts(textsOf(answer.draft ?? answer.published ?? null)); // the editor starts from the saved draft, or from what is live
      } else setProblem(answer.message ?? t('ann.admin.loadFailed'));
    });
    return () => {
      cancelled = true;
    };
  }, [call, version, t]);

  const ready = useMemo(() => readiness(texts), [texts]);
  const missing = useMemo(() => gaps(texts), [texts]);
  const shown = pickText(texts, previewLang);
  const langName = (l: Lang) => t(`ann.lang.${l}` as MessageKey);
  const set = (l: Lang, part: 'title' | 'body', value: string) => setTexts((current) => ({ ...current, [l]: { ...current[l], [part]: value } }));

  const run = async (action: string, payload: Record<string, unknown> = {}) => {
    setBusy(true);
    const answer = await call(action, payload);
    setBusy(false);
    setConfirming(null);
    if (answer.ok) {
      toast.show('success', answer.message || t('admin.done'));
      setVersion((v) => v + 1);
    } else toast.show('error', answer.message || t('admin.failed'));
  };

  const liveDate = state?.published?.published_at ? new Intl.DateTimeFormat(LOCALES[lang], { dateStyle: 'medium' }).format(new Date(state.published.published_at)) : '';

  return (
    <div className={styles.panel} data-testid="announcement-panel">
      <p className={styles.intro}>{t('ann.admin.intro')}</p>
      {problem ? <Notice kind="warn">{problem}</Notice> : null}

      <section className={styles.status} aria-label={t('ann.admin.live')} data-testid="announcement-status">
        {state?.published ? (
          <>
            <div>
              <strong>{t('ann.admin.live')}</strong>
              <p>{state.published.title_en}</p>
              <small>{t('ann.admin.liveSince', { date: liveDate, n: String(state.reads) })}</small>
            </div>
            <Button variant="outline" disabled={busy} onClick={() => setConfirming('retire')} data-testid="announcement-retire">
              {t('ann.admin.retire')}
            </Button>
          </>
        ) : (
          <p>{t('ann.admin.none')}</p>
        )}
      </section>
      {confirming === 'retire' ? (
        <Notice kind="warn">
          <p>{t('ann.admin.confirmRetire')}</p>
          <div className={styles.row}>
            <Button loading={busy} onClick={() => void run('announcement_retire')} data-testid="announcement-retire-yes">
              {t('ann.admin.yesRetire')}
            </Button>
            <Button variant="outline" onClick={() => setConfirming(null)}>
              {t('ann.admin.cancel')}
            </Button>
          </div>
        </Notice>
      ) : null}

      <div className={styles.columns}>
        <div className={styles.editor}>
          {LANGS.map((l) => (
            <fieldset key={l} className={styles.lang} data-testid={`announcement-lang-${l}`}>
              <legend>{t(`ann.admin.${l}` as MessageKey)}</legend>
              <Field label={t('ann.admin.title')} value={texts[l].title} maxLength={TITLE_MAX} hint={`${texts[l].title.length} / ${TITLE_MAX}`} autoComplete="off" onChange={(e) => set(l, 'title', e.target.value)} data-testid={`announcement-title-${l}`} />
              <TextAreaField label={t('ann.admin.body')} value={texts[l].body} maxLength={BODY_MAX} rows={l === 'en' ? 6 : 4} hint={`${texts[l].body.length} / ${BODY_MAX}`} onChange={(e) => set(l, 'body', e.target.value)} data-testid={`announcement-body-${l}`} />
            </fieldset>
          ))}
          <p className={styles.help}>{t('ann.admin.help')}</p>
        </div>

        <div className={styles.side}>
          <h3 className={styles.h3}>{t('ann.admin.preview')}</h3>
          <div className={styles.chips} role="group" aria-label={t('ann.admin.previewAs')}>
            {LANGS.map((l) => (
              <button key={l} type="button" className={`${styles.chip} ${previewLang === l ? styles.on : ''}`} aria-pressed={previewLang === l} onClick={() => setPreviewLang(l)} data-testid={`announcement-preview-${l}`}>
                {langName(l)}
              </button>
            ))}
          </div>
          {previewLang !== 'en' && shown.language === 'en' ? <Notice kind="info">{t('ann.admin.fallback', { lang: langName(previewLang) })}</Notice> : null}
          <div className={styles.frame} data-testid="announcement-preview">
            <AnnouncementView title={shown.title || t('ann.admin.noTitle')} body={shown.body || t('ann.admin.noBody')} tick={false} tickDisabled />
          </div>
        </div>
      </div>

      {missing.length > 0 ? (
        <div className={styles.warnings} data-testid="announcement-warnings">
          {missing.map((g) => (
            <Notice key={g.lang} kind="warn">
              {t(g.kind === 'empty' ? 'ann.admin.warnEmpty' : 'ann.admin.warnPartial', { lang: langName(g.lang) })}
            </Notice>
          ))}
        </div>
      ) : null}
      {!ready.english ? <Notice kind="info">{t('ann.admin.needEnglish')}</Notice> : null}

      {confirming === 'publish' ? (
        <Notice kind="info">
          <p>{t('ann.admin.confirmPublish')}</p>
          {missing.length > 0 ? <p>{t('ann.admin.confirmMissing', { langs: missing.map((g) => langName(g.lang)).join(', ') })}</p> : null}
          <div className={styles.row}>
            <Button loading={busy} onClick={() => void run('announcement_publish', payloadOf(texts))} data-testid="announcement-publish-yes">
              {t('ann.admin.yesPublish')}
            </Button>
            <Button variant="outline" onClick={() => setConfirming(null)}>
              {t('ann.admin.cancel')}
            </Button>
          </div>
        </Notice>
      ) : null}

      <div className={styles.row}>
        <Button variant="outline" disabled={busy} onClick={() => void run('announcement_save', payloadOf(texts))} data-testid="announcement-save">
          {t('ann.admin.saveDraft')}
        </Button>
        <Button disabled={busy || !ready.ok} onClick={() => setConfirming('publish')} data-testid="announcement-publish">
          {t('ann.admin.publish')}
        </Button>
      </div>
    </div>
  );
}
