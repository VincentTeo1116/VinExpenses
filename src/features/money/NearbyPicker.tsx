// RX-04: lists the closest named places so the merchant does not have to be typed. The location is used once, kept nowhere, and
// sent only to the signed-in "nearby-place" service. The person picks a place (or searches the list); nothing is filled in by itself.
import { useId, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/Button';
import { useAuth } from '@/app/AuthProvider';
import { ApiError, callFunction } from '@/lib/api';
import { envResult } from '@/lib/env';
import { useI18n, type MessageKey } from '@/lib/i18n';
import styles from './NearbyPicker.module.css';

const reply = z.object({
  places: z
    .array(z.object({ name: z.string().min(1).max(80), kind: z.string().max(30), distance: z.number().min(0).max(5000) }))
    .max(20)
    .optional(),
});
type Place = { name: string; kind: string; distance: number };
type Problem = 'unsupported' | 'denied' | 'unavailable' | 'service' | 'offline' | 'limit';

const FIRST = 5;

function position(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(Object.assign(new Error('unsupported'), { code: 'unsupported' }));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      (e) => reject(Object.assign(new Error('geo'), { code: e.code === 1 ? 'denied' : 'unavailable' })),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  });
}

export function NearbyPicker({ onPick }: { onPick: (name: string) => void }) {
  const { t } = useI18n();
  const { session } = useAuth();
  const [step, setStep] = useState<'idle' | 'locating' | 'searching'>('idle');
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState('');
  const searchId = useId();
  const busy = step !== 'idle';

  const find = async () => {
    if (busy || !envResult.ok) return;
    setProblem(null);
    setPicked('');
    setQuery('');
    setAll(false);
    setStep('locating');
    try {
      const where = await position();
      setStep('searching');
      const answer = await callFunction('nearby-place', { ...where, list: true }, { baseUrl: envResult.env.supabaseUrl, anonKey: envResult.env.supabaseAnonKey, accessToken: session?.access_token, timeoutMs: 20_000, schema: reply });
      setPlaces(answer.places ?? []);
    } catch (error) {
      setPlaces(null);
      const code = (error as { code?: string }).code;
      if (error instanceof ApiError) setProblem(error.code === 'offline' ? 'offline' : error.code === 'rate_limited' ? 'limit' : 'service');
      else setProblem(code === 'unsupported' || code === 'denied' || code === 'unavailable' ? code : 'service');
    } finally {
      setStep('idle');
    }
  };

  const needle = query.trim().toLowerCase();
  const matches = (places ?? []).filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.kind.toLowerCase().includes(needle));
  const shown = needle || all ? matches : matches.slice(0, FIRST);

  return (
    <div className={styles.box}>
      <Button variant="outline" block loading={busy} onClick={() => void find()}>
        {step === 'locating' ? t('nearby.locating') : step === 'searching' ? t('nearby.searching') : t('nearby.button')}
      </Button>
      <p className={styles.hint}>{t('nearby.hint')}</p>
      {problem ? (
        <p className={`${styles.note} ${styles.bad}`} role="status" data-testid="nearby-note">
          {t(`nearby.e.${problem}` as MessageKey)}
        </p>
      ) : null}
      {places && !places.length ? (
        <p className={styles.note} role="status" data-testid="nearby-note">
          {t('nearby.none')}
        </p>
      ) : null}
      {places?.length ? (
        <div className={styles.list} role="group" aria-label={t('nearby.pick')}>
          <span className={styles.label}>{t('nearby.pick')}</span>
          {places.length > FIRST ? (
            <div className={styles.search}>
              <label htmlFor={searchId} className={styles.searchLabel}>
                {t('nearby.search')}
              </label>
              <input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" maxLength={40} />
            </div>
          ) : null}
          {shown.map((p) => (
            <button
              key={p.name}
              type="button"
              className={styles.place}
              aria-pressed={picked === p.name}
              data-testid="nearby-place"
              onClick={() => {
                setPicked(p.name);
                onPick(p.name);
              }}
            >
              <span className={styles.name}>{p.name}</span>
              <span className={styles.meta}>{[p.kind, p.distance ? t('nearby.away', { m: String(p.distance) }) : ''].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
          {needle && !matches.length ? <p className={styles.note}>{t('nearby.noMatch')}</p> : null}
          {!needle && matches.length > FIRST ? (
            <button type="button" className={styles.more} onClick={() => setAll((v) => !v)}>
              {all ? t('nearby.less') : t('nearby.more', { n: String(matches.length) })}
            </button>
          ) : null}
          {picked ? (
            <p className={styles.note} role="status">
              {t('nearby.picked', { name: picked })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
