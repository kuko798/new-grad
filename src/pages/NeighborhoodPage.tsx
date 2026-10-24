import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FitLedger } from '../components/FitLedger.tsx';
import { Icon } from '../components/Icon.tsx';
import { PreferencesDrawer } from '../components/PreferencesDrawer.tsx';
import { SponsorSlot } from '../components/SponsorSlot.tsx';
import { moveInCost, type CostLine } from '../lib/cost.ts';
import { INDEX_WEIGHTS, incidentIndex } from '../lib/incidentIndex.ts';
import { dayMonthYear, dec1, int, money, relativeWords, trendWords, windowLabel } from '../lib/format.ts';
import { zillowFilterHints, zillowRentalsUrl } from '../lib/links.ts';
import { BEDROOM_LABELS, BEDROOM_SHORT, MODE_LABELS } from '../lib/prefs.ts';
import { cityStats, evaluateCity } from '../lib/scoring.ts';
import { BEDROOM_KEYS, type CityDataset, type IncidentKind } from '../lib/types.ts';
import { CITY_NAMES, freshness, isCityId, useCity } from '../state/data.ts';
import { useStore } from '../state/store.tsx';
import { NotFound } from './NotFound.tsx';

const NeighborhoodMap = lazy(() => import('../components/NeighborhoodMap.tsx'));

export default function NeighborhoodPage() {
  const { city, id } = useParams();
  const data = useCity(isCityId(city) ? city : null);
  if (!isCityId(city)) return <NotFound />;
  if (data.status === 'loading')
    return (
      <div className="page" aria-busy="true">
        <div className="skeleton" style={{ width: 280, height: 30 }} />
        <div className="skeleton" style={{ height: 88, marginTop: 20 }} />
      </div>
    );
  if (data.status === 'error')
    return (
      <div className="page">
        <h1 className="title">Neighborhood</h1>
        <div className="panel" style={{ marginTop: 16 }} role="alert">
          <p>Couldn't load {CITY_NAMES[city]} data.</p>
          <button className="btn" style={{ marginTop: 12 }} onClick={data.retry}>Retry</button>
        </div>
      </div>
    );
  const hood = data.data.neighborhoods.find((h) => h.id === id);
  if (!hood) return <NotFound message={`No ${data.data.geographyLabel.toLowerCase()} with that id in ${data.data.name}. It may not be ranked; see the coverage notes in Data and methods.`} />;
  return <Detail dataset={data.data} id={hood.id} />;
}

const KIND_LABEL: Record<IncidentKind, string> = { violent: 'Violent incidents', property: 'Property incidents', vehicle: 'Vehicle-related incidents' };

function Lines({ lines }: { lines: CostLine[] }) {
  return (
    <div className="rows">
      {lines.map((l) => (
        <div key={l.id} className="cost-line">
          <span>
            {l.label}
            <span className={`kind kind-${l.kind}`}>{l.kind === 'sourced' ? 'Sourced' : l.kind === 'assumption' ? 'Assumption' : l.kind === 'entered' ? 'Yours' : 'Estimate'}</span>
          </span>
          <span className="num">{money(l.amount)}</span>
          <span className="note">{l.note}</span>
        </div>
      ))}
    </div>
  );
}

