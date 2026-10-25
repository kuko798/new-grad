import { describe, expect, it } from 'vitest';
import { pointInMultiPolygon, simplifyMultiPolygon, multiPolygonAreaKm2 } from '../src/lib/geo.ts';
import { percentileRanks } from '../src/lib/stats.ts';
import { estimateCommute, monthlyTransportCost, travelFor } from '../src/lib/travel.ts';
import { applyPriorityCode, compareShareUrl, parseCompareParams, priorityCode, zillowFilterHints, zillowRentalsUrl } from '../src/lib/links.ts';
import { conflicts, scenarios } from '../src/lib/relax.ts';
import { evaluateCity } from '../src/lib/scoring.ts';
import { moveInCost, monthlyCost } from '../src/lib/cost.ts';
import { addMonths, completeWindowEnd } from '../scripts/ingest/util.ts';
import { city, hood, prefs } from './fixtures.ts';

describe('geometry', () => {
  const withHole = {
    type: 'MultiPolygon' as const,
    coordinates: [[
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ]] as [number, number][][][],
  };
  it('respects holes', () => {
    expect(pointInMultiPolygon([1, 1], withHole)).toBe(true);
    expect(pointInMultiPolygon([5, 5], withHole)).toBe(false);
    expect(pointInMultiPolygon([11, 5], withHole)).toBe(false);
  });
  it('simplifies without losing closure', () => {
    const ring: [number, number][] = Array.from({ length: 200 }, (_, i) => [Math.cos((i / 200) * 2 * Math.PI), Math.sin((i / 200) * 2 * Math.PI)]);
    ring.push(ring[0]);
    const s = simplifyMultiPolygon({ type: 'MultiPolygon', coordinates: [[ring]] }, 0.01);
    expect(s.coordinates[0][0].length).toBeLessThan(ring.length);
    expect(s.coordinates[0][0].length).toBeGreaterThan(8);
  });
  it('computes plausible areas', () => {
    // A 0.01° square at the equator is about 1.11 km on a side.
    const a = multiPolygonAreaKm2({ type: 'MultiPolygon', coordinates: [[[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]]] });
    expect(a).toBeGreaterThan(1.2);
    expect(a).toBeLessThan(1.3);
  });
});

describe('percentile ranks', () => {
  it('shares ranks between ties and spans 0–1', () => {
    const r = percentileRanks([{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'c', v: 2 }, { id: 'd', v: 5 }]);
    expect(r.get('a')).toBe(0);
    expect(r.get('b')).toBe(r.get('c'));
    expect(r.get('b')).toBe(0.5);
    expect(r.get('d')).toBe(1);
  });
});

describe('reporting windows', () => {
  it('ends the window after the last complete month', () => {
    expect(completeWindowEnd('2026-06-30T00:00:00.000')).toBe('2026-07-01');
    expect(completeWindowEnd('2026-10-15T00:00:00.000')).toBe('2026-10-01');
    expect(completeWindowEnd('2026-12-31')).toBe('2027-01-01');
    expect(addMonths('2026-10-01', -12)).toBe('2025-10-01');
  });
});

describe('commute estimates', () => {
  it('uses rail when both ends are near a station, bus otherwise, and walking for short trips', () => {
    const from: [number, number] = [-87.65, 41.9];
    const to: [number, number] = [-87.63, 41.88];
    const rail = estimateCommute('chicago', from, 300, to, 200, 'transit');
    expect(rail.variant).toBe('rail');
    const bus = estimateCommute('chicago', from, 3000, to, 200, 'transit');
    expect(bus.variant).toBe('bus');
    expect(bus.minutes).toBeGreaterThan(rail.minutes);
    const short = estimateCommute('chicago', from, 3000, [-87.648, 41.9], 3000, 'transit');
    expect(short.variant).toBe('walk');
    expect(rail.basis).toMatch(/km straight-line/);
  });

  it('caps transit cost at the monthly pass', () => {
    const t = travelFor('nyc');
    expect(monthlyTransportCost('nyc', 'transit', [{ distanceKm: 5, daysPerWeek: 6 }], 0.14, null).amount).toBe(t.monthlyPass!);
    const oneDay = monthlyTransportCost('nyc', 'transit', [{ distanceKm: 5, daysPerWeek: 1 }], 0.14, null);
    expect(oneDay.amount).toBeLessThan(t.monthlyPass!);
  });
});

