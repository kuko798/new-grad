import { describe, expect, it } from 'vitest';
import { NIBRS_NAME_RULES, labelKinds, nibrsKinds, nibrsKindsAll } from '../scripts/ingest/generic/classify.ts';
import { parseCsv, toIsoDate } from '../scripts/ingest/generic/fetch.ts';
import { runGenericIncidents, type GenericIncidentSpec, type NormRow } from '../scripts/ingest/generic/incidents.ts';
import { trendWords } from '../src/lib/format.ts';
import { zillowRentalsUrl } from '../src/lib/links.ts';
import { cityInfo, CITIES, depositNote, isCityId } from '../src/lib/cities.ts';
import { hood } from './fixtures.ts';

describe('offense classification', () => {
  it('maps NIBRS codes to the three measures', () => {
    expect(nibrsKinds('13A')).toEqual(['violent']);
    expect(nibrsKinds('13B')).toEqual([]); // simple assault is not counted
    expect(nibrsKinds('23F')).toEqual(['property', 'vehicle']);
    expect(nibrsKinds('240')).toEqual(['property', 'vehicle']);
    expect(nibrsKinds('23C')).toEqual(['property']);
    expect(nibrsKinds('11D')).toEqual([]); // fondling is outside the violent definition
    expect(nibrsKinds(' 120 ')).toEqual(['violent']);
    expect(nibrsKindsAll(['13B', '23F', '13A'])).toEqual(['property', 'vehicle', 'violent']);
  });

  it('maps NIBRS offense names', () => {
    expect(labelKinds('Aggravated Assault', NIBRS_NAME_RULES)).toEqual(['violent']);
    expect(labelKinds('Simple Assault', NIBRS_NAME_RULES)).toEqual([]);
    expect(labelKinds('Theft From Motor Vehicle', NIBRS_NAME_RULES)).toEqual(['property', 'vehicle']);
    expect(labelKinds('Theft of Motor Vehicle Parts or Accessories', NIBRS_NAME_RULES)).toEqual(['property', 'vehicle']);
    expect(labelKinds('Shoplifting', NIBRS_NAME_RULES)).toEqual(['property']);
    expect(labelKinds('Statutory Rape', NIBRS_NAME_RULES)).toEqual([]);
    expect(labelKinds('Identity Theft', NIBRS_NAME_RULES)).toEqual([]);
  });
});

describe('parsing', () => {
  it('parses quoted CSV with commas, quotes and a BOM', () => {
    const rows = parseCsv('﻿a,b,c\r\n1,"x, y","he said ""hi"""\n2,,3\n');
    expect(rows).toEqual([{ a: '1', b: 'x, y', c: 'he said "hi"' }, { a: '2', b: '', c: '3' }]);
  });

  it('normalizes the date formats departments publish', () => {
    expect(toIsoDate(Date.UTC(2026, 2, 5))).toBe('2026-03-05');
    expect(toIsoDate('2026-03-05 00:00:00.0000000')).toBe('2026-03-05');
    expect(toIsoDate('3/5/2026  14:00')).toBe('2026-03-05');
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate('not a date')).toBeNull();
  });
});

