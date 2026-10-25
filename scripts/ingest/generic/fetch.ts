// Fetchers for the open-data platforms the generic city configs use: ArcGIS REST (FeatureServer/MapServer
// layers and tables), Socrata (via ../sources/socrata.ts) and plain CSV files. Results are cached under data/raw.
import { createHash } from 'node:crypto';
import { cached, fetchWithRetry } from '../util.ts';

const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12);

interface LayerMeta {
  maxRecordCount?: number;
  objectIdField?: string;
  fields?: Array<{ name: string; type: string }>;
  advancedQueryCapabilities?: { supportsPagination?: boolean };
  error?: { message: string };
}

const metaCache = new Map<string, Promise<LayerMeta>>();
export function layerMeta(url: string): Promise<LayerMeta> {
  let m = metaCache.get(url);
  if (!m) {
    m = fetchWithRetry(`${url}?f=json`).then((r) => r.json() as Promise<LayerMeta>);
    metaCache.set(url, m);
  }
  return m;
}

async function post(url: string, params: Record<string, string>) {
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ f: 'json', ...params }),
  });
  const j = (await res.json()) as { features?: Array<{ attributes: Record<string, unknown>; geometry?: { x: number; y: number } }>; objectIds?: number[]; exceededTransferLimit?: boolean; error?: { message: string; details?: string[] } };
  if (j.error) throw new Error(`ArcGIS ${url}: ${j.error.message} ${(j.error.details ?? []).join(' ')}`);
  return j;
}

export interface ArcRow {
  a: Record<string, unknown>;
  /** Point geometry in WGS84 when requested. */
  x?: number;
  y?: number;
}

/** Every row matching `where`, paged by offset when the layer supports it and by object ids otherwise. */
export async function arcgisRows(url: string, where: string, outFields: string[], geometry = false): Promise<ArcRow[]> {
  return (
    await cached(`arcgis/${hash(url + where + outFields.join(',') + geometry)}`, 6, async () => {
      const meta = await layerMeta(url);
      if (meta.error) throw new Error(`ArcGIS ${url}: ${meta.error.message}`);
      const oid = meta.objectIdField ?? meta.fields?.find((f) => f.type === 'esriFieldTypeOID')?.name ?? 'OBJECTID';
      const page = Math.min(meta.maxRecordCount ?? 1000, 2000);
      const base = { outFields: outFields.join(','), returnGeometry: String(geometry), ...(geometry ? { outSR: '4326' } : {}) };
      const out: ArcRow[] = [];
      const take = (j: Awaited<ReturnType<typeof post>>) => {
        for (const f of j.features ?? []) out.push(f.geometry ? { a: f.attributes, x: f.geometry.x, y: f.geometry.y } : { a: f.attributes });
      };
      if (meta.advancedQueryCapabilities?.supportsPagination !== false) {
        try {
          for (let offset = 0; ; offset += page) {
            const j = await post(`${url}/query`, { ...base, where, orderByFields: oid, resultOffset: String(offset), resultRecordCount: String(page) });
            take(j);
            if ((j.features?.length ?? 0) < page && !j.exceededTransferLimit) return out;
          }
        } catch (err) {
          if (out.length) throw err;
          // Fall through to id paging on servers that reject offsets.
        }
      }
      const ids = (await post(`${url}/query`, { where, returnIdsOnly: 'true' })).objectIds ?? [];
      ids.sort((p, q) => p - q);
      for (let i = 0; i < ids.length; i += page) {
        take(await post(`${url}/query`, { ...base, objectIds: ids.slice(i, i + page).join(',') }));
      }
      return out;
    })
  ).value;
}

/** Maximum of a date field (epoch ms) as an ISO date. */
export async function arcgisMaxDate(url: string, field: string, where = '1=1'): Promise<string> {
  const stats = JSON.stringify([{ statisticType: 'max', onStatisticField: field, outStatisticFieldName: 'm' }]);
  const j = await post(`${url}/query`, { where, outStatistics: stats });
  const v = j.features?.[0]?.attributes?.m;
  if (v == null) throw new Error(`No max date for ${url}`);
  return toIsoDate(v)!;
}

/** ArcGIS standardized-SQL date range on one field. */
export const arcDateRange = (field: string, from: string, to: string) => `${field} >= DATE '${from}' AND ${field} < DATE '${to}'`;

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF), returning objects keyed by header. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}

/** A CSV file reduced to the listed columns, cached. */
export async function csvRows(url: string, columns: string[], maxAgeDays = 6, headers: Record<string, string> = {}): Promise<Array<Record<string, string>>> {
  return (
    await cached(`csv/${hash(url + columns.join(','))}`, maxAgeDays, async () => {
      const res = await fetchWithRetry(url, { headers });
      const rows = parseCsv(await res.text());
      return rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? ''])));
    })
  ).value;
}

/** Normalizes epoch milliseconds, ISO strings and US M/D/YYYY strings to YYYY-MM-DD. */
export function toIsoDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? new Date(v).toISOString().slice(0, 10) : null;
  const s = String(v).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return null;
}

export const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  return Number.isFinite(n) && n !== 0 ? n : undefined;
};

/** Polygon features of an ArcGIS layer as GeoJSON (WGS84), paged. */
export async function arcgisPolygons(url: string, where: string, outFields: string[]) {
  return (
    await cached(`arcgis-geo/${hash(url + where + outFields.join(','))}`, 30, async () => {
      const meta = await layerMeta(url);
      if (meta.error) throw new Error(`ArcGIS ${url}: ${meta.error.message}`);
      const oid = meta.objectIdField ?? meta.fields?.find((f) => f.type === 'esriFieldTypeOID')?.name ?? 'OBJECTID';
      const page = Math.min(meta.maxRecordCount ?? 1000, 500);
      const out: Array<{ properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } | null }> = [];
      for (let offset = 0; ; offset += page) {
        const res = await fetchWithRetry(`${url}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ where, outFields: outFields.join(','), returnGeometry: 'true', outSR: '4326', orderByFields: oid, resultOffset: String(offset), resultRecordCount: String(page), f: 'geojson' }),
        });
        const fc = (await res.json()) as { features?: typeof out; error?: { message: string } };
        if (fc.error) throw new Error(`ArcGIS ${url}: ${fc.error.message}`);
        out.push(...(fc.features ?? []));
        if ((fc.features?.length ?? 0) < page) return out;
      }
    })
  ).value;
}
