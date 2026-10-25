import { join } from 'node:path';
import {
  PolygonIndex,
  bboxOf,
  haversineM,
  multiPolygonAreaKm2,
  polygonCentroid,
  simplifyMultiPolygon,
  toMultiPolygon,
  unionBBox,
  type BBox,
} from '../../src/lib/geo.ts';
import { percentileRanks } from '../../src/lib/stats.ts';
import type {
  Amenities,
  BedroomKey,
  CityDataset,
  IncidentKind,
  IncidentMeasure,
  LngLat,
  MultiPolygon,
  Neighborhood,
  SourceRecord,
} from '../../src/lib/types.ts';
import polygonClipping from 'polygon-clipping';
import { cityInfo } from '../../src/lib/cities.ts';
import type { IncidentResult } from './cities/types.ts';
import { slug } from './cities/types.ts';
import { arcgisPolygons } from './generic/fetch.ts';
import { runGenericIncidents } from './generic/incidents.ts';
import type { CityConfig, OfficialGeography } from './registry.ts';
import { ZCTA_URL, countiesInBox, placeBoundary, PLACES_URL, zctasInBox } from './sources/tiger.ts';
import { BLOCKS_URL, blocksForCounty } from './sources/blocks.ts';
import { ACS_PERIOD, ZCTA_TRACT_URL, acsTable, tractToZcta } from './sources/census.ts';
import { LODES_STATES, LODES_YEAR, jobsByBlock, lodesUrl } from './sources/lodes.ts';
import { OSM_DEFINITIONS, osmAll, type OsmCategory, type OsmPoint } from './sources/osm.ts';
import { SAFMR_FY, SAFMR_URL, safmrByZip } from './sources/safmr.ts';
import { geojson } from './sources/socrata.ts';
import { cached, fetchWithRetry, flags, log, OUT_DIR, titleCase, writeJson } from './util.ts';

/** Neighborhoods with fewer residents are parkland, airports or industrial areas: listed in coverage notes, not ranked. */
const MIN_RANKED_POPULATION = 500;
/** Below this, per-resident incident rates are too unstable to compare. */
const MIN_RATE_POPULATION = 2000;
/** ACS medians at or above this were top-coded by the Census Bureau ("3,500+"). */
const ACS_TOP_CODE = 3500;
/** A tract's bedroom-specific median is used only with this many renter units of that size behind it… */
const MIN_TRACT_UNITS = 30;
/** …and a neighborhood benchmark needs this many allocated units in total, so a handful of subsidized units cannot set it. */
const MIN_HOOD_UNITS = 200;

interface Draft {
  id: string;
  name: string;
  district: string | null;
  geometry: MultiPolygon;
}

const BR_COLUMNS: Record<BedroomKey, { rent: string; renters: string; safmr: 'br0' | 'br1' | 'br2' | 'br3' }> = {
  studio: { rent: 'B25031_E002', renters: 'B25042_E010', safmr: 'br0' },
  br1: { rent: 'B25031_E003', renters: 'B25042_E011', safmr: 'br1' },
  br2: { rent: 'B25031_E004', renters: 'B25042_E012', safmr: 'br2' },
  br3: { rent: 'B25031_E005', renters: 'B25042_E013', safmr: 'br3' },
};

const round = (n: number, dp = 0) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Population and housing-unit shares of each tract that fall in each neighborhood, built from 2020 blocks. */
interface Crosswalk {
  /** tract → neighborhood → { pop share, housing-unit share } */
  tract: Map<string, Map<string, { pop: number; hu: number }>>;
  /** block group → neighborhood → population share (block count share where the group has no residents) */
  blockGroup: Map<string, Array<[string, number]>>;
  /** neighborhood → block-population-weighted centre */
  centre: Map<string, LngLat>;
  /** block → neighborhood */
  blockHood: Map<string, string>;
}

