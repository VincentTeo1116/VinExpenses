// RX-04: lists the closest named places so the merchant does not have to be typed. The location is used once and kept nowhere. It goes
// straight from the device to two public map services (the free ones refuse server addresses); only if neither can be reached does it go
// through the signed-in "nearby-place" function. The person picks a place (or searches the list); nothing is filled in by itself.
import { useEffect, useId, useState } from 'react';
import { z } from 'zod';
import { Icon } from '@/components/Icon';
import { useAuth } from '@/app/AuthProvider';
import { ApiError, callFunction } from '@/lib/api';
import { envResult } from '@/lib/env';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { mergePlaces, nearestPlaces, placesFromPhoton } from '../../../supabase/functions/_shared/nearby.ts';
import styles from './NearbyPicker.module.css';

const reply = z.object({
  places: z
    .array(z.object({ name: z.string().min(1).max(80), kind: z.string().max(30), distance: z.number().min(0).max(5000) }))
    .max(20)
    .optional(),
  // an older deployed server answers with one name instead of a list; it is shown as a list of one
  name: z.string().min(1).max(80).optional(),
});
type Place = { name: string; kind: string; distance: number };
/** What the lookup is doing right now (shown to the person while they wait). */
type Working = 'locating' | 'searching' | 'wider' | 'backup';
type Problem = 'unsupported' | 'denied' | 'unavailable' | 'service' | 'offline' | 'limit';

const FIRST = 5;
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const PHOTON_URL = 'https://photon.komoot.io/reverse';
const DIRECT_MS = 8000;

/**
 * Asks the public map services from the person's own device (the free ones refuse the shared addresses that server functions run from,
 * but accept ordinary visitors). Photon goes first: it is quick and rarely busy. Overpass, which is often at capacity, is asked only when
 * Photon fails or finds nothing, so a busy Overpass does not slow the answer or fill the console. Throws only when NEITHER could be
 * asked; an empty list means the map has nothing there.
 */
