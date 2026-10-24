// Explainable matching.
//
// 1. Hard constraints decide whether a neighborhood is shown as a match at all: the rent limit always, the total
//    housing budget when given, and the commute limit when the person marks it as a limit. A constraint that
//    cannot be checked (no rent benchmark) never passes silently: the neighborhood is listed as unverified.
// 2. Preferences are normalized to 0–1 within the city (1 = best fit) and combined as a weighted average,
//    using the weights from the person's priorities. The score is preference fit, not a quality or safety grade.
// 3. Missing data is explicit. Incident measures with no stable rate are scored at the city median (0.5) and
//    marked "imputed": they are neither rewarded nor penalized. Amenity measures with no data are left out and
//    the remaining weights are renormalized. Coverage reports how much of the requested weight was measured.
import { grossLimit, monthlyCost, rentFigure, type MonthlyCost, type RentFigure } from './cost.ts';
import { BEDROOM_SHORT, MODE_LABELS, PRIORITY_WEIGHTS, type AmenityKey, type Preferences, type Priority, type SafetyKey } from './prefs.ts';
import { clamp01, percentileRanks } from './stats.ts';
import { plural } from './format.ts';
import { estimateCommute, nearestDistanceM, type CommuteEstimate } from './travel.ts';
import type { CityDataset, Neighborhood } from './types.ts';

export type ComponentId = 'affordability' | 'commute' | SafetyKey | AmenityKey;

export const COMPONENT_LABELS: Record<ComponentId, string> = {
  affordability: 'Rent headroom',
  commute: 'Commute',
  violent: 'Lower reported violent-incident rate',
  property: 'Lower reported property-incident rate',
  vehicle: 'Lower reported vehicle-incident rate',
  transit: 'Transit access',
  grocery: 'Grocery access',
  parks: 'Parks',
  restaurants: 'Restaurants and cafés',
  nightlife: 'Nightlife',
  quiet: 'Quieter surroundings',
  pets: 'Pet-friendly spaces',
  stepFree: 'Step-free stations',
};

export const SAFETY_KEYS: SafetyKey[] = ['violent', 'property', 'vehicle'];
export const AMENITY_KEYS: AmenityKey[] = ['transit', 'grocery', 'parks', 'restaurants', 'nightlife', 'quiet', 'pets', 'stepFree'];

export type ComponentStatus = 'measured' | 'imputed' | 'missing';

export interface ScoreComponent {
  id: ComponentId;
  label: string;
  priority: Priority;
  weight: number;
  /** 0–1 fit on this measure, 1 = best in the city for this preference. Null when missing. */
  value: number | null;
  status: ComponentStatus;
  /** Points this component adds to the 0–100 score. */
  points: number;
  /** The measured fact, in words, with its numbers. */
  fact: string;
}

export interface HardCheck {
  id: 'rent' | 'housing' | 'commute';
  label: string;
  /** null = could not be checked with the data available. */
  passes: boolean | null;
  detail: string;
  /** How far over the limit, in dollars or minutes. */
  overBy?: number;
}

export interface Evaluation {
  hood: Neighborhood;
  rent: RentFigure | null;
  commutes: CommuteEstimate[];
  cost: MonthlyCost | null;
  checks: HardCheck[];
  matches: boolean;
  unverified: boolean;
  score: number | null;
  components: ScoreComponent[];
  coverage: number;
  reasons: string[];
  tradeoff: string;
}

interface HoodStats {
  density: Record<'grocery' | 'parks' | 'restaurants' | 'nightlife' | 'busStops' | 'dogParks' | 'population', number | null>;
  pct: Partial<Record<'grocery' | 'parks' | 'restaurants' | 'nightlife' | 'busStops' | 'dogParks' | 'population' | 'nearRail', number>>;
}

const statsCache = new WeakMap<CityDataset, Map<string, HoodStats>>();