describe('generic incident runner', () => {
  const rows: NormRow[] = [
    // the same incident twice (two offense rows): counted once per measure
    { id: 'A', date: '2026-03-01', kinds: ['violent'], lat: 30.01, lon: -97.01 },
    { id: 'A', date: '2026-03-01', kinds: ['violent', 'property'], lat: 30.01, lon: -97.01 },
    // placed by name when it has no coordinates
    { id: 'B', date: '2026-04-01', kinds: ['property'], name: 'North Side' },
    // placed by ZIP
    { id: 'C', date: '2026-05-01', kinds: ['property', 'vehicle'], zip: '78701' },
    // outside every area
    { id: 'D', date: '2026-05-02', kinds: ['violent'], lat: 10, lon: 10 },
    // prior window
    { id: 'E', date: '2025-01-10', kinds: ['violent'], lat: 30.01, lon: -97.01 },
    // after the last complete month: ignored
    { id: 'F', date: '2026-09-20', kinds: ['violent'], lat: 30.01, lon: -97.01 },
  ];
  const spec: GenericIncidentSpec = {
    name: 'Test', publisher: 'Test PD', url: 'https://example.org', license: 'test', updateFrequency: 'daily', staleAfterDays: 30,
    dateBasis: 'report', dedupe: 'ids', notes: [],
    latest: async () => '2026-09-20',
    rows: async () => rows,
  };
  const ctx = {
    locatePoint: (p: [number, number]) => (p[1] > 29 && p[1] < 31 ? 'h-south' : null),
    blockGroupShares: () => [],
    nameToNeighborhood: (n: string) => (n === 'North Side' ? 'h-north' : null),
    locateZip: (z: string) => (z === '78701' ? 'h-zip' : null),
  };

  it('windows, deduplicates and places incidents', async () => {
    const r = await runGenericIncidents('test', spec, ctx);
    expect(r.window).toEqual({ start: '2025-09-01', end: '2026-09-01' });
    expect(r.current.violent.get('h-south')).toBe(1);
    expect(r.current.property.get('h-south')).toBe(1);
    expect(r.current.property.get('h-north')).toBe(1);
    expect(r.current.vehicle.get('h-zip')).toBe(1);
    expect(r.prior.violent.get('h-south')).toBe(1);
    // D is the one unplaced violent/property incident; F is outside the window.
    expect(r.unplaced).toBe(1);
    expect(r.placed).toBe(4);
    expect(r.priorComplete).toBe(false); // data starts 2025-01, after the prior window start of 2024-09
  });
});

describe('cities', () => {
  it('registers forty cities with travel assumptions', () => {
    expect(CITIES).toHaveLength(40);
    expect(new Set(CITIES.map((c) => c.id)).size).toBe(40);
    for (const c of CITIES) {
      expect(c.travel.driveKmh).toBeGreaterThan(10);
      expect(c.travel.fare).toBeGreaterThanOrEqual(0);
    }
    expect(isCityId('denver')).toBe(true);
    expect(isCityId('paris')).toBe(false);
  });

  it('gives deposit rules where established and a general pointer elsewhere', () => {
    expect(depositNote(cityInfo('phoenix'))).toMatch(/one and a half months/);
    expect(depositNote(cityInfo('denver'))).toMatch(/check current Colorado rules/);
  });
});

describe('links for ZIP areas', () => {
  it('searches Zillow by the ZIP code', () => {
    const h = { ...hood('z'), name: 'ZIP 75201' };
    expect(zillowRentalsUrl(h, { name: 'Dallas', state: 'TX', city: 'dallas' })).toBe('https://www.zillow.com/homes/for_rent/75201_rb/');
  });

  it('says when no trend can be shown', () => {
    expect(trendWords(10, 0, false)).toMatch(/does not reach back/);
    expect(trendWords(12, 10)).toBe('+20% vs the previous 12 months (10)');
  });
});

describe('health check city list', () => {
  it('matches the registry in the self-contained Vercel function', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('api/health.ts', 'utf8');
    const list = JSON.parse(/const CITIES = (\[[^\]]*\]);/.exec(src)![1]);
    expect(list).toEqual(CITIES.map((c) => c.id));
  });
});

describe('county-wide police files', () => {
  it('leaves out incidents located outside the city instead of counting them as unplaced', async () => {
    const spec: GenericIncidentSpec = {
      name: 'County PD', publisher: 'x', url: 'x', license: 'x', updateFrequency: 'x', staleAfterDays: 30, dateBasis: 'report', dedupe: 'x', notes: [],
      latest: async () => '2026-08-31',
      rows: async () => [
        { id: 'in', date: '2026-05-01', kinds: ['violent'], lat: 36.17, lon: -115.14 },
        { id: 'out', date: '2026-05-01', kinds: ['violent'], lat: 36.0, lon: -115.0 },
        { id: 'gap', date: '2026-05-01', kinds: ['violent'], lat: 36.18, lon: -115.15 },
      ],
    };
    const r = await runGenericIncidents('lv', spec, {
      locatePoint: (p) => (p[1] === 36.17 ? 'h' : null),
      inCity: (p) => p[1] > 36.1,
      blockGroupShares: () => [],
      nameToNeighborhood: () => null,
      locateZip: () => null,
    });
    expect(r.placed).toBe(1);
    expect(r.unplaced).toBe(1); // inside the city but in no area
  });
});
