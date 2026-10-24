import { useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon.tsx';
import { moveInCost } from '../lib/cost.ts';
import { incidentIndex } from '../lib/incidentIndex.ts';
import { dec1, int, money, relativeWords, windowLabel } from '../lib/format.ts';
import { applyPriorityCode, compareShareUrl, parseCompareParams, zillowRentalsUrl } from '../lib/links.ts';
import { defaultPreferences } from '../lib/prefs.ts';
import { evaluateCity, type Evaluation } from '../lib/scoring.ts';
import type { CityDataset, CityId } from '../lib/types.ts';
import { CITY_NAMES, useCity } from '../state/data.ts';
import { useStore } from '../state/store.tsx';

export default function ComparePage() {
  const [params] = useSearchParams();
  const shared = parseCompareParams(params);
  const { compare } = useStore();
  const city: CityId | null = shared?.city ?? compare.city;
  const ids = shared ? shared.ids : compare.ids;
  const data = useCity(city && ids.length ? city : null);

  if (!city || !ids.length) {
    return (
      <div className="page">
        <h1 className="title">Compare neighborhoods</h1>
        <p className="subtitle">Choose up to three neighborhoods with Compare on any result to see cost, commute, reported incidents and amenities side by side.</p>
        <div className="empty" style={{ marginTop: 24 }}>
          Nothing selected to compare yet.
          <Link className="btn" to="/">Choose a city</Link>
        </div>
      </div>
    );
  }
  if (data.status === 'loading') return <div className="page" aria-busy="true"><h1 className="title">Compare neighborhoods</h1><div className="skeleton" style={{ height: 320, marginTop: 20 }} /></div>;
  if (data.status === 'error')
    return (
      <div className="page">
        <h1 className="title">Compare neighborhoods</h1>
        <div className="panel" role="alert" style={{ marginTop: 16 }}>Couldn't load {CITY_NAMES[city]} data. <button className="btn btn-small" onClick={data.retry}>Retry</button></div>
      </div>
    );
  return <CompareTable dataset={data.data} ids={ids} sharedPriorities={shared ? shared.priorities : null} isShared={!!shared} />;
}

type Row = { label: string; cells: ReactNode[]; best?: number | null };

function bestIndex(values: Array<number | null | undefined>, lowerIsBetter: boolean): number | null {
  let best: number | null = null;
  values.forEach((v, i) => {
    if (v == null) return;
    if (best === null || (lowerIsBetter ? v < values[best]! : v > values[best]!)) best = i;
  });
  // Only mark a best when the values differ.
  return best !== null && values.filter((v) => v != null && v === values[best!]).length === 1 ? best : null;
}

function CompareTable({ dataset, ids, sharedPriorities, isShared }: { dataset: CityDataset; ids: string[]; sharedPriorities: string | null; isShared: boolean }) {
  const { prefs: myPrefs, toggleCompare, notify } = useStore();
  // A shared link brings priorities only. Costs and commutes use this visitor's own inputs, if they have any here.
  const ownHere = myPrefs.city === dataset.city;
  const prefs = useMemo(() => {
    const base = ownHere ? myPrefs : { ...defaultPreferences(), city: dataset.city };
    return sharedPriorities ? applyPriorityCode(base, sharedPriorities) : base;
  }, [ownHere, myPrefs, dataset.city, sharedPriorities]);
  const evs = useMemo(() => {
    const all = evaluateCity(dataset, prefs);
    return ids.map((id) => all.find((e) => e.hood.id === id)).filter(Boolean) as Evaluation[];
  }, [dataset, prefs, ids]);
  const missing = ids.length - evs.length;

  const share = async () => {
    const url = compareShareUrl(window.location.origin, dataset.city, evs.map((e) => e.hood.id), prefs);
    try {
      await navigator.clipboard.writeText(url);
      notify('Link copied. It includes neighborhoods and priority levels only.');
    } catch {
      window.prompt('Copy this link. It includes neighborhoods and priority levels only.', url);
    }
  };

  const inc = (k: 'violent' | 'property' | 'vehicle'): Row => {
    const vals = evs.map((e) => e.hood.incidents?.[k].ratePer1k);
    return {
      label: `${k === 'violent' ? 'Violent' : k === 'property' ? 'Property' : 'Vehicle'} incidents per 1,000 residents`,
      best: bestIndex(vals, true),
      cells: evs.map((e) => {
        const x = e.hood.incidents?.[k];
        return x?.ratePer1k != null ? <><span className="num">{dec1(x.ratePer1k)}</span><div className="small muted">{relativeWords(x.cityPercentile, dataset.name)}</div></> : <span className="dash">—</span>;
      }),
    };
  };
  const longest = (e: Evaluation) => (e.commutes.length ? Math.max(...e.commutes.map((c) => c.minutes)) : null);

  const groups: Array<{ title: string; rows: Row[] }> = [
    {
      title: 'Fit',
      rows: [
        { label: 'Preference fit', best: bestIndex(evs.map((e) => e.score), false), cells: evs.map((e) => <span className="num" style={{ color: 'var(--hue-ink)', fontWeight: 500 }}>{e.score ?? '—'}</span>) },
        { label: 'Within your limits', cells: evs.map((e) => (e.checks.length === 0 ? <span className="muted">No limits set</span> : e.matches ? 'Yes' : e.unverified && !e.checks.some((c) => c.passes === false) ? <span className="muted">Couldn't check</span> : <span>No: {e.checks.filter((c) => c.passes === false).map((c) => c.label.toLowerCase()).join(', ')}</span>)) },
        { label: 'Tradeoff', cells: evs.map((e) => <span className="small">{e.tradeoff}</span>) },
      ],
    },
    {
      title: 'Cost',
      rows: [
        { label: 'Rent benchmark', best: bestIndex(evs.map((e) => e.rent?.shareGross), true), cells: evs.map((e) => (e.rent ? <><span className="num">{money(e.rent.shareGross)}</span><div className="small muted">{e.rent.source === 'safmr' ? 'HUD SAFMR' : 'ACS median'}, gross</div></> : <span className="dash">—</span>)) },
        { label: 'Estimated monthly total', best: bestIndex(evs.map((e) => e.cost?.total), true), cells: evs.map((e) => <span className="num">{money(e.cost?.total)}</span>) },
        { label: 'Move-in cash', best: bestIndex(evs.map((e) => moveInCost(dataset.city, e.hood, prefs)?.total), true), cells: evs.map((e) => <span className="num">{money(moveInCost(dataset.city, e.hood, prefs)?.total)}</span>) },
      ],
    },
    {
      title: 'Commute',
      rows: [
        {
          label: prefs.destinations.length ? 'Estimated commute' : 'Estimated commute (add a destination)',
          best: bestIndex(evs.map(longest), true),
          cells: evs.map((e) => (e.commutes.length ? <span className="num">≈ {longest(e)} min</span> : <span className="dash">—</span>)),
        },
        { label: 'Nearest rail station', best: bestIndex(evs.map((e) => e.hood.nearestRailM), true), cells: evs.map((e) => <span className="num">{e.hood.nearestRailM == null ? '—' : e.hood.nearestRailM < 1000 ? `${Math.round(e.hood.nearestRailM / 10) * 10} m` : `${(e.hood.nearestRailM / 1000).toFixed(1)} km`}</span>) },
      ],
    },
    {
      title: 'Reported incidents',
      rows: [
        {
          label: `Reported-incident index (${dataset.name}-relative, 10 = fewest)`,
          best: bestIndex(evs.map((e) => incidentIndex(e.hood).value), false),
          cells: evs.map((e) => {
            const v = incidentIndex(e.hood).value;
            return v != null ? <span className="num">{v.toFixed(1)} <span className="small muted">/10</span></span> : <span className="dash">—</span>;
          }),
        },
        inc('violent'),
        inc('property'),
        inc('vehicle'),
      ],
    },
    {
      title: 'Amenities (mapped in OpenStreetMap)',
      rows: (['grocery', 'parks', 'restaurants', 'nightlife'] as const).map((k) => ({
        label: { grocery: 'Supermarkets and greengrocers', parks: 'Parks', restaurants: 'Restaurants and cafés', nightlife: 'Bars, pubs and clubs' }[k],
        cells: evs.map((e) => <span className="num">{e.hood.amenities ? int(e.hood.amenities[k]) : '—'}</span>),
      })),
    },
    {
      title: 'Data',
      rows: [
        { label: 'Residents', cells: evs.map((e) => <span className="num">{int(e.hood.population)}</span>) },
        { label: 'Incident period', cells: evs.map(() => <span className="small">{dataset.incidentMethod ? windowLabel(dataset.incidentMethod.window) : 'Unavailable'}</span>) },
        { label: 'Rent benchmark period', cells: evs.map((e) => <span className="small">{e.rent?.source === 'safmr' ? 'HUD FY2026' : e.rent ? 'ACS 2020–2024' : '—'}</span>) },
      ],
    },
  ];

  return (
    <div className="page">
      <div className="detail-head">
        <div>
          <h1 className="title">Compare neighborhoods</h1>
          <p className="subtitle">{dataset.name} · {evs.length} of 3 selected{isShared ? ' · opened from a shared link' : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn" to={`/${dataset.city}`}>Back to results</Link>
          <button className="btn btn-primary" onClick={share} disabled={!evs.length}><Icon name="share" size={16} /> Copy share link</button>
        </div>
      </div>
      {isShared ? (
        <p className="notice notice-neutral" style={{ marginTop: 16 }}>
          {ownHere ? 'Using the priorities from the link with your own rent, commute and cost inputs from this device.' : 'Shared links carry priorities only. Costs use a 1-bed for one person; add your own budget and commute to see your figures.'}
        </p>
      ) : null}
      {missing ? <p className="notice" style={{ marginTop: 12 }}>{missing} selected {missing === 1 ? 'area is' : 'areas are'} no longer in this city's data and {missing === 1 ? 'is' : 'are'} not shown.</p> : null}

      <div className="panel compare-scroll" style={{ marginTop: 20 }}>
        <table className="compare-table">
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Measure</span></th>
              {evs.map((e) => (
                <th key={e.hood.id} scope="col">
                  <Link className="result-name" to={`/${dataset.city}/n/${e.hood.id}`}>{e.hood.name}</Link>
                  <div className="small muted" style={{ fontWeight: 400 }}>{e.hood.district ?? dataset.geographyLabel}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    <a className="btn btn-small" href={zillowRentalsUrl(e.hood, dataset)} target="_blank" rel="noopener noreferrer">Zillow <Icon name="external" size={14} /></a>
                    {!isShared ? <button className="btn btn-small btn-ghost" onClick={() => toggleCompare(dataset.city, e.hood.id)} aria-label={`Remove ${e.hood.name} from compare`}>Remove</button> : null}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <FragmentRows key={g.title} title={g.title} rows={g.rows} cols={evs.length} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>
        The figure in bold is the lowest cost, shortest commute, lowest reported rate, highest incident index or highest fit among these {evs.length}, where they differ. Incident rates are compared within {dataset.name} only.
      </p>
    </div>
  );
}

function FragmentRows({ title, rows, cols }: { title: string; rows: Row[]; cols: number }) {
  return (
    <>
      <tr className="group"><th scope="rowgroup" colSpan={cols + 1}>{title}</th></tr>
      {rows.map((r) => (
        <tr key={r.label}>
          <th scope="row">{r.label}</th>
          {r.cells.map((c, i) => <td key={i} className={r.best === i ? 'best' : undefined}>{c}</td>)}
        </tr>
      ))}
    </>
  );
}
