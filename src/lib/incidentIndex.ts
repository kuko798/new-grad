// Reported-incident index, 0–10. Display only: it is not part of preference fit, which already weighs the three
// incident measures separately by the person's priorities.
//
// 10 means the fewest reported incidents per resident among this city's areas; 0 the most. It combines the
// three city-relative percentiles with fixed weights (violent counts most). It is not a measure of personal
// safety and is never compared across cities.
import type { IncidentKind, Neighborhood } from './types.ts';

export const INDEX_WEIGHTS: Record<IncidentKind, number> = { violent: 0.6, property: 0.3, vehicle: 0.1 };

export interface IncidentIndex {
  /** 0–10 with one decimal, or null when no measure has a stable rate. */
  value: number | null;
  /** Measures that had a stable rate and went into the index. */
  used: IncidentKind[];
  /** Measures left out (no stable rate); the remaining weights are renormalized. */
  missing: IncidentKind[];
}

export function incidentIndex(h: Neighborhood): IncidentIndex {
  const kinds = Object.keys(INDEX_WEIGHTS) as IncidentKind[];
  if (!h.incidents) return { value: null, used: [], missing: kinds };
  let sum = 0;
  let weight = 0;
  const used: IncidentKind[] = [];
  const missing: IncidentKind[] = [];
  for (const k of kinds) {
    const p = h.incidents[k].cityPercentile;
    if (p == null) {
      missing.push(k);
      continue;
    }
    sum += INDEX_WEIGHTS[k] * (1 - p);
    weight += INDEX_WEIGHTS[k];
    used.push(k);
  }
  return { value: weight > 0 ? Math.round((sum / weight) * 100) / 10 : null, used, missing };
}
