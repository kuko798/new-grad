import { useEffect, useState } from 'react';
import { dayMonthYear, windowLabel } from '../lib/format.ts';
import { travelFor, BUS_ACCESS_MIN, BUS_WAIT_MIN, MAX_STATION_WALK_M, RAIL_WAIT_MIN, ROUTE_FACTOR } from '../lib/travel.ts';
import type { CityId, SourceRecord } from '../lib/types.ts';
import { CITY_NAMES, CITY_ORDER, freshness, useCity, useManifest } from '../state/data.ts';

interface Health {
  status: 'ok' | 'degraded';
  checkedAt: string;
  cities: Array<{ city: CityId; ok: boolean; problems: string[] }>;
}

function SourceRow({ s }: { s: SourceRecord }) {
  const f = freshness(s.retrievedAt, s.staleAfterDays);
  return (
    <tr>
      <td>
        <a className="text-link" href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a>
        <div className="small muted">{s.publisher} · {s.license}</div>
        {s.notes ? <div className="small muted" style={{ marginTop: 4 }}>{s.notes}</div> : null}
      </td>
      <td className="small">{s.observationPeriod}<div className="muted">{s.updateFrequency}</div></td>
      <td className="num small">
        {s.status === 'unavailable' ? <span className="pill">Not published</span> : s.status === 'failed' ? <span className="pill pill-negative">Unavailable</span> : f.stale ? <span className="pill pill-warning">Stale, {f.days} days</span> : <span className="pill pill-positive">Current</span>}
        <div className="muted" style={{ marginTop: 4 }}>{dayMonthYear(s.retrievedAt)}</div>
      </td>
    </tr>
  );
}

/** One city's incident method, loaded only when the reader opens it (40 city files would be several megabytes). */
function IncidentMethods({ city, summary }: { city: CityId; summary: string }) {
  const [open, setOpen] = useState(false);
  const d = useCity(open ? city : null);
  return (
    <details className="panel method-details" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary><span className="section-title">{CITY_NAMES[city]}</span><span className="small muted">{summary}</span></summary>
      {open ? <IncidentMethodBody d={d} /> : null}
    </details>
  );
}

function IncidentMethodBody({ d }: { d: ReturnType<typeof useCity> }) {
  if (d.status === 'loading') return <div className="skeleton" style={{ height: 80, marginTop: 10 }} />;
  if (d.status === 'error') return <p className="small" style={{ marginTop: 8 }}>Couldn't load this city's data. <button className="btn btn-small" onClick={d.retry}>Retry</button></p>;
  const m = d.data.incidentMethod;
  return (
    <>
      {!m ? (
        <p className="muted" style={{ marginTop: 6 }}>{d.data.incidentsUnavailable ?? 'Incident data did not load in the latest refresh.'} Incident measures for this city are shown as unavailable and scored at the city median, so they do not change rankings.</p>
      ) : (
        <div className="prose small" style={{ marginTop: 6 }}>
          <p><b style={{ fontWeight: 500 }}>Window:</b> {windowLabel(m.window)} by {m.dateBasis} date, compared with {windowLabel(m.priorWindow)} for the trend. {Math.round(m.unlocatedShare * 100)}% of violent and property records in the window were not placed in a covered area.</p>
          <p><b style={{ fontWeight: 500 }}>Violent:</b> {m.definitions.violent}</p>
          <p><b style={{ fontWeight: 500 }}>Property:</b> {m.definitions.property}</p>
          <p><b style={{ fontWeight: 500 }}>Vehicle-related:</b> {m.definitions.vehicle}</p>
          <p><b style={{ fontWeight: 500 }}>Deduplication:</b> {m.dedupe}</p>
          {m.notes.map((n) => <p key={n}>{n}</p>)}
          {m.priorComplete === false ? <p>The published data does not cover the whole previous 12 months, so no trend is shown.</p> : null}
        </div>
      )}
      <p className="small muted" style={{ marginTop: 8 }}>{d.data.coverage}</p>
    </>
  );
}

