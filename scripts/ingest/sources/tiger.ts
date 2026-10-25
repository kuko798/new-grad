// Census Bureau TIGERweb (no key): the city's legal boundary, the counties it touches, and ZIP Code Tabulation
// Areas, used when a city publishes no clean neighborhood geography.
import { toMultiPolygon, type BBox } from '../../../src/lib/geo.ts';
import type { MultiPolygon } from '../../../src/lib/types.ts';
import { cached, fetchWithRetry } from '../util.ts';

const CURRENT = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer';
export const PLACES_URL = `${CURRENT}/28`;
const COUNTIES_URL = `${CURRENT}/82`;
export const ZCTA_URL = `${CURRENT}/2`;

interface GeoJsonFC {
  features: Array<{ properties: Record<string, string>; geometry: { type: string; coordinates: unknown } | null }>;
}

async function query(layer: string, params: Record<string, string>): Promise<GeoJsonFC> {
  const u = new URL(`${layer}/query`);
  for (const [k, v] of Object.entries({ outSR: '4326', f: 'geojson', ...params })) u.searchParams.set(k, v);
  const res = await fetchWithRetry(u);
  const j = (await res.json()) as GeoJsonFC & { error?: { message: string } };
  if (j.error) throw new Error(`TIGERweb: ${j.error.message}`);
  return j;
}

/** The incorporated place (city limits) as a MultiPolygon. */
export async function placeBoundary(geoid: string) {
  return cached(`census/place-${geoid}`, 365, async () => {
    const fc = await query(PLACES_URL, { where: `GEOID='${geoid}'`, outFields: 'GEOID,NAME', returnGeometry: 'true' });
    const g = fc.features[0]?.geometry;
    if (!g) throw new Error(`No place ${geoid} in TIGERweb`);
    return { name: fc.features[0].properties.NAME, geometry: toMultiPolygon(g) };
  });
}

/** State+county FIPS codes of counties intersecting a bounding box (the blocks crosswalk filters by the place itself). */
export async function countiesInBox(box: BBox) {
  return cached(`census/counties-${box.map((v) => v.toFixed(2)).join('_')}`, 365, async () => {
    const fc = await query(COUNTIES_URL, {
      geometry: box.join(','),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'GEOID',
      returnGeometry: 'false',
      f: 'json',
    } as Record<string, string>) as unknown as { features: Array<{ attributes: { GEOID: string } }> };
    return fc.features.map((f) => f.attributes.GEOID).sort();
  });
}

/** ZIP Code Tabulation Areas intersecting a bounding box. */
export async function zctasInBox(box: BBox) {
  return cached(`census/zcta-${box.map((v) => v.toFixed(2)).join('_')}`, 365, async () => {
    const out: Array<{ zcta: string; geometry: MultiPolygon }> = [];
    for (let offset = 0; ; offset += 200) {
      const fc = await query(ZCTA_URL, {
        geometry: box.join(','),
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'ZCTA5',
        returnGeometry: 'true',
        resultOffset: String(offset),
        resultRecordCount: '200',
        orderByFields: 'OBJECTID',
      });
      for (const f of fc.features) if (f.geometry) out.push({ zcta: f.properties.ZCTA5, geometry: toMultiPolygon(f.geometry) });
      if (fc.features.length < 200) break;
    }
    return out;
  });
}
