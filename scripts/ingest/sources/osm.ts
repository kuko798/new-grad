// Amenity and station counts from OpenStreetMap via the Overpass API (ODbL). One query per city fetches every
// category and features are classified by their tags here; the app never calls Overpass. If the combined query
// fails (large cities can time out), each category is fetched on its own.
import type { LngLat } from '../../../src/lib/types.ts';
import type { BBox } from '../../../src/lib/geo.ts';
import { cached, fetchWithRetry, flags, log, peekCache } from '../util.ts';

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

export type OsmCategory = 'grocery' | 'parks' | 'restaurants' | 'nightlife' | 'rail' | 'bus' | 'dogParks' | 'places';
export const OSM_CATEGORIES: OsmCategory[] = ['grocery', 'parks', 'restaurants', 'nightlife', 'rail', 'bus', 'dogParks', 'places'];

/** Overpass filters per category. Kept narrow so counts mean the same thing in every city. */
export const OSM_FILTERS: Record<OsmCategory, string[]> = {
  grocery: ['nwr["shop"="supermarket"]', 'nwr["shop"="greengrocer"]'],
  parks: ['nwr["leisure"="park"]'],
  restaurants: ['nwr["amenity"="restaurant"]', 'nwr["amenity"="cafe"]'],
  nightlife: ['nwr["amenity"="bar"]', 'nwr["amenity"="pub"]', 'nwr["amenity"="nightclub"]'],
  rail: ['node["railway"="station"]', 'node["railway"="halt"]', 'node["railway"="tram_stop"]'],
  bus: ['node["highway"="bus_stop"]'],
  dogParks: ['nwr["leisure"="dog_park"]'],
  places: ['node["place"~"^(suburb|neighbourhood|quarter)$"]["name"]'],
};

export const OSM_DEFINITIONS: Record<Exclude<OsmCategory, 'places'>, string> = {
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
  /** name, kept for place labels */
  n?: string;
  /** place rank: 0 suburb, 1 neighbourhood/quarter */
  r?: number;
}

type Element = { type: string; id?: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

function categoriesOf(el: Element): OsmCategory[] {
  const t = el.tags ?? {};
  const out: OsmCategory[] = [];
  if (t.shop === 'supermarket' || t.shop === 'greengrocer') out.push('grocery');
  if (t.leisure === 'park') out.push('parks');
  if (t.amenity === 'restaurant' || t.amenity === 'cafe') out.push('restaurants');
  if (t.amenity === 'bar' || t.amenity === 'pub' || t.amenity === 'nightclub') out.push('nightlife');
  if (el.type === 'node' && (t.railway === 'station' || t.railway === 'halt' || t.railway === 'tram_stop')) out.push('rail');
  if (el.type === 'node' && t.highway === 'bus_stop') out.push('bus');
  if (t.leisure === 'dog_park') out.push('dogParks');
  if (el.type === 'node' && t.name && /^(suburb|neighbourhood|quarter)$/.test(t.place ?? '')) out.push('places');
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function overpass(query: string): Promise<{ elements: Element[] }> {
  let lastErr: unknown;
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetchWithRetry(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
      }, 1);
      const j = (await res.json()) as { elements: Element[]; remark?: string };
      // Overpass reports a timeout or memory error as a 200 with a remark and partial data; treat that as a failure.
      if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) throw new Error(`Overpass: ${j.remark.slice(0, 120)}`);
      return j;
    } catch (err) {
      lastErr = err;
      log(`overpass endpoint failed (${endpoint}): ${(err as Error).message}`);
    }
  }
  throw lastErr;
}

function toPoint(el: Element, cat: OsmCategory): OsmPoint | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat === undefined || lon === undefined) return null;
  const pt: OsmPoint = { p: [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] };
  if (cat === 'rail' && el.tags?.wheelchair) pt.w = el.tags.wheelchair;
  if (cat === 'places') {
    pt.n = el.tags!.name;
    pt.r = el.tags!.place === 'suburb' ? 0 : 1;
  }
  return pt;
}

function split(elements: Element[]): Record<OsmCategory, OsmPoint[]> {
  const out = Object.fromEntries(OSM_CATEGORIES.map((c) => [c, [] as OsmPoint[]])) as Record<OsmCategory, OsmPoint[]>;
  for (const el of elements)
    for (const cat of categoriesOf(el)) {
      const pt = toPoint(el, cat);
      if (pt) out[cat].push(pt);
    }
  return out;
}

const bboxString = (b: BBox) => `${b[1]},${b[0]},${b[3]},${b[2]}`;

/** Every feature in a box, from one combined query; a box that fails is split into quarters (up to three levels). */
async function tiled(box: BBox, depth = 0, label = ''): Promise<Element[]> {
  const body = OSM_CATEGORIES.flatMap((c) => OSM_FILTERS[c]).map((f) => `${f}(${bboxString(box)});`).join('');
  try {
    // A modest timeout and the default memory limit get a query admitted sooner when the servers are busy.
    const json = await overpass(`[out:json][timeout:120];(${body});out center tags qt;`);
    await sleep(3000);
    return json.elements;
  } catch (err) {
    if (depth >= 3) throw err;
    log(`overpass: splitting tile${label || ' (city)'} after: ${(err as Error).message.slice(0, 80)}`);
    await sleep(20_000);
    const [w, s, e, n] = box;
    const mx = (w + e) / 2;
    const my = (s + n) / 2;
    const quarters: BBox[] = [[w, s, mx, my], [mx, s, e, my], [w, my, mx, n], [mx, my, e, n]];
    const out: Element[] = [];
    for (let i = 0; i < 4; i++) out.push(...(await tiled(quarters[i], depth + 1, `${label}.${i + 1}`)));
    return out;
  }
}

/** Every category for a city. Features on tile edges can be returned twice, so they are deduplicated by OSM id. */
export async function osmAll(cityKey: string, bbox: BBox) {
  if (flags.noOsmFetch) {
    const hit = await peekCache<Record<OsmCategory, OsmPoint[]>>(`osm/${cityKey}-all`);
    if (hit) return hit;
    throw new Error('OpenStreetMap data not fetched yet (run with --osm-only)');
  }
  return cached(`osm/${cityKey}-all`, 30, async () => {
    const elements = await tiled(bbox);
    const seen = new Set<string>();
    const unique = elements.filter((el) => {
      const k = `${el.type}/${el.id}`;
      if (el.id === undefined || !seen.has(k)) {
        seen.add(k);
        return true;
      }
      return false;
    });
    return split(unique);
  });
}
