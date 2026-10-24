// Scheduled ingestion entry point.
//   npm run ingest                      build every city from cached or fresh sources
//   npm run ingest -- --city chicago    one city
//   npm run ingest:refresh              ignore caches and refetch everything
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CityDataset, DataManifest } from '../../src/lib/types.ts';
import { austin } from './cities/austin.ts';
import { chicago } from './cities/chicago.ts';
import { nyc } from './cities/nyc.ts';
import { sf } from './cities/sf.ts';
import type { CityAdapter } from './cities/types.ts';
import { buildCity, outFile, writeCity } from './build.ts';
import { simplifyMultiPolygon } from '../../src/lib/geo.ts';
import { log, OUT_DIR, writeJson } from './util.ts';

const ADAPTERS: CityAdapter[] = [chicago, nyc, sf, austin];

async function main() {
  const i = process.argv.indexOf('--city');
  const only = i > -1 ? process.argv[i + 1] : null;
  const targets = process.argv.includes('--manifest-only') ? [] : only ? ADAPTERS.filter((a) => a.id === only) : ADAPTERS;
  if (!targets.length && !process.argv.includes('--manifest-only')) throw new Error(`Unknown city "${only}". Use one of: ${ADAPTERS.map((a) => a.id).join(', ')}`);

  let failures = 0;
  for (const adapter of targets) {
    try {
      const started = Date.now();
      const ds = await buildCity(adapter);
      await writeCity(ds);
      log(`${adapter.id}: wrote ${ds.neighborhoods.length} neighborhoods in ${Math.round((Date.now() - started) / 1000)}s`);
    } catch (err) {
      failures++;
      // The previous output (if any) is left in place, so the app keeps serving the last good data.
      log(`${adapter.id}: FAILED — ${(err as Error).stack ?? err}`);
    }
  }

  // Rebuild the manifest from whatever city files exist.
  const manifest: DataManifest = { generatedAt: new Date().toISOString(), cities: [] };
  for (const adapter of ADAPTERS) {
    try {
      const ds = JSON.parse(await readFile(outFile(adapter.id), 'utf8')) as CityDataset;
      manifest.cities.push({
        city: ds.city,
        file: `${ds.city}.json`,
        isDemo: ds.isDemo,
        generatedAt: ds.generatedAt,
        neighborhoods: ds.neighborhoods.length,
        population: ds.neighborhoods.reduce((s, n) => s + (n.population ?? 0), 0),
        coverage: ds.coverage,
        geographyLabel: ds.geographyLabel,
        incidentWindow: ds.incidentMethod?.window ?? null,
        preview: preview(ds),
        sources: ds.sources,
      });
    } catch {
      log(`${adapter.id}: no dataset on disk; the app will show this city as unavailable`);
    }
  }
  await writeJson(join(OUT_DIR, 'manifest.json'), manifest);
  log(`manifest: ${manifest.cities.length} cities`);
  if (failures) process.exitCode = 1;
}

/** Project every boundary into a 100-wide box (equirectangular, scaled by latitude) as SVG path data. */
function preview(ds: CityDataset) {
  const [[w, s], [e, n]] = ds.bounds;
  const k = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const width = (e - w) * k;
  const height = Math.round(((n - s) / width) * 100 * 10) / 10;
  const px = (lng: number) => (((lng - w) * k) / width) * 100;
  const py = (lat: number) => ((n - lat) / width) * 100;
  const paths = ds.neighborhoods.map((h) =>
    simplifyMultiPolygon(h.geometry, (e - w) / 400, 5)
      .coordinates.map((poly) => poly[0].map(([x, y], i) => `${i ? 'L' : 'M'}${px(x).toFixed(1)} ${py(y).toFixed(1)}`).join('') + 'Z')
      .join(''),
  );
  return { height, paths };
}

main();