function Detail({ dataset, id }: { dataset: CityDataset; id: string }) {
  const { prefs, isSaved, toggleSaved, compare, toggleCompare, notify } = useStore();
  const [drawer, setDrawer] = useState<null | 'priorities' | 'costs' | 'home' | 'commute'>(null);
  const evs = useMemo(() => evaluateCity(dataset, prefs), [dataset, prefs]);
  const ev = evs.find((e) => e.hood.id === id)!;
  const h = ev.hood;
  const stats = cityStats(dataset).get(h.id)!;
  const moveIn = moveInCost(dataset.city, h, prefs);
  const failing = ev.checks.filter((c) => c.passes === false);
  const comparing = compare.city === dataset.city && compare.ids.includes(h.id);
  const saved = isSaved(dataset.city, h.id);
  const longest = ev.commutes.length ? ev.commutes.reduce((a, b) => (b.minutes > a.minutes ? b : a)) : null;
  const m = dataset.incidentMethod;

  return (
    <div className="page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={`/${dataset.city}`}>{dataset.name}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{h.name}</span>
      </nav>
      <div className="detail-head">
        <div>
          <h1 className="title">{h.name}</h1>
          <p className="subtitle" style={{ marginTop: 4 }}>
            {[h.district, dataset.geographyLabel, `${int(h.population)} residents`, `${dec1(h.areaKm2)} km²`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn" aria-pressed={saved} onClick={() => toggleSaved(dataset.city, h.id)}>
            <Icon name="saved" size={16} filled={saved} /> {saved ? 'Saved' : 'Save'}
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={comparing}
            onClick={() => {
              const r = toggleCompare(dataset.city, h.id);
              if (r === 'full') notify('You can compare up to three. Remove one first.');
            }}
          >
            <Icon name={comparing ? 'check' : 'compare'} size={16} /> {comparing ? 'Comparing' : 'Compare'}
          </button>
          <a className="btn btn-primary" href={zillowRentalsUrl(h, dataset)} target="_blank" rel="noopener noreferrer">
            Explore rentals on Zillow <Icon name="external" size={14} />
          </a>
        </div>
      </div>

      {failing.length ? (
        <div className="notice" style={{ marginTop: 16 }} role="status">
          {failing.map((c) => c.detail).join('. ')}. This area is outside your limits, so it is not shown as a match.
        </div>
      ) : ev.unverified ? (
        <div className="notice" style={{ marginTop: 16 }}>No {BEDROOM_SHORT[prefs.bedrooms]} rent benchmark is published here, so your rent limit could not be checked.</div>
      ) : null}

      <div className="kpis" style={{ marginTop: 20 }}>
        <div className="kpi">
          <div className="kpi-label">Preference fit</div>
          <div className="kpi-value lead num">{ev.score ?? '—'}<span className="unit"> /100</span></div>
          <div className="kpi-note">{Math.round(ev.coverage * 100)}% of weighted measures have data</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Rent benchmark, {prefs.people > 1 ? 'your share' : BEDROOM_SHORT[prefs.bedrooms]}</div>
          <div className="kpi-value num">{money(ev.rent?.shareGross)}<span className="unit"> /mo</span></div>
          <div className="kpi-note">{ev.rent ? `${ev.rent.source === 'safmr' ? 'HUD FY2026 SAFMR' : 'ACS 2020–2024'}, incl. utilities` : 'Not published'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Estimated monthly total</div>
          <div className="kpi-value num">{money(ev.cost?.total)}<span className="unit"> /mo</span></div>
          <div className="kpi-note">{ev.cost?.shareOfTakeHome != null ? `${Math.round(ev.cost.shareOfTakeHome * 100)}% of your take-home pay` : 'Rent, bills and commuting'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Commute{ev.commutes.length > 1 ? ', longer of two' : ''}</div>
          <div className="kpi-value num">{longest ? <>≈ {longest.minutes}<span className="unit"> min</span></> : '—'}</div>
          <div className="kpi-note">{longest ? `${MODE_LABELS[longest.mode]} estimate, ${longest.distanceKm.toFixed(1)} km straight-line` : 'Add a destination'}</div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="col-7 stack">
          <section className="panel" aria-labelledby="why">
            <div className="panel-head">
              <h2 id="why" className="section-title">Why it fits, and the tradeoff</h2>
              <button className="btn btn-small" onClick={() => setDrawer('priorities')}><Icon name="sliders" size={16} /> Change priorities</button>
            </div>
            {ev.reasons.length ? (
              <ul className="reasons">
                {ev.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            ) : null}
            <p className="tradeoff" style={{ marginTop: 8 }}><b>Tradeoff:</b> {ev.tradeoff}</p>
            <div className="divider" />
            <FitLedger ev={ev} />
          </section>

          <section className="panel" aria-labelledby="incidents">
            <div className="panel-head">
              <h2 id="incidents" className="section-title">Reported incidents</h2>
              <span className="small muted">{m ? `${windowLabel(m.window)}, by ${m.dateBasis} date` : 'Unavailable'}</span>
            </div>
            {!h.incidents || !m ? (
              <div className="empty">Incident data for {dataset.name} could not be loaded in the latest refresh. Nothing here is counted as low.</div>
            ) : (
              <>
                {(() => {
                  const idx = incidentIndex(h);
                  return (
                    <div className="kv" style={{ padding: '0 0 12px', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 500 }}>Reported-incident index</div>
                        <div className="small muted" style={{ maxWidth: '52ch' }}>
                          10 means the fewest reported incidents per resident among {dataset.name}'s areas, 0 the most. Combines the three rates below
                          (violent {INDEX_WEIGHTS.violent * 100}%, property {INDEX_WEIGHTS.property * 100}%, vehicle {INDEX_WEIGHTS.vehicle * 100}%)
                          {idx.missing.length && idx.value != null ? `; ${idx.missing.join(' and ')} left out for lack of a stable rate` : ''}. It describes reported incidents, not personal safety, and is not part of the fit score.
                        </div>
                      </div>
                      <div className="num" style={{ fontSize: 24, lineHeight: '30px', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {idx.value != null ? <>{idx.value.toFixed(1)}<span className="small muted" style={{ fontWeight: 400 }}> /10</span></> : <span className="dash">—</span>}
                      </div>
                    </div>
                  );
                })()}
                <p className="small muted" style={{ marginBottom: 8 }}>
                  Rates per 1,000 residents, placed among {dataset.name}'s {dataset.neighborhoods.length} areas (left is lowest). Compare within {dataset.name} only; other cities count and classify differently.
                </p>
                <div className="rows">
                  {(['violent', 'property', 'vehicle'] as IncidentKind[]).map((k) => {
                    const x = h.incidents![k];
                    return (
                      <div key={k} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 140px', gap: '4px 16px', padding: '12px 0', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 500 }}>{KIND_LABEL[k]}</div>
                          <div className="small muted">{m.definitions[k]}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="num" style={{ fontSize: 18, fontWeight: 500 }}>{x.ratePer1k != null ? dec1(x.ratePer1k) : <span className="dash">—</span>}<span className="small muted" style={{ fontWeight: 400 }}> /1k</span></div>
                          <div className="small muted num">{int(x.count)} reported</div>
                        </div>
                        <div>
                          {x.cityPercentile != null ? (
                            <div className="position" role="img" aria-label={`${relativeWords(x.cityPercentile, dataset.name)}: ${Math.round(x.cityPercentile * 100)}th percentile of ${dataset.name} areas`}>
                              <span className="median" />
                              <span className="tick" style={{ left: `${x.cityPercentile * 100}%` }} />
                            </div>
                          ) : (
                            <p className="small muted">Too few residents for a stable rate; not ranked.</p>
                          )}
                        </div>
                        <div className="small muted" style={{ textAlign: 'right' }}>{relativeWords(x.cityPercentile, dataset.name)}</div>
                        <div className="small muted" style={{ gridColumn: '1 / -1' }}>{trendWords(x.count, x.priorCount)}</div>
                      </div>
                    );
                  })}
                </div>
                {h.incidents.visitorHeavy ? (
                  <p className="notice notice-neutral" style={{ marginTop: 12 }}>
                    {h.jobs != null && h.population ? `About ${int(h.jobs)} people work here against ${int(h.population)} residents. ` : ''}Commuters, shoppers and visitors add to reported incidents but not to the residential count, so per-resident rates here overstate what residents experience.
                  </p>
                ) : null}
                <p className="small muted" style={{ marginTop: 12 }}>
                  {m.dedupe} {Math.round(m.unlocatedShare * 100)}% of the city's records in this window could not be placed in a covered area. <Link className="text-link" to="/data#incidents">How incidents are counted</Link>
                </p>
              </>
            )}
          </section>

          <section className="panel" aria-labelledby="amenities">
            <div className="panel-head">
              <h2 id="amenities" className="section-title">Everyday amenities</h2>
              <span className="small muted">OpenStreetMap, mapped features</span>
            </div>
            {!h.amenities ? (
              <div className="empty">Amenity data could not be loaded for this city.</div>
            ) : (
              <table className="data">
                <thead>
                  <tr><th>Feature</th><th className="num">Mapped</th><th className="num">Per km²</th><th className="num">Density vs city</th></tr>
                </thead>
                <tbody>
                  {([
                    ['Supermarkets and greengrocers', h.amenities.grocery, stats.density.grocery, stats.pct.grocery],
                    ['Parks', h.amenities.parks, stats.density.parks, stats.pct.parks],
                    ['Restaurants and cafés', h.amenities.restaurants, stats.density.restaurants, stats.pct.restaurants],
                    ['Bars, pubs and clubs', h.amenities.nightlife, stats.density.nightlife, stats.pct.nightlife],
                    ['Bus stops', h.amenities.busStops, stats.density.busStops, stats.pct.busStops],
                    ['Dog parks', h.amenities.dogParks, stats.density.dogParks, stats.pct.dogParks],
                  ] as Array<[string, number, number | null, number | undefined]>).map(([label, n, d, p]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td className="num">{int(n)}</td>
                      <td className="num">{d == null ? '—' : d.toFixed(1)}</td>
                      <td className="num muted">{p == null ? '—' : n === 0 ? 'None mapped' : `Denser than ${Math.round(p * 100)}%`}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>Rail stations{h.amenities.stationsWithAccessTag ? `, ${h.amenities.stepFreeStations} tagged step-free` : ''}</td>
                    <td className="num">{int(h.amenities.railStations)}</td>
                    <td className="num" colSpan={2}>{h.nearestRailM != null ? `Nearest ${h.nearestRailM < 1000 ? `${Math.round(h.nearestRailM / 10) * 10} m` : `${(h.nearestRailM / 1000).toFixed(1)} km`} from the population centre` : '—'}</td>
                  </tr>
                </tbody>
              </table>
            )}
            <p className="small muted" style={{ marginTop: 10 }}>Counts reflect what volunteers have mapped and can miss places. Pet and accessibility measures are limited to what OpenStreetMap records.</p>
          </section>

          <section className="panel" aria-labelledby="rent">
            <h2 id="rent" className="section-title" style={{ marginBottom: 8 }}>Rent benchmarks</h2>
            <table className="data">
              <thead><tr><th>Unit</th><th className="num">Recent movers<br />HUD SAFMR</th><th className="num">All renters<br />ACS median</th></tr></thead>
              <tbody>
                {BEDROOM_KEYS.map((b) => (
                  <tr key={b} style={b === prefs.bedrooms ? { fontWeight: 500 } : undefined}>
                    <td>{BEDROOM_LABELS[b]}</td>
                    <td className="num">{money(h.safmr?.byBedroom[b])}</td>
                    <td className="num">{h.rent?.byBedroom[b] != null ? `${h.rent.topCoded[b] ? '≥ ' : ''}${money(h.rent.byBedroom[b])}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted" style={{ marginTop: 10 }}>
              Both are monthly gross rents (rent plus utilities). HUD's FY2026 Small Area Fair Market Rent is the 40th percentile paid by recent movers in the ZIP code{h.safmr && h.safmr.zips.length ? `s ${h.safmr.zips.join(', ')}` : ''}, so it is not specific to this boundary. The ACS 2020–2024 median covers all renters, including long-term and subsidized tenants, and runs below asking rents.
              {h.rent ? ` ${Math.round(h.rent.coverage * 100)}% of renter homes here are in tracts with a published median.` : ''}
            </p>
          </section>

        </div>

        <div className="col-5 stack">
          <div className="mini-map">
            <Suspense fallback={null}>
              <NeighborhoodMap
                dataset={dataset}
                states={{ [h.id]: { state: 'match', fit: 70 } }}
                selectedId={h.id}
                hoveredId={null}
                interactive={false}
                focusId={h.id}
                destinations={prefs.destinations.map((d) => d.point)}
                label={`Map of the ${h.name} boundary`}
              />
            </Suspense>
          </div>

          <section className="panel" aria-labelledby="cost">
            <div className="panel-head">
              <h2 id="cost" className="section-title">True monthly cost</h2>
              <button className="btn btn-small" onClick={() => setDrawer('costs')}>Edit assumptions</button>
            </div>
            {ev.cost ? (
              <>
                <Lines lines={ev.cost.lines} />
                <div className="cost-total"><span>Estimated total</span><span className="num">{money(ev.cost.total)}</span></div>
                {ev.cost.missing.length ? <p className="small muted" style={{ marginTop: 8 }}>Not included until you add it: {ev.cost.missing.join(', ')}.</p> : null}
              </>
            ) : (
              <div className="empty">No rent benchmark is published for a {BEDROOM_SHORT[prefs.bedrooms]} here, so the total cannot be estimated.</div>
            )}
          </section>

          <section className="panel" aria-labelledby="movein">
            <div className="panel-head">
              <h2 id="movein" className="section-title">Move-in cash</h2>
              <span className="small muted">One-time, kept apart from monthly costs</span>
            </div>
            {moveIn ? (
              <>
                <Lines lines={moveIn.lines} />
                <div className="cost-total"><span>Cash to move in</span><span className="num">{money(moveIn.total)}</span></div>
                <p className="small muted" style={{ marginTop: 8 }}>{moveIn.notes.join(' ')}</p>
              </>
            ) : (
              <div className="empty">Needs a rent benchmark.</div>
            )}
          </section>

          <section className="panel" aria-labelledby="commute">
            <h2 id="commute" className="section-title" style={{ marginBottom: 8 }}>Commute estimate</h2>
            {ev.commutes.length ? (
              <div className="rows">
                {ev.commutes.map((c, i) => (
                  <div key={i} style={{ padding: '8px 0' }}>
                    <div className="kv" style={{ padding: 0 }}>
                      <span style={{ fontWeight: 500 }}>{prefs.destinations[i]?.label}</span>
                      <span className="num" style={{ fontWeight: 500 }}>≈ {c.minutes} min</span>
                    </div>
                    <p className="small muted" style={{ marginTop: 4 }}>From the neighborhood's population centre. {c.basis.charAt(0).toUpperCase() + c.basis.slice(1)}. An estimate, not a scheduled trip.</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">
                Add a work or school address to estimate commutes.
                <button className="btn btn-small" onClick={() => setDrawer('commute')}>Add destination</button>
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="rentals">
            <h2 id="rentals" className="section-title">Explore rentals</h2>
            <p style={{ marginTop: 6 }}>Zillow opens a search for {h.name}. Its search area may not match this boundary exactly; use the map above to compare.</p>
            <p className="small muted" style={{ marginTop: 10 }}>Set these filters on Zillow (they are not carried over):</p>
            <ul className="reasons" style={{ marginTop: 6 }}>
              {zillowFilterHints(prefs).map((t) => <li key={t}>{t}</li>)}
            </ul>
            <a className="btn" style={{ marginTop: 12 }} href={zillowRentalsUrl(h, dataset)} target="_blank" rel="noopener noreferrer">
              Open Zillow rentals <Icon name="external" size={14} />
            </a>
            <p className="small muted" style={{ marginTop: 10 }}>Landing does not show or rank listings, and no listing or placement is paid for.</p>
          </section>

          <section className="panel" aria-labelledby="sources">
            <h2 id="sources" className="section-title" style={{ marginBottom: 4 }}>Data for this area</h2>
            <div className="rows">
              {dataset.sources.filter((s) => !/gazetteer|zcta/.test(s.id)).map((s) => {
                const f = freshness(s.retrievedAt, s.staleAfterDays);
                return (
                  <div key={s.id} className="kv">
                    <span className="small" style={{ minWidth: 0 }}><a className="text-link" href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a><br /><span className="muted">{s.observationPeriod}</span></span>
                    <span className="small">{s.status === 'failed' ? <span className="pill pill-negative">Unavailable</span> : f.stale ? <span className="pill pill-warning">Stale</span> : <span className="muted">Retrieved {dayMonthYear(s.retrievedAt)}</span>}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      <SponsorSlot />

      <PreferencesDrawer key={drawer ?? 'closed'} open={drawer !== null} initialTab={drawer ?? 'priorities'} onClose={() => setDrawer(null)} dataset={dataset} />
    </div>
  );
}
