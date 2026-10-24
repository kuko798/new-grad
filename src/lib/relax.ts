// "What if?" — re-run the same matching with one input changed and report what really changes.
// Nothing here estimates savings; every figure comes from evaluating the city's data again.
import { evaluateCity, partition, type Evaluation } from './scoring.ts';
import type { Preferences } from './prefs.ts';
import { BEDROOM_KEYS, type BedroomKey, type CityDataset } from './types.ts';

export interface Scenario {
  id: string;
  label: string;
  change: Partial<Preferences>;
  matchCount: number;
  /** Neighborhoods that match in the scenario but not now, best fit first. */
  added: Evaluation[];
  /** Change in the cheapest matching monthly total, when both exist. */
  cheapestDelta: number | null;
}

export interface Conflict {
  check: 'rent' | 'housing' | 'commute';
  /** How many neighborhoods fail only this check. */
  onlyThis: number;
  /** The smallest increase in the limit that would admit at least one neighborhood. */
  smallestFix: number | null;
}

function cheapest(evs: Evaluation[]): number | null {
  const totals = evs.flatMap((e) => (e.cost ? [e.cost.total] : []));
  return totals.length ? Math.min(...totals) : null;
}

function nextBedroom(b: BedroomKey): BedroomKey | null {
  const i = BEDROOM_KEYS.indexOf(b);
  return i < BEDROOM_KEYS.length - 1 ? BEDROOM_KEYS[i + 1] : null;
}

export function candidateChanges(prefs: Preferences, exact: { rent?: number | null; commute?: number | null } = {}): Array<{ id: string; label: string; change: Partial<Preferences> }> {
  const out: Array<{ id: string; label: string; change: Partial<Preferences> }> = [];
  if (prefs.maxRent != null) {
    const steps = [150, 300, 500];
    // The smallest raise that admits an area, rounded up to $10, when it is not already one of the steps.
    const fit = exact.rent != null ? Math.ceil(exact.rent / 10) * 10 : null;
    if (fit != null && fit > 0 && !steps.includes(fit)) steps.push(fit);
    for (const step of steps.sort((a, b) => a - b))
      out.push({ id: `rent+${step}`, label: `Rent limit $${(prefs.maxRent + step).toLocaleString('en-US')} (+$${step})`, change: { maxRent: prefs.maxRent + step } });
  }
  if (prefs.totalHousingBudget != null) {
    out.push({ id: 'housing+300', label: `Housing budget +$300`, change: { totalHousingBudget: prefs.totalHousingBudget + 300 } });
  }
  if (prefs.destinations.length && prefs.commuteHard) {
    const steps = [10, 20];
    if (exact.commute != null && exact.commute > 0 && !steps.includes(exact.commute)) steps.push(exact.commute);
    for (const step of steps.sort((a, b) => a - b)) out.push({ id: `commute+${step}`, label: `Commute limit ${prefs.maxCommute + step} min (+${step})`, change: { maxCommute: prefs.maxCommute + step } });
  }
  // Adding a roommate means one more person and one more bedroom.
  const bigger = nextBedroom(prefs.bedrooms);
  const roomsNow = BEDROOM_KEYS.indexOf(prefs.bedrooms); // studio = 0
  if (bigger && prefs.people <= Math.max(1, roomsNow) + 1) {
    out.push({ id: 'roommate', label: `Share a ${bigger === 'br2' ? '2' : '3'}-bedroom with ${prefs.people === 1 ? 'one roommate' : `${prefs.people} roommates`}`, change: { bedrooms: bigger, people: prefs.people + 1 } });
  }
  if (prefs.bedrooms !== 'studio' && prefs.people === 1) out.push({ id: 'studio', label: 'Look at studios instead', change: { bedrooms: 'studio' } });
  return out;
}

export function scenarios(ds: CityDataset, prefs: Preferences, current: Evaluation[], exact: { rent?: number | null; commute?: number | null } = {}): Scenario[] {
  const now = partition(current);
  const nowIds = new Set(now.matches.map((e) => e.hood.id));
  const nowCheapest = cheapest(now.matches);
  return candidateChanges(prefs, exact).map(({ id, label, change }) => {
    const next = partition(evaluateCity(ds, { ...prefs, ...change }));
    const c = cheapest(next.matches);
    return {
      id,
      label,
      change,
      matchCount: next.matches.length,
      added: next.matches.filter((e) => !nowIds.has(e.hood.id)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
      cheapestDelta: c != null && nowCheapest != null ? c - nowCheapest : null,
    };
  });
}

/** Explains why nothing matches: which limit excludes the most areas on its own, and by how much. */
export function conflicts(evs: Evaluation[]): Conflict[] {
  const ids = ['rent', 'housing', 'commute'] as const;
  return ids
    .filter((id) => evs.some((e) => e.checks.some((c) => c.id === id)))
    .map((id) => {
      const onlyThis = evs.filter((e) => {
        const failing = e.checks.filter((c) => c.passes === false);
        return failing.length === 1 && failing[0].id === id;
      });
      const fixes = onlyThis.flatMap((e) => e.checks.filter((c) => c.id === id && c.overBy != null).map((c) => c.overBy!));
      return { check: id, onlyThis: onlyThis.length, smallestFix: fixes.length ? Math.min(...fixes) : null };
    });
}
