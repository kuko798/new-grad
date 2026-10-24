// Socrata (SODA 2.x) helpers for the Chicago, NYC, San Francisco and Austin open-data portals.
import { createHash } from 'node:crypto';
import { cached, fetchWithRetry } from '../util.ts';

const PAGE = 50_000;

function withToken(): HeadersInit {
  // An app token raises rate limits; it is optional and stays server-side (ingestion only).
  return process.env.SOCRATA_APP_TOKEN ? { 'X-App-Token': process.env.SOCRATA_APP_TOKEN } : {};
}

export async function soql<T = Record<string, string>>(
  domain: string,
  dataset: string,
  params: Record<string, string>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const url = new URL(`https://${domain}/resource/${dataset}.json`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('$limit', String(PAGE));
    url.searchParams.set('$offset', String(offset));
    if (!params.$order) url.searchParams.set('$order', ':id');
    const res = await fetchWithRetry(url, { headers: withToken() });
    const page = (await res.json()) as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export interface GeoJsonFeature {
  type: 'Feature';
  properties: Record<string, string>;
  geometry: { type: string; coordinates: unknown } | null;
}

export async function geojson(domain: string, dataset: string): Promise<GeoJsonFeature[]> {
  const url = new URL(`https://${domain}/resource/${dataset}.geojson`);
  url.searchParams.set('$limit', '5000');
  const res = await fetchWithRetry(url, { headers: withToken() });
  const fc = (await res.json()) as { features: GeoJsonFeature[] };
  return fc.features;
}

/** Dataset metadata: when the publisher last updated rows, for the source record. */
export async function metadata(domain: string, dataset: string): Promise<{ name: string; dataUpdatedAt: string | null; license: string | null }> {
  const res = await fetchWithRetry(`https://${domain}/api/views/${dataset}.json`, { headers: withToken() });
  const j = (await res.json()) as { name: string; rowsUpdatedAt?: number; license?: { name?: string } };
  return {
    name: j.name,
    dataUpdatedAt: j.rowsUpdatedAt ? new Date(j.rowsUpdatedAt * 1000).toISOString() : null,
    license: j.license?.name ?? null,
  };
}

/** An aggregate query cached for a few days, so a failed run can resume without repeating finished queries. */
export async function cachedSoql<T = Record<string, string>>(domain: string, dataset: string, params: Record<string, string>): Promise<T[]> {
  const hash = createHash('sha1').update(JSON.stringify(params)).digest('hex').slice(0, 12);
  return (await cached(`socrata/${domain}-${dataset}-${hash}`, 6, () => soql<T>(domain, dataset, params))).value;
}
