// U.S. Census Bureau files that need no API key: ACS table-based summary files and the 2020 ZCTA-to-tract
// relationship file. Each national file is filtered to the counties we cover and cached.
import { cached, fetchWithRetry } from '../util.ts';

export const ACS_VINTAGE = '2024';
export const ACS_PERIOD = '2020–2024 ACS 5-year estimates';
const ACS_BASE = `https://www2.census.gov/programs-surveys/acs/summary_file/${ACS_VINTAGE}/table-based-SF/data/5YRData`;
export const ZCTA_TRACT_URL = 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tract20_natl.txt';

/** State+county FIPS prefixes for the four cities, so national files can be cut down once. */
export const ALL_COUNTIES = ['17031', '36005', '36047', '36061', '36081', '36085', '06075', '48453', '48491', '48209'];

/** ACS jam values (suppressed, not applicable, too few cases) are large negatives; treat all as missing. */
const acsValue = (s: string | undefined) => {
  if (s === undefined || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Returns estimates (E columns) for every covered tract: { geoid: { B25031_E003: 1450, ... } }. */
export async function acsTable(table: string) {
  return cached(`census/acs${ACS_VINTAGE}-${table}`, 365, async () => {
    const res = await fetchWithRetry(`${ACS_BASE}/acsdt5y${ACS_VINTAGE}-${table.toLowerCase()}.dat`);
    const lines = (await res.text()).split('\n');
    const header = lines[0].split('|');
    const out: Record<string, Record<string, number | null>> = {};
    for (const line of lines.slice(1)) {
      if (!line.startsWith('1400000US')) continue;
      const geoid = line.slice(9, 20);
      if (!ALL_COUNTIES.some((p) => geoid.startsWith(p))) continue;
      const cells = line.split('|');
      const row: Record<string, number | null> = {};
      header.forEach((h, i) => {
        if (/_E\d+$/.test(h)) row[h] = acsValue(cells[i]);
      });
      out[geoid] = row;
    }
    return out;
  });
}

/** For each covered tract, the ZCTA containing most of its land area. */
export async function tractToZcta() {
  return cached('census/zcta-tract-2020', 365, async () => {
    const res = await fetchWithRetry(ZCTA_TRACT_URL);
    const best: Record<string, { zcta: string; land: number }> = {};
    for (const line of (await res.text()).split('\n').slice(1)) {
      const c = line.split('|');
      const zcta = c[1];
      const tract = c[9];
      const land = Number(c[15]);
      if (!zcta || !tract || !ALL_COUNTIES.some((p) => tract.startsWith(p))) continue;
      if (!best[tract] || land > best[tract].land) best[tract] = { zcta, land };
    }
    return Object.fromEntries(Object.entries(best).map(([t, v]) => [t, v.zcta]));
  });
}
