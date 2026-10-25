// Vercel function: GET /api/health. Same report as server/health.ts, reading the manifest that the build
// published at /data/manifest.json. Returns 503 when any source failed or is past its staleness threshold.

interface ManifestSource {
  name: string;
  retrievedAt: string;
  staleAfterDays: number;
  status: string;
}
interface Manifest {
  cities: Array<{ city: string; isDemo: boolean; generatedAt: string; incidentWindow?: { start: string; end: string } | null; sources: ManifestSource[] }>;
}

// Same ids as src/lib/cities.ts (kept inline: Vercel bundles this function on its own).
const CITIES = ["nyc", "la", "houston", "chicago", "sanantonio", "phoenix", "austin", "philadelphia", "dallas", "sandiego", "columbus", "jacksonville", "seattle", "fortworth", "charlotte", "nashville", "denver", "sf", "indianapolis", "boston", "okc", "atlanta", "tucson", "portland", "sanjose", "raleigh", "coloradosprings", "detroit", "milwaukee", "lasvegas", "minneapolis", "louisville", "albuquerque", "memphis", "omaha", "baltimore", "mesa", "kansascity", "orlando", "fresno"];

export async function GET(request: Request): Promise<Response> {
  const now = Date.now();
  let manifest: Manifest | null = null;
  try {
    const r = await fetch(new URL('/data/manifest.json', request.url), { signal: AbortSignal.timeout(5_000) });
    if (r.ok) manifest = (await r.json()) as Manifest;
  } catch {
    /* reported below */
  }
  const cities = CITIES.map((city) => {
    const m = manifest?.cities.find((c) => c.city === city);
    if (!m) return { city, ok: false, generatedAt: null, problems: ['No dataset built for this city'] };
    const problems: string[] = [];
    if (m.isDemo) problems.push('Serving demo data');
    // The incident window should end within about four months of the build; older means the publisher stopped updating.
    if (m.incidentWindow) {
      const lag = Math.floor((new Date(m.generatedAt).getTime() - new Date(m.incidentWindow.end).getTime()) / 86_400_000);
      if (lag > 120) problems.push(`Reported incidents end ${m.incidentWindow.end}, ${lag} days before the last build: the publisher may have stopped updating`);
    }
    for (const s of m.sources) {
      const days = Math.floor((now - new Date(s.retrievedAt).getTime()) / 86_400_000);
      if (s.status === 'failed') problems.push(`${s.name}: failed in the last refresh`);
      else if (days > s.staleAfterDays) problems.push(`${s.name}: ${days} days old (stale after ${s.staleAfterDays})`);
    }
    return { city, ok: problems.length === 0, generatedAt: m.generatedAt, problems };
  });
  const ok = cities.every((c) => c.ok);
  return new Response(JSON.stringify({ status: ok ? 'ok' : 'degraded', checkedAt: new Date(now).toISOString(), cities }), {
    status: ok ? 200 : 503,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
