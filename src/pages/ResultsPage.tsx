import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon.tsx';
import type { HoodState } from '../components/NeighborhoodMap.tsx';
import { PreferencesDrawer } from '../components/PreferencesDrawer.tsx';
import { Segmented } from '../components/PreferenceFields.tsx';
import { FitFigure, ResultCard } from '../components/ResultCard.tsx';
import { money, monthYear, windowLabel, labelText } from '../lib/format.ts';
import { BEDROOM_SHORT, MODE_LABELS, type Preferences } from '../lib/prefs.ts';
import { conflicts, scenarios } from '../lib/relax.ts';
import { evaluateCity, partition, sortEvaluations, type Evaluation, type SortKey } from '../lib/scoring.ts';
import type { CityDataset, LngLat } from '../lib/types.ts';
import { CITY_NAMES, freshness, isCityId, useCity } from '../state/data.ts';
import { useStore } from '../state/store.tsx';
import { NotFound } from './NotFound.tsx';

const NeighborhoodMap = lazy(() => import('../components/NeighborhoodMap.tsx'));

function summary(prefs: Preferences) {
  const parts: string[] = [];
  parts.push(prefs.maxRent != null ? `Up to ${money(prefs.maxRent)} rent` : 'No rent limit');
  parts.push(prefs.people > 1 ? `${BEDROOM_SHORT[prefs.bedrooms]} shared by ${prefs.people}` : BEDROOM_SHORT[prefs.bedrooms]);
  if (prefs.destinations.length) parts.push(`${prefs.commuteHard ? '≤' : 'about'} ${prefs.maxCommute} min by ${MODE_LABELS[prefs.mode].toLowerCase()}`);
  return parts.join(' · ');
}

export default function ResultsPage() {
  const { city } = useParams();
  if (!isCityId(city)) return <NotFound />;
  return <Results city={city} />;
}

function Results({ city }: { city: NonNullable<Preferences['city']> }) {
  const data = useCity(city);
  const { prefs, setPrefs } = useStore();

  // Visiting a city's results makes it the working city. Destinations belong to one city only.
  useEffect(() => {
    if (prefs.city !== city) setPrefs((p) => ({ ...p, city, destinations: [] }));
  }, [city, prefs.city, setPrefs]);

  if (data.status === 'loading') return <ResultsSkeleton city={CITY_NAMES[city]} />;
  if (data.status === 'error')
    return (
      <div className="page">
        <h1 className="title">{CITY_NAMES[city]} neighborhoods</h1>
        <div className="panel" style={{ marginTop: 20 }} role="alert">
          <p>{data.error === 'not-found' ? `Neighborhood data for ${CITY_NAMES[city]} has not been loaded on this server yet. Run the data ingestion to add it.` : `Couldn't load ${CITY_NAMES[city]} neighborhood data. Check your connection.`}</p>
          {data.error !== 'not-found' ? <button className="btn" style={{ marginTop: 12 }} onClick={data.retry}>Retry</button> : null}
        </div>
      </div>
    );
  return <ResultsView dataset={data.data} />;
}

function ResultsSkeleton({ city }: { city: string }) {
  return (
    <div className="results" aria-busy="true">
      <section className="results-side">
        <div className="results-head">
          <h1 className="title">{city} neighborhoods</h1>
          <div className="skeleton" style={{ height: 16, width: 220, marginTop: 8 }} />
        </div>
        <div className="results-scroll">
          {[0, 1, 2].map((i) => (
            <div key={i} className="result" style={{ height: 260 }}>
              <div className="skeleton" style={{ height: 22, width: '50%' }} />
              <div className="skeleton" style={{ height: 40 }} />
              <div className="skeleton" style={{ height: 60 }} />
            </div>
          ))}
        </div>
      </section>
      <section className="results-map" style={{ background: 'var(--raised)' }} />
    </div>
  );
}

