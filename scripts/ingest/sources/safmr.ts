// HUD Small Area Fair Market Rents by ZIP code. SAFMRs estimate the 40th percentile gross rent paid by
// recent movers, which is closer to what a newcomer will see than the all-tenant ACS median.
import ExcelJS from 'exceljs';
import { cached, fetchWithRetry } from '../util.ts';

export const SAFMR_FY = 'FY2026';
export const SAFMR_URL = 'https://www.huduser.gov/portal/datasets/fmr/fmr2026/fy2026_safmrs.xlsx';

export interface SafmrRow {
  br0: number;
  br1: number;
  br2: number;
  br3: number;
}

/** ZIPs of interest share these three-digit prefixes; filtering keeps the cache small. */
const ZIP_PREFIXES = ['606', '607', '100', '101', '102', '103', '104', '110', '111', '112', '113', '114', '116', '941', '787', '786'];

export async function safmrByZip() {
  return cached('hud/safmr-fy2026', 120, async () => {
    // huduser.gov answers non-browser user agents with an empty 202 while it runs a bot check.
    const res = await fetchWithRetry(SAFMR_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; relocate-fit-ingest/0.1)' } });
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 10_000) throw new Error('HUD returned an empty SAFMR file (bot check); retry later or download it manually.');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    const out: Record<string, SafmrRow> = {};
    ws.eachRow((row, i) => {
      if (i === 1) return;
      const v = row.values as unknown[];
      const zip = String(v[1]).padStart(5, '0');
      if (!ZIP_PREFIXES.some((p) => zip.startsWith(p)) || out[zip]) return;
      out[zip] = { br0: Number(v[4]), br1: Number(v[7]), br2: Number(v[10]), br3: Number(v[13]) };
    });
    return out;
  });
}
