// U.S. Census Bureau files that need no API key: ACS table-based summary files and the 2020 ZCTA-to-tract
// relationship file. Each national file is filtered to the counties we cover and cached.
import { cached, fetchWithRetry } from '../util.ts';

export const ACS_VINTAGE = '2024';
export const ACS_PERIOD = '2020–2024 ACS 5-year estimates';
const ACS_BASE = `https://www2.census.gov/programs-surveys/acs/summary_file/${ACS_VINTAGE}/table-based-SF/data/5YRData`;
export const ZCTA_TRACT_URL = 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tract20_natl.txt';

/** FIPS codes of every state with a covered city, so national files are cut down once. */
export const STATE_FIPS: Record<string, string> = {
  AZ: '04', CA: '06', CO: '08', FL: '12', GA: '13', IL: '17', IN: '18', KY: '21', MA: '25', MD: '24', MI: '26', MN: '27', MO: '29',
  NC: '37', NE: '31', NM: '35', NV: '32', NY: '36', OH: '39', OK: '40', OR: '41', PA: '42', TN: '47', TX: '48', WA: '53', WI: '55',
};
const COVERED = Object.values(STATE_FIPS);
export const inCoveredState = (geoid: string) => COVERED.includes(geoid.slice(0, 2));

/** ACS jam values (suppressed, not applicable, too few cases) are large negatives; treat all as missing. */
const acsValue = (s: string | undefined) => {
  if (s === undefined || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Returns estimates (E columns) for every covered tract: { geoid: { B25031_E003: 1450, ... } }. */
export async function acsTable(table: string) {
  return cached(`census/acs${ACS_VINTAGE}-${table}-states`, 365, async () => {
    const res = await fetchWithRetry(`${ACS_BASE}/acsdt5y${ACS_VINTAGE}-${table.toLowerCase()}.dat`);
    const lines = (await res.text()).split('\n');
    const header = lines[0].split('|');
    const out: Record<string, Record<string, number | null>> = {};
    for (const line of lines.slice(1)) {
      if (!line.startsWith('1400000US')) continue;
      const geoid = line.slice(9, 20);
      if (!inCoveredState(geoid)) continue;
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
  return cached('census/zcta-tract-2020-states', 365, async () => {
    const res = await fetchWithRetry(ZCTA_TRACT_URL);
    const best: Record<string, { zcta: string; land: number }> = {};
    for (const line of (await res.text()).split('\n').slice(1)) {
      const c = line.split('|');
      const zcta = c[1];
      const tract = c[9];
      const land = Number(c[15]);
      if (!zcta || !tract || !inCoveredState(tract)) continue;
      if (!best[tract] || land > best[tract].land) best[tract] = { zcta, land };
    }
    return Object.fromEntries(Object.entries(best).map(([t, v]) => [t, v.zcta]));
  });
}
