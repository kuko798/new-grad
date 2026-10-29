# Your Next Corner

A relocation planner that answers one question: **which neighborhoods fit my budget, commute, lifestyle and
safety preferences?** It covers the 40 U.S. cities that gained the most new residents in 2024, from New York City
and Los Angeles to Orlando and Fresno, each within its legal city limits. Cities that publish a clean official
neighborhood map use it (community areas, NTAs, super neighborhoods, neighborhood councils); the rest are divided
into ZIP code areas clipped to the city limits. Where a police department publishes incident-level data it is
used; seven cities publish none, and the app says so.

- Limits first: a rent limit, an optional total housing budget, and a commute limit that can be hard or soft.
  Nothing over a limit is ever shown as a match, and when nothing fits, the app says which limit is the
  conflict and what changing it would add.
- Preference fit: a weighted average of city-relative measures (rent headroom, commute, reported violent,
  property and vehicle incident rates, transit, groceries, parks, restaurants, nightlife, quiet, pets,
  step-free stations). Every score can be opened into its components, and weights change live.
- Every figure shows its source and date. Missing data is shown as missing and never counted as low.
- True monthly cost, move-in cash, two-destination commutes, "what if?" scenarios, favorites, comparing up to
  three, privacy-safe share links, and outbound Zillow searches.
- No accounts, no language model, no paid data feed. Preferences stay in the browser.

Method: [docs/methodology.md](docs/methodology.md). Sources, crosswalks and integration decisions:
[docs/data-sources.md](docs/data-sources.md).

## Stack

| Part | Choice |
| --- | --- |
| Client | React 18, React Router 6, TypeScript, Vite 6 |
| Map | MapLibre GL JS 4 with OpenFreeMap tiles (no key) |
| Server | Plain Node `http` (`server/index.ts`): static files, `/data/*`, `/api/geocode`, `/api/health` |
| Data | Static JSON per city in `public/data`, built by `scripts/ingest` from official sources |
| Tests | Vitest (matching logic), Playwright-core browser walkthrough (`scripts/e2e.ts`) |

Node 22.18 or newer runs the TypeScript server and scripts directly (type stripping); there is no compile step
for them. There is no database: datasets change only when ingestion runs, are a few hundred kilobytes per city,
and are served as cacheable files, so migrations are not needed. If accounts are added later, add a database
then.

## Run it

```bash
npm ci
npm run build        # type-checks, then builds the client into dist/
npm start            # http://localhost:8787 (serves dist/, public/data, and the API)
```

For development, run `npm start` (API) and `npm run dev` (Vite on :5173, proxying `/api` to :8787) side by
side. The repository ships built datasets in `public/data`, so the app works without running ingestion.

Copy `.env.example` to `.env` to change the port, data directory, geocoder rate limit, the ingestion contact,
or to configure the optional sponsorship slot.

## Data ingestion and refresh

```bash
npm run ingest                    # every city; reuses cached source files under data/raw/
npm run ingest -- --city austin   # one city
npm run ingest:refresh            # ignore caches and refetch everything
npm run ingest:manifest           # rebuild public/data/manifest.json only
npm run data:health               # exit 1 if any source failed or is past its staleness threshold
```

A full fresh run takes about three hours for 40 cities (4–6 minutes each), mostly Overpass and the incident
queries; `--city a,b,c` builds a subset, and several subsets can run in parallel. Sources are cached in
`data/raw` (git-ignored) with per-source lifetimes: incident queries 6 days, OSM 30 days, boundaries 30 days,
HUD SAFMR 120 days, Census files a year. If a source fails, that city's dataset is still written with the
measure marked unavailable, and the previous file is kept if the whole city fails.

Scheduling:

- **GitHub Actions**: `.github/workflows/refresh-data.yml` runs weekly, then opens a pull request with the new
  data after tests and the health check. Set the `INGEST_CONTACT` variable and, optionally, a
  `SOCRATA_APP_TOKEN` secret.
- **cron on a server**: `17 9 * * 1 cd /srv/yournextcorner && npm run ingest && npm run data:health`, with `DATA_DIR`
  pointing at the directory the server reads, so no rebuild or restart is needed.

Staleness thresholds per source: incidents 21 days (NYC 120, because it is quarterly; Austin 30), OSM 60 days,
HUD SAFMR 400 days, ACS 450 days, boundaries 365 days. Stale or failed sources appear on the Data and methods
page, as a notice above affected results, and in `/api/health` (HTTP 503 when degraded, for uptime monitors).