/** City-relative percentiles for every density measure, computed once per dataset. */
export function cityStats(ds: CityDataset): Map<string, HoodStats> {
  const hit = statsCache.get(ds);
  if (hit) return hit;
  const keys = ['grocery', 'parks', 'restaurants', 'nightlife', 'busStops', 'dogParks'] as const;
  const out = new Map<string, HoodStats>();
  for (const h of ds.neighborhoods) {
    const area = Math.max(0.05, h.areaKm2);
    const density = {} as HoodStats['density'];
    for (const k of keys) density[k] = h.amenities ? h.amenities[k] / area : null;
    density.population = h.population != null ? h.population / area : null;
    out.set(h.id, { density, pct: {} });
  }
  for (const k of [...keys, 'population'] as const) {
    const vals = ds.neighborhoods.flatMap((h) => {
      const v = out.get(h.id)!.density[k];
      return v == null ? [] : [{ id: h.id, v }];
    });
    for (const [id, p] of percentileRanks(vals)) out.get(id)!.pct[k] = p;
  }
  const rail = ds.neighborhoods.flatMap((h) => (h.nearestRailM == null ? [] : [{ id: h.id, v: h.nearestRailM }]));
  for (const [id, p] of percentileRanks(rail)) out.get(id)!.pct.nearRail = 1 - p; // nearer is better
  statsCache.set(ds, out);
  return out;
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pctOf = (p: number) => `${Math.round(p * 100)}%`;
const fmtKm = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

interface Ctx {
  ds: CityDataset;
  prefs: Preferences;
  stats: Map<string, HoodStats>;
  destRailM: Array<number | null>;
  rentPct: Map<string, number>;
}

function amenityComponent(key: AmenityKey, h: Neighborhood, ctx: Ctx): { value: number | null; fact: string } {
  const s = ctx.stats.get(h.id)!;
  const a = h.amenities;
  if (!a) return { value: null, fact: 'No OpenStreetMap data loaded for this area' };
  const per = (k: keyof HoodStats['density']) => (s.density[k] ?? 0).toFixed(1);
  switch (key) {
    case 'grocery':
      return { value: s.pct.grocery ?? null, fact: `${plural(a.grocery, 'supermarket or greengrocer', 'supermarkets or greengrocers')} mapped (${per('grocery')} per km²)` };
    case 'parks':
      return { value: s.pct.parks ?? null, fact: `${plural(a.parks, 'park', 'parks')} mapped (${per('parks')} per km²)` };
    case 'restaurants':
      return { value: s.pct.restaurants ?? null, fact: `${plural(a.restaurants, 'restaurant or café', 'restaurants and cafés')} mapped (${per('restaurants')} per km²)` };
    case 'nightlife':
      return { value: s.pct.nightlife ?? null, fact: `${plural(a.nightlife, 'bar, pub or club', 'bars, pubs and clubs')} mapped (${per('nightlife')} per km²)` };
    case 'quiet': {
      if (s.pct.nightlife == null || s.pct.population == null) return { value: null, fact: 'Not enough data to compare' };
      const v = 1 - (s.pct.nightlife + s.pct.population) / 2;
      return { value: v, fact: `${plural(a.nightlife, 'bar', 'bars')} mapped and ${Math.round(s.density.population ?? 0).toLocaleString('en-US')} residents per km²` };
    }
    case 'transit': {
      const rail = s.pct.nearRail;
      const bus = s.pct.busStops;
      if (rail == null && bus == null) return { value: null, fact: 'No station data' };
      const v = rail != null && bus != null ? (rail + bus) / 2 : (rail ?? bus)!;
      const railText = h.nearestRailM != null ? `rail station ${fmtKm(h.nearestRailM)} from the population centre` : 'no rail station data';
      return { value: v, fact: `${railText.charAt(0).toUpperCase()}${railText.slice(1)}; ${plural(a.busStops, 'bus stop', 'bus stops')} mapped` };
    }
    case 'pets': {
      if (s.pct.dogParks == null || s.pct.parks == null) return { value: null, fact: 'No data' };
      return { value: (s.pct.dogParks + s.pct.parks) / 2, fact: `${plural(a.dogParks, 'dog park', 'dog parks')} and ${plural(a.parks, 'park', 'parks')} mapped` };
    }
    case 'stepFree': {
      // Only measured where most stations carry a wheelchair tag; otherwise unknown, not "inaccessible".
      if (a.railStations === 0) return { value: null, fact: 'No rail stations in this area' };
      if (a.stationsWithAccessTag < a.railStations / 2) return { value: null, fact: `Accessibility is tagged for only ${a.stationsWithAccessTag} of ${a.railStations} stations` };
      return { value: a.stepFreeStations / a.railStations, fact: `${a.stepFreeStations} of ${a.railStations} rail stations tagged step-free in OpenStreetMap` };
    }
  }
}

function safetyComponent(key: SafetyKey, h: Neighborhood, ctx: Ctx): { value: number | null; status: ComponentStatus; fact: string } {
  const m = h.incidents?.[key];
  const noun = key === 'violent' ? 'violent-incident' : key === 'property' ? 'property-incident' : 'vehicle-incident';
  if (!h.incidents || !m) return { value: 0.5, status: 'imputed', fact: 'No incident data loaded; counted at the city median, not as low' };
  if (m.ratePer1k == null || m.cityPercentile == null)
    return { value: 0.5, status: 'imputed', fact: `Too few residents for a stable ${noun} rate (${m.count} reported); counted at the city median` };
  const p = m.cityPercentile;
  const city = ctx.ds.name;
  const rel = p <= 0.5 ? `lower than ${pctOf(1 - p)} of ${city} areas` : `higher than ${pctOf(p)} of ${city} areas`;
  return { value: 1 - p, status: 'measured', fact: `Reported ${noun} rate ${m.ratePer1k.toFixed(1)} per 1,000 residents, ${rel}` };
}

export function prepare(ds: CityDataset, prefs: Preferences): Ctx {
  const stats = cityStats(ds);
  const destRailM = prefs.destinations.map((d) => nearestDistanceM(d.point, ds.railStations));
  const rentVals = ds.neighborhoods.flatMap((h) => {
    const r = rentFigure(h, prefs);
    return r ? [{ id: h.id, v: r.shareGross }] : [];
  });
  return { ds, prefs, stats, destRailM, rentPct: percentileRanks(rentVals) };
}

export function evaluate(h: Neighborhood, ctx: Ctx): Evaluation {
  const { prefs, ds } = ctx;
  const rent = rentFigure(h, prefs);
  const mode = prefs.mode === 'drive' && !prefs.hasCar ? 'transit' : prefs.mode;
  const commutes = prefs.destinations.map((d, i) => estimateCommute(ds.city, h.centroid, h.nearestRailM, d.point, ctx.destRailM[i], mode));
  const cost = monthlyCost(ds.city, h, prefs, commutes.map((c, i) => ({ distanceKm: c.distanceKm, daysPerWeek: prefs.destinations[i].daysPerWeek })));

  // Hard constraints.
  const checks: HardCheck[] = [];
  const limit = grossLimit(prefs);
  if (limit != null) {
    if (!rent) checks.push({ id: 'rent', label: 'Rent limit', passes: null, detail: `No ${BEDROOM_SHORT[prefs.bedrooms]} rent benchmark is published for this area, so the limit cannot be checked` });
    else
      checks.push({
        id: 'rent',
        label: 'Rent limit',
        passes: rent.shareGross <= limit,
        detail: `${money(rent.shareGross)} benchmark against your ${money(prefs.maxRent!)} rent + ${money(limit - prefs.maxRent!)} utilities`,
        overBy: Math.max(0, rent.shareGross - limit),
      });
  }
  if (prefs.totalHousingBudget != null) {
    if (!cost) checks.push({ id: 'housing', label: 'Housing budget', passes: null, detail: 'No rent benchmark, so the housing total cannot be checked' });
    else
      checks.push({
        id: 'housing',
        label: 'Housing budget',
        passes: cost.housing <= prefs.totalHousingBudget,
        detail: `${money(cost.housing)} housing total against your ${money(prefs.totalHousingBudget)} budget`,
        overBy: Math.max(0, cost.housing - prefs.totalHousingBudget),
      });
  }
  if (prefs.commuteHard && commutes.length) {
    const worst = Math.max(...commutes.map((c) => c.minutes));
    checks.push({
      id: 'commute',
      label: 'Commute limit',
      passes: worst <= prefs.maxCommute,
      detail: `${commutes.length > 1 ? 'Longer commute' : 'Commute'} ≈ ${worst} min against your ${prefs.maxCommute}-min limit`,
      overBy: Math.max(0, worst - prefs.maxCommute),
    });
  }
  const unverified = checks.some((c) => c.passes === null);
  const matches = checks.every((c) => c.passes === true);

  // Preference components.
  const components: ScoreComponent[] = [];
  const push = (id: ComponentId, priority: Priority, value: number | null, status: ComponentStatus, fact: string) =>
    components.push({ id, label: COMPONENT_LABELS[id], priority, weight: PRIORITY_WEIGHTS[priority], value: value == null ? null : clamp01(value), status, points: 0, fact });

  if (rent) {
    if (limit != null) {
      // Full marks at 35% or more under the limit; zero at the limit.
      const headroom = (limit - rent.shareGross) / limit;
      push('affordability', prefs.affordability, headroom / 0.35, 'measured',
        headroom >= 0 ? `${money(rent.shareGross)} a month for your share, ${money(limit - rent.shareGross)} under your limit with utilities` : `${money(rent.shareGross)} a month for your share, ${money(rent.shareGross - limit)} over your limit with utilities`);
    } else {
      const p = ctx.rentPct.get(h.id) ?? 0.5;
      push('affordability', prefs.affordability, 1 - p, 'measured', `${money(rent.shareGross)} a month for your share, cheaper than ${pctOf(1 - p)} of ${ds.name} areas`);
    }
  } else push('affordability', prefs.affordability, null, 'missing', `No ${BEDROOM_SHORT[prefs.bedrooms]} rent benchmark published`);

  if (commutes.length) {
    const vals = commutes.map((c) => clamp01((prefs.maxCommute - c.minutes) / Math.max(5, prefs.maxCommute - 10)));
    const value = vals.length === 2 ? vals[0] * prefs.destinationBalance + vals[1] * (1 - prefs.destinationBalance) : vals[0];
    const fact = commutes
      .map((c, i) => `≈ ${c.minutes} min by ${c.variant === 'walk' ? 'walking' : MODE_LABELS[c.mode].toLowerCase()} to ${prefs.destinations[i].label || `destination ${i + 1}`}`)
      .join('; ');
    push('commute', prefs.commute, value, 'measured', fact);
  } else push('commute', prefs.commute, null, 'missing', 'Add a work or school address to compare commutes');

  for (const k of SAFETY_KEYS) {
    const c = safetyComponent(k, h, ctx);
    push(k, prefs.safety[k], c.value, c.status, c.fact);
  }
  for (const k of AMENITY_KEYS) {
    const c = amenityComponent(k, h, ctx);
    push(k, prefs.amenities[k], c.value, c.value == null ? 'missing' : 'measured', c.fact);
  }

  const scored = components.filter((c) => c.weight > 0 && c.value != null);
  const totalWeight = scored.reduce((s, c) => s + c.weight, 0);
  const requested = components.filter((c) => c.weight > 0).reduce((s, c) => s + c.weight, 0);
  for (const c of scored) c.points = (100 * c.weight * c.value!) / totalWeight;
  const score = totalWeight > 0 ? scored.reduce((s, c) => s + c.points, 0) : null;
  const measuredWeight = components.filter((c) => c.weight > 0 && c.status === 'measured').reduce((s, c) => s + c.weight, 0);

  const ev: Evaluation = {
    hood: h,
    rent,
    commutes,
    cost,
    checks,
    matches,
    unverified,
    score: score == null ? null : Math.round(score),
    components,
    coverage: requested > 0 ? measuredWeight / requested : 1,
    reasons: [],
    tradeoff: '',
  };
  ev.reasons = reasonsFor(ev, ds.name);
  ev.tradeoff = tradeoffFor(ev, ctx);
  return ev;
}

const FRAMES: Partial<Record<ComponentId, [string, string]>> = {
  transit: ['Better transit access', 'Weaker transit access'],
  grocery: ['More grocery stores per km²', 'Fewer grocery stores per km²'],
  parks: ['More parks per km²', 'Fewer parks per km²'],
  restaurants: ['More restaurants and cafés per km²', 'Fewer restaurants and cafés per km²'],
  nightlife: ['More nightlife per km²', 'Less nightlife per km²'],
  pets: ['More dog parks and parks', 'Fewer dog parks and parks'],
  quiet: ['Quieter', 'Busier'],
};

/** Amenity facts are counts; say how they compare within the city so the reader knows why they matter. */
function framed(c: ScoreComponent, city: string, strong: boolean): string {
  const f = FRAMES[c.id];
  if (!f || c.value == null) return c.fact;
  const share = Math.round((strong ? c.value : 1 - c.value) * 100);
  const fact = c.fact.charAt(0).toLowerCase() + c.fact.slice(1);
  return `${strong ? f[0] : f[1]} than ${share}% of ${city} areas: ${fact}`;
}

export function reasonsFor(ev: Evaluation, city: string): string[] {
  const strong = ev.components
    .filter((c) => c.weight > 0 && c.status === 'measured' && (c.value ?? 0) >= 0.6)
    .sort((a, b) => b.weight * b.value! - a.weight * a.value!);
  const out = strong.slice(0, 3).map((c) => framed(c, city, true));
  if (out.length < 2) {
    // Fall back to the best measured facts the person asked about, then to any measured strength.
    const extra = ev.components
      .filter((c) => c.status === 'measured' && !strong.includes(c) && (c.value ?? 0) >= 0.5)
      .sort((a, b) => b.weight - a.weight || b.value! - a.value!);
    for (const c of extra) {
      if (out.length >= 2) break;
      out.push(framed(c, city, true));
    }
  }
  return out;
}

export function tradeoffFor(ev: Evaluation, ctx: Ctx): string {
  const { prefs } = ctx;
  const weak = ev.components
    .filter((c) => c.weight > 0 && c.status === 'measured' && c.value! < 0.45)
    .sort((a, b) => b.weight * (1 - b.value!) - a.weight * (1 - a.value!))[0];
  if (weak) return framed(weak, ctx.ds.name, false);

  const commuteMax = ev.commutes.length ? Math.max(...ev.commutes.map((c) => c.minutes)) : null;
  if (commuteMax != null && commuteMax >= prefs.maxCommute * 0.8) return `Commute ≈ ${commuteMax} min, close to your ${prefs.maxCommute}-min limit`;
  const limit = grossLimit(prefs);
  if (ev.rent && limit != null && ev.rent.shareGross >= limit * 0.92) return `The rent benchmark uses ${pctOf(ev.rent.shareGross / limit)} of your limit with utilities`;
  const imputed = ev.components.find((c) => c.weight > 0 && c.status === 'imputed');
  if (imputed) return imputed.fact;
  if (ev.hood.incidents?.visitorHeavy) return 'Many workers and visitors: per-resident incident rates here overstate what residents report';
  if (ev.rent?.source === 'safmr') return `Rent benchmark is ZIP-based (${ev.hood.safmr!.zips.length} ZIP${ev.hood.safmr!.zips.length === 1 ? '' : 's'}), so listings inside the boundary can differ`;
  const unasked = ev.components.filter((c) => c.weight === 0 && c.status === 'measured').sort((a, b) => a.value! - b.value!)[0];
  if (unasked) {
    const t = framed(unasked, ctx.ds.name, false);
    return `Not one of your priorities, but: ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  }
  return 'No clear weakness among the measures available';
}

export type SortKey = 'fit' | 'affordability' | 'commute';

export function evaluateCity(ds: CityDataset, prefs: Preferences): Evaluation[] {
  const ctx = prepare(ds, prefs);
  return ds.neighborhoods.map((h) => evaluate(h, ctx));
}

export function sortEvaluations(evs: Evaluation[], by: SortKey): Evaluation[] {
  const key = (e: Evaluation): number => {
    if (by === 'affordability') return e.cost?.total ?? e.rent?.shareGross ?? Infinity;
    if (by === 'commute') return e.commutes.length ? Math.max(...e.commutes.map((c) => c.minutes)) : Infinity;
    return -(e.score ?? -1);
  };
  return [...evs].sort((a, b) => key(a) - key(b) || (b.score ?? 0) - (a.score ?? 0) || a.hood.name.localeCompare(b.hood.name));
}

export interface ResultSet {
  matches: Evaluation[];
  unverified: Evaluation[];
  failing: Evaluation[];
}

export function partition(evs: Evaluation[]): ResultSet {
  return {
    matches: evs.filter((e) => e.matches),
    unverified: evs.filter((e) => !e.matches && e.unverified && e.checks.every((c) => c.passes !== false)),
    failing: evs.filter((e) => e.checks.some((c) => c.passes === false)),
  };
}

/** Whole-number points that add up exactly to the displayed score (largest-remainder rounding). */
export function displayPoints(ev: Evaluation): Map<ComponentId, number> {
  const out = new Map<ComponentId, number>();
  const parts = ev.components.filter((c) => c.points > 0);
  if (ev.score == null) return out;
  const floors = parts.map((c) => ({ id: c.id, floor: Math.floor(c.points), rest: c.points - Math.floor(c.points) }));
  let left = ev.score - floors.reduce((s, p) => s + p.floor, 0);
  for (const p of [...floors].sort((a, b) => b.rest - a.rest)) {
    out.set(p.id, p.floor + (left > 0 ? 1 : 0));
    left--;
  }
  for (const c of ev.components) if (!out.has(c.id)) out.set(c.id, 0);
  return out;
}
