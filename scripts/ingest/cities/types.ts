import type { CityId, IncidentKind, LngLat, SourceRecord } from '../../../src/lib/types.ts';
import type { GeoJsonFeature } from '../sources/socrata.ts';

export interface BoundaryFeature {
  id: string;
  name: string;
  district: string | null;
}

export interface IncidentContext {
  /** Neighborhood id containing a point, or null outside covered neighborhoods. */
  locatePoint(p: LngLat): string | null;
  /**
   * How a 12-digit block group's residents divide between covered neighborhoods, from 2020 block populations:
   * [[neighborhoodId, share], ...]. Shares sum to less than 1 where part of the block group is outside coverage.
   */
  blockGroupShares(geoid: string): Array<[string, number]>;
  /** Neighborhood id for a name as the police dataset spells it. */
  nameToNeighborhood(name: string): string | null;
  /** Neighborhood id for a 5-digit ZIP code: the ZIP area itself in ZIP-based cities, otherwise null. */
  locateZip(zip: string): string | null;
  /** Whether a point lies inside the city limits; absent for hand-written adapters. */
  inCity?(p: LngLat): boolean;
}

export type KindCounts = Record<IncidentKind, Map<string, number>>;

export interface IncidentResult {
  current: KindCounts;
  prior: KindCounts;
  window: { start: string; end: string };
  priorWindow: { start: string; end: string };
  /** False when the published data does not reach back to the start of the prior window. */
  priorComplete?: boolean;
  dateBasis: 'occurrence' | 'report';
  /** Records in the current window (violent + property) that were not placed in a covered neighborhood. */
  unplaced: number;
  placed: number;
  definitions: Record<IncidentKind, string>;
  dedupe: string;
  notes: string[];
  sources: SourceRecord[];
}

export interface CityAdapter {
  id: CityId;
  name: string;
  state: string;
  geographyLabel: string;
  coverage: string;
  /** State+county FIPS codes whose tracts may fall inside the covered neighborhoods. */
  counties: string[];
  boundary: {
    domain: string;
    dataset: string;
    title: string;
    publisher: string;
    pageUrl: string;
    license: string;
    toFeature(f: GeoJsonFeature): BoundaryFeature | null;
  };
  /** Driving and transit assumptions are kept with the city so they can be documented together. */
  incidents(ctx: IncidentContext): Promise<IncidentResult>;
}

export function emptyCounts(): KindCounts {
  return { violent: new Map(), property: new Map(), vehicle: new Map() };
}

export function add(map: Map<string, number>, key: string, n: number) {
  map.set(key, (map.get(key) ?? 0) + n);
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
