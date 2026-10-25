// Jobs located in each Census block from the LEHD Origin-Destination Employment Statistics (LODES 8) workplace
// area characteristics. Used only to flag areas where workers outnumber residents, where per-resident incident
// rates overstate what residents experience.
import { gunzipSync } from 'node:zlib';
import { STATE_FIPS } from './census.ts';
import { cached, fetchWithRetry } from '../util.ts';

export const LODES_YEAR = '2023';
export const LODES_STATES: Record<string, string> = Object.fromEntries(Object.entries(STATE_FIPS).map(([abbr, fips]) => [fips, abbr.toLowerCase()]));
export const lodesUrl = (st: string) => `https://lehd.ces.census.gov/data/lodes/LODES8/${st}/wac/${st}_wac_S000_JT00_${LODES_YEAR}.csv.gz`;

/** { blockGeoid: jobs } for the given counties of one state. */
export async function jobsByBlock(stateFips: string, counties: string[]) {
  const st = LODES_STATES[stateFips];
  const all = await cached(`lehd/wac-blocks-${st}-${LODES_YEAR}-state`, 365, async () => {
    const res = await fetchWithRetry(lodesUrl(st));
    const text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
    const out: Record<string, number> = {};
    for (const line of text.split('\n').slice(1)) {
      const first = line.indexOf(',');
      if (first < 0) continue;
      const block = line.slice(0, first);
      out[block] = Number(line.slice(first + 1, line.indexOf(',', first + 1)));
    }
    return out;
  });
  const value: Record<string, number> = {};
  for (const [block, n] of Object.entries(all.value)) if (counties.some((c) => block.startsWith(c))) value[block] = n;
  return { retrievedAt: all.retrievedAt, value };
}
