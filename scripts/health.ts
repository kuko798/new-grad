// `npm run data:health` — prints stale or failed sources and exits 1 when any need attention (for cron alerts).
import { join } from 'node:path';
import { checkManifest } from '../server/health.ts';
import { OUT_DIR } from './ingest/util.ts';

const report = await checkManifest(process.env.DATA_DIR ?? OUT_DIR);
for (const c of report.cities) {
  console.log(`${c.ok ? 'ok      ' : 'ATTENTION'} ${c.city.padEnd(8)} built ${c.generatedAt ?? '—'}`);
  for (const p of c.problems) console.log(`          - ${p}`);
}
console.log(`\noverall: ${report.status} (${join(process.env.DATA_DIR ?? OUT_DIR, 'manifest.json')})`);
if (report.status !== 'ok') process.exitCode = 1;
