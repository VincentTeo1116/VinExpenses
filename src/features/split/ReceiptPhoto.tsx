// SP-13: the receipt photo beside the table: zoom, a hide button for phones, tap to enlarge, and marks where the chosen row (and any row that does not add up) sits.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { useI18n } from '@/lib/i18n';
import { prefersReducedMotion } from '@/lib/motion';
import type { Regions } from './read';
import type { Box } from './rows';
import styles from './ReceiptPhoto.module.css';

interface Props {
  image: string;
  /** Where each line sits on the photo, by line id (empty when the reader gave no word positions). */
  boxes: Record<string, Box>;
  /** The shop, date, items and total areas to outline (only those that were found). */
  regions: Regions;
  activeId: string | null;
  failing: ReadonlySet<string>;
}

const ZOOM = ['z1', 'z2', 'z3', 'z4'] as const;
const AREAS = ['merchant', 'date', 'items', 'total'] as const;
type Area = (typeof AREAS)[number];
const CLASS_OF: Record<Area, string> = { merchant: 'kMerchant', date: 'kDate', items: 'kItems', total: 'kTotal' };
const LABEL_OF = { merchant: 'split.photo.area.merchant', date: 'split.photo.area.date', items: 'split.photo.area.items', total: 'split.photo.area.total' } as const;

function Viewer({ image, boxes, regions, activeId, failing, label }: Props & { label: string }) {
  const { t } = useI18n();
  const [zoom, setZoom] = useState(0);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const box = activeId ? boxes[activeId] : undefined;

  // bring the chosen row into view on the photo
  useEffect(() => {
    if (!box || !size || !scroller.current || !stage.current) return;
    const top = (box.y0 / size.h) * stage.current.clientHeight - scroller.current.clientHeight / 3;
    scroller.current.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [box, size]);

  const marks = size
    ? Object.entries(boxes)
        .filter(([id]) => id === activeId || failing.has(id))
        .map(([id, b]) => <rect key={id} data-line={id} data-testid={id === activeId ? 'split-mark-active' : 'split-mark-bad'} className={id === activeId ? styles.active : styles.bad} x={b.x0 - 4} y={b.y0 - 3} width={b.x1 - b.x0 + 8} height={b.y1 - b.y0 + 6} rx={4} />)
    : null;

  const fs = size ? Math.max(12, Math.round(size.h * 0.017)) : 12;
  const areas = size
    ? AREAS.flatMap((key) => {
        const b = regions[key];
        if (!b) return [];
        const text = t(LABEL_OF[key]);
        const pad = Math.round(fs * 0.3);
        const pillW = Math.round(text.length * fs * 0.62 + fs * 0.9);
        const pillH = Math.round(fs * 1.5);
        const above = b.y0 - pad - pillH >= 0;
        const py = above ? b.y0 - pad - pillH : b.y0 + pad;
        return [
          <g key={key} className={styles[CLASS_OF[key] as string]} data-testid={'split-region-' + key}>
            <rect className={styles.area} x={b.x0 - pad} y={b.y0 - pad} width={b.x1 - b.x0 + pad * 2} height={b.y1 - b.y0 + pad * 2} rx={4} />
            <rect className={styles.pill} x={b.x0 - pad} y={py} width={pillW} height={pillH} rx={4} />
            <text className={styles.pillText} x={b.x0 - pad + Math.round(fs * 0.45)} y={py + Math.round(pillH * 0.72)} fontSize={fs}>
              {text}
            </text>
          </g>,
        ];
      })
    : null;

  return (
    <>
      <div className={styles.toolbar}>
        <Button variant="outline" aria-label={t('split.photo.zoomOut')} disabled={zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))}>
          −
        </Button>
        <Button variant="outline" aria-label={t('split.photo.zoomIn')} disabled={zoom === ZOOM.length - 1} onClick={() => setZoom((z) => Math.min(ZOOM.length - 1, z + 1))}>
          +
        </Button>
        <Button variant="outline" disabled={zoom === 0} onClick={() => setZoom(0)}>
          {t('split.photo.fit')}
        </Button>
      </div>
      {/* tabIndex: the zoomed photo scrolls, so it must be reachable by keyboard */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div ref={scroller} className={styles.viewer} tabIndex={0} role="region" aria-label={label}>
        <div ref={stage} className={`${styles.stage} ${styles[ZOOM[zoom] as string]}`}>
          <img className={styles.photo} src={image} alt={t('split.photo.alt')} data-testid="split-photo" onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
          {size ? (
            <svg className={styles.overlay} viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none" aria-hidden="true">
              {areas}
              {marks}
            </svg>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function ReceiptPhoto(props: Props) {
  const { t } = useI18n();
  const [hidden, setHidden] = useState<ReadonlySet<Area>>(new Set());
  const found = AREAS.filter((key) => props.regions[key]);
  const shown: Regions = Object.fromEntries(found.filter((key) => !hidden.has(key)).map((key) => [key, props.regions[key]]));
  const flip = (key: Area) => setHidden((h) => { const next = new Set(h); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const [open, setOpen] = useState(true);
  const [big, setBig] = useState(false);
  const hasBoxes = Object.keys(props.boxes).length > 0;
  return (
    <section className={styles.card} aria-labelledby="split-photo-title" data-testid="split-photo-card">
      <div className={styles.head}>
        <h2 id="split-photo-title" className={styles.h2}>
          {t('split.photo.title')}
        </h2>
        <div className={styles.phone}>
          <button type="button" className={styles.toggle} aria-expanded={open} aria-controls="split-photo-body" data-testid="split-photo-toggle" onClick={() => setOpen((o) => !o)}>
            {open ? t('split.photo.hide') : t('split.photo.show')}
          </button>
          <button type="button" className={styles.toggle} data-testid="split-photo-enlarge" onClick={() => setBig(true)}>
            {t('split.photo.enlarge')}
          </button>
        </div>
      </div>
      <div id="split-photo-body" className={styles.body} hidden={!open}>
        {found.length ? (
          <div className={styles.legend} role="group" aria-label={t('split.photo.areas')}>
            {found.map((key) => (
              <button key={key} type="button" className={`${styles.chip} ${styles[CLASS_OF[key] as string]}`} aria-pressed={!hidden.has(key)} data-testid={'split-area-' + key} onClick={() => flip(key)}>
                {t(LABEL_OF[key])}
              </button>
            ))}
          </div>
        ) : null}
        <Viewer {...props} regions={shown} label={t('split.photo.title')} />
        <p className={styles.hint}>{hasBoxes ? t('split.photo.rowHint') : t('split.photo.noBoxes')}</p>
      </div>
      <Sheet open={big} onClose={() => setBig(false)} title={t('split.photo.title')} size="wide">
        <Viewer {...props} regions={shown} label={t('split.photo.title')} />
      </Sheet>
    </section>
  );
}
