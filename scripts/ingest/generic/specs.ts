// Small builders that turn a platform and a field mapping into a GenericIncidentSpec's `latest` and `rows`.
import type { IncidentKind } from '../../../src/lib/types.ts';
import { cachedSoql, soql } from '../sources/socrata.ts';
import { arcDateRange, arcgisMaxDate, arcgisRows, csvRows, num, toIsoDate, type ArcRow } from './fetch.ts';
import type { NormRow } from './incidents.ts';

type Located = { kinds: IncidentKind[]; lat?: number; lon?: number; zip?: string; name?: string };
type Spec = { latest(): Promise<string>; rows(from: string, to: string): Promise<NormRow[]> };

const inList = (field: string, values: string[]) => `${field} IN (${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(',')})`;
export { inList };

/** ArcGIS layer or table, optionally split across yearly layers. */
export function arcgis(o: {
  urls: string[];
  dateField: string;
  idField: string;
  fields: string[];
  where?: string;
  geometry?: boolean;
  map: (a: Record<string, unknown>, row: ArcRow) => Located;
}): Spec {
  return {
    async latest() {
      const dates = await Promise.all(o.urls.map((u) => arcgisMaxDate(u, o.dateField, o.where ?? '1=1').catch(() => '0000-00-00')));
      return dates.sort().at(-1)!;
    },
    async rows(from, to) {
      const out: NormRow[] = [];
      for (const url of o.urls) {
        const where = [o.where, arcDateRange(o.dateField, from, to)].filter(Boolean).join(' AND ');
        const rows = await arcgisRows(url, where, [...new Set([o.idField, o.dateField, ...o.fields])], o.geometry ?? false);
        for (const r of rows) {
          const loc = o.map(r.a, r);
          out.push({ id: String(r.a[o.idField] ?? ''), date: toIsoDate(r.a[o.dateField]), ...loc, lat: loc.lat ?? (o.geometry ? r.y : undefined), lon: loc.lon ?? (o.geometry ? r.x : undefined) });
        }
      }
      return out;
    },
  };
}

/** Socrata dataset(s); date comparisons work for timestamps and ISO-like text alike. */
export function socrata(o: {
  domain: string;
  /** Dataset ids; a dataset whose columns are named differently maps the names used here to its own. */
  datasets: SocrataDataset[];
  dateField: string;
  idField: string;
  select: string[];
  where?: string;
  map: (r: Record<string, unknown>) => Located;
}): Spec {
  return {
    async latest() {
      const dates: string[] = [];
      for (const ds of o.datasets) {
        const { id, f } = dataset(ds);
        const where = o.where && rename(o.where, ds);
        const [r] = await soql<{ m: string }>(o.domain, id, { $select: `max(${f(o.dateField)}) as m`, ...(where ? { $where: where } : {}), $order: 'm' });
        if (r?.m) dates.push(toIsoDate(r.m)!);
      }
      return dates.sort().at(-1)!;
    },
    async rows(from, to) {
      const out: NormRow[] = [];
      for (const ds of o.datasets) {
        const { id, f } = dataset(ds);
        const date = f(o.dateField);
        const rows = await cachedSoql<Record<string, unknown>>(o.domain, id, {
          $select: [...new Set([o.idField, o.dateField, ...o.select])].map((c) => (f(c) === c ? c : `${f(c)} as ${c}`)).join(','),
          $where: [o.where && rename(o.where, ds), `${date} >= '${from}' AND ${date} < '${to}'`].filter(Boolean).join(' AND '),
        });
        for (const r of rows) out.push({ id: String(r[o.idField] ?? ''), date: toIsoDate(r[o.dateField]), ...o.map(r) });
      }
      return out;
    },
  };
}

/** CSV files (yearly files, or one full export), filtered locally. */
export function csv(o: {
  urls: (from: string, to: string) => string[];
  /** The date column, or alternatives when the publisher renamed it between files. */
  dateField: string | string[];
  idField: string;
  columns: string[];
  map: (r: Record<string, string>) => Located;
  headers?: Record<string, string>;
}): Spec {
  const load = async (from: string, to: string) => {
    const out: NormRow[] = [];
    for (const url of o.urls(from, to)) {
      const dateFields = Array.isArray(o.dateField) ? o.dateField : [o.dateField];
      const rows = await csvRows(url, [...new Set([o.idField, ...dateFields, ...o.columns])], 6, o.headers);
      for (const r of rows) out.push({ id: r[o.idField], date: toIsoDate(dateFields.map((d) => r[d]).find((v) => v)), ...o.map(r) });
    }
    return out;
  };
  return {
    async latest() {
      const today = new Date().toISOString().slice(0, 10);
      const yearStart = `${today.slice(0, 4)}-01-01`;
      // Look back far enough to find the newest month even early in a year.
      const rows = await load(`${Number(today.slice(0, 4)) - 1}-01-01`, today);
      const dates = rows.map((r) => r.date).filter((d): d is string => !!d && d <= today);
      if (!dates.length) throw new Error(`No dated rows since ${yearStart}`);
      return dates.sort().at(-1)!;
    },
    rows: load,
  };
}

/** Socrata point or location columns as lat/lon. */
type SocrataDataset = string | { id: string; fields: Record<string, string> };

function dataset(ds: SocrataDataset) {
  if (typeof ds === 'string') return { id: ds, f: (c: string) => c };
  return { id: ds.id, f: (c: string) => ds.fields[c] ?? c };
}

/** Rewrites column names in a where clause for a dataset that names them differently. */
function rename(where: string, ds: SocrataDataset) {
  if (typeof ds === 'string') return where;
  return where.replace(/\b[a-z_]+\b/g, (w) => ds.fields[w] ?? w);
}

export function socrataPoint(v: unknown): { lat?: number; lon?: number } {
  if (!v || typeof v !== 'object') return {};
  const o = v as { coordinates?: [number, number]; latitude?: string; longitude?: string };
  if (o.coordinates) return { lon: num(o.coordinates[0]), lat: num(o.coordinates[1]) };
  return { lat: num(o.latitude), lon: num(o.longitude) };
}

export const years = (from: string, to: string) => {
  const out: number[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) out.push(y);
  return out;
};
