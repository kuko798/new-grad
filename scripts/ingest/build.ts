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
import type { CityAdapter, IncidentResult } from './cities/types.ts';
import { BLOCKS_URL, blocksForCounty } from './sources/blocks.ts';
import { ACS_PERIOD, ZCTA_TRACT_URL, acsTable, tractToZcta } from './sources/census.ts';
import { LODES_STATES, LODES_YEAR, jobsByBlock, lodesUrl } from './sources/lodes.ts';
import { OSM_DEFINITIONS, osmPoints, type OsmCategory, type OsmPoint } from './sources/osm.ts';
import { SAFMR_FY, SAFMR_URL, safmrByZip } from './sources/safmr.ts';
import { geojson } from './sources/socrata.ts';
import { cached, log, OUT_DIR, writeJson } from './util.ts';

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

export async function buildCity(adapter: CityAdapter): Promise<CityDataset> {
  const sources: SourceRecord[] = [];
  const nowIso = new Date().toISOString();
  const states = [...new Set(adapter.counties.map((c) => c.slice(0, 2)))];

  // 1. Boundaries — features sharing an id (Austin sub-districts) are dissolved into one MultiPolygon.
  const boundary = await cached(`boundaries/${adapter.id}`, 30, () => geojson(adapter.boundary.domain, adapter.boundary.dataset));
  const drafts = new Map<string, Draft>();
  for (const f of boundary.value) {
    if (!f.geometry) continue;
    const feat = adapter.boundary.toFeature(f);
    if (!feat) continue;
    const mp = toMultiPolygon(f.geometry);
    const existing = drafts.get(feat.id);
    if (existing) existing.geometry.coordinates.push(...mp.coordinates);
    else drafts.set(feat.id, { ...feat, geometry: mp });
  }
  const draftList = [...drafts.values()];
  const index = new PolygonIndex(draftList);
  const find = (p: LngLat) => index.find(p)?.id ?? null;
  sources.push({
    id: `${adapter.id}-boundaries`,
    name: adapter.boundary.title,
    publisher: adapter.boundary.publisher,
    url: adapter.boundary.pageUrl,
    license: adapter.boundary.license,
    observationPeriod: 'Current boundaries',
    retrievedAt: boundary.retrievedAt,
    updateFrequency: 'Rarely; boundaries change with official redefinitions',
    staleAfterDays: 365,
    status: 'ok',
  });
  log(`${adapter.id}: ${draftList.length} boundary features`);

  // 2. Block crosswalk.
  const blockEntries = [];
  for (const county of adapter.counties) blockEntries.push(await blocksForCounty(county));
  const blocks = blockEntries.flatMap((e) => e.value);
  const xw = buildCrosswalk(blocks, find);
  log(`${adapter.id}: ${blocks.length} blocks, ${xw.tract.size} tracts touch covered neighborhoods`);
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
    log(`${adapter.id}: SAFMR unavailable — ${(err as Error).message}`);
    sources.push({
      id: 'hud-safmr', name: `Small Area Fair Market Rents, ${SAFMR_FY}`, publisher: 'U.S. Department of Housing and Urban Development', url: SAFMR_URL,
      license: 'Public domain (U.S. Government work)', observationPeriod: SAFMR_FY, retrievedAt: nowIso, updateFrequency: 'Annually', staleAfterDays: 400,
      status: 'failed', notes: `Not loaded: ${(err as Error).message}. Rent benchmarks fall back to the ACS median.`,
    });
  }

  // 4b. Jobs by block (LEHD LODES).
  let jobs: Record<string, number> | null = null;
  try {
    const parts = await Promise.all(states.map((st) => jobsByBlock(st)));
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
    log(`${adapter.id}: LODES unavailable — ${(err as Error).message}`);
  }
  const hoodJobs = new Map<string, number>();
  if (jobs) for (const [block, n] of Object.entries(jobs)) {
    const h = xw.blockHood.get(block);
    if (h) hoodJobs.set(h, (hoodJobs.get(h) ?? 0) + n);
  }

  // 5. OpenStreetMap amenities and stations.
  const bbox: BBox = unionBBox(draftList.map((d) => bboxOf(d.geometry)));
  const padded: BBox = [bbox[0] - 0.02, bbox[1] - 0.02, bbox[2] + 0.02, bbox[3] + 0.02];
  const osm: Partial<Record<OsmCategory, OsmPoint[]>> = {};
  let osmRetrieved: string | null = null;
  const osmFailed: string[] = [];
  const categories: OsmCategory[] = ['grocery', 'parks', 'restaurants', 'nightlife', 'rail', 'bus', 'dogParks'];
  for (const cat of categories) {
    try {
      const r = await osmPoints(adapter.id, cat, padded);
      osm[cat] = r.value;
      osmRetrieved = r.retrievedAt;
    } catch (err) {
      log(`${adapter.id}: OSM ${cat} failed — ${(err as Error).message}`);
      osmFailed.push(cat);
    }
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
    const field: Record<OsmCategory, keyof Amenities> = {
      grocery: 'grocery', parks: 'parks', restaurants: 'restaurants', nightlife: 'nightlife', rail: 'railStations', bus: 'busStops', dogParks: 'dogParks',
    };
    for (const [cat, points] of Object.entries(osm) as Array<[OsmCategory, OsmPoint[]]>) {
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

  // 6. Reported incidents.
  const nameToId = new Map(draftList.map((d) => [d.name.toLowerCase(), d.id] as const));
  let incidents: IncidentResult | null = null;
  try {
    incidents = await adapter.incidents({
      locatePoint: find,
      blockGroupShares: (g) => xw.blockGroup.get(g) ?? [],
      nameToNeighborhood: (n) => nameToId.get(n.toLowerCase()) ?? null,
    });
    sources.push(...incidents.sources);
  } catch (err) {
    log(`${adapter.id}: incidents failed — ${(err as Error).message}`);
    sources.push({
      id: `${adapter.id}-incidents`, name: 'Reported incidents', publisher: 'City police department open data', url: `https://${adapter.boundary.domain}`,
      license: 'Publisher terms of use', observationPeriod: '—', retrievedAt: nowIso, updateFrequency: '—', staleAfterDays: 30,
      status: 'failed', notes: `Not loaded: ${(err as Error).message}`,
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
    if (safmr) {
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
  const coverage = excluded.length
    ? `${adapter.coverage} Not ranked (fewer than ${MIN_RANKED_POPULATION} residents): ${excluded.sort().join(', ')}.`
    : adapter.coverage;

  return {
    schemaVersion: 1,
    city: adapter.id,
    name: adapter.name,
    state: adapter.state,
    isDemo: false,
    generatedAt: nowIso,
    geographyLabel: adapter.geographyLabel,
    coverage,
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
