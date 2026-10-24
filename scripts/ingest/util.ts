import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RAW_DIR = join(ROOT, 'data', 'raw');
export const OUT_DIR = join(ROOT, 'public', 'data');

/** Identifies the pipeline to publishers. Set INGEST_CONTACT to an address you monitor before scheduling refreshes. */
export const USER_AGENT = `relocate-fit-ingest/0.1 (+${process.env.INGEST_CONTACT ?? 'https://github.com/'})`;

export const flags = {
  refresh: process.argv.includes('--refresh'),
};

export function log(...args: unknown[]) {
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(url: string | URL, init: RequestInit = {}, attempts = 4): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(300_000),
      });
      // 428 and 429 are Socrata's throttling responses; back off and try again.
      if (res.status === 428 || res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status} for ${url}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${url}: ${(await res.text()).slice(0, 300)}`), { fatal: true });
      return res;
    } catch (err) {
      lastError = err;
      if ((err as { fatal?: boolean }).fatal) throw err;
      const wait = 2000 * 2 ** i;
      log(`retrying in ${wait / 1000}s: ${(err as Error).message}`);
      await sleep(wait);
    }
  }
  throw lastError;
}

interface CacheEntry<T> {
  retrievedAt: string;
  value: T;
}

/**
 * Runs `produce` once and stores its result under data/raw. Later runs reuse it until it is older than
 * `maxAgeDays` or `--refresh` is passed, so a rebuild never re-downloads every source.
 */
export async function cached<T>(key: string, maxAgeDays: number, produce: () => Promise<T>): Promise<CacheEntry<T>> {
  const file = join(RAW_DIR, `${key}.json`);
  if (!flags.refresh) {
    try {
      const info = await stat(file);
      if ((Date.now() - info.mtimeMs) / 86_400_000 < maxAgeDays) {
        return JSON.parse(await readFile(file, 'utf8')) as CacheEntry<T>;
      }
    } catch {
      /* not cached yet */
    }
  }
  log(`fetching ${key}`);
  const entry: CacheEntry<T> = { retrievedAt: new Date().toISOString(), value: await produce() };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(entry));
  return entry;
}

export async function writeJson(file: string, value: unknown) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}

/** Month arithmetic on ISO dates (YYYY-MM-DD), staying on the first of the month. */
export function addMonths(isoDate: string, months: number): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months, 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The 12-month window ends at the start of the month after the last complete month of data.
 * A dataset whose latest record is mid-month has that month treated as incomplete.
 */
export function completeWindowEnd(latestIso: string): string {
  const d = new Date(`${latestIso.slice(0, 10)}T00:00:00Z`);
  const next = new Date(d);
  next.setUTCDate(d.getUTCDate() + 1);
  const monthStart = `${latestIso.slice(0, 7)}-01`;
  return next.getUTCMonth() !== d.getUTCMonth() ? addMonths(monthStart, 1) : monthStart;
}

export const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[\s\-/(])([a-z])/g, (_, p, c) => p + c.toUpperCase())
    .replace(/\bO'([a-z])/g, (_, c) => `O'${c.toUpperCase()}`)
    .replace(/\bMc([a-z])/g, (_, c) => `Mc${c.toUpperCase()}`);