## Deploy

### Vercel

Import the repository; `vercel.json` sets the build (`npm run build`, output `dist/`), the page routing and the
security headers. The two API routes run as Vercel functions from `api/geocode.ts` and `api/health.ts`
(self-contained copies of the server routes); `server/` is not used there. No environment variables are
required. Optional: `GEOCODE_PER_MINUTE`, and `VITE_SPONSOR_*`, which are read at build time, so redeploy after
changing them.

Data ships with the build from `public/data`. Ingestion takes about 20 minutes, too long for a Vercel function,
so refresh through the GitHub Actions workflow: it opens a pull request with new data, and merging it
redeploys. The geocoder's rate limit and cache are per function instance, so treat the limit as a speed bump.

### Node host or Docker

Any host that runs Node 22.18+:

```bash
npm ci && npm run build
PORT=8787 DATA_DIR=/var/lib/yournextcorner/data node server/index.ts
```

Or with Docker: `docker build -t yournextcorner . && docker run -p 8787:8787 -v yournextcorner-data:/app/data yournextcorner`.

Put it behind HTTPS. The server sends a strict Content-Security-Policy that allows only its own origin,
OpenFreeMap tiles and the bundled Geist fonts. If you change tile or font providers, update `SECURITY_HEADERS` in
`server/index.ts`. When behind a proxy, make sure `X-Forwarded-For` carries the client IP so geocoder rate
limits apply per person.

Operating dependencies with no SLA: OpenFreeMap tiles (the map falls back to boundaries on a plain ground if
they fail) and the Census Bureau geocoder (people can pick a neighborhood or a point on the map instead). For
production traffic, consider self-hosted tiles.

## Privacy

- Budget, take-home pay, addresses, saved areas and comparisons live in `localStorage` only.
- Addresses pass through `/api/geocode` to the Census Bureau. The server does not log query strings or write
  them to disk; results are cached in memory for an hour.
- Share links contain the city, up to three neighborhood ids and a 13-digit priority code. Nothing else.
- Google AdSense is loaded from `index.html` (publisher id in the script tag and in `public/ads.txt`); the
  Content-Security-Policy in `vercel.json` and `server/index.ts` allows Google's ad hosts. No inputs are passed to
  it and none appear in URLs. No analytics are included; if you add any, exclude every input and URL query.
- The sponsorship slot (`VITE_SPONSOR_*`) renders one labelled message at the foot of neighborhood pages. It is
  never shown in results, never affects rankings, and receives no inputs. Core features have no paywall.

## Tests and checks

```bash
npm test             # 34 unit tests: hard limits and boundaries, weighting, missing data, rent, costs,
                     # commute model, what-if, share-link privacy, Zillow links, geometry, reporting windows
npm run typecheck
BASE_URL=http://localhost:8787 CHROME_PATH="/path/to/chrome-or-edge" npm run e2e
                     # 40 browser checks at 1440×900 and 390×844; screenshots in .e2e/
```

The browser walkthrough covers onboarding, address entry (live Census geocoder), map/list sync, sorting,
re-ranking after a priority change, favorites, compare (and refusing a fourth), detail pages, Zillow link
format, share links without private inputs, the no-match state, a city-data network error, and tile failure.

## Layout

```
src/lib/           types, geometry, scoring, costs, commute model, what-if, links (pure, tested)
src/components/    shell, map, result card, fit ledger, preference fields, drawer
src/pages/         home, onboarding, results, neighborhood, compare, saved, data and methods
server/            Node server and source-health check
scripts/ingest/    city adapters (chicago, nyc, sf, austin) and shared sources (census, blocks, hud, osm, lodes)
public/data/       built datasets and manifest (served at /data)
tests/             unit tests and a clearly fictional fixture city
docs/              methodology and data sources
```

## Known limitations

- Coverage is each city proper; Austin planning areas leave out much of the city's northwest, far north and
  southwest.
- Rent benchmarks are ZIP- (HUD) or tract-based (ACS) averages, not asking rents.
- Commute times are distance-based estimates, not scheduled trips; fares and speeds are assumptions in
  `src/lib/travel.ts` last checked in 2025.
- Amenity counts depend on OpenStreetMap completeness.
- Reported incidents undercount what happens and reflect reporting and policing patterns.
- Zillow links follow Zillow's public search URL pattern but could not be verified automatically (Zillow blocks
  automated browsers); spot-check them by hand. No listing data is shown.