function ResultsView({ dataset }: { dataset: CityDataset }) {
  const { prefs, setPrefs, isSaved, toggleSaved, compare, toggleCompare, notify } = useStore();
  const navigate = useNavigate();
  const deferred = useDeferredValue(prefs);
  const [sort, setSort] = useState<SortKey>('fit');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<null | 'priorities' | 'home' | 'commute' | 'costs'>(null);
  const [picking, setPicking] = useState<number | null>(null);
  const [showFailing, setShowFailing] = useState(false);
  const [showWhatIf, setShowWhatIf] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const evaluations = useMemo(() => evaluateCity(dataset, deferred), [dataset, deferred]);
  const groups = useMemo(() => partition(evaluations), [evaluations]);
  const matches = useMemo(() => sortEvaluations(groups.matches, sort), [groups, sort]);
  const failing = useMemo(
    () => [...groups.failing].sort((a, b) => totalOver(a) - totalOver(b) || (b.score ?? 0) - (a.score ?? 0)),
    [groups],
  );
  const noMatch = matches.length === 0;
  const conflictList = useMemo(() => (noMatch ? conflicts(evaluations) : []), [noMatch, evaluations]);
  const whatIf = useMemo(() => {
    if (!noMatch && !showWhatIf) return [];
    const exact = {
      rent: conflictList.find((c) => c.check === 'rent')?.smallestFix ?? null,
      commute: conflictList.find((c) => c.check === 'commute')?.smallestFix ?? null,
    };
    return scenarios(dataset, deferred, evaluations, exact);
  }, [noMatch, showWhatIf, dataset, deferred, evaluations, conflictList]);

  const states = useMemo(() => {
    const s: Record<string, { state: HoodState; fit: number | null }> = {};
    for (const e of evaluations) s[e.hood.id] = { state: e.matches ? 'match' : e.checks.some((c) => c.passes === false) ? 'fail' : 'unverified', fit: e.score };
    return s;
  }, [evaluations]);

  const selectFromMap = useCallback((id: string) => {
    setSelectedId(id);
    const ev = evaluations.find((e) => e.hood.id === id);
    if (ev && !ev.matches && ev.checks.some((c) => c.passes === false)) setShowFailing(true);
    requestAnimationFrame(() => document.getElementById(`result-${id}`)?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
  }, [evaluations]);

  const onPick = useCallback(
    (p: LngLat) => {
      if (picking === null) return;
      setPrefs((x) => {
        const list = [...x.destinations];
        list[picking] = { label: `Point on map (${p[1].toFixed(4)}, ${p[0].toFixed(4)})`, point: p, daysPerWeek: list[picking]?.daysPerWeek ?? 5 };
        return { ...x, destinations: list.filter(Boolean) };
      });
      setPicking(null);
      setDrawer('commute');
      notify('Destination set');
    },
    [picking, setPrefs, notify],
  );

  const onToggleCompare = useCallback(
    (id: string) => {
      const r = toggleCompare(dataset.city, id);
      if (r === 'full') notify('You can compare up to three. Remove one first.');
      else if (r === 'added') notify('Added to compare');
    },
    [toggleCompare, dataset.city, notify],
  );
  const onToggleSave = useCallback((id: string) => toggleSaved(dataset.city, id), [toggleSaved, dataset.city]);

  const comparing = compare.city === dataset.city ? compare.ids : [];
  const selected = selectedId ? evaluations.find((e) => e.hood.id === selectedId) ?? null : null;
  const staleSources = dataset.sources.filter((s) => s.status === 'failed' || freshness(s.retrievedAt, s.staleAfterDays).stale);
  const moveAfterData = prefs.moveDate && dataset.incidentMethod && prefs.moveDate > addYears(dataset.incidentMethod.window.end, 1);

  const card = (e: Evaluation) => (
    <ResultCard
      key={e.hood.id}
      ev={e}
      dataset={dataset}
      selected={e.hood.id === selectedId}
      saved={isSaved(dataset.city, e.hood.id)}
      comparing={comparing.includes(e.hood.id)}
      onSelect={setSelectedId}
      onHover={setHoveredId}
      onToggleSave={onToggleSave}
      onToggleCompare={onToggleCompare}
    />
  );

  return (
    <div className="results" data-view={view}>
      <section className="results-side" aria-labelledby="results-title">
        <div className="results-head">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <h1 id="results-title" className="title">{dataset.name} neighborhoods</h1>
            <button type="button" className="btn btn-small" onClick={() => setDrawer('priorities')}>
              <Icon name="sliders" size={16} /> Preferences
            </button>
          </div>
          <p className="small muted" style={{ marginTop: 4 }}>
            <b className="ink" style={{ fontWeight: 500 }}>{matches.length} of {dataset.neighborhoods.length}</b> {labelText(dataset.geographyLabel)}s fit your limits · {summary(prefs)}
          </p>
          <div className="results-toolbar">
            <Segmented<SortKey>
              small
              label="Sort by"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'fit', label: 'Best fit', title: 'Best fit' },
                { value: 'affordability', label: 'Lowest cost', title: 'Lowest cost' },
                { value: 'commute', label: 'Commute', title: 'Shortest commute' },
              ]}
            />
            <span className="bottom-only">
              <Segmented small label="View" value={view} onChange={setView} options={[{ value: 'list', label: 'List' }, { value: 'map', label: 'Map' }]} />
            </span>
          </div>
        </div>

        <div className="results-scroll" ref={listRef}>
          {!prefs.destinations.length ? (
            <div className="notice notice-neutral" style={{ marginBottom: 8 }}>
              Commute estimates need a destination. <button type="button" className="btn btn-small" style={{ marginLeft: 6 }} onClick={() => setDrawer('commute')}>Add work or school</button>
            </div>
          ) : null}
          {staleSources.length ? (
            <div className="notice" style={{ marginBottom: 8 }}>
              {staleSources.map((s) => s.name).join('; ')} {staleSources.length === 1 ? 'is' : 'are'} {staleSources.some((s) => s.status === 'failed') ? 'unavailable or out of date' : 'out of date'}. Affected figures are marked. <Link className="text-link" to="/data">Details</Link>
            </div>
          ) : null}
          {dataset.incidentsUnavailable ? (
            <div className="notice notice-neutral" style={{ marginBottom: 8 }}>
              Reported incidents are not available for {dataset.name}: {dataset.incidentsUnavailable.charAt(0).toLowerCase() + dataset.incidentsUnavailable.slice(1)} <Link className="text-link" to="/data#incidents">Why</Link>
            </div>
          ) : null}
          {dataset.geographyKind === 'zcta' ? (
            <div className="notice notice-neutral" style={{ marginBottom: 8 }}>
              {dataset.name} publishes no clean neighborhood map, so these are ZIP code areas within the city limits.
            </div>
          ) : null}
          {dataset.incidentMethod && Date.parse(dataset.generatedAt) - Date.parse(dataset.incidentMethod.window.end) > 182 * 86_400_000 ? (
            <div className="notice" style={{ marginBottom: 8 }}>The newest reported-incident data {dataset.name} has published ends {monthYear(addYears(dataset.incidentMethod.window.end, 0))}; the department has not posted newer records.</div>
          ) : null}
          {moveAfterData ? (
            <div className="notice" style={{ marginBottom: 8 }}>Your move date is more than a year after the newest incident data here; patterns can change.</div>
          ) : null}

          {noMatch ? <NoMatch conflicts={conflictList} scenarios={whatIf} prefs={prefs} onApply={(c) => setPrefs(c)} /> : null}

          {matches.map(card)}

          {!noMatch ? (
            <div className="panel" style={{ marginTop: 12 }}>
              <div className="panel-head" style={{ marginBottom: showWhatIf ? 12 : 0 }}>
                <h2 className="section-title">What if?</h2>
                <button type="button" className="btn btn-small" aria-expanded={showWhatIf} onClick={() => setShowWhatIf((v) => !v)}>{showWhatIf ? 'Hide' : 'Show changes'}</button>
              </div>
              {showWhatIf ? <ScenarioList scenarios={whatIf} current={matches.length} onApply={(c) => setPrefs(c)} /> : <p className="small muted" style={{ marginTop: 4 }}>See how a higher budget, a longer commute or a roommate changes these results, recalculated from the same data.</p>}
            </div>
          ) : null}

          {groups.unverified.length ? (
            <>
              <div className="group-title">
                <h2 className="section-title">Couldn't check your limits</h2>
                <span className="small muted">{groups.unverified.length}</span>
              </div>
              <p className="small muted" style={{ padding: '0 8px 8px' }}>No {BEDROOM_SHORT[prefs.bedrooms]} rent benchmark is published for these, so they are not counted as matches.</p>
              {groups.unverified.map(card)}
            </>
          ) : null}

          {failing.length ? (
            <>
              <div className="group-title">
                <h2 className="section-title">Over your limits</h2>
                <button type="button" className="btn btn-small" aria-expanded={showFailing} onClick={() => setShowFailing((v) => !v)}>{showFailing ? 'Hide' : `Show ${failing.length}`}</button>
              </div>
              {showFailing ? failing.map(card) : null}
            </>
          ) : null}

          <p className="small muted" style={{ padding: '20px 8px 0' }}>
            Fit is how well each area matches your stated preferences, compared within {dataset.name}; it is not a rating of the neighborhood.
            {dataset.incidentMethod ? ` Incidents: ${windowLabel(dataset.incidentMethod.window)}.` : ' Incident data is unavailable for this city right now.'}{' '}
            <Link className="text-link" to="/data">Sources and methods</Link>
          </p>
        </div>
      </section>

      <section className="results-map" aria-label="Map">
        <Suspense fallback={<div className="map-root" style={{ background: 'var(--raised)' }} />}>
          <NeighborhoodMap
            dataset={dataset}
            states={states}
            selectedId={selectedId}
            hoveredId={hoveredId}
            onSelect={selectFromMap}
            onHover={setHoveredId}
            destinations={prefs.destinations.map((d) => d.point)}
            onPickPoint={picking !== null ? onPick : null}
            followSelection
            label={`Map of ${dataset.name} ${labelText(dataset.geographyLabel)}s, shaded by preference fit. The list beside it has the same areas.`}
          />
        </Suspense>
        {picking !== null ? (
          <div className="map-note notice notice-neutral" role="status" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            Click the map to place {picking === 0 ? 'work or school' : 'your second destination'}.
            <button className="btn btn-small" onClick={() => { setPicking(null); setDrawer('commute'); }}>Cancel</button>
          </div>
        ) : null}
        <div className="map-legend" aria-hidden={view === 'list' ? undefined : undefined}>
          <div className="ramp"><span>Fit</span><span className="ramp-bar">{[0.12, 0.25, 0.38, 0.5, 0.62].map((o) => <span key={o} style={{ opacity: o }} />)}</span><span className="muted">higher</span></div>
          <div className="ramp"><span className="swatch swatch-fail" /> Over your limits</div>
          {groups.unverified.length ? <div className="ramp"><span className="swatch swatch-unverified" /> Rent not published</div> : null}
        </div>
        {view === 'map' && selected ? (
          <div className="bottom-only" style={{ position: 'absolute', left: 12, right: 12, bottom: 12, zIndex: 3 }}>
            <div className="result" style={{ cursor: 'default' }}>
              <div className="result-top">
                <div>
                  <div className="result-name">{selected.hood.name}</div>
                  <div className="result-district">{selected.rent ? `${money(selected.rent.shareGross)}/mo benchmark` : 'Rent not published'}{selected.commutes.length ? ` · ≈ ${Math.max(...selected.commutes.map((c) => c.minutes))} min` : ''}</div>
                </div>
                <FitFigure ev={selected} />
              </div>
              <button className="btn btn-primary" onClick={() => navigate(`/${dataset.city}/n/${selected.hood.id}`)}>Open details</button>
            </div>
          </div>
        ) : null}
      </section>

      <PreferencesDrawer
        key={drawer ?? 'closed'}
        open={drawer !== null}
        initialTab={drawer ?? 'priorities'}
        onClose={() => setDrawer(null)}
        dataset={dataset}
        onPickOnMap={(i) => {
          setDrawer(null);
          setView('map');
          setPicking(i);
        }}
      />
    </div>
  );
}

