// A small, clearly fictional city for tests. Never shipped to the app.
import type { Amenities, CityDataset, IncidentMeasure, Neighborhood } from '../src/lib/types.ts';
import { defaultPreferences, type Preferences } from '../src/lib/prefs.ts';

const square = (x: number, y: number, s = 0.01): Neighborhood['geometry'] => ({
  type: 'MultiPolygon',
  coordinates: [[[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]]],
});

const measure = (count: number, rate: number | null, pct: number | null): IncidentMeasure => ({ count, priorCount: count, ratePer1k: rate, cityPercentile: pct });

const amen = (o: Partial<Amenities> = {}): Amenities => ({
  grocery: 2, parks: 2, restaurants: 10, nightlife: 2, railStations: 1, busStops: 10, dogParks: 0, stepFreeStations: 0, stationsWithAccessTag: 0, ...o,
});

type HoodOptions = Omit<Partial<Neighborhood>, 'rent'> & { x?: number; rent?: number | null; safmr1?: number | null };

export function hood(id: string, options: HoodOptions = {}): Neighborhood {
  const { x = 0, rent = 1500, safmr1 = null, ...o } = options;
  return {
    id,
    name: `Demo ${id}`,
    district: null,
    geometry: square(x, 0),
    centroid: [x + 0.005, 0.005],
    areaKm2: 1,
    population: 10_000,
    jobs: 2_000,
    tractIds: [],
    rent: rent === null ? null : { byBedroom: { studio: rent - 200, br1: rent, br2: rent + 400, br3: rent + 800 }, topCoded: {}, coverage: 1 },
    safmr: safmr1 === null ? null : { byBedroom: { studio: safmr1 - 100, br1: safmr1, br2: safmr1 + 300, br3: safmr1 + 700 }, zips: ['00000'] },
    incidents: {
      violent: measure(50, 5, 0.5),
      property: measure(300, 30, 0.5),
      vehicle: measure(80, 8, 0.5),
      visitorHeavy: false,
    },
    amenities: amen(),
    nearestRailM: 400,
    ...o,
  } as Neighborhood;
}

export function city(neighborhoods: Neighborhood[]): CityDataset {
  return {
    schemaVersion: 1,
    city: 'chicago',
    name: 'Demo City',
    state: 'IL',
    isDemo: true,
    generatedAt: '2026-01-01T00:00:00Z',
    geographyLabel: 'Demo area',
    coverage: 'Test fixture',
    center: [0, 0],
    bounds: [[0, 0], [1, 1]],
    sources: [],
    incidentMethod: null,
    railStations: [[0.005, 0.005], [0.105, 0.005]],
    neighborhoods,
  };
}

export function prefs(o: Partial<Preferences> = {}): Preferences {
  const p = defaultPreferences();
  return {
    ...p,
    city: 'chicago',
    // Only what a test turns on counts: start from no preferences at all.
    affordability: 0,
    commute: 0,
    safety: { violent: 0, property: 0, vehicle: 0 },
    amenities: { transit: 0, grocery: 0, parks: 0, restaurants: 0, nightlife: 0, quiet: 0, pets: 0, stepFree: 0 },
    ...o,
  };
}

export { amen, measure };
