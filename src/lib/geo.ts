// Small geometry toolkit shared by the ingestion scripts and the app. Coordinates are [lng, lat] in WGS84.
import type { LngLat, MultiPolygon, Polygon, Ring } from './types.ts';

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function pointInRing(p: LngLat, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(p: LngLat, poly: Polygon): boolean {
  if (!poly.length || !pointInRing(p, poly[0])) return false;
  for (let h = 1; h < poly.length; h++) if (pointInRing(p, poly[h])) return false;
  return true;
}

export function pointInMultiPolygon(p: LngLat, mp: MultiPolygon): boolean {
  return mp.coordinates.some((poly) => pointInPolygon(p, poly));
}

export type BBox = [number, number, number, number]; // minLng, minLat, maxLng, maxLat

export function bboxOf(mp: MultiPolygon): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of mp.coordinates)
    for (const [x, y] of poly[0]) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  return [minX, minY, maxX, maxY];
}

export function unionBBox(boxes: BBox[]): BBox {
  return boxes.reduce(
    (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])],
    [Infinity, Infinity, -Infinity, -Infinity] as BBox,
  );
}

/** Area of a ring in square metres on a sphere (signed by winding, so callers take the absolute value). */
function ringAreaM2(ring: Ring): number {
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    total += toRad(x2 - x1) * (2 + Math.sin(toRad(y1)) + Math.sin(toRad(y2)));
  }
  return (total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2;
}

export function multiPolygonAreaKm2(mp: MultiPolygon): number {
  let m2 = 0;
  for (const poly of mp.coordinates) {
    m2 += Math.abs(ringAreaM2(poly[0]));
    for (let h = 1; h < poly.length; h++) m2 -= Math.abs(ringAreaM2(poly[h]));
  }
  return m2 / 1e6;
}

/** Area-weighted centre of the largest polygon's outer ring (good enough as a label point and fallback centroid). */
export function polygonCentroid(mp: MultiPolygon): LngLat {
  let best: Ring | null = null;
  let bestArea = -1;
  for (const poly of mp.coordinates) {
    const a = Math.abs(ringAreaM2(poly[0]));
    if (a > bestArea) {
      bestArea = a;
      best = poly[0];
    }
  }
  if (!best) return [0, 0];
  let cx = 0, cy = 0, a2 = 0;
  for (let i = 0; i < best.length - 1; i++) {
    const [x1, y1] = best[i];
    const [x2, y2] = best[i + 1];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
    a2 += f;
  }
  if (a2 === 0) return best[0];
  return [cx / (3 * a2), cy / (3 * a2)];
}

function perpendicularDistance(p: LngLat, a: LngLat, b: LngLat): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const tt = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + tt * dx), p[1] - (a[1] + tt * dy));
}

/** Douglas–Peucker simplification of an open polyline (iterative to avoid deep recursion on long rings). */
function simplifyLine(points: LngLat[], tolerance: number): LngLat[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(points[i], points[start], points[end]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([start, idx], [idx, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Simplifies and rounds a MultiPolygon for the browser, dropping rings that collapse below a triangle. */
export function simplifyMultiPolygon(mp: MultiPolygon, tolerance = 0.00008, dp = 5): MultiPolygon {
  const coordinates: Polygon[] = [];
  for (const poly of mp.coordinates) {
    const rings: Ring[] = [];
    poly.forEach((ring, ri) => {
      const open = ring.slice(0, -1);
      // Split the closed ring into two halves so the endpoints are well-defined for Douglas–Peucker.
      const mid = Math.floor(open.length / 2);
      const a = simplifyLine(open.slice(0, mid + 1), tolerance);
      const b = simplifyLine([...open.slice(mid), open[0]], tolerance);
      const merged = [...a, ...b.slice(1)].map(([x, y]) => [round(x, dp), round(y, dp)] as LngLat);
      if (merged.length >= 4) rings.push(merged);
      else if (ri === 0) rings.push(ring.map(([x, y]) => [round(x, dp), round(y, dp)] as LngLat));
    });
    if (rings.length) coordinates.push(rings);
  }
  return { type: 'MultiPolygon', coordinates };
}

/** Spatial lookup of points against many polygons, with a coarse grid over polygon bounding boxes. */
export class PolygonIndex<T extends { geometry: MultiPolygon }> {
  private cells = new Map<string, Array<{ item: T; box: BBox }>>();
  private readonly size: number;

  constructor(items: T[], cellSizeDeg = 0.02) {
    this.size = cellSizeDeg;
    for (const item of items) {
      const box = bboxOf(item.geometry);
      for (let x = Math.floor(box[0] / this.size); x <= Math.floor(box[2] / this.size); x++)
        for (let y = Math.floor(box[1] / this.size); y <= Math.floor(box[3] / this.size); y++) {
          const key = `${x}:${y}`;
          let list = this.cells.get(key);
          if (!list) this.cells.set(key, (list = []));
          list.push({ item, box });
        }
    }
  }

  /** Every item containing the point (more than one only where polygons overlap). */
  findAll(p: LngLat): T[] {
    const list = this.cells.get(`${Math.floor(p[0] / this.size)}:${Math.floor(p[1] / this.size)}`);
    if (!list) return [];
    return list.filter(({ item, box }) => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3] && pointInMultiPolygon(p, item.geometry)).map((x) => x.item);
  }

  find(p: LngLat): T | null {
    const list = this.cells.get(`${Math.floor(p[0] / this.size)}:${Math.floor(p[1] / this.size)}`);
    if (!list) return null;
    for (const { item, box } of list) {
      if (p[0] < box[0] || p[0] > box[2] || p[1] < box[1] || p[1] > box[3]) continue;
      if (pointInMultiPolygon(p, item.geometry)) return item;
    }
    return null;
  }
}

export function toMultiPolygon(geom: { type: string; coordinates: unknown }): MultiPolygon {
  if (geom.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: geom.coordinates as Polygon[] };
  if (geom.type === 'Polygon') return { type: 'MultiPolygon', coordinates: [geom.coordinates as Polygon] };
  throw new Error(`Unsupported geometry type ${geom.type}`);
}