function totalOver(e: Evaluation) {
  // Rank near misses first: dollars over plus a dollar-equivalent for minutes over.
  return e.checks.reduce((s, c) => s + (c.passes === false ? (c.id === 'commute' ? (c.overBy ?? 0) * 20 : c.overBy ?? 0) : 0), 0);
}

function addYears(iso: string, years: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function ScenarioList({ scenarios: list, current, onApply }: { scenarios: ReturnType<typeof scenarios>; current: number; onApply: (c: Partial<Preferences>) => void }) {
  if (!list.length) return <p className="small muted">Set a rent limit or a commute limit to explore changes.</p>;
  return (
    <ul className="rows">
      {list.map((s) => (
        <li key={s.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '4px 12px', padding: '10px 0', alignItems: 'center' }}>
          <div style={{ fontWeight: 500 }}>{s.label}</div>
          <button type="button" className="btn btn-small" onClick={() => onApply(s.change)}>Apply</button>
          <div className="small muted" style={{ gridColumn: '1 / -1' }}>
            {s.matchCount} {s.matchCount === 1 ? 'area fits' : 'areas fit'} ({s.matchCount - current >= 0 ? '+' : ''}{s.matchCount - current} vs now)
            {s.added.length ? `: adds ${s.added.slice(0, 3).map((e) => e.hood.name).join(', ')}${s.added.length > 3 ? ` and ${s.added.length - 3} more` : ''}` : ''}
            {s.cheapestDelta != null && s.cheapestDelta !== 0 ? `. Cheapest monthly total ${s.cheapestDelta < 0 ? 'falls' : 'rises'} by ${money(Math.abs(s.cheapestDelta))}` : ''}
          </div>
        </li>
      ))}
    </ul>
  );
}