describe('costs', () => {
  it('labels sourced figures apart from assumptions and leaves unknown parking out', () => {
    const ds = city([hood('a', { rent: 2000 })]);
    const c = monthlyCost('chicago', ds.neighborhoods[0], prefs({ hasCar: true, needsParking: true, mode: 'drive' }), [])!;
    expect(c.lines.find((l) => l.id === 'rent')!.kind).toBe('sourced');
    expect(c.lines.find((l) => l.id === 'internet')!.kind).toBe('assumption');
    expect(c.lines.find((l) => l.id === 'parking')).toBeUndefined();
    expect(c.missing).toContain('parking at home');
    expect(c.total).toBe(c.lines.reduce((s, l) => s + l.amount, 0));
  });

  it('keeps move-in cash separate from monthly costs', () => {
    const ds = city([hood('a', { rent: 2000 })]);
    const p = prefs();
    const m = moveInCost('chicago', ds.neighborhoods[0], { ...p, assumptions: { ...p.assumptions, movingCost: 800 } })!;
    const first = 2000 - p.assumptions.utilities;
    expect(m.lines.find((l) => l.id === 'first')!.amount).toBe(first);
    expect(m.lines.find((l) => l.id === 'deposit')!.amount).toBe(first);
    expect(m.total).toBe(first * 2 + 800);
  });
});

describe('what if', () => {
  it('recomputes matches when the rent limit rises', () => {
    const ds = city([hood('a', { rent: 1400 }), hood('b', { rent: 1700 }), hood('c', { rent: 2100 })]);
    const p = prefs({ maxRent: 1500 - p0Utilities() });
    const evs = evaluateCity(ds, p);
    const s = scenarios(ds, p, evs);
    const plus300 = s.find((x) => x.id === 'rent+300')!;
    expect(plus300.added.map((e) => e.hood.id)).toEqual(['b']);
    expect(plus300.matchCount).toBe(2);
  });

  it('names the conflicting limit and the smallest change that admits an area', () => {
    const ds = city([hood('a', { rent: 1900 }), hood('b', { rent: 2400 })]);
    const p = prefs({ maxRent: 1500 - p0Utilities() });
    const c = conflicts(evaluateCity(ds, p));
    expect(c).toEqual([{ check: 'rent', onlyThis: 2, smallestFix: 400 }]);
  });

  it('offers a roommate scenario that changes both bedrooms and people', () => {
    const ds = city([hood('a', { rent: 1600 })]);
    const p = prefs({ maxRent: 900 });
    const s = scenarios(ds, p, evaluateCity(ds, p)).find((x) => x.id === 'roommate')!;
    expect(s.change).toEqual({ bedrooms: 'br2', people: 2 });
    // 2-bed benchmark 2,000 split two ways is 1,000, within 900 + 85 utilities? No: 985 < 1,000.
    expect(s.matchCount).toBe(0);
  });
});

function p0Utilities() {
  return prefs().assumptions.utilities;
}

describe('links', () => {
  const p = prefs({ maxRent: 2100, takeHomePay: 5200, destinations: [{ label: '233 S Wacker Dr', point: [-87.636, 41.879], daysPerWeek: 5 }], safety: { violent: 3, property: 1, vehicle: 0 } });

  it('shares only the city, neighborhood ids and priorities', () => {
    const url = compareShareUrl('https://example.org', 'chicago', ['chi-22', 'chi-7', 'chi-24', 'chi-1'], p);
    expect(url).not.toMatch(/Wacker|2100|5200|-87|41\.8/);
    const parsed = parseCompareParams(new URL(url).searchParams)!;
    expect(parsed.ids).toEqual(['chi-22', 'chi-7', 'chi-24']);
    expect(applyPriorityCode(prefs(), parsed.priorities!).safety.violent).toBe(3);
    expect(priorityCode(applyPriorityCode(prefs(), parsed.priorities!))).toBe(priorityCode(p));
  });

  it('rejects malformed share parameters', () => {
    expect(parseCompareParams(new URLSearchParams('city=paris&ids=a'))).toBeNull();
    expect(parseCompareParams(new URLSearchParams('city=sf&ids=<script>,sf-mission&p=99'))).toEqual({ city: 'sf', ids: ['sf-mission'], priorities: null });
  });

  it('builds a Zillow place search without guessing filters', () => {
    const h = { ...hood('x'), name: 'Bedford-Stuyvesant (West)', district: 'Brooklyn' };
    expect(zillowRentalsUrl(h, { name: 'New York City', state: 'NY', city: 'nyc' })).toBe('https://www.zillow.com/homes/for_rent/Bedford-Stuyvesant,-Brooklyn,-NY_rb/');
    expect(zillowRentalsUrl({ ...hood('y'), name: 'Logan Square' }, { name: 'Chicago', state: 'IL', city: 'chicago' })).toBe('https://www.zillow.com/homes/for_rent/Logan-Square,-Chicago,-IL_rb/');
    expect(zillowFilterHints(prefs({ maxRent: 1500, people: 2, bedrooms: 'br2' }))[0]).toBe('Price: up to $3,000 for the unit (2 people)');
  });
});

