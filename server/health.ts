// Source-health check shared by the server's /api/health endpoint and `npm run data:health`.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CityId, DataManifest } from '../src/lib/types.ts';

const CITIES: CityId[] = ['chicago', 'nyc', 'sf', 'austin'];

export interface HealthReport {
  status: 'ok' | 'degraded';
  checkedAt: string;
  cities: Array<{ city: CityId; ok: boolean; generatedAt: string | null; problems: string[] }>;
}

export async function checkManifest(dataDir: string, now = Date.now()): Promise<HealthReport> {
  let manifest: DataManifest | null = null;
  try {
    manifest = JSON.parse(await readFile(join(dataDir, 'manifest.json'), 'utf8')) as DataManifest;
  } catch {
    /* reported below */
  }
  const cities = CITIES.map((city) => {
    const m = manifest?.cities.find((c) => c.city === city);
    if (!m) return { city, ok: false, generatedAt: null, problems: ['No dataset built for this city'] };
    const problems: string[] = [];
    if (m.isDemo) problems.push('Serving demo data');
    for (const s of m.sources) {
      const days = Math.floor((now - new Date(s.retrievedAt).getTime()) / 86_400_000);
      if (s.status === 'failed') problems.push(`${s.name}: failed in the last refresh`);
      else if (days > s.staleAfterDays) problems.push(`${s.name}: ${days} days old (stale after ${s.staleAfterDays})`);
    }
    return { city, ok: problems.length === 0, generatedAt: m.generatedAt, problems };
  });
  return { status: cities.every((c) => c.ok) ? 'ok' : 'degraded', checkedAt: new Date(now).toISOString(), cities };
}