function buildCrosswalk(blocks: Array<{ g: string; pop: number; hu: number; p: LngLat }>, find: (p: LngLat) => string | null): Crosswalk {
  const tractTotals = new Map<string, { pop: number; hu: number }>();
  const tractParts = new Map<string, Map<string, { pop: number; hu: number }>>();
  const bgTotals = new Map<string, { pop: number; n: number }>();
  const bgParts = new Map<string, Map<string, { pop: number; n: number }>>();
  const centreSum = new Map<string, { x: number; y: number; w: number }>();
  const blockHood = new Map<string, string>();

  for (const b of blocks) {
    const tract = b.g.slice(0, 11);
    const bg = b.g.slice(0, 12);
    const t = tractTotals.get(tract) ?? { pop: 0, hu: 0 };
    t.pop += b.pop;
    t.hu += b.hu;
    tractTotals.set(tract, t);
    const g = bgTotals.get(bg) ?? { pop: 0, n: 0 };
    g.pop += b.pop;
    g.n += 1;
    bgTotals.set(bg, g);

    const hood = find(b.p);
    if (!hood) continue;
    blockHood.set(b.g, hood);
    if (!tractParts.has(tract)) tractParts.set(tract, new Map());
    const tp = tractParts.get(tract)!.get(hood) ?? { pop: 0, hu: 0 };
    tp.pop += b.pop;
    tp.hu += b.hu;
    tractParts.get(tract)!.set(hood, tp);
    if (!bgParts.has(bg)) bgParts.set(bg, new Map());
    const gp = bgParts.get(bg)!.get(hood) ?? { pop: 0, n: 0 };
    gp.pop += b.pop;
    gp.n += 1;
    bgParts.get(bg)!.set(hood, gp);
    if (b.pop > 0) {
      const c = centreSum.get(hood) ?? { x: 0, y: 0, w: 0 };
      c.x += b.p[0] * b.pop;
      c.y += b.p[1] * b.pop;
      c.w += b.pop;
      centreSum.set(hood, c);
    }
  }

  const tract = new Map<string, Map<string, { pop: number; hu: number }>>();
  for (const [t, parts] of tractParts) {
    const tot = tractTotals.get(t)!;
    const m = new Map<string, { pop: number; hu: number }>();
    for (const [h, v] of parts) {
      const pop = tot.pop > 0 ? v.pop / tot.pop : 0;
      const hu = tot.hu > 0 ? v.hu / tot.hu : pop;
      if (pop > 0 || hu > 0) m.set(h, { pop, hu });
    }
    if (m.size) tract.set(t, m);
  }
  const blockGroup = new Map<string, Array<[string, number]>>();
  for (const [bg, parts] of bgParts) {
    const tot = bgTotals.get(bg)!;
    blockGroup.set(bg, [...parts].map(([h, v]) => [h, tot.pop > 0 ? v.pop / tot.pop : v.n / tot.n] as [string, number]).filter(([, s]) => s > 0));
  }
  const centre = new Map<string, LngLat>();
  for (const [h, c] of centreSum) centre.set(h, [round(c.x / c.w, 5), round(c.y / c.w, 5)]);
  return { tract, blockGroup, centre, blockHood };
}

/** Adds a feature to the draft list, dissolving features that share an id into one MultiPolygon. */
function addDraft(drafts: Map<string, Draft>, d: Draft) {
  const existing = drafts.get(d.id);
  if (existing) existing.geometry.coordinates.push(...d.geometry.coordinates);
  else drafts.set(d.id, d);
}

type Feature = { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } | null };

async function officialDrafts(cityId: string, g: OfficialGeography): Promise<{ drafts: Draft[]; retrievedAt: string }> {
  const fields = [g.nameField, ...(g.districtField ? [g.districtField] : [])];
  const fetched = await cached(`boundaries/${cityId}`, 30, async (): Promise<Feature[]> => {
    if (g.source.type === 'arcgis') return arcgisPolygons(g.source.url, g.source.where ?? '1=1', fields);
    if (g.source.type === 'socrata') return (await geojson(g.source.domain, g.source.dataset)) as unknown as Feature[];
    const res = await fetchWithRetry(g.source.url);
    return ((await res.json()) as { features: Feature[] }).features;
  });
  const drafts = new Map<string, Draft>();
  for (const f of fetched.value) {
    const raw = String(f.properties?.[g.nameField] ?? '').trim();
    if (!f.geometry || !raw) continue;
    let name = /[a-z]/.test(raw) ? raw : titleCase(raw);
    if (g.rename) name = g.rename(name);
    const districtRaw = g.districtField ? String(f.properties?.[g.districtField] ?? '').trim() : '';
    const district = districtRaw ? (g.districtField === 'NPU' ? `NPU ${districtRaw}` : /[a-z]/.test(districtRaw) ? districtRaw : titleCase(districtRaw)) : null;
    addDraft(drafts, { id: `${cityId}-${slug(name)}`, name, district, geometry: toMultiPolygon(f.geometry) });
  }
  return { drafts: [...drafts.values()], retrievedAt: fetched.retrievedAt };
}

