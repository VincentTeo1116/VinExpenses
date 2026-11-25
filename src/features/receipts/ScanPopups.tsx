// RX-03: the pop-ups around scanning a receipt: choose how (take a photo, or pick a file), a live camera view with a guide frame for
// computers, and the photo with the words that were used marked on it. The camera picture never leaves the device until it is scanned.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { useI18n } from '@/lib/i18n';
import { findAmountBoxes, toFractions, type OcrWord } from './highlight';
import styles from './ScanPopups.module.css';

export const cameraAvailable = (): boolean => typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';
/** A phone or tablet: its own camera app is the better way to take the photo. */
export const isTouchDevice = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

export function ScanChooser({ open, onClose, onCamera, onFile }: { open: boolean; onClose: () => void; onCamera: () => void; onFile: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet open={open} onClose={onClose} title={t('scan.button')}>
      <div className={styles.choices}>
        <button type="button" className={styles.choice} onClick={onCamera} data-testid="scan-take-photo">
          <Icon name="camera" size={24} />
          <span>
            <b>{t('scan.takePhoto')}</b>
            <small>{t('scan.takePhotoHint')}</small>
          </span>
        </button>
        <button type="button" className={styles.choice} onClick={onFile} data-testid="scan-choose-file">
          <Icon name="receipt" size={24} />
          <span>
            <b>{t('scan.chooseFile')}</b>
            <small>{t('scan.chooseFileHint')}</small>
          </span>
        </button>
      </div>
    </Sheet>
  );
}

/** Live camera on a computer. Shows a guide frame; Capture hands back a JPEG file. */
export function CameraSheet({ open, onClose, onCapture, onFallback }: { open: boolean; onClose: () => void; onCapture: (file: File) => void; onFallback: () => void }) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'starting' | 'live' | 'blocked' | 'none'>('starting');

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        audio: false,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().catch(() => undefined);
        }
      })
      .catch((error: { name?: string }) => setState(error && (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') ? 'none' : 'blocked'));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop()); // the camera light goes off as soon as the pop-up closes
    };
  }, [open]);

  const capture = () => {
    const el = video.current;
    if (!el || !el.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = el.videoWidth;
    canvas.height = el.videoHeight;
    canvas.getContext('2d')?.drawImage(el, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(new File([blob], 'receipt.jpg', { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92,
    );
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('scan.takePhoto')} size="wide">
      {state === 'blocked' || state === 'none' ? (
        <div className={styles.cameraProblem} role="alert">
          <p>{t(state === 'blocked' ? 'scan.camera.blocked' : 'scan.camera.none')}</p>
          <Button variant="outline" block onClick={onFallback}>
            {t('scan.chooseFile')}
          </Button>
        </div>
      ) : (
        <div className={styles.camera}>
          <div className={styles.viewport}>
            <video ref={video} className={styles.video} playsInline muted onLoadedData={() => setState('live')} aria-label={t('scan.camera.view')} data-testid="camera-video" />
            <div className={styles.frame} aria-hidden="true" />
          </div>
          <p className={styles.cameraHint}>{state === 'starting' ? t('scan.camera.starting') : t('scan.camera.hint')}</p>
          <Button block onClick={capture} disabled={state !== 'live'} data-testid="camera-capture">
            {t('scan.camera.capture')}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

/** The photo that was read, with the total marked, so a wrong pick is obvious at a glance. */
export function ReceiptPreview({ src, words, amount, onClose }: { src: string; words: OcrWord[]; amount: number; onClose: () => void }) {
  const { t } = useI18n();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const boxes = size ? toFractions(findAmountBoxes(words, amount), size.w, size.h) : [];
  return (
    <figure className={styles.preview} data-testid="receipt-preview">
      <div className={styles.imageWrap}>
        <div className={styles.stage}>
          <img
            src={src}
            alt={t('scan.preview.alt')}
            className={styles.image}
            onLoad={(event) =>
              setSize({
                w: event.currentTarget.naturalWidth,
                h: event.currentTarget.naturalHeight,
              })
            }
          />
          {boxes.length ? (
            <svg className={styles.marks} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
              {boxes.map((b, i) => (
                <rect key={i} className={styles.mark} data-testid="receipt-mark" x={b.x} y={b.y} width={b.w} height={b.h} rx={0.004} vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
          ) : null}
        </div>
      </div>
      <figcaption className={styles.caption}>
        <span>{boxes.length ? t('scan.preview.marked') : t('scan.preview.plain')}</span>
        <button type="button" className={styles.dismiss} onClick={onClose} aria-label={t('scan.preview.hide')}>
          <Icon name="x" size={18} />
        </button>
      </figcaption>
    </figure>
  );
}
