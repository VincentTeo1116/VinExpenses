// AN-03: what the announcement looks like: simple formatting shown safely (no raw HTML, links only inside the app), and the "don't show me again" tick.
// The pop-up and the administrator's preview use this same piece, so the preview is exactly what people see.
import { Link } from 'react-router-dom';
import { useI18n } from '@/lib/i18n';
import { parseArticle, type Inline } from '@/features/guides/markdown';
import styles from './AnnouncementView.module.css';

function Inlines({ nodes, onLink }: { nodes: Inline[]; onLink?: () => void }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.t === 'text') return n.v;
        if (n.t === 'code') return <code key={i}>{n.v}</code>;
        if (n.t === 'a')
          return (
            <Link key={i} to={n.href} onClick={onLink}>
              <Inlines nodes={n.c} onLink={onLink} />
            </Link>
          );
        const Tag = n.t === 'b' ? 'strong' : 'em';
        return (
          <Tag key={i}>
            <Inlines nodes={n.c} onLink={onLink} />
          </Tag>
        );
      })}
    </>
  );
}

export function AnnouncementBody({ text, onLink }: { text: string; onLink?: () => void }) {
  const blocks = parseArticle(text).blocks;
  return (
    <div className={styles.body} data-testid="announcement-body">
      {blocks.map((b, i) => {
        if (b.t === 'h2') return <h3 key={i}><Inlines nodes={b.c} onLink={onLink} /></h3>;
        if (b.t === 'p') return <p key={i}><Inlines nodes={b.c} onLink={onLink} /></p>;
        if (b.t === 'ul' || b.t === 'ol') {
          const List = b.t;
          return (
            <List key={i}>
              {b.items.map((item, j) => (
                <li key={j}><Inlines nodes={item} onLink={onLink} /></li>
              ))}
            </List>
          );
        }
        return null; // tables are not part of an announcement
      })}
    </div>
  );
}

interface Props {
  /** Shown as a heading: for the preview. The pop-up shows the title in its own header instead. */
  title?: string;
  body: string;
  tick: boolean;
  onTick?: (next: boolean) => void;
  /** In the preview the tick is only for show. */
  tickDisabled?: boolean;
  onLink?: () => void;
}

export function AnnouncementView({ title, body, tick, onTick, tickDisabled, onLink }: Props) {
  const { t } = useI18n();
  return (
    <div className={styles.view}>
      <div className={styles.hero} aria-hidden="true">
        <span className={styles.badge}>{'\u{1F389}'}</span>
        <span className={styles.spark1}>{'\u2728'}</span>
        <span className={styles.spark2}>{'\u{1F973}'}</span>
      </div>
      <p className={styles.kicker}>{t('ann.label')}</p>
      {title ? <h3 className={styles.title}>{title}</h3> : null}
      <AnnouncementBody text={body} onLink={onLink} />
      <label className={styles.tick}>
        <input type="checkbox" checked={tick} disabled={tickDisabled} onChange={(event) => onTick?.(event.target.checked)} data-testid="announcement-tick" />
        <span>{t('ann.read')}</span>
      </label>
    </div>
  );
}