describe('exact fixes', () => {
  it('offers the smallest rent raise that admits an area as its own scenario', () => {
    const ds = city([hood('a', { rent: 1905 }), hood('b', { rent: 2400 })]);
    const p = prefs({ maxRent: 1500 - p0Utilities() });
    const evs = evaluateCity(ds, p);
    const fix = conflicts(evs)[0].smallestFix!;
    expect(fix).toBe(405);
    const s = scenarios(ds, p, evs, { rent: fix }).find((x) => x.id === 'rent+410')!;
    expect(s.matchCount).toBe(1);
    expect(s.added.map((e) => e.hood.id)).toEqual(['a']);
  });
});

describe('reported-incident index', () => {
  it('runs 0–10 from most to fewest reported incidents in the city, weighting violent most', async () => {
    const { incidentIndex } = await import('../src/lib/incidentIndex.ts');
    const { measure } = await import('./fixtures.ts');
    const best = hood('a', { incidents: { violent: measure(1, 1, 0), property: measure(1, 1, 0), vehicle: measure(1, 1, 0), visitorHeavy: false } });
    const worst = hood('b', { incidents: { violent: measure(9, 9, 1), property: measure(9, 9, 1), vehicle: measure(9, 9, 1), visitorHeavy: false } });
    expect(incidentIndex(best).value).toBe(10);
    expect(incidentIndex(worst).value).toBe(0);
    // Low violent, high property: violent's 60% weight dominates.
    const mixed = hood('c', { incidents: { violent: measure(1, 1, 0), property: measure(9, 9, 1), vehicle: measure(9, 9, 1), visitorHeavy: false } });
    expect(incidentIndex(mixed).value).toBe(6);
  });

  it('renormalizes over measures with a stable rate and is null with none', async () => {
    const { incidentIndex } = await import('../src/lib/incidentIndex.ts');
    const { measure } = await import('./fixtures.ts');
    const partial = hood('a', { incidents: { violent: measure(0, null, null), property: measure(1, 1, 0.25), vehicle: measure(1, 1, 0.25), visitorHeavy: false } });
    expect(incidentIndex(partial)).toEqual({ value: 7.5, used: ['property', 'vehicle'], missing: ['violent'] });
    expect(incidentIndex(hood('b', { incidents: null })).value).toBeNull();
    const none = hood('c', { incidents: { violent: measure(0, null, null), property: measure(0, null, null), vehicle: measure(0, null, null), visitorHeavy: false } });
    expect(incidentIndex(none).value).toBeNull();
  });

  it('is display only: it does not change preference fit', () => {
    const ds = city([hood('a'), hood('b', { incidents: null })]);
    const evs = evaluateCity(ds, prefs({ affordability: 2 }));
    expect(evs.map((e) => e.components.map((c) => c.id))).toEqual(evs.map(() => evs[0].components.map((c) => c.id)));
    expect(evs[0].components.some((c) => (c.id as string) === 'incidentIndex')).toBe(false);
  });
});

describe('fares across cities', () => {
  it('charges nothing in fare-free systems and pays per ride where there is no pass', () => {
    expect(monthlyTransportCost('tucson', 'transit', [{ distanceKm: 5, daysPerWeek: 5 }], 0.14, null).amount).toBe(0);
    const hou = monthlyTransportCost('houston', 'transit', [{ distanceKm: 5, daysPerWeek: 5 }], 0.14, null);
    expect(hou.amount).toBe(Math.round(5 * (52 / 12) * 2 * travelFor('houston').fare));
    expect(hou.basis).toMatch(/no monthly pass/);
  });
});
