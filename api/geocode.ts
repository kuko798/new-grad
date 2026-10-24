// Vercel function: GET /api/geocode?city=chicago&q=233 S Wacker Dr
// Same behaviour as the Node server's route (server/index.ts): forwards to the U.S. Census Bureau geocoder,
// keeps results inside the city, never logs the query. Self-contained because Vercel bundles each function
// on its own.
//
// Rate limits and the result cache live in this instance's memory. Vercel runs several instances and
// recycles them, so the limit is per instance: a speed bump, not a guarantee.

const GEOCODER = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const CITY_HINT: Record<string, { suffix: string; bounds: [number, number, number, number] }> = {
  chicago: { suffix: 'Chicago, IL', bounds: [-87.95, 41.63, -87.5, 42.03] },
  nyc: { suffix: 'New York, NY', bounds: [-74.27, 40.47, -73.68, 40.93] },
  sf: { suffix: 'San Francisco, CA', bounds: [-122.53, 37.7, -122.35, 37.84] },
  austin: { suffix: 'Austin, TX', bounds: [-98.0, 30.05, -97.55, 30.55] },
};
const PER_MINUTE = Number(process.env.GEOCODE_PER_MINUTE ?? 20);
const CACHE_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; body: string }>();
const buckets = new Map<string, { tokens: number; at: number }>();

function take(bucket: { tokens: number; at: number }) {
  const now = Date.now();
  bucket.tokens = Math.min(PER_MINUTE, bucket.tokens + ((now - bucket.at) / 60_000) * PER_MINUTE);
  bucket.at = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const hint = CITY_HINT[url.searchParams.get('city') ?? ''];
  if (!hint || q.length < 4) return json(400, { error: 'Provide q (an address) and city.' });

  // Vercel's edge sets x-real-ip to the client address; it does not pass through a client-supplied value.
  const ip = request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const bucket = buckets.get(ip) ?? { tokens: PER_MINUTE, at: Date.now() };
  buckets.set(ip, bucket);
  if (buckets.size > 5000) buckets.delete(buckets.keys().next().value!);
  if (!take(bucket)) return json(429, { error: 'Too many lookups' }, { 'Retry-After': '60' });

  const full = /\b(IL|NY|CA|TX|\d{5})\b/i.test(q) ? q : `${q}, ${hint.suffix}`;
  const key = `${hint.suffix}|${full.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return json(200, hit.body);

  try {
    const u = new URL(GEOCODER);
    u.searchParams.set('address', full);
    u.searchParams.set('benchmark', 'Public_AR_Current');
    u.searchParams.set('format', 'json');
    const r = await fetch(u, { signal: AbortSignal.timeout(8_000) });
    if (!r.ok) throw new Error(`geocoder ${r.status}`);
    const j = (await r.json()) as { result?: { addressMatches?: Array<{ matchedAddress: string; coordinates: { x: number; y: number } }> } };
    const [w, s, e, n] = hint.bounds;
    const results = (j.result?.addressMatches ?? [])
      .filter((m) => m.coordinates.x >= w && m.coordinates.x <= e && m.coordinates.y >= s && m.coordinates.y <= n)
      .slice(0, 5)
      .map((m) => ({ label: m.matchedAddress, point: [Math.round(m.coordinates.x * 1e5) / 1e5, Math.round(m.coordinates.y * 1e5) / 1e5] }));
    const body = JSON.stringify({ results, source: 'U.S. Census Bureau Geocoder' });
    cache.set(key, { at: Date.now(), body });
    if (cache.size > 2000) cache.delete(cache.keys().next().value!);
    return json(200, body);
  } catch {
    return json(502, { error: 'The address service is unavailable.' });
  }
}