/** ZIP Code Tabulation Areas clipped to the city limits. */
function zctaDrafts(cityId: string, place: MultiPolygon, zctas: Array<{ zcta: string; geometry: MultiPolygon }>): Draft[] {
  const out: Draft[] = [];
  for (const z of zctas) {
    const clipped = polygonClipping.intersection(z.geometry.coordinates as never, place.coordinates as never) as unknown as MultiPolygon['coordinates'];
    if (!clipped.length) continue;
    const geometry: MultiPolygon = { type: 'MultiPolygon', coordinates: clipped };
    if (multiPolygonAreaKm2(geometry) < 0.1) continue;
    out.push({ id: `${cityId}-${z.zcta}`, name: `ZIP ${z.zcta}`, district: null, geometry });
  }
  return out;
}

export async function buildCity(cfg: CityConfig): Promise<CityDataset | null> {
  const sources: SourceRecord[] = [];
  const nowIso = new Date().toISOString();
  const info = cityInfo(cfg.id);
  const id = cfg.id;

  // 1. Geography. Hand-written adapters bring their own boundaries; generic cities use an official partition or
  // ZIP areas clipped to the Census place (city limits). Features sharing an id are dissolved.
  let draftList: Draft[];
  let counties: string[];
  let place: MultiPolygon | null = null;
  let geographyLabel: string;
  let geographyKind: 'official' | 'zcta' = 'official';
  let baseCoverage: string;
  if (cfg.kind === 'custom') {
    const adapter = cfg.adapter;
    const boundary = await cached(`boundaries/${id}`, 30, () => geojson(adapter.boundary.domain, adapter.boundary.dataset));
    const drafts = new Map<string, Draft>();
    for (const f of boundary.value) {
      if (!f.geometry) continue;
      const feat = adapter.boundary.toFeature(f);
      if (feat) addDraft(drafts, { ...feat, geometry: toMultiPolygon(f.geometry) });
    }
    draftList = [...drafts.values()];
    counties = adapter.counties;
    geographyLabel = adapter.geographyLabel;
    baseCoverage = adapter.coverage;
    sources.push({
      id: `${id}-boundaries`, name: adapter.boundary.title, publisher: adapter.boundary.publisher, url: adapter.boundary.pageUrl,
      license: adapter.boundary.license, observationPeriod: 'Current boundaries', retrievedAt: boundary.retrievedAt,
      updateFrequency: 'Rarely; boundaries change with official redefinitions', staleAfterDays: 365, status: 'ok',
    });
  } else {
    const p = await placeBoundary(cfg.placeGeoid);
    place = p.value.geometry;
    const box = bboxOf(place);
    counties = (await countiesInBox(box)).value;
    sources.push({
      id: 'census-place', name: `City limits: ${p.value.name} (TIGERweb incorporated places)`, publisher: 'U.S. Census Bureau', url: PLACES_URL,
      license: 'Public domain (U.S. Government work)', observationPeriod: 'Current TIGER/Line boundaries', retrievedAt: p.retrievedAt,
      updateFrequency: 'Annually', staleAfterDays: 730, status: 'ok',
      notes: 'Everything is counted inside the legal city limits only: residents, amenities and incidents outside them are left out.',
    });
    if (cfg.geography.kind === 'official') {
      const g = cfg.geography;
      const o = await officialDrafts(id, g);
      draftList = o.drafts;
      geographyLabel = g.label;
      baseCoverage = `The City of ${info.name}, using ${g.title} from ${g.publisher}.`;
      sources.push({
        id: `${id}-boundaries`, name: g.title, publisher: g.publisher, url: g.pageUrl, license: g.license, observationPeriod: 'Current boundaries',
        retrievedAt: o.retrievedAt, updateFrequency: 'Rarely; boundaries change with official redefinitions', staleAfterDays: 365, status: 'ok',
      });
    } else {
      geographyKind = 'zcta';
      const z = await zctasInBox(box);
      draftList = zctaDrafts(id, place, z.value);
      geographyLabel = 'ZIP code area';
      baseCoverage = `The City of ${info.name}, divided into ZIP Code Tabulation Areas clipped to the city limits, because the city publishes no clean neighborhood partition in open data. ZIP areas are larger than neighborhoods and are named by number, with mapped neighborhood names listed where OpenStreetMap has them.`;
      sources.push({
        id: 'census-zcta', name: '2020 ZIP Code Tabulation Areas (TIGERweb)', publisher: 'U.S. Census Bureau', url: ZCTA_URL,
        license: 'Public domain (U.S. Government work)', observationPeriod: '2020 Census', retrievedAt: z.retrievedAt, updateFrequency: 'Decennial',
        staleAfterDays: 3650, status: 'ok', notes: 'ZCTAs approximate USPS ZIP code delivery areas. Each is clipped to the city limits.',
      });
    }
  }
  const states = [...new Set(counties.map((c) => c.slice(0, 2)))];
  // Point lookups run against lightly simplified copies (about 2 m for areas, 10 m for the city limits): official
  // boundaries can carry tens of thousands of vertices, and every block, amenity and incident is tested.
  const index = new PolygonIndex(draftList.map((d) => ({ id: d.id, geometry: simplifyMultiPolygon(d.geometry, 0.00002, 6) })));
  const placeIndex = place ? new PolygonIndex([{ geometry: simplifyMultiPolygon(place, 0.0001, 6) }]) : null;
  const find = (p: LngLat) => (placeIndex && !placeIndex.find(p) ? null : index.find(p)?.id ?? null);
  log(`${id}: ${draftList.length} areas (${geographyKind}), counties ${counties.join(',')}`);

  // 2. Block crosswalk.
  const blockEntries = [];
  for (const county of counties) blockEntries.push(await blocksForCounty(county));
  const blocks = blockEntries.flatMap((e) => e.value);
  const xw = buildCrosswalk(blocks, find);
  // Coverage and overlap checks on the geography, by 2020 residents inside the city.
  let inCity = 0, inAreas = 0, overlapping = 0;
  for (const b of blocks) {
    if (b.pop === 0 || (placeIndex && !placeIndex.find(b.p))) continue;
    inCity += b.pop;
    const hits = index.findAll(b.p).length;
    if (hits) inAreas += b.pop;
    if (hits > 1) overlapping += b.pop;
  }
  const coveredShare = inCity ? inAreas / inCity : 1;
  const overlapShare = inCity ? overlapping / inCity : 0;
  log(`${id}: ${blocks.length} blocks, ${xw.tract.size} tracts; areas cover ${(coveredShare * 100).toFixed(1)}% of residents, ${(overlapShare * 100).toFixed(1)}% in overlapping areas`);
  sources.push({
    id: 'census-blocks',
    name: '2020 Census blocks: population, housing units and internal points (TIGERweb)',
    publisher: 'U.S. Census Bureau',
    url: BLOCKS_URL,
    license: 'Public domain (U.S. Government work)',
    observationPeriod: '2020 Census',
    retrievedAt: blockEntries[0].retrievedAt,
    updateFrequency: 'Decennial',
    staleAfterDays: 3650,
    status: 'ok',
    notes: 'Each block is placed in the neighborhood containing its internal point. Tract-level ACS figures are then split between neighborhoods by the share of the tract’s 2020 residents (or housing units, for renter figures) in each.',
  });

  // 3. ACS population and rent.
  const [pop, rent, tenure] = await Promise.all([acsTable('B01003'), acsTable('B25031'), acsTable('B25042')]);
  sources.push({
    id: 'acs-5yr',
    name: 'American Community Survey tables B01003 (population), B25031 (median gross rent by bedrooms), B25042 (tenure by bedrooms)',
    publisher: 'U.S. Census Bureau',
    url: 'https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/',
    license: 'Public domain (U.S. Government work)',
    observationPeriod: ACS_PERIOD,
    retrievedAt: rent.retrievedAt,
    updateFrequency: 'Annually (each December)',
    staleAfterDays: 450,
    status: 'ok',
    notes: 'Gross rent is contract rent plus estimated utilities and fuels paid by the renter. It covers all renters, including long-term and subsidized tenants, so it runs below current asking rents.',
  });

  // 4. HUD Small Area FMRs, joined through the tract → ZCTA relationship file.
  let safmr: Record<string, { br0: number; br1: number; br2: number; br3: number }> | null = null;
  let zctaOf: Record<string, string> = {};
  try {
    const [s, z] = await Promise.all([safmrByZip(), tractToZcta()]);
    safmr = s.value;
    zctaOf = z.value;
    sources.push({
      id: 'hud-safmr',
      name: `Small Area Fair Market Rents, ${SAFMR_FY}`,
      publisher: 'U.S. Department of Housing and Urban Development',
      url: SAFMR_URL,
      license: 'Public domain (U.S. Government work)',
      observationPeriod: `${SAFMR_FY} (effective October 1, 2025), from recent-mover rents trended forward`,
      retrievedAt: s.retrievedAt,
      updateFrequency: 'Annually (each October)',
      staleAfterDays: 400,
      status: 'ok',
      notes: 'The 40th percentile gross rent paid by recent movers, by ZIP code. Joined to tracts with the Census 2020 ZCTA–tract relationship file, taking the ZCTA covering most of each tract. A ZIP-level figure, not a neighborhood asking rent.',
    });
    sources.push({
      id: 'census-zcta-tract',
      name: '2020 ZCTA to Census Tract Relationship File',
      publisher: 'U.S. Census Bureau',
      url: ZCTA_TRACT_URL,
      license: 'Public domain (U.S. Government work)',
      observationPeriod: '2020 Census geography',
      retrievedAt: z.retrievedAt,
      updateFrequency: 'Decennial',
      staleAfterDays: 3650,
      status: 'ok',
    });
  } catch (err) {
    log(`${id}: SAFMR unavailable — ${(err as Error).message}`);
    sources.push({
      id: 'hud-safmr', name: `Small Area Fair Market Rents, ${SAFMR_FY}`, publisher: 'U.S. Department of Housing and Urban Development', url: SAFMR_URL,
      license: 'Public domain (U.S. Government work)', observationPeriod: SAFMR_FY, retrievedAt: nowIso, updateFrequency: 'Annually', staleAfterDays: 400,
      status: 'failed', notes: `Not loaded: ${(err as Error).message}. Rent benchmarks fall back to the ACS median.`,
    });
  }

  // 4b. Jobs by block (LEHD LODES).
  let jobs: Record<string, number> | null = null;
  try {
    // Counties across a state line come from the bounding box; only states the city lies in have residents here.
    const parts = await Promise.all(states.filter((st) => LODES_STATES[st]).map((st) => jobsByBlock(st, counties)));
    jobs = Object.assign({}, ...parts.map((p) => p.value));
    sources.push({
      id: 'lehd-lodes',
      name: `LEHD Origin-Destination Employment Statistics (LODES 8), workplace area characteristics, ${LODES_YEAR}`,
      publisher: 'U.S. Census Bureau, Center for Economic Studies',
      url: lodesUrl(LODES_STATES[states[0]]),
      license: 'Public domain (U.S. Government work)',
      observationPeriod: `Jobs in ${LODES_YEAR}`,
      retrievedAt: parts[0].retrievedAt,
      updateFrequency: 'Annually, about two years behind',
      staleAfterDays: 900,
      status: 'ok',
      notes: 'Used only to flag areas where jobs outnumber residents, where per-resident incident rates need care.',
    });
  } catch (err) {
    log(`${id}: LODES unavailable — ${(err as Error).message}`);
  }
  const hoodJobs = new Map<string, number>();
  if (jobs) for (const [block, n] of Object.entries(jobs)) {
    const h = xw.blockHood.get(block);
    if (h) hoodJobs.set(h, (hoodJobs.get(h) ?? 0) + n);
  }

  // 5. OpenStreetMap amenities and stations.
  const bbox: BBox = unionBBox(draftList.map((d) => bboxOf(d.geometry)));
  const padded: BBox = [bbox[0] - 0.02, bbox[1] - 0.02, bbox[2] + 0.02, bbox[3] + 0.02];
  if (flags.osmOnly) {
    await osmAll(id, padded);
    return null;
  }
  let osm: Partial<Record<OsmCategory, OsmPoint[]>> = {};
  let osmRetrieved: string | null = null;
  const osmFailed: string[] = [];
  const categories: OsmCategory[] = ['grocery', 'parks', 'restaurants', 'nightlife', 'rail', 'bus', 'dogParks'];
  try {
    const r = await osmAll(id, padded);
    osm = r.value;
    osmRetrieved = r.retrievedAt;
  } catch (err) {
    log(`${id}: OSM failed — ${(err as Error).message}`);
    osmFailed.push(...categories);
  }
  sources.push({
    id: 'osm',
    name: 'OpenStreetMap amenities and stations (via Overpass API)',
    publisher: 'OpenStreetMap contributors',
    url: 'https://www.openstreetmap.org/copyright',
    license: 'Open Database License (ODbL) 1.0',
    observationPeriod: `Snapshot ${(osmRetrieved ?? nowIso).slice(0, 10)}`,
    retrievedAt: osmRetrieved ?? nowIso,
    updateFrequency: 'Continuously edited; refreshed here monthly',
    staleAfterDays: 60,
    status: osmFailed.length === categories.length ? 'failed' : 'ok',
    notes: `Counts of mapped features: ${Object.values(OSM_DEFINITIONS).join('; ')}. Completeness depends on volunteer mapping and varies by area.${osmFailed.length ? ` Not loaded: ${osmFailed.join(', ')}.` : ''}`,
  });

  const amenityCounts = new Map<string, Amenities>();
  if (osmFailed.length < categories.length) {
    for (const d of draftList)
      amenityCounts.set(d.id, { grocery: 0, parks: 0, restaurants: 0, nightlife: 0, railStations: 0, busStops: 0, dogParks: 0, stepFreeStations: 0, stationsWithAccessTag: 0 });
    const field: Record<Exclude<OsmCategory, 'places'>, keyof Amenities> = {
      grocery: 'grocery', parks: 'parks', restaurants: 'restaurants', nightlife: 'nightlife', rail: 'railStations', bus: 'busStops', dogParks: 'dogParks',
    };
    for (const [cat, points] of Object.entries(osm) as Array<[OsmCategory, OsmPoint[]]>) {
      if (cat === 'places') continue;
      for (const pt of points) {
        const hood = find(pt.p);
        if (!hood) continue;
        const a = amenityCounts.get(hood)!;
        a[field[cat]]++;
        if (cat === 'rail' && pt.w) {
          a.stationsWithAccessTag++;
          if (pt.w === 'yes') a.stepFreeStations++;
        }
      }
    }
  }
  const railPoints: LngLat[] = (osm.rail ?? []).map((r) => r.p);
  if (geographyKind === 'zcta') {
    const names = new Map<string, Array<{ n: string; r: number }>>();
    for (const pt of osm.places ?? []) {
      const h = find(pt.p);
      if (h && pt.n) names.set(h, [...(names.get(h) ?? []), { n: pt.n, r: pt.r ?? 1 }]);
    }
    for (const d of draftList) {
      const list = (names.get(d.id) ?? []).sort((a, b) => a.r - b.r || a.n.localeCompare(b.n)).map((x) => x.n);
      const unique = [...new Set(list)].slice(0, 3);
      if (unique.length) d.district = `Includes ${unique.join(', ')}`;
    }
  }

  // 6. Reported incidents.
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const nameToId = new Map(draftList.map((d) => [norm(d.name), d.id] as const));
  const zipToId = new Map(geographyKind === 'zcta' ? draftList.map((d) => [d.name.replace('ZIP ', ''), d.id] as const) : []);
  const ctx = {
    locatePoint: find,
    blockGroupShares: (g: string) => xw.blockGroup.get(g) ?? [],
    nameToNeighborhood: (n: string) => nameToId.get(norm(n)) ?? null,
    locateZip: (z: string) => zipToId.get(z) ?? null,
    inCity: placeIndex ? (p: LngLat) => !!placeIndex.find(p) : undefined,
  };
  let incidents: IncidentResult | null = null;
  const incidentsUnavailable = cfg.kind === 'generic' && !cfg.incidents ? cfg.incidentsUnavailable : undefined;
  try {
    if (cfg.kind === 'custom') incidents = await cfg.adapter.incidents(ctx);
    else if (cfg.incidents) incidents = await runGenericIncidents(id, cfg.incidents, ctx);
    if (incidents) sources.push(...incidents.sources);
  } catch (err) {
    log(`${id}: incidents failed — ${(err as Error).message}`);
    const spec = cfg.kind === 'generic' ? cfg.incidents : null;
    sources.push({
      id: `${id}-incidents`, name: spec?.name ?? 'Reported incidents', publisher: spec?.publisher ?? 'City police department open data', url: spec?.url ?? '',
      license: spec?.license ?? 'Publisher terms of use', observationPeriod: '—', retrievedAt: nowIso, updateFrequency: spec?.updateFrequency ?? '—',
      staleAfterDays: 30, status: 'failed', notes: `Not loaded in the latest refresh: ${(err as Error).message}`,
    });
  }
  if (incidentsUnavailable) {
    sources.push({
      id: `${id}-incidents`, name: 'Reported incidents', publisher: `${info.name} police`, url: '', license: '—', observationPeriod: '—',
      retrievedAt: nowIso, updateFrequency: '—', staleAfterDays: 3650, status: 'unavailable', notes: incidentsUnavailable,
    });
  }

  // 7. Assemble neighborhoods from the crosswalk.
  const hoodTracts = new Map<string, Array<{ tract: string; pop: number; hu: number }>>();
  for (const [tract, parts] of xw.tract)
    for (const [h, s] of parts) {
      if (!hoodTracts.has(h)) hoodTracts.set(h, []);
      hoodTracts.get(h)!.push({ tract, ...s });
    }

  const neighborhoods: Neighborhood[] = [];
  const excluded: string[] = [];
  for (const d of draftList) {
    const parts = hoodTracts.get(d.id) ?? [];
    const population = round(parts.reduce((s, p) => s + (pop.value[p.tract]?.B01003_E001 ?? 0) * p.pop, 0));
    if (!parts.length || population < MIN_RANKED_POPULATION) {
      excluded.push(d.name);
      continue;
    }

    // Rent: average of tract medians weighted by the renter units of that size allocated to this neighborhood.
    const byBedroom = {} as Record<BedroomKey, number | null>;
    const topCoded: Partial<Record<BedroomKey, boolean>> = {};
    for (const [key, cols] of Object.entries(BR_COLUMNS) as Array<[BedroomKey, (typeof BR_COLUMNS)[BedroomKey]]>) {
      let sum = 0, weight = 0;
      for (const p of parts) {
        const median = rent.value[p.tract]?.[cols.rent];
        const units = tenure.value[p.tract]?.[cols.renters] ?? 0;
        if (median == null || units < MIN_TRACT_UNITS) continue;
        sum += median * units * p.hu;
        weight += units * p.hu;
        if (median >= ACS_TOP_CODE) topCoded[key] = true;
      }
      byBedroom[key] = weight >= MIN_HOOD_UNITS ? round(sum / weight) : null;
      if (byBedroom[key] === null) delete topCoded[key];
    }
    let coveredRenters = 0, allRenters = 0;
    for (const p of parts) {
      const units = (tenure.value[p.tract]?.B25042_E009 ?? 0) * p.hu;
      allRenters += units;
      if (rent.value[p.tract]?.B25031_E001 != null) coveredRenters += units;
    }

    let safmrBench: Neighborhood['safmr'] = null;
    const ownZip = geographyKind === 'zcta' ? d.name.replace('ZIP ', '') : null;
    if (safmr && ownZip && safmr[ownZip]) {
      const row = safmr[ownZip];
      safmrBench = { byBedroom: { studio: row.br0, br1: row.br1, br2: row.br2, br3: row.br3 }, zips: [ownZip] };
    } else if (safmr) {
      const sb = {} as Record<BedroomKey, number | null>;
      const zips = new Set<string>();
      for (const [key, cols] of Object.entries(BR_COLUMNS) as Array<[BedroomKey, (typeof BR_COLUMNS)[BedroomKey]]>) {
        let sum = 0, weight = 0;
        for (const p of parts) {
          const z = zctaOf[p.tract];
          const row = z ? safmr[z] : undefined;
          if (!row) continue;
          const units = Math.max(1, (tenure.value[p.tract]?.B25042_E009 ?? 0) * p.hu);
          sum += row[cols.safmr] * units;
          weight += units;
          zips.add(z);
        }
        sb[key] = weight > 0 ? round(sum / weight / 10) * 10 : null;
      }
      safmrBench = sb.br1 === null && sb.studio === null ? null : { byBedroom: sb, zips: [...zips].sort() };
    }

    const centroid = xw.centre.get(d.id) ?? (polygonCentroid(d.geometry).map((v) => round(v, 5)) as LngLat);
    neighborhoods.push({
      id: d.id,
      name: d.name,
      district: d.district,
      geometry: simplifyMultiPolygon(d.geometry),
      centroid,
      areaKm2: round(multiPolygonAreaKm2(d.geometry), 2),
      population,
      jobs: jobs ? hoodJobs.get(d.id) ?? 0 : null,
      // Tracts contributing at least 5% of the neighborhood's residents.
      tractIds: parts
        .filter((p) => ((pop.value[p.tract]?.B01003_E001 ?? 0) * p.pop) / population >= 0.05)
        .map((p) => p.tract)
        .sort(),
      rent: allRenters > 0 ? { byBedroom, topCoded, coverage: round(coveredRenters / allRenters, 3) } : null,
      safmr: safmrBench,
      incidents: null,
      amenities: amenityCounts.get(d.id) ?? null,
      nearestRailM: railPoints.length ? round(Math.min(...railPoints.map((p) => haversineM(centroid, p)))) : null,
    });
  }

  // Incident rates and city-relative percentiles.
  if (incidents) {
    const visitorRatio = new Map<string, number>();
    for (const n of neighborhoods) {
      if (n.amenities && n.population) visitorRatio.set(n.id, ((n.amenities.restaurants + n.amenities.nightlife) / n.population) * 1000);
    }
    const ratios = [...visitorRatio.values()].sort((a, b) => a - b);
    const topDecile = ratios.length ? ratios[Math.floor(ratios.length * 0.9)] : Infinity;

    const rates: Record<IncidentKind, Array<{ id: string; v: number }>> = { violent: [], property: [], vehicle: [] };
    for (const n of neighborhoods) {
      const stable = (n.population ?? 0) >= MIN_RATE_POPULATION;
      const measure = (kind: IncidentKind): IncidentMeasure => {
        const raw = incidents!.current[kind].get(n.id) ?? 0;
        const ratePer1k = stable ? round((raw / n.population!) * 1000, 2) : null;
        if (ratePer1k !== null) rates[kind].push({ id: n.id, v: ratePer1k });
        return { count: round(raw), priorCount: round(incidents!.prior[kind].get(n.id) ?? 0), ratePer1k, cityPercentile: null };
      };
      n.incidents = {
        violent: measure('violent'),
        property: measure('property'),
        vehicle: measure('vehicle'),
        visitorHeavy: (n.jobs !== null && n.population ? n.jobs / n.population >= 1 : false) || (visitorRatio.get(n.id) ?? 0) >= topDecile,
      };
    }
    for (const kind of ['violent', 'property', 'vehicle'] as IncidentKind[]) {
      const pct = percentileRanks(rates[kind]);
      for (const n of neighborhoods) if (n.incidents && pct.has(n.id)) n.incidents[kind].cityPercentile = round(pct.get(n.id)!, 3);
    }
  }

  const allBoxes = unionBBox(neighborhoods.map((n) => bboxOf(n.geometry)));
  const coverageNote = cfg.kind === 'generic' && coveredShare < 0.97 ? ` These areas include ${Math.round(coveredShare * 100)}% of the city's 2020 residents; the rest live outside any published area.` : '';
  const coverage = `${baseCoverage}${coverageNote}${excluded.length ? ` Not ranked (fewer than ${MIN_RANKED_POPULATION} residents): ${excluded.sort().join(', ')}.` : ''}`;

  return {
    schemaVersion: 1,
    city: id,
    name: info.name,
    state: info.state,
    isDemo: false,
    generatedAt: nowIso,
    geographyLabel,
    geographyKind,
    coverage,
    ...(incidentsUnavailable ? { incidentsUnavailable } : {}),
    center: [round((allBoxes[0] + allBoxes[2]) / 2, 4), round((allBoxes[1] + allBoxes[3]) / 2, 4)],
    bounds: [
      [round(allBoxes[0], 4), round(allBoxes[1], 4)],
      [round(allBoxes[2], 4), round(allBoxes[3], 4)],
    ],
    sources,
    incidentMethod: incidents
      ? {
          window: incidents.window,
          priorWindow: incidents.priorWindow,
          ...(incidents.priorComplete === false ? { priorComplete: false } : {}),
          dateBasis: incidents.dateBasis,
          unlocatedShare: round(incidents.unplaced / Math.max(1, incidents.placed + incidents.unplaced), 3),
          definitions: incidents.definitions,
          dedupe: incidents.dedupe,
          notes: [
            ...incidents.notes,
            `Rates are reported incidents per 1,000 residents per year, using ${ACS_PERIOD} population allocated to neighborhoods by 2020 block populations. They are not shown for areas with fewer than ${MIN_RATE_POPULATION.toLocaleString('en-US')} residents.`,
          ],
        }
      : null,
    railStations: railPoints.filter((p) => p[0] >= padded[0] && p[0] <= padded[2] && p[1] >= padded[1] && p[1] <= padded[3]),
    neighborhoods: neighborhoods.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export const outFile = (city: string) => join(OUT_DIR, `${city}.json`);

export async function writeCity(dataset: CityDataset) {
  await writeJson(outFile(dataset.city), dataset);
}