export default function DataPage() {
  const manifest = useManifest();
  const [health, setHealth] = useState<Health | 'error' | null>(null);
  useEffect(() => {
    fetch('/api/health').then((r) => (r.ok ? r.json() : Promise.reject())).then(setHealth, () => setHealth('error'));
  }, []);

  return (
    <div className="page" style={{ maxWidth: 1080 }}>
      <h1 className="title">Data and methods</h1>
      <p className="subtitle">Where every figure comes from, how matching works, and what the data cannot tell you. No language model or paid data feed is involved: results come from the datasets below and the rules on this page.</p>

      <section style={{ marginTop: 32 }} aria-labelledby="matching">
        <h2 id="matching" className="section-title">How matching works</h2>
        <div className="prose" style={{ marginTop: 8 }}>
          <p><b style={{ fontWeight: 500 }}>Limits first.</b> Your rent limit is always a hard limit: a neighborhood whose rent benchmark is above your rent plus your utilities assumption is never shown as a match. The total housing budget and the commute limit are applied when you set them (the commute can be a limit or a preference). If a limit cannot be checked because a figure is not published, the neighborhood is listed under "Couldn't check your limits", not as a match.</p>
          <p><b style={{ fontWeight: 500 }}>Then preferences.</b> Each preference is turned into a 0–1 fit within the city: percentile ranks for densities and incident rates, headroom under your rent limit (full marks at 35% under), and commute time against your limit. Priorities weigh them 0, 1, 2 or 4 (off, low, medium, high), and preference fit is the weighted average × 100. Each neighborhood page shows every component, its weight and the points it adds.</p>
          <p><b style={{ fontWeight: 500 }}>Missing data.</b> An incident rate that is not available (too few residents, or a failed refresh) is scored at the city median and marked imputed: it is never treated as low. Amenity measures with no data are left out and the remaining weights renormalized. Coverage, the share of your weighted measures that had real data, is shown beside every score.</p>
          <p><b style={{ fontWeight: 500 }}>Explanations</b> are sentence templates filled with the calculated values above. Reasons are the strongest weighted measures; the tradeoff is the weakest weighted measure, or the nearest limit.</p>
          <p><b style={{ fontWeight: 500 }}>Not used, ever:</b> race, ethnicity, religion, national origin or any other protected characteristic, and no demographic composition is used as a proxy for anything.</p>
        </div>
      </section>

      <section style={{ marginTop: 32 }} aria-labelledby="incidents">
        <h2 id="incidents" className="section-title">Reported incidents</h2>
        <div className="prose" style={{ marginTop: 8 }}>
          <p>These are incidents reported to and recorded by each city's police department: not calls for service, not arrests, and not a prediction of anyone's personal safety. Many incidents are never reported, and reporting rates differ by place and by offense. We never label a neighborhood safe or dangerous. The 0–10 reported-incident index combines the three city-relative rates (violent 60%, property 30%, vehicle 10%; measures without a stable rate are left out and the rest renormalized). It is display only: it does not change preference fit, which weighs the three rates by your priorities.</p>
          <p>Rates divide each neighborhood's incidents by its residents, so places with many workers, shoppers or visitors (downtowns, nightlife districts, transit hubs) show high rates that overstate what residents report. These are flagged using Census LEHD job counts. Percentiles compare neighborhoods within one city only: each department classifies, geocodes and publishes differently, so a Chicago percentile and an Austin percentile do not measure the same thing.</p>
        </div>
        <div className="stack" style={{ marginTop: 12 }}>
          {CITY_ORDER.map((c) => {
            const mf = manifest.status === 'ready' ? manifest.data.cities.find((x) => x.city === c) : undefined;
            const summary = !mf ? 'Not built yet' : mf.incidentWindow ? `${windowLabel(mf.incidentWindow)} · ${mf.geographyKind === 'zcta' ? 'ZIP areas' : mf.geographyLabel}` : 'Incidents not published';
            return <IncidentMethods key={c} city={c} summary={summary} />;
          })}
        </div>
      </section>

      <section style={{ marginTop: 32 }} aria-labelledby="rent">
        <h2 id="rent" className="section-title">Rent and costs</h2>
        <div className="prose" style={{ marginTop: 8 }}>
          <p>The rent benchmark for a newcomer is HUD's FY2026 Small Area Fair Market Rent: the 40th percentile gross rent paid by recent movers, published by ZIP code. ZIP codes and neighborhoods are different geographies, so each neighborhood's figure is the renter-weighted average of the SAFMRs of the ZIP code areas covering its Census tracts. It is a benchmark, not an asking rent for a specific listing.</p>
          <p>Where no SAFMR exists, the ACS 2020–2024 median gross rent is used and labelled. It includes long-term and subsidized tenants and runs below today's asking rents. ACS figures are allocated from tracts to neighborhoods by 2020 Census block populations and housing units; medians top-coded by the Census Bureau are shown as "≥".</p>
          <p>Both are gross rents that include utilities, so your utilities assumption is added to your rent limit before comparing. Monthly totals list which lines are sourced benchmarks, which are default assumptions and which you entered. Parking and fixed car costs are only counted when you enter them.</p>
        </div>
      </section>

      <section style={{ marginTop: 32 }} aria-labelledby="commute">
        <h2 id="commute" className="section-title">Commute estimates</h2>
        <div className="prose" style={{ marginTop: 8 }}>
          <p>No routing service is called. Each estimate starts from the straight-line distance between the neighborhood's population centre and your destination, stretched by a route factor (walking {ROUTE_FACTOR.walk}, cycling {ROUTE_FACTOR.bike}, driving {ROUTE_FACTOR.drive}, rail {ROUTE_FACTOR.rail}, bus {ROUTE_FACTOR.bus}) and divided by an assumed speed. Transit takes the faster of a rail trip (when both ends are within {MAX_STATION_WALK_M.toLocaleString('en-US')} m of a station: walks to and from stations, {RAIL_WAIT_MIN} min wait, a transfer allowance over 6 km) and a bus trip ({BUS_ACCESS_MIN} min walk at each end, {BUS_WAIT_MIN} min wait). Real trips vary with schedules, transfers and traffic.</p>
        </div>
        <div className="panel" style={{ marginTop: 12 }}>
          <table className="data">
            <thead><tr><th>City</th><th className="num">Driving km/h</th><th className="num">Rail km/h</th><th className="num">Bus km/h</th><th className="num">Fare</th><th className="num">Monthly pass</th></tr></thead>
            <tbody>
              {CITY_ORDER.map((c) => {
                const t = travelFor(c);
                return (
                  <tr key={c}>
                    <td>{CITY_NAMES[c]}<div className="small muted">{t.agency} · <a className="text-link" href={t.fareUrl} target="_blank" rel="noopener noreferrer">Fares</a> as published in {t.faresCheckedAt}</div></td>
                    <td className="num">{t.driveKmh}</td><td className="num">{t.railKmh}</td><td className="num">{t.busKmh}</td>
                    <td className="num">{t.fare === 0 ? 'Free' : `$${t.fare.toFixed(2)}`}</td><td className="num">{t.fare === 0 ? '—' : t.monthlyPass === null ? <span className="muted">None</span> : `$${t.monthlyPass.toFixed(2)}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="small muted" style={{ marginTop: 8 }}>Speeds and fares are assumptions kept in one file (src/lib/travel.ts) so they can be reviewed and updated together.</p>
        </div>
      </section>

      <section style={{ marginTop: 32 }} aria-labelledby="sources">
        <div className="panel-head">
          <h2 id="sources" className="section-title">Sources and freshness</h2>
          <span className="small muted">
            {health === null ? 'Checking server…' : health === 'error' ? 'Server health check unavailable' : `Server check ${dayMonthYear(health.checkedAt)}: ${health.status === 'ok' ? 'all cities loaded' : 'some sources need attention'}`}
          </span>
        </div>
        {manifest.status === 'loading' ? <div className="skeleton" style={{ height: 200 }} /> : null}
        {manifest.status === 'error' ? <div className="panel" role="alert">Couldn't load the data manifest. <button className="btn btn-small" onClick={manifest.retry}>Retry</button></div> : null}
        {manifest.status === 'ready'
          ? CITY_ORDER.map((c) => {
              const m = manifest.data.cities.find((x) => x.city === c);
              const attention = m ? m.sources.filter((s) => s.status === 'failed' || freshness(s.retrievedAt, s.staleAfterDays).stale).length : 0;
              return (
                <details key={c} className="panel method-details" style={{ marginTop: 12 }}>
                  <summary>
                    <span className="section-title">{CITY_NAMES[c]}</span>
                    <span className="small muted">{m ? `Built ${dayMonthYear(m.generatedAt)} · ${m.neighborhoods} areas${attention ? ` · ${attention} need attention` : ''}${m.isDemo ? ' · DEMO DATA' : ''}` : 'Not loaded on this server'}</span>
                  </summary>
                  {m ? (
                    <div className="compare-scroll">
                      <table className="data">
                        <thead><tr><th>Source</th><th>Period and updates</th><th className="num">Status</th></tr></thead>
                        <tbody>{m.sources.map((s) => <SourceRow key={s.id} s={s} />)}</tbody>
                      </table>
                    </div>
                  ) : null}
                </details>
              );
            })
          : null}
        <p className="small muted" style={{ marginTop: 12 }}>Map tiles: OpenFreeMap, © OpenMapTiles, data © OpenStreetMap contributors. Address lookup: U.S. Census Bureau Geocoder.</p>
      </section>

      <section style={{ marginTop: 32 }} aria-labelledby="privacy">
        <h2 id="privacy" className="section-title">Privacy and how Landing is paid for</h2>
        <div className="prose" style={{ marginTop: 8 }}>
          <p>There are no accounts. Your preferences, budget, pay, addresses, saved neighborhoods and comparisons are stored in this browser's local storage. An address you type is sent to our server, which forwards it to the Census Bureau geocoder. The server does not log it or write it to disk; the lookup result is held in memory for up to an hour to avoid repeat requests. Shared comparison links contain only the city, neighborhood ids and priority levels. Landing includes no analytics or advertising trackers.</p>
          <p>Search, neighborhood pages and comparisons are free. A sponsored message, if any, appears only at the foot of a neighborhood page, labelled "Sponsored", and has no effect on rankings, matches or rental links. Zillow links carry no paid placement.</p>
        </div>
      </section>

      <section style={{ marginTop: 32 }} aria-labelledby="limits">
        <h2 id="limits" className="section-title">Known limitations</h2>
        <ul className="reasons" style={{ marginTop: 8, maxWidth: '72ch' }}>
          <li>Coverage is each city proper (its legal city limits), not the metro area. Austin covers only the city's adopted neighborhood planning areas, which leave out much of northwest, far north and southwest Austin.</li>
          <li>Neighborhood names follow each city's official geography (community areas, NTAs, super neighborhoods, neighborhood councils and so on), which can differ from names people use or from Zillow's areas.</li>
          <li>Where a city publishes no clean neighborhood map, areas are ZIP code tabulation areas clipped to the city limits. They are larger than neighborhoods and are labeled with the mapped neighborhoods inside them.</li>
          <li>Jacksonville, Oklahoma City, San José, Albuquerque, Mesa, Orlando and Fresno publish no usable incident-level crime data, so incident measures are unavailable there. A few departments publish only offense groups or omit some offenses; each city's definitions above say exactly what is counted.</li>
          <li>Rent benchmarks are ZIP- or tract-based averages; individual listings vary widely.</li>
          <li>Commute times are distance-based estimates, not scheduled trips.</li>
          <li>Amenity counts depend on OpenStreetMap completeness and say nothing about price or quality.</li>
          <li>Reported incidents undercount what happens, especially for sexual assault, and reflect reporting and policing patterns as well as events.</li>
        </ul>
      </section>
    </div>
  );
}
