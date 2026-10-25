import { useCallback, useEffect, useState } from 'react';
import type { CityDataset, CityId, DataManifest } from '../lib/types.ts';

import { CITIES, CITY_IDS, isCityId as isKnownCity } from '../lib/cities.ts';

export const CITY_ORDER: CityId[] = CITY_IDS;
export const CITY_NAMES: Record<CityId, string> = Object.fromEntries(CITIES.map((c) => [c.id, c.name]));
export const isCityId = (s: string | undefined): s is CityId => isKnownCity(s);

const cache = new Map<string, Promise<unknown>>();

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(res.status === 404 ? 'not-found' : `HTTP ${res.status}`);
  return (await res.json()) as T;
}

function load<T>(path: string): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = getJson<T>(path);
    cache.set(path, p);
    p.catch(() => cache.delete(path)); // a failed load can be retried
  }
  return p;
}

export type Loadable<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: string; retry: () => void };

function useLoad<T>(path: string | null): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setState({ status: 'loading' });
    load<T>(path).then(
      (data) => live && setState({ status: 'ready', data }),
      (err: Error) => live && setState({ status: 'error', error: err.message, retry }),
    );
    return () => {
      live = false;
    };
  }, [path, attempt, retry]);
  return state;
}

export const useCity = (city: CityId | null) => useLoad<CityDataset>(city ? `/data/${city}.json` : null);
export const useManifest = () => useLoad<DataManifest>('/data/manifest.json');

/** Days since a source was retrieved, and whether that exceeds its own staleness threshold. */
export function freshness(retrievedAt: string, staleAfterDays: number, now = Date.now()) {
  const days = Math.floor((now - new Date(retrievedAt).getTime()) / 86_400_000);
  return { days, stale: days > staleAfterDays };
}
