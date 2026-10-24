# Data sources and integration decisions

Checked October 2026 while building the first datasets. Every source below was queried directly; the
"Access" column records what it actually took. Each source record in `public/data/<city>.json` carries its URL,
license, observation period, retrieval time and staleness threshold, and `npm run data:health` reports on them.

## Geographies

Neighborhoods, ZIP codes, Census tracts and police districts are different geographies. Landing ranks the
official neighborhood-scale statistical geography of each city and converts everything else into it:

| City | Geography ranked | Source | Count | Notes |
| --- | --- | --- | --- | --- |
| Chicago | Community areas | [Boundaries – Community Areas](https://data.cityofchicago.org/d/igwz-8jzy) | 77 | City proper. |
| New York City | 2020 Neighborhood Tabulation Areas | [NYC Planning NTAs](https://data.cityofnewyork.us/d/9nt8-h7nd) | 197 residential (of 262) | All five boroughs. Non-residential NTAs (`ntatype` 5–9: parks, airports, cemeteries) are not ranked. |
| San Francisco | Analysis neighborhoods | [DataSF Analysis Neighborhoods](https://data.sfgov.org/d/j2bu-swwd) | 39 ranked (of 41) | City and County of San Francisco only. Golden Gate Park and Lincoln Park have under 500 residents and are not ranked. |
| Austin | Neighborhood planning areas | [Boundaries: City of Austin Neighborhoods](https://data.austintexas.gov/d/inrm-c3ee) | 65 | Planning areas cover central, east, south and north-central Austin only; much of northwest, far north and southwest Austin has none. Sub-district polygons sharing a name are dissolved. |

### Crosswalk (documented aggregation)

1. Every 2020 Census block (population, housing units, internal point) is fetched from the Census Bureau's
   TIGERweb REST service and placed in the neighborhood containing its internal point.
2. For each tract, the share of its 2020 residents and of its housing units in each neighborhood is computed
   from those blocks.
3. Tract-level ACS estimates are split by those shares: population by resident share, renter-unit counts by
   housing-unit share. Rent medians are averaged across tracts, weighted by the allocated renter units of the
   matching bedroom size.
4. HUD's ZIP-level SAFMRs reach tracts through the Census 2020 ZCTA–tract relationship file (the ZCTA covering
   most of each tract's land), then neighborhoods by the same weights. ZCTAs approximate, but are not, USPS ZIPs.
5. Austin incidents arrive by block group and are split between planning areas by the block group's resident
   shares, so Austin counts can be fractional before rounding.

An early version assigned whole tracts by their centre point. That undercounted Austin's small planning areas
(Hyde Park showed 2,865 residents; the block crosswalk gives 6,139), so it was replaced.

## Rent

| Source | Access | Geography | Period | Use |
| --- | --- | --- | --- | --- |
| [HUD Small Area FMRs FY2026](https://www.huduser.gov/portal/datasets/fmr/fmr2026/fy2026_safmrs.xlsx) | Public file; HUD returns an empty 202 to unidentified user agents, so ingestion sends a browser-compatible user agent that names the project | ZIP code | FY2026 (effective Oct 1, 2025) | Primary newcomer benchmark: 40th percentile gross rent of recent movers. |
| ACS 5-year B25031, B25042, B01003 via the [table-based summary files](https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/) | Public files, no key | Tract | 2020–2024 | All-renter median gross rent (fallback and context) and population. |

The Census Data API now requires a key (`Missing Key` page), so the pipeline reads the summary files instead
and needs no key. Medians the Census Bureau top-codes are shown as "≥". Bedroom-level medians are used only from
tracts with at least 30 renter units of that size, and a neighborhood figure needs 200 allocated units; otherwise
it is shown as not published. Example of why: Englewood's tract medians include a studio median of $281, which
reflects subsidized and single-room units rather than market rents.

Neither figure is a neighborhood asking rent, and the interface never calls it one.

## Reported incidents

| City | Dataset | Access | Date basis | Dedupe | Placement | Update cadence |
| --- | --- | --- | --- | --- | --- | --- |
| Chicago | [Crimes – 2001 to Present](https://data.cityofchicago.org/d/ijzp-q8t2) | SODA, no key | Occurrence | Distinct `case_number` (homicides have one row per victim) | City-assigned `community_area` | Daily; last 7 days withheld |
| NYC | [NYPD Complaint Data Current YTD](https://data.cityofnewyork.us/d/5uac-w243) + [Historic](https://data.cityofnewyork.us/d/qgea-i56i) | SODA, no key | Report date (`rpt_dt`, which partitions the two datasets) | Distinct `cmplnt_num` | Published coordinates → NTA polygon | Quarterly |
| San Francisco | [Police Department Incident Reports 2018–present](https://data.sfgov.org/d/wg3w-h783) | SODA, no key (throttles with HTTP 428; retried with backoff) | Report date | Distinct `incident_id`, initial reports only (`II`, `VI`); supplements excluded | SFPD-assigned `analysis_neighborhood` | Daily |
| Austin | [APD Crime Reports](https://data.austintexas.gov/d/fdj4-gpfu) | SODA, no key | Report date | Distinct `incident_report_number`; APD publishes the most serious offense per incident only | `census_block_group` (APD no longer publishes coordinates) → planning areas | Weekly |

Categories are mapped to three measures per city (definitions in each dataset's `incidentMethod` and on the
Data and methods page): violent (homicide, rape/sexual assault, robbery, aggravated assault), property
(burglary, theft, motor vehicle theft, arson) and vehicle-related (vehicle theft plus thefts from vehicles).
These datasets record reported incidents. They are not calls for service or arrests, and none of the fields
used describe people.

Rates are per 1,000 residents a year and are not computed below 2,000 residents. Percentiles are within one
city only. Areas where LEHD jobs outnumber residents, or where restaurants and bars per resident are in the
city's top decile, are flagged because visitors inflate per-resident rates.

Window: 12 complete months ending at the last full month the publisher has released, plus the previous 12
months for the trend. In this build: Chicago, SF and Austin Oct 2025–Sep 2026; NYC Jul 2025–Jun 2026.

## Amenities and stations

[OpenStreetMap](https://www.openstreetmap.org/copyright) via the Overpass API (ODbL; attribution shown in the
app). Queried once per city and category during ingestion, never by browsers. Counts are of mapped features:
supermarkets and greengrocers, parks, restaurants and cafés, bars/pubs/nightclubs, rail and light-rail
stations (with `wheelchair` tags), bus stops and dog parks. Completeness varies with volunteer mapping.

[LEHD LODES 8 WAC 2023](https://lehd.ces.census.gov/data/lodes/LODES8/) gives jobs by block, used only for
the visitor-heavy flag.

## Maps, geocoding and routing

| Need | Choice | Cost and limits | Alternatives considered |
| --- | --- | --- | --- |
| Map rendering | MapLibre GL JS 4 (BSD) | Free | — |
| Base map tiles | [OpenFreeMap](https://openfreemap.org) Positron style | No key, no published quota; best-effort service with no SLA. Attribution to OpenFreeMap, OpenMapTiles and OSM contributors is kept. | Self-hosted PMTiles (Protomaps) for an SLA you control; MapTiler, Stadia or Mapbox are keyed and metered. |
| Geocoding | [U.S. Census Bureau Geocoder](https://geocoding.geo.census.gov/) via `/api/geocode` | No key; U.S. addresses only; no published SLA. The proxy rate-limits to 20 lookups per IP per minute and 300 per minute overall, and caches results in memory for an hour. | Nominatim's public instance forbids heavy use; Mapbox, Google and others are keyed and metered. |
| Routing | None. Commutes are distance-based estimates with every assumption shown. | — | OpenTripPlanner with each agency's GTFS (self-hosted) for real transit trips; OSRM or Valhalla for driving and cycling; commercial matrix APIs are metered per element. |

If a keyed provider is added later, its key belongs in the server environment and calls go through a server
route with the same rate limiting and caching as `/api/geocode`.

## Zillow and rental listings

- No listing data is fetched, scraped or cached. Zillow's Terms of Use prohibit scraping.
- We found no listing API open to this project without an approved partnership. Zillow's developer offerings
  (Bridge Interactive and MLS-sourced feeds) require an application, approval and use restrictions. No such
  access was available, so no listing adapter ships and no listing cards are shown.
- The app links out to Zillow's public place search, `https://www.zillow.com/homes/for_rent/<Place>,-<City>,-<ST>_rb/`
  (NYC uses the borough as the city). Filters are listed for the person to apply rather than encoded, because
  Zillow's filter parameters are undocumented.
- Verification: Zillow answers automated browsers with HTTP 403 ("Access to this page has been denied"), so the
  links could not be checked by the automated suite. Spot-check a few in a normal browser after deploying.
- If approved access arrives, add a server-side adapter beside the city adapters that returns listings with
  source attribution, retrieval time and links to the original listings, kept separate from rankings.
