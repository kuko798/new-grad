// Amenity and station counts from OpenStreetMap via the Overpass API (ODbL). Queries run once per city per
// category during ingestion, politely and in sequence; the app never calls Overpass.
import type { LngLat } from '../../../src/lib/types.ts';
import type { BBox } from '../../../src/lib/geo.ts';
import { cached, fetchWithRetry, log } from '../util.ts';

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

export type OsmCategory = 'grocery' | 'parks' | 'restaurants' | 'nightlife' | 'rail' | 'bus' | 'dogParks';

/** Overpass filters per category. Kept narrow so counts mean the same thing in every city. */
export const OSM_FILTERS: Record<OsmCategory, string[]> = {
  grocery: ['nwr["shop"="supermarket"]', 'nwr["shop"="greengrocer"]'],
  parks: ['nwr["leisure"="park"]'],
  restaurants: ['nwr["amenity"="restaurant"]', 'nwr["amenity"="cafe"]'],
  nightlife: ['nwr["amenity"="bar"]', 'nwr["amenity"="pub"]', 'nwr["amenity"="nightclub"]'],
  rail: ['node["railway"="station"]', 'node["railway"="halt"]', 'node["railway"="tram_stop"]'],
  bus: ['node["highway"="bus_stop"]'],
  dogParks: ['nwr["leisure"="dog_park"]'],
};

export const OSM_DEFINITIONS: Record<OsmCategory, string> = {
  grocery: 'OSM shop=supermarket or shop=greengrocer',
  parks: 'OSM leisure=park',
  restaurants: 'OSM amenity=restaurant or amenity=cafe',
  nightlife: 'OSM amenity=bar, pub or nightclub',
  rail: 'OSM railway=station or halt, and light-rail/subway stops',
  bus: 'OSM highway=bus_stop',
  dogParks: 'OSM leisure=dog_park',
};

export interface OsmPoint {
  p: LngLat;
  /** wheelchair tag for stations: 'yes' | 'no' | 'limited' | undefined */
  w?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function overpass(query: string): Promise<{ elements: Array<{ lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }> }> {
  let lastErr: unknown;
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetchWithRetry(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
      }, 3);
      return await res.json();
    } catch (err) {
      lastErr = err;
      log(`overpass endpoint failed (${endpoint}): ${(err as Error).message}`);
    }
  }
  throw lastErr;
}

export async function osmPoints(cityKey: string, category: OsmCategory, bbox: BBox) {
  return cached(`osm/${cityKey}-${category}`, 30, async () => {
    const b = `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`;
    const body = OSM_FILTERS[category].map((f) => `${f}(${b});`).join('');
    const q = `[out:json][timeout:240];(${body});out center tags qt;`;
    const json = await overpass(q);
    await sleep(3000); // be polite between heavy queries
    const points: OsmPoint[] = [];
    for (const el of json.elements) {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat === undefined || lon === undefined) continue;
      const pt: OsmPoint = { p: [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] };
      if (category === 'rail' && el.tags?.wheelchair) pt.w = el.tags.wheelchair;
      points.push(pt);
    }
    return points;
  });
}
