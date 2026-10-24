// 2020 Census block populations and internal points from the Census Bureau's TIGERweb REST service (no key).
// Blocks are the building unit of the crosswalk: each block falls in one neighborhood, so a tract's ACS figures
// can be split between neighborhoods by where its residents and homes actually are.
import type { LngLat } from '../../../src/lib/types.ts';
import { cached, fetchWithRetry } from '../util.ts';

export const BLOCKS_URL = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/2';

export interface Block {
  /** 15-digit block GEOID: state 2, county 3, tract 6, block 4 (block group = first 12). */
  g: string;
  pop: number;
  hu: number;
  p: LngLat;
}

export async function blocksForCounty(stateCounty: string) {
  const st = stateCounty.slice(0, 2);
  const co = stateCounty.slice(2);
  return cached(`census/blocks2020-${stateCounty}`, 365, async () => {
    const out: Block[] = [];
    const page = 50_000;
    for (let offset = 0; ; offset += page) {
      const u = new URL(`${BLOCKS_URL}/query`);
      u.searchParams.set('where', `STATE='${st}' AND COUNTY='${co}'`);
      u.searchParams.set('outFields', 'GEOID,POP100,HU100,INTPTLAT,INTPTLON');
      u.searchParams.set('returnGeometry', 'false');
      u.searchParams.set('orderByFields', 'OBJECTID');
      u.searchParams.set('resultOffset', String(offset));
      u.searchParams.set('resultRecordCount', String(page));
      u.searchParams.set('f', 'json');
      const res = await fetchWithRetry(u);
      const j = (await res.json()) as { features?: Array<{ attributes: Record<string, string | number> }>; exceededTransferLimit?: boolean; error?: { message: string } };
      if (j.error) throw new Error(`TIGERweb: ${j.error.message}`);
      for (const f of j.features ?? []) {
        const a = f.attributes;
        out.push({
          g: String(a.GEOID),
          pop: Number(a.POP100) || 0,
          hu: Number(a.HU100) || 0,
          p: [Math.round(Number(a.INTPTLON) * 1e5) / 1e5, Math.round(Number(a.INTPTLAT) * 1e5) / 1e5],
        });
      }
      if (!j.exceededTransferLimit && (j.features?.length ?? 0) < page) break;
    }
    return out;
  });
}
