// Browser walkthrough of the core workflows against a running server (npm start).
//   BASE_URL=http://localhost:8787 CHROME_PATH="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" npm run e2e
// Saves screenshots to .e2e/ and exits 1 on the first failed check.
import { mkdirSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { chromium, type Page } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const OUT = '.e2e';
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean) as string[];

mkdirSync(OUT, { recursive: true });
const results: Array<{ name: string; ok: boolean; note?: string }> = [];
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

function check(name: string, ok: boolean, note?: string) {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
}

async function main() {
  const executablePath = CANDIDATES.find((p) => existsSync(p));
  if (!executablePath) throw new Error('No Chrome or Edge found; set CHROME_PATH.');
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  // Ads keep the network busy (so "networkidle" never comes) and should not be requested by tests: block Google's ad hosts.
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const ctx = await newContext(options);
    await ctx.route(/googlesyndication\.com|doubleclick\.net|adtrafficquality\.google|googletagservices\.com|adservice\.google\.com/, (r) => r.abort());
    return ctx;
  };

  for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'phone', width: 390, height: 844 }]) {
    if (only && only !== viewport.name) continue;
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: viewport.name === 'phone', isMobile: viewport.name === 'phone' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    const v = viewport.name;

    // Home
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { level: 1 }).waitFor();
    check(`${v}: home shows the first eight cities`, (await page.locator('.city-card').count()) === 8);
    await page.getByLabel('Find a city').fill('denver');
    check(`${v}: city search filters`, (await page.locator('.city-card').count()) === 1);
    await page.getByLabel('Find a city').fill('');
    await shot(page, `${v}-home`);

    // Onboarding: city → rent → commute (address) → priorities
    await page.getByRole('button', { name: /^Chicago/ }).click();
    await page.waitForURL(/\/start/);
    await page.getByLabel('Maximum monthly rent').fill('1700');
    await shot(page, `${v}-onboard-rent`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Work or school').fill('233 S Wacker Dr');
    await page.getByRole('button', { name: 'Find' }).click();
    const hit = page.getByRole('listitem').filter({ hasText: 'WACKER' }).first();
    await hit.waitFor({ timeout: 15000 }).catch(() => undefined);
    const geocoded = await hit.isVisible().catch(() => false);
    check(`${v}: address lookup returns a match`, geocoded);
    if (geocoded) await hit.click();
    else await page.getByLabel('Or use the centre of a neighborhood').first().selectOption({ label: 'Loop' });
    await shot(page, `${v}-onboard-commute`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('radiogroup', { name: /violent-incident rates: priority/ }).getByRole('radio', { name: 'Very important' }).click();
    await page.getByRole('button', { name: 'See neighborhoods' }).click();
    await page.waitForURL(/\/chicago$/);

    // Results and map
    await page.locator('.result').first().waitFor();
    const count = await page.locator('.result').count();
    check(`${v}: results listed`, count > 0, `${count} cards`);
    const headline = await page.locator('.results-head p').first().innerText();
    check(`${v}: headline states matches`, /\d+ of 77/.test(headline), headline);
    if (v === 'phone') await page.getByRole('radio', { name: 'Map' }).click();
    const canvas = page.locator('.maplibregl-canvas');
    await canvas.waitFor({ timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
    check(`${v}: map canvas rendered`, await canvas.isVisible().catch(() => false));
    await shot(page, `${v}-results`);
    if (v === 'phone') await page.getByRole('radio', { name: 'List' }).click();

    // Over-limit areas never appear among matches
    const overInMatches = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.results-scroll > .result')];
      return cards.filter((c) => c.classList.contains('is-failing')).length;
    });
    check(`${v}: no over-limit card among matches`, overInMatches === 0);

    // Sorting
    await page.getByRole('radio', { name: 'Lowest cost' }).click();
    const totals = await page.$$eval('.results-scroll > .result .result-figures > div:nth-child(2) .figure-value', (els) => els.map((e) => Number(e.textContent!.replace(/[^0-9]/g, ''))));
    check(`${v}: cost sort ascending`, totals.every((t, i) => i === 0 || t >= totals[i - 1]), totals.slice(0, 5).join(', '));
    await page.getByRole('radio', { name: 'Best fit' }).click();

    // Adjust a priority in the drawer and see results update
    const topFive = async () => (await page.locator('.results-scroll > .result .result-name').allInnerTexts()).slice(0, 5).join(' | ');
    const before = await topFive();
    await page.getByRole('button', { name: 'Preferences' }).click();
    await page.getByRole('radiogroup', { name: /Nightlife: priority/ }).getByRole('radio', { name: 'Very important' }).click();
    await page.getByRole('button', { name: 'Show results' }).click();
    await page.waitForTimeout(400);
    const after = await topFive();
    check(`${v}: changing priorities re-ranks`, before !== after, `${before} → ${after}`);

    // Save and compare three
    const cards = page.locator('.results-scroll > .result');
    for (let i = 0; i < 3; i++) await cards.nth(i).getByRole('button', { name: /Compare/ }).click();
    await cards.nth(0).getByRole('button', { name: /Save/ }).click();
    await cards.nth(3).getByRole('button', { name: /Compare/ }).click();
    const refused = await page.locator('[aria-live="polite"]').innerText();
    check(`${v}: fourth compare is refused`, /up to three/.test(refused), refused);
    const firstName = await cards.nth(0).locator('.result-name').innerText();

    // Detail page
    await cards.nth(0).locator('.result-name').click();
    await page.getByRole('heading', { level: 1, name: firstName }).waitFor();
    check(`${v}: detail shows fit ledger`, await page.locator('.ledger-row').count() > 2);
    check(`${v}: detail shows incident window`, await page.getByText(/by occurrence date/).isVisible());
    const zillow = await page.getByRole('link', { name: /Explore rentals on Zillow/ }).getAttribute('href');
    check(`${v}: Zillow link is a place search`, /^https:\/\/www\.zillow\.com\/homes\/for_rent\/.+_rb\/$/.test(zillow ?? ''), zillow ?? '');
    await page.waitForTimeout(2500);
    await shot(page, `${v}-detail`);
    await page.mouse.wheel(0, 1400);
    await page.waitForTimeout(300);
    await shot(page, `${v}-detail-2`);

    // Compare and the share link
    await page.goto(`${BASE}/compare`, { waitUntil: 'networkidle' });
    await page.locator('.compare-table').waitFor();
    check(`${v}: compare shows three`, (await page.locator('.compare-table thead th').count()) === 4);
    await shot(page, `${v}-compare`);
    const shareUrl = await page.evaluate(() => {
      const raw = localStorage.getItem('landing.compare.v1');
      const p = JSON.parse(localStorage.getItem('landing.prefs.v1') ?? '{}');
      return { compare: raw, rent: p.maxRent, dest: p.destinations?.[0]?.label };
    });
    const shared = `${BASE}/compare?city=chicago&ids=${JSON.parse(shareUrl.compare!).ids.join(',')}&p=2230000000000`;
    const privateCtx = await browser.newContext({ viewport });
    const p2 = await privateCtx.newPage();
    await p2.goto(shared, { waitUntil: 'networkidle' });
    await p2.locator('.compare-table').waitFor();
    const text = await p2.locator('body').innerText();
    check(`${v}: shared link opens without private inputs`, !text.includes('WACKER') && !text.includes('1,700'), shared);
    await p2.close();
    await privateCtx.close();

    // Saved
    await page.goto(`${BASE}/saved`, { waitUntil: 'networkidle' });
    check(`${v}: saved list has the favorite`, await page.getByText(firstName).first().isVisible());

    // No-match state
    await page.goto(`${BASE}/chicago`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Preferences' }).click();
    await page.getByRole('radio', { name: 'Rent' }).click();
    await page.getByLabel('Maximum monthly rent').fill('400');
    await page.getByRole('button', { name: 'Show results' }).click();
    await page.getByText('No neighborhood meets all your limits').waitFor();
    check(`${v}: no-match explains the conflict`, await page.getByText(/alone rules out/).first().isVisible());
    await shot(page, `${v}-nomatch`);
    await page.getByRole('button', { name: 'Preferences' }).click();
    await page.getByRole('radio', { name: 'Rent' }).click();
    await page.getByLabel('Maximum monthly rent').fill('1700');
    await page.getByRole('button', { name: 'Show results' }).click();

    // Network error state: block the city file
    const errCtx = await browser.newContext({ viewport });
    const p3 = await errCtx.newPage();
    await p3.route('**/data/nyc.json', (r) => r.abort());
    await p3.goto(`${BASE}/nyc`, { waitUntil: 'networkidle' });
    check(`${v}: network error shows retry`, await p3.getByRole('button', { name: 'Retry' }).isVisible());
    await shot(p3, `${v}-error`);
    await errCtx.close();

    // Onboarding from scratch: the city is chosen from a dropdown
    const startCtx = await browser.newContext({ viewport });
    const p5 = await startCtx.newPage();
    await p5.goto(`${BASE}/start`, { waitUntil: 'domcontentloaded' });
    await p5.getByLabel('Destination city').selectOption('denver');
    await p5.getByRole('button', { name: 'Continue' }).click();
    const toRent = await p5.getByText('Step 2 of 4 · Denver').waitFor({ timeout: 5000 }).then(() => true, () => false);
    if (!toRent) await shot(p5, `${v}-start-dropdown`);
    check(`${v}: city dropdown starts onboarding`, toRent);
    await startCtx.close();

    // Basemap failure: block tiles, boundaries still render with a notice
    const tileCtx = await browser.newContext({ viewport });
    const p4 = await tileCtx.newPage();
    await p4.route('https://tiles.openfreemap.org/**', (r) => r.abort());
    await p4.goto(`${BASE}/sf`, { waitUntil: 'domcontentloaded' });
    if (v === 'phone') await p4.getByRole('radio', { name: 'Map' }).click();
    const noticed = await p4.getByText(/Street map tiles could not load/).waitFor({ timeout: 15000 }).then(() => true, () => false);
    check(`${v}: tile failure falls back with a notice`, noticed);
    await shot(p4, `${v}-tiles-down`);
    await tileCtx.close();

    // A ZIP-area city, and a city whose police publish no incident data
    await page.goto(`${BASE}/phoenix`, { waitUntil: 'networkidle' });
    await page.locator('.results-scroll .result').first().waitFor();
    check(`${v}: ZIP-area city explains its geography`, await page.getByText(/these are ZIP code areas/).isVisible());
    const zipLink = await page.locator('.results-scroll .result a[href*="zillow"]').first().getAttribute('href');
    check(`${v}: ZIP-area Zillow link searches the ZIP`, /\/homes\/for_rent\/\d{5}_rb\/$/.test(zipLink ?? ''), zipLink ?? '');
    await shot(page, `${v}-phoenix`);
    await page.goto(`${BASE}/jacksonville`, { waitUntil: 'networkidle' });
    await page.locator('.results-scroll .result').first().waitFor();
    check(`${v}: city without incident data says so`, await page.getByText(/Reported incidents are not available for Jacksonville/).isVisible());

    // Data page
    await page.goto(`${BASE}/data`, { waitUntil: 'networkidle' });
    check(`${v}: data page lists sources`, (await page.locator('table.data tbody tr').count()) > 10);
    await shot(page, `${v}-data`);

    // /api/health answers 503 when any source is stale (the browser logs that as an error); the page shows it.
    const unexpected = errors.filter((e) => !/tiles\.openfreemap|ERR_FAILED|net::|status of 503/.test(e));
    check(`${v}: no console errors`, unexpected.length === 0, unexpected.slice(0, 3).join(' | '));
    await ctx.close();
  }
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
