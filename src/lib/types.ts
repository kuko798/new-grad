// Shared data contract between the ingestion pipeline (scripts/ingest) and the app.
// Every figure the app shows comes from a CityDataset file; nothing here is computed at request time.

/** A city id from src/lib/cities.ts, e.g. "chicago". */
export type CityId = string;

export type LngLat = [number, number];
export type Ring = LngLat[];
export type Polygon = Ring[];
export interface MultiPolygon {
  type: 'MultiPolygon';
  coordinates: Polygon[];
}

export type SourceStatus = 'ok' | 'stale' | 'failed' | 'demo' | 'unavailable';

export interface SourceRecord {
  id: string;
  name: string;
  publisher: string;
  url: string;
  license: string;
  /** What the figures describe, e.g. "2020–2024 ACS 5-year estimates" or "2025-07-01 to 2026-06-30". */
  observationPeriod: string;
  retrievedAt: string;
  /** How often the publisher updates it, in words. */
  updateFrequency: string;
  /** After this many days since retrieval the source is flagged stale. */
  staleAfterDays: number;
  status: SourceStatus;
  notes?: string;
}

export type BedroomKey = 'studio' | 'br1' | 'br2' | 'br3';
export const BEDROOM_KEYS: BedroomKey[] = ['studio', 'br1', 'br2', 'br3'];

export interface RentBenchmark {
  /** Monthly gross rent (contract rent plus utilities) by bedroom count; null where suppressed or unavailable. */
  byBedroom: Record<BedroomKey, number | null>;
  /** True where at least one contributing tract median was top-coded by the Census Bureau. */
  topCoded: Partial<Record<BedroomKey, boolean>>;
  /** Share of renter-occupied units in the neighborhood covered by a published median (0–1). */
  coverage: number;
}

export interface SafmrBenchmark {
  byBedroom: Record<BedroomKey, number | null>;
  /** ZIP Code Tabulation Areas contributing to the benchmark. */
  zips: string[];
}

export type IncidentKind = 'violent' | 'property' | 'vehicle';
export const INCIDENT_KINDS: IncidentKind[] = ['violent', 'property', 'vehicle'];

export interface IncidentMeasure {
  /** Reported incidents in the current 12-month window. */
  count: number;
  /** Reported incidents in the 12 months before that, for the trend. */
  priorCount: number;
  /** Incidents per 1,000 residents per year; null when the residential base is too small to give a stable rate. */
  ratePer1k: number | null;
  /** 0 = lowest rate in this city, 1 = highest. City-relative only. Null when ratePer1k is null. */
  cityPercentile: number | null;
}

export interface NeighborhoodIncidents {
  violent: IncidentMeasure;
  property: IncidentMeasure;
  vehicle: IncidentMeasure;
  /**
   * Jobs outnumber residents, or restaurants and bars per resident are in the city's top 10%:
   * workers and visitors add to incidents but not to the residential denominator.
   */
  visitorHeavy: boolean;
}

export interface Amenities {
  grocery: number;
  parks: number;
  restaurants: number;
  nightlife: number;
  railStations: number;
  busStops: number;
  dogParks: number;
  /** Rail stations tagged wheelchair=yes in OpenStreetMap, and how many carry any wheelchair tag. */
  stepFreeStations: number;
  stationsWithAccessTag: number;
}

export interface Neighborhood {
  id: string;
  name: string;
  /** Borough, side or district the name is usually given with. */
  district: string | null;
  geometry: MultiPolygon;
  /** Population-weighted centre of the neighborhood's Census tracts (falls back to the polygon centre). */
  centroid: LngLat;
  areaKm2: number;
  population: number | null;
  /** Jobs located here (LEHD LODES), to show when the daytime population far exceeds residents. */
  jobs: number | null;
  tractIds: string[];
  rent: RentBenchmark | null;
  safmr: SafmrBenchmark | null;
  incidents: NeighborhoodIncidents | null;
  amenities: Amenities | null;
  /** Straight-line distance from the centroid to the nearest rail or light-rail station, in metres. */
  nearestRailM: number | null;
}

export interface IncidentMethod {
  window: { start: string; end: string };
  priorWindow: { start: string; end: string };
  /** False when the data does not cover the whole prior window, so no trend is shown. */
  priorComplete?: boolean;
  /** Which date the window applies to: occurrence or report. */
  dateBasis: 'occurrence' | 'report';
  /** Records in the window that could not be placed in any covered neighborhood. */
  unlocatedShare: number;
  definitions: Record<IncidentKind, string>;
  dedupe: string;
  notes: string[];
}

export interface CityDataset {
  schemaVersion: 1;
  city: CityId;
  name: string;
  state: string;
  isDemo: boolean;
  generatedAt: string;
  geographyLabel: string;
  /** "official": the city's own neighborhood partition; "zcta": ZIP Code Tabulation Areas clipped to the city limits. */
  geographyKind?: 'official' | 'zcta';
  coverage: string;
  /** Why reported incidents are not available for this city, when they are not. */
  incidentsUnavailable?: string;
  center: LngLat;
  bounds: [LngLat, LngLat];
  sources: SourceRecord[];
  incidentMethod: IncidentMethod | null;
  /** Rail and light-rail stations, used for the destination side of the transit estimate. */
  railStations: LngLat[];
  neighborhoods: Neighborhood[];
}

export interface DataManifest {
  generatedAt: string;
  cities: Array<{
    city: CityId;
    file: string;
    isDemo: boolean;
    generatedAt: string;
    neighborhoods: number;
    population: number;
    coverage: string;
    geographyLabel: string;
    incidentWindow: { start: string; end: string } | null;
    /** A light outline of the covered neighborhoods for previews: SVG path data in a 0–100 × h viewBox. */
    preview: { height: number; paths: string[] };
    center: LngLat;
    geographyKind: 'official' | 'zcta';
    incidentsUnavailable: string | null;
    sources: SourceRecord[];
  }>;
}