async function nearbyDirect(where: Fix, radius: number): Promise<Place[]> {
  const { latitude: lat, longitude: lon } = where;
  const around = `(around:${radius},${lat},${lon})`;
  // four simple key filters are much cheaper for Overpass than one regular expression over every key
  const query = `[out:json][timeout:6];(${['amenity', 'shop', 'tourism', 'leisure'].map((key) => `nwr${around}[name][${key}];`).join('')});out center 60;`;
  const overpass = async (): Promise<Place[]> => {
    const response = await fetch(OVERPASS_URL, { method: 'POST', body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(DIRECT_MS), credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('overpass');
    return nearestPlaces(((await response.json()) as { elements?: unknown }).elements, lat, lon, 20);
  };
  const photon = async (): Promise<Place[]> => {
    // the tag filters keep roads and buildings from using up the 40 places Photon returns
    const params = new URLSearchParams({ lat: String(lat), lon: String(lon), radius: String(radius / 1000), limit: '40', lang: 'en' });
    for (const key of ['amenity', 'shop', 'tourism', 'leisure']) params.append('osm_tag', key);
    const url = `${PHOTON_URL}?${params}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(DIRECT_MS), credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('photon');
    return placesFromPhoton(await response.json(), lat, lon, 20);
  };
  const lists: Place[][] = [];
  let answered = false;
  for (const ask of [photon, overpass]) {
    try {
      lists.push(await ask());
      answered = true;
      if (lists.flat().length) break;
    } catch {
      // that service could not be asked: the next one is tried
    }
  }
  if (!answered) throw new Error('no map service answered');
  return mergePlaces(lists, 10);
}

type Fix = { latitude: number; longitude: number };

function once(options: PositionOptions): Promise<Fix> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      (e) => reject(Object.assign(new Error('geo'), { code: e.code === 1 ? 'denied' : 'unavailable' })),
      options,
    );
  });
}

/**
 * The position once. A quick, network-based fix comes first (works indoors and on computers, which have no GPS; about 100 m is plenty for
 * naming a shop). Only when that cannot be had does it ask for the GPS, which can take longer. A refusal is never retried.
 */
async function position(): Promise<Fix> {
  if (!('geolocation' in navigator)) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
  try {
    return await once({ enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 });
  } catch (error) {
    if ((error as { code?: string }).code === 'denied') throw error;
    return once({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 });
  }
}

/** The whole lookup: ask for the position, then for places. Used by the pin button in the field and by the list under it. */
export function useNearby(onPick: (name: string) => void) {
  const { session } = useAuth();
  const [step, setStep] = useState<'idle' | Working>('idle');
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
    setPlaces(null);
    setStep('locating');
    try {
      const where = await position();
      setStep('searching');
      let found: Place[] | null = null;
      try {
        // one wider search (the nearest are listed first anyway), and a last, wider one only when the first found nothing
        found = await nearbyDirect(where, 300);
        if (!found.length) {
          setStep('wider');
          found = await nearbyDirect(where, 600);
        }
      } catch {
        found = null; // the map services could not be asked from here: try through the app's server
      }
      if (found) {
        setPlaces(found);
        return;
      }
      setStep('backup');
      const answer = await callFunction('nearby-place', { ...where, list: true }, { baseUrl: envResult.env.supabaseUrl, anonKey: envResult.env.supabaseAnonKey, accessToken: session?.access_token, timeoutMs: 20_000, schema: reply });
      setPlaces(answer.places ?? (answer.name ? [{ name: answer.name, kind: '', distance: 0 }] : []));
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

  return { busy, step, find: () => void find(), problem, places, query, setQuery, all, setAll, picked, setPicked, matches, shown, needle, onPick, searchId };
}

export type Nearby = ReturnType<typeof useNearby>;

/** The map-pin button that sits inside the "Where" field. Its name changes while it works, so a screen reader hears the progress. */
export function NearbyLocate({ nearby }: { nearby: Nearby }) {
  const { t } = useI18n();
  const label = nearby.step === 'idle' ? t('nearby.button') : nearby.step === 'locating' ? t('nearby.locating') : t('nearby.searching');
  return (
    <button type="button" className={`${styles.locate} ${nearby.busy ? styles.working : ''}`} aria-label={label} title={label} aria-busy={nearby.busy} onClick={nearby.find}>
      <Icon name="pin" size={20} />
    </button>
  );
}

/** A few friendly lines for each step, shown one after another so the wait has something to read (all of them need their translations). */
const TIPS: Record<Working, MessageKey[]> = {
  locating: ['nearby.tip.locating1', 'nearby.tip.locating2', 'nearby.tip.locating3'],
  searching: ['nearby.tip.searching1', 'nearby.tip.searching2', 'nearby.tip.searching3', 'nearby.tip.searching4'],
  wider: ['nearby.tip.wider1', 'nearby.tip.wider2'],
  backup: ['nearby.tip.backup1', 'nearby.tip.backup2'],
};
const TIP_MS = 2600;
const SLOW_AFTER_MS = 9000;

/**
 * What is happening, under the field, while the lookup works: the step in bold (announced once to screen readers), then lines that change
 * every few seconds (hidden from them, so nothing is read out repeatedly), and an honest "still trying" when it takes long.
 * It starts again for each step because the parent gives it a new key.
 */
function NearbyProgress({ step }: { step: Working }) {
  const { t } = useI18n();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), TIP_MS);
    return () => clearInterval(timer);
  }, []);
  const tips = TIPS[step];
  const slow = tick * TIP_MS >= SLOW_AFTER_MS;
  const line = slow ? t('nearby.slow') : t(tips[Math.min(tick, tips.length - 1)] as MessageKey);
  return (
    <div className={styles.progress} data-testid="nearby-progress">
      <span className={styles.spinner} aria-hidden="true" />
      <div className={styles.progressText}>
        <p className={styles.progressMain} role="status">
          {t(`nearby.step.${step}` as MessageKey)}
        </p>
        <p className={styles.progressTip} key={line} aria-hidden="true">
          {line}
        </p>
      </div>
    </div>
  );
}

/** What the lookup is doing, found, or why it could not, under the field. */
export function NearbyResults({ nearby }: { nearby: Nearby }) {
  const { t } = useI18n();
  const { problem, places, query, setQuery, all, setAll, picked, setPicked, matches, shown, needle, onPick, searchId } = nearby;
  if (nearby.step !== 'idle') return <NearbyProgress key={nearby.step} step={nearby.step} />;
  if (!problem && !places) return null;
  return (
    <div className={styles.box}>
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
