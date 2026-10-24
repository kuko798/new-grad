// Jobs located in each Census block from the LEHD Origin-Destination Employment Statistics (LODES 8) workplace
// area characteristics. Used only to flag areas where workers outnumber residents, where per-resident incident
// rates overstate what residents experience.
import { gunzipSync } from 'node:zlib';
import { ALL_COUNTIES } from './census.ts';
import { cached, fetchWithRetry } from '../util.ts';

export const LODES_YEAR = '2023';
export const LODES_STATES: Record<string, string> = { '17': 'il', '36': 'ny', '06': 'ca', '48': 'tx' };
export const lodesUrl = (st: string) => `https://lehd.ces.census.gov/data/lodes/LODES8/${st}/wac/${st}_wac_S000_JT00_${LODES_YEAR}.csv.gz`;

/** { blockGeoid: jobs } for the covered counties of one state. */
export async function jobsByBlock(stateFips: string) {
  const st = LODES_STATES[stateFips];
  return cached(`lehd/wac-blocks-${st}-${LODES_YEAR}`, 365, async () => {
    const res = await fetchWithRetry(lodesUrl(st));
    const text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
    const out: Record<string, number> = {};
    for (const line of text.split('\n').slice(1)) {
      const first = line.indexOf(',');
      if (first < 0) continue;
      const block = line.slice(0, first);
      if (!ALL_COUNTIES.some((c) => block.startsWith(c))) continue;
      out[block] = Number(line.slice(first + 1, line.indexOf(',', first + 1)));
    }
    return out;
  });
}
