// Turns a city's normalized incident rows into the counts the builder needs: a 12-month window ending at the
// last complete month, the 12 months before it for the trend, deduplicated per incident and per measure.
import type { IncidentKind } from '../../../src/lib/types.ts';
import type { IncidentContext, IncidentResult } from '../cities/types.ts';
import { add, emptyCounts } from '../cities/types.ts';
import { addMonths, completeWindowEnd, log } from '../util.ts';
import { NIBRS_DEFINITIONS } from './classify.ts';

export interface NormRow {
  /** Incident or case id: rows sharing it are one incident. */
  id: string;
  date: string | null;
  kinds: IncidentKind[];
  lon?: number;
  lat?: number;
  zip?: string;
  /** Neighborhood name as the department records it. */
  name?: string;
}

export interface GenericIncidentSpec {
  name: string;
  publisher: string;
  url: string;
  license: string;
  updateFrequency: string;
  staleAfterDays: number;
  dateBasis: 'occurrence' | 'report';
  definitions?: Partial<Record<IncidentKind, string>>;
  dedupe: string;
  notes: string[];
  /** Latest record date (YYYY-MM-DD). */
  latest(): Promise<string>;
  /** Rows dated within [from, to). Rows may include other offenses; only rows with kinds are counted. */
  rows(from: string, to: string): Promise<NormRow[]>;
}

const plausible = (lat?: number, lon?: number) => lat !== undefined && lon !== undefined && Math.abs(lat) > 1 && Math.abs(lon) > 1 && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

export async function runGenericIncidents(cityId: string, spec: GenericIncidentSpec, ctx: IncidentContext): Promise<IncidentResult> {
  const latest = await spec.latest();
  // Guard against records dated in the future by data-entry errors.
  const today = new Date().toISOString().slice(0, 10);
  const end = completeWindowEnd(latest > today ? today : latest);
  const start = addMonths(end, -12);
  const priorStart = addMonths(end, -24);
  const rows = await spec.rows(priorStart, end);

  const current = emptyCounts();
  const prior = emptyCounts();
  const seen = { current: { violent: new Set<string>(), property: new Set<string>(), vehicle: new Set<string>() }, prior: { violent: new Set<string>(), property: new Set<string>(), vehicle: new Set<string>() } };
  const placedIds = new Set<string>();
  const unplacedIds = new Set<string>();
  let earliest = '9999-12-31';

  for (const r of rows) {
    if (!r.date || r.date < priorStart || r.date >= end || !r.kinds.length) continue;
    if (r.date < earliest) earliest = r.date;
    const bucket = r.date >= start ? 'current' : 'prior';
    let hood: string | null = null;
    const located = plausible(r.lat, r.lon);
    // A department whose file covers more than the city (a county police force) is not missing those records:
    // incidents with coordinates outside the city limits are left out rather than counted as unplaced.
    if (located && ctx.inCity && !ctx.inCity([r.lon!, r.lat!])) continue;
    if (located) hood = ctx.locatePoint([r.lon!, r.lat!]);
    if (!hood && r.name) hood = ctx.nameToNeighborhood(r.name);
    if (!hood && r.zip) hood = ctx.locateZip(r.zip.slice(0, 5));
    for (const kind of r.kinds) {
      const key = `${r.id}`;
      if (seen[bucket][kind].has(key)) continue;
      seen[bucket][kind].add(key);
      if (hood) add((bucket === 'current' ? current : prior)[kind], hood, 1);
      if (bucket === 'current' && kind !== 'vehicle') (hood ? placedIds : unplacedIds).add(`${kind}:${key}`);
    }
  }

  // The prior window is complete only when the data reaches back to its start.
  const priorComplete = earliest <= `${priorStart.slice(0, 8)}15`;
  log(`${cityId}: ${rows.length} rows, ${placedIds.size} placed, ${unplacedIds.size} unplaced, earliest ${earliest}${priorComplete ? '' : ' (prior window incomplete)'}`);

  return {
    current,
    prior,
    window: { start, end },
    priorWindow: { start: priorStart, end: start },
    priorComplete,
    dateBasis: spec.dateBasis,
    placed: placedIds.size,
    unplaced: unplacedIds.size,
    definitions: { ...NIBRS_DEFINITIONS, ...spec.definitions },
    dedupe: spec.dedupe,
    notes: spec.notes,
    sources: [
      {
        id: `${cityId}-incidents`,
        name: spec.name,
        publisher: spec.publisher,
        url: spec.url,
        license: spec.license,
        observationPeriod: `${priorStart} to ${end} (${spec.dateBasis} date)`,
        retrievedAt: new Date().toISOString(),
        updateFrequency: spec.updateFrequency,
        staleAfterDays: spec.staleAfterDays,
        status: 'ok',
      },
    ],
  };
}
