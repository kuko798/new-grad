import { describe, expect, it } from 'vitest';
import { evaluateCity, partition, sortEvaluations } from '../src/lib/scoring.ts';
import { grossLimit, rentFigure } from '../src/lib/cost.ts';
import { amen, city, hood, measure, prefs } from './fixtures.ts';

const utilities = prefs().assumptions.utilities; // the default 1-bed utilities assumption

describe('hard constraints', () => {
  it('never shows a neighborhood above the rent limit as a match', () => {
    const ds = city([hood('a', { rent: 1500 }), hood('b', { rent: 2500 })]);
    const p = prefs({ maxRent: 1600 - utilities, affordability: 2 });
    const r = partition(evaluateCity(ds, p));
    expect(r.matches.map((e) => e.hood.id)).toEqual(['a']);
    expect(r.failing.map((e) => e.hood.id)).toEqual(['b']);
    expect(r.failing[0].checks.find((c) => c.id === 'rent')!.overBy).toBe(2500 - 1600);
  });

  it('treats a benchmark exactly at the limit as within it', () => {
    const ds = city([hood('a', { rent: 1600 })]);
    const r = partition(evaluateCity(ds, prefs({ maxRent: 1600 - utilities })));
    expect(r.matches).toHaveLength(1);
  });

  it('lists areas without a rent benchmark as unverified, not as matches', () => {
    const ds = city([hood('a', { rent: null }), hood('b', { rent: 1200 })]);
    const r = partition(evaluateCity(ds, prefs({ maxRent: 2000 })));
    expect(r.matches.map((e) => e.hood.id)).toEqual(['b']);
    expect(r.unverified.map((e) => e.hood.id)).toEqual(['a']);
  });

  it('applies the commute limit only when it is marked as a limit', () => {
    const ds = city([hood('near', { x: 0 }), hood('far', { x: 0.3 })]);
    const dest = [{ label: 'Work', point: [0.005, 0.005] as [number, number], daysPerWeek: 5 }];
    const hard = partition(evaluateCity(ds, prefs({ destinations: dest, maxCommute: 30, commuteHard: true, commute: 2 })));
    expect(hard.matches.map((e) => e.hood.id)).toEqual(['near']);
    const soft = partition(evaluateCity(ds, prefs({ destinations: dest, maxCommute: 30, commuteHard: false, commute: 2 })));
    expect(soft.matches).toHaveLength(2);
    const far = soft.matches.find((e) => e.hood.id === 'far')!;
    expect(far.components.find((c) => c.id === 'commute')!.value).toBe(0);
  });

  it('checks two destinations against the limit separately', () => {
    const ds = city([hood('a', { x: 0 })]);
    const dests = [
      { label: 'Work', point: [0.005, 0.005] as [number, number], daysPerWeek: 5 },
      { label: 'School', point: [0.4, 0.005] as [number, number], daysPerWeek: 2 },
    ];
    const r = partition(evaluateCity(ds, prefs({ destinations: dests, maxCommute: 40 })));
    expect(r.failing).toHaveLength(1);
  });

  it('enforces the optional total housing budget', () => {
    const ds = city([hood('a', { rent: 1500 })]);
    const p = prefs({ totalHousingBudget: 1500 });
    const r = partition(evaluateCity(ds, p));
    expect(r.failing).toHaveLength(1);
    expect(r.failing[0].checks.find((c) => c.id === 'housing')!.passes).toBe(false);
  });
});

describe('weighting', () => {
  it('ranks by the weighted average of preferences and reports each contribution', () => {
    const quietLowCrime = hood('a', { incidents: { violent: measure(5, 1, 0), property: measure(20, 4, 0), vehicle: measure(5, 1, 0), visitorHeavy: false } });
    const busy = hood('b', { incidents: { violent: measure(90, 20, 1), property: measure(900, 90, 1), vehicle: measure(90, 9, 1), visitorHeavy: false } });
    const ds = city([quietLowCrime, busy]);
    const p = prefs({ safety: { violent: 3, property: 0, vehicle: 0 } });
    const evs = sortEvaluations(evaluateCity(ds, p), 'fit');
    expect(evs[0].hood.id).toBe('a');
    expect(evs[0].score).toBe(100);
    expect(evs[1].score).toBe(0);
    for (const e of evs) {
      const sum = e.components.reduce((s, c) => s + c.points, 0);
      expect(Math.round(sum)).toBe(e.score);
    }
  });

  it('changing a weight changes the order', () => {
    const groceryRich = hood('a', { amenities: amen({ grocery: 9, parks: 0 }) });
    const parkRich = hood('b', { amenities: amen({ grocery: 0, parks: 9 }) });
    const ds = city([groceryRich, parkRich]);
    const groceryFirst = sortEvaluations(evaluateCity(ds, prefs({ amenities: { ...prefs().amenities, grocery: 3, parks: 1 } })), 'fit');
    expect(groceryFirst[0].hood.id).toBe('a');
    const parksFirst = sortEvaluations(evaluateCity(ds, prefs({ amenities: { ...prefs().amenities, grocery: 1, parks: 3 } })), 'fit');
    expect(parksFirst[0].hood.id).toBe('b');
  });

  it('ignores preferences set to "not a factor"', () => {
    const ds = city([hood('a', { amenities: amen({ nightlife: 0 }) }), hood('b', { amenities: amen({ nightlife: 50 }) })]);
    const evs = evaluateCity(ds, prefs({ amenities: { ...prefs().amenities, nightlife: 0, grocery: 2 } }));
    expect(evs[0].score).toBe(evs[1].score);
    expect(evs[0].components.find((c) => c.id === 'nightlife')!.points).toBe(0);
  });

  it('gives no score when nothing is weighted', () => {
    const ds = city([hood('a')]);
    expect(evaluateCity(ds, prefs())[0].score).toBeNull();
  });
});