function NoMatch({ conflicts: list, scenarios: sc, prefs, onApply }: { conflicts: ReturnType<typeof conflicts>; scenarios: ReturnType<typeof scenarios>; prefs: Preferences; onApply: (c: Partial<Preferences>) => void }) {
  const names = { rent: 'rent limit', housing: 'total housing budget', commute: 'commute limit' } as const;
  const both = list.length > 1 && list.every((c) => c.onlyThis === 0);
  return (
    <div className="panel" style={{ marginBottom: 8 }} role="status">
      <h2 className="section-title">No neighborhood meets all your limits</h2>
      <div className="prose" style={{ marginTop: 8 }}>
        {list.map((c) => (
          <p key={c.check}>
            {c.onlyThis > 0 ? (
              <>Your <b style={{ fontWeight: 500 }}>{names[c.check]}</b> alone rules out {c.onlyThis} {c.onlyThis === 1 ? 'area' : 'areas'} that pass everything else.{c.smallestFix != null ? ` Raising it by ${c.check === 'commute' ? `${c.smallestFix} min` : money(c.smallestFix)} would let the closest one in.` : ''}</>
            ) : (
              <>No area is ruled out by your {names[c.check]} alone: every area over it is also over another limit.</>
            )}
          </p>
        ))}
        {both ? <p>Every area fails more than one limit at once, so changing one limit is not enough.</p> : null}
        {prefs.maxRent != null ? <p className="small muted">Rent limits are compared with gross-rent benchmarks, which include utilities; your utilities assumption is added to your limit.</p> : null}
      </div>
      <h3 className="section-title" style={{ marginTop: 16 }}>What changing one thing would do</h3>
      <div style={{ marginTop: 4 }}>
        <ScenarioList scenarios={sc} current={0} onApply={onApply} />
      </div>
    </div>
  );
}
