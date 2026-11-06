import { readFile } from 'node:fs/promises';
import { database } from '../server/partners/db.ts';
const db = database();
try {
  await db.query(await readFile(new URL('../server/partners/schema.sql', import.meta.url), 'utf8'));
  console.log('Partnership schema ready.');
} finally {
  await db.end();
}