describe('missing data', () => {
  it('scores a missing incident rate at the city median, never as low', () => {
    const low = hood('low', { incidents: { violent: measure(1, 0.5, 0), property: measure(1, 1, 0), vehicle: measure(1, 1, 0), visitorHeavy: false } });
    const unknown = hood('unknown', { population: 800, incidents: { violent: measure(0, null, null), property: measure(0, null, null), vehicle: measure(0, null, null), visitorHeavy: false } });
    const noData = hood('none', { incidents: null });
    const ds = city([low, unknown, noData]);
    const evs = evaluateCity(ds, prefs({ safety: { violent: 3, property: 0, vehicle: 0 } }));
    const by = Object.fromEntries(evs.map((e) => [e.hood.id, e]));
    expect(by.unknown.components.find((c) => c.id === 'violent')!.status).toBe('imputed');
    expect(by.unknown.score).toBe(50);
    expect(by.none.score).toBe(50);
    expect(by.low.score).toBeGreaterThan(by.unknown.score!);
    // Coverage is reported separately from fit.
    expect(by.unknown.coverage).toBe(0);
    expect(by.low.coverage).toBe(1);
  });

  it('renormalizes over supported measures when amenity data is missing, and says so', () => {
    const withData = hood('a', { amenities: amen({ grocery: 5 }) });
    const without = hood('b', { amenities: null });
    const ds = city([withData, without, hood('c', { amenities: amen({ grocery: 0 }) })]);
    const p = prefs({ affordability: 2, amenities: { ...prefs().amenities, grocery: 2 } });
    const b = evaluateCity(ds, p).find((e) => e.hood.id === 'b')!;
    const grocery = b.components.find((c) => c.id === 'grocery')!;
    expect(grocery.status).toBe('missing');
    expect(grocery.points).toBe(0);
    expect(b.coverage).toBe(0.5);
    // The score is the affordability fit alone, not dragged to zero by the missing measure.
    const aff = b.components.find((c) => c.id === 'affordability')!;
    expect(b.score).toBe(Math.round(aff.value! * 100));
  });

  it('does not treat a station accessibility tag gap as inaccessible', () => {
    const ds = city([hood('a', { amenities: amen({ railStations: 4, stationsWithAccessTag: 1, stepFreeStations: 0 }) })]);
    const e = evaluateCity(ds, prefs({ amenities: { ...prefs().amenities, stepFree: 2 } }))[0];
    expect(e.components.find((c) => c.id === 'stepFree')!.status).toBe('missing');
  });
});

describe('rent benchmarks', () => {
  it('prefers the recent-mover SAFMR over the all-renter ACS median', () => {
    const h = hood('a', { rent: 1400, safmr1: 1900 });
    expect(rentFigure(h, { bedrooms: 'br1', people: 1 })).toMatchObject({ source: 'safmr', unitGross: 1900 });
    expect(rentFigure(hood('b', { rent: 1400 }), { bedrooms: 'br1', people: 1 })).toMatchObject({ source: 'acs', unitGross: 1400 });
  });

  it('splits the unit benchmark between people sharing', () => {
    const h = hood('a', { rent: 3000 });
    expect(rentFigure(h, { bedrooms: 'br1', people: 3 })!.shareGross).toBe(1000);
  });

  it('adds the per-person utilities assumption to the rent limit', () => {
    const p = prefs({ maxRent: 1000, people: 2 });
    expect(grossLimit(p)).toBe(1000 + Math.round(p.assumptions.utilities / 2));
  });
});

describe('explanations', () => {
  it('builds reasons and a tradeoff from calculated values', () => {
    const a = hood('a', { rent: 1200, amenities: amen({ grocery: 9 }), incidents: { violent: measure(5, 1.2, 0), property: measure(900, 90, 1), vehicle: measure(5, 1, 0), visitorHeavy: false } });
    const ds = city([a, hood('b', { rent: 1500, amenities: amen({ grocery: 0 }), incidents: { violent: measure(90, 9, 1), property: measure(20, 2, 0), vehicle: measure(5, 1, 1), visitorHeavy: false } })]);
    const p = prefs({ maxRent: 1800, affordability: 2, safety: { violent: 3, property: 2, vehicle: 0 }, amenities: { ...prefs().amenities, grocery: 1 } });
    const e = evaluateCity(ds, p).find((x) => x.hood.id === 'a')!;
    expect(e.reasons.length).toBeGreaterThanOrEqual(2);
    expect(e.reasons.join(' ')).toContain('1.2 per 1,000 residents');
    expect(e.tradeoff).toContain('property-incident rate 90.0');
  });
});

describe('display rounding', () => {
  it('shows whole points that add up to the displayed score', async () => {
    const { displayPoints } = await import('../src/lib/scoring.ts');
    const ds = city([hood('a', { amenities: amen({ grocery: 3, parks: 1 }) }), hood('b', { amenities: amen({ grocery: 1, parks: 7 }) }), hood('c', { amenities: amen({ grocery: 2, parks: 3 }) })]);
    const evs = evaluateCity(ds, prefs({ affordability: 1, amenities: { ...prefs().amenities, grocery: 2, parks: 3, transit: 1 } }));
    for (const e of evs) {
      const sum = [...displayPoints(e).values()].reduce((s, n) => s + n, 0);
      expect(sum).toBe(e.score);
    }
  });
});
