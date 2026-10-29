// Production server: static app, data files, a geocoding proxy and a health check. No framework, no database.
//   PORT=8787 DATA_DIR=public/data node server/index.ts
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkManifest } from './health.ts';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const DIST = resolve(process.env.DIST_DIR ?? join(ROOT, 'dist'));
const DATA = resolve(process.env.DATA_DIR ?? join(ROOT, 'public', 'data'));
const PORT = Number(process.env.PORT ?? 8787);
const GEOCODER = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob: https://tiles.openfreemap.org",
    "connect-src 'self' https://tiles.openfreemap.org",
    "worker-src 'self' blob:",
    "child-src blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join('; '),
};

function send(res: ServerResponse, status: number, body: string | Buffer, type = 'application/json; charset=utf-8', extra: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS, ...extra });
  res.end(body);
}

async function serveFile(res: ServerResponse, file: string, cache: string) {
  const info = await stat(file);
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': cache, ...SECURITY_HEADERS });
  createReadStream(file).pipe(res);
}

/** Resolve a URL path inside a root directory, refusing anything that escapes it. */
function inside(root: string, urlPath: string): string | null {
  const p = normalize(join(root, decodeURIComponent(urlPath)));
  return p.startsWith(root) ? p : null;
}

// --- Geocoding proxy -------------------------------------------------------------------------------------------
// The Census Bureau geocoder needs no key. Queries are never logged. Results are kept in memory for an hour so
// repeated lookups do not hit the Census service; nothing is written to disk.
const CITY_HINT: Record<string, { suffix: string; bounds: [number, number, number, number] }> = {
  chicago: { suffix: 'Chicago, IL', bounds: [-87.95, 41.63, -87.5, 42.03] },
  nyc: { suffix: 'New York, NY', bounds: [-74.27, 40.47, -73.68, 40.93] },
  sf: { suffix: 'San Francisco, CA', bounds: [-122.53, 37.7, -122.35, 37.84] },
  austin: { suffix: 'Austin, TX', bounds: [-98.0, 30.05, -97.55, 30.55] },
};
const cache = new Map<string, { at: number; body: string }>();
const CACHE_MS = 60 * 60 * 1000;
const buckets = new Map<string, { tokens: number; at: number }>();
const PER_MINUTE = Number(process.env.GEOCODE_PER_MINUTE ?? 20);
let globalTokens = { tokens: 300, at: Date.now() };

function take(bucket: { tokens: number; at: number }, perMinute: number) {
  const now = Date.now();
  bucket.tokens = Math.min(perMinute, bucket.tokens + ((now - bucket.at) / 60_000) * perMinute);
  bucket.at = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

async function geocode(req: IncomingMessage, res: ServerResponse, url: URL) {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const city = url.searchParams.get('city') ?? '';
  const hint = CITY_HINT[city];
  if (!hint || q.length < 4) return send(res, 400, JSON.stringify({ error: 'Provide q (an address) and city.' }));

  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const bucket = buckets.get(ip) ?? { tokens: PER_MINUTE, at: Date.now() };
  buckets.set(ip, bucket);
  if (!take(bucket, PER_MINUTE) || !take(globalTokens, 300)) return send(res, 429, JSON.stringify({ error: 'Too many lookups' }), undefined, { 'Retry-After': '60' });

  // Add the city when the person typed no state or ZIP code.
  const full = /\b(IL|NY|CA|TX|\d{5})\b/i.test(q) ? q : `${q}, ${hint.suffix}`;
  const key = `${city}|${full.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return send(res, 200, hit.body, undefined, { 'Cache-Control': 'no-store' });

  try {
    const u = new URL(GEOCODER);
    u.searchParams.set('address', full);
    u.searchParams.set('benchmark', 'Public_AR_Current');
    u.searchParams.set('format', 'json');
    const r = await fetch(u, { signal: AbortSignal.timeout(10_000) });
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
    send(res, 200, body, undefined, { 'Cache-Control': 'no-store' });
  } catch {
    send(res, 502, JSON.stringify({ error: 'The address service is unavailable.' }));
  }
}

const server = createServer(async (req, res) => {
  // Prefixing the origin (rather than passing it as a base) keeps paths like "//" from parsing as a host.
  let url: URL;
  try {
    url = new URL(`http://localhost${(req.url ?? '/').startsWith('/') ? req.url : '/'}`);
  } catch {
    return send(res, 400, '{"error":"Bad request"}');
  }
  // Deliberately no request logging of query strings: they can contain addresses.
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '{"error":"Method not allowed"}');
    if (url.pathname === '/api/geocode') return await geocode(req, res, url);
    if (url.pathname === '/api/health') {
      const report = await checkManifest(DATA);
      return send(res, report.status === 'ok' ? 200 : 503, JSON.stringify(report), undefined, { 'Cache-Control': 'no-store' });
    }
    if (url.pathname.startsWith('/data/')) {
      const file = inside(DATA, url.pathname.slice('/data/'.length));
      if (!file) return send(res, 400, '{"error":"Bad path"}');
      // City files change only when ingestion runs; let browsers revalidate after ten minutes.
      return await serveFile(res, file, 'public, max-age=600, stale-while-revalidate=86400');
    }
    const file = inside(DIST, url.pathname === '/' ? 'index.html' : url.pathname);
    if (file && extname(file)) {
      try {
        return await serveFile(res, file, url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
      } catch {
        return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      }
    }
    // Client-side routes fall back to the app shell.
    const html = await readFile(join(DIST, 'index.html'));
    send(res, 200, html, TYPES['.html'], { 'Cache-Control': 'no-cache' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return send(res, 404, '{"error":"Not found"}');
    console.error('request failed', url.pathname, (err as Error).message);
    if (!res.headersSent) send(res, 500, '{"error":"Server error"}');
  }
});

server.listen(PORT, () => console.log(`Your Next Corner on http://localhost:${PORT} (data from ${DATA})`));
