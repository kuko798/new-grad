import { memo } from 'react';
import { Link } from 'react-router-dom';
import { dec1, int, money, plural, relativeWords } from '../lib/format.ts';
import { zillowRentalsUrl } from '../lib/links.ts';
import { MODE_LABELS } from '../lib/prefs.ts';
import { incidentIndex } from '../lib/incidentIndex.ts';
import type { Evaluation } from '../lib/scoring.ts';
import type { CityDataset, IncidentKind } from '../lib/types.ts';
import { Icon } from './Icon.tsx';

export function FitFigure({ ev, large }: { ev: Evaluation; large?: boolean }) {
  if (ev.score == null) return <div className="fit-figure none" title="No preferences weighted">—</div>;
  return (
    <div style={{ textAlign: 'right' }}>
      <div className="fit-figure" style={large ? { fontSize: 30, lineHeight: '36px' } : undefined}>
        {ev.score}
        <small> /100</small>
      </div>
      <div className="small muted">Preference fit{ev.coverage < 0.999 ? ` · ${Math.round(ev.coverage * 100)}% measured` : ''}</div>
    </div>
  );
}

const KIND_SHORT: Record<IncidentKind, string> = { violent: 'Violent', property: 'Property', vehicle: 'Vehicle' };

/** The 0–10 reported-incident index, always with its city and what it is. */
export function IncidentIndexLine({ ev, dataset }: { ev: Evaluation; dataset: CityDataset }) {
  const idx = incidentIndex(ev.hood);
  return (
    <div className="index-line">
      <span className="figure-label">Reported-incident index</span>
      {idx.value != null ? (
        <span className="num" style={{ fontWeight: 500 }}>
          {idx.value.toFixed(1)}<span className="unit muted" style={{ fontWeight: 400, fontSize: 12 }}> /10</span>
        </span>
      ) : (
        <span className="dash">—</span>
      )}
      <span className="figure-note" style={{ marginTop: 0 }}>
        {idx.value == null ? 'Not enough data' : `${dataset.name}-relative; 10 = fewest reported${idx.missing.length ? ` (no stable ${idx.missing.join(', ')} rate)` : ''}`}
      </span>
    </div>
  );
}

export function IncidentStrip({ ev, dataset }: { ev: Evaluation; dataset: CityDataset }) {
  const inc = ev.hood.incidents;
  return (
    <div className="incident-strip" aria-label="Reported incidents per 1,000 residents, last 12 months">
      {(['violent', 'property', 'vehicle'] as IncidentKind[]).map((k) => {
        const m = inc?.[k];
        return (
          <div key={k}>
            <div className="figure-label">{KIND_SHORT[k]} reported</div>
            <div className="figure-value num">
              {m?.ratePer1k != null ? <>{dec1(m.ratePer1k)}<span className="unit"> /1k</span></> : <span className="dash">—</span>}
            </div>
            <div className="figure-note">{!inc ? (dataset.incidentsUnavailable ? 'Not published' : 'Not loaded') : m?.ratePer1k == null ? 'Too few residents' : relativeWords(m.cityPercentile, dataset.name).replace(` in ${dataset.name}`, '').replace(` ${dataset.name}`, '')}</div>
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  ev: Evaluation;
  dataset: CityDataset;
  selected: boolean;
  saved: boolean;
  comparing: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onToggleSave: (id: string) => void;
  onToggleCompare: (id: string) => void;
}

export const ResultCard = memo(function ResultCard({ ev, dataset, selected, saved, comparing, onSelect, onHover, onToggleSave, onToggleCompare }: Props) {
  const h = ev.hood;
  const failing = ev.checks.filter((c) => c.passes === false);
  const commute = ev.commutes.length ? ev.commutes.reduce((a, b) => (b.minutes > a.minutes ? b : a)) : null;
  const a = h.amenities;
  return (
    <article
      id={`result-${h.id}`}
      className={`result ${selected ? 'is-selected' : ''} ${failing.length ? 'is-failing' : ''}`}
      onClick={() => onSelect(h.id)}
      onMouseEnter={() => onHover(h.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(h.id)}
      aria-labelledby={`name-${h.id}`}
    >
      <div className="result-top">
        <div style={{ minWidth: 0 }}>
          <Link id={`name-${h.id}`} to={`/${dataset.city}/n/${h.id}`} className="result-name" onClick={(e) => e.stopPropagation()}>
            {h.name}
          </Link>
          <div className="result-district">{[h.district, `${int(h.population)} residents`].filter(Boolean).join(' · ')}</div>
        </div>
        <FitFigure ev={ev} />
      </div>

      <div className="result-figures">
        <div>
          <div className="figure-label">Rent benchmark</div>
          <div className="figure-value num">{ev.rent ? <>{money(ev.rent.shareGross)}<span className="unit"> /mo</span></> : <span className="dash">—</span>}</div>
          <div className="figure-note">{ev.rent ? (ev.rent.source === 'safmr' ? 'HUD FY2026, gross' : 'ACS 2020–24, gross') : 'Not published'}</div>
        </div>
        <div>
          <div className="figure-label">Est. monthly total</div>
          <div className="figure-value num">{ev.cost ? <>{money(ev.cost.total)}<span className="unit"> /mo</span></> : <span className="dash">—</span>}</div>
          <div className="figure-note">{ev.cost?.shareOfTakeHome != null ? `${Math.round(ev.cost.shareOfTakeHome * 100)}% of take-home` : 'Rent, bills, commute'}</div>
        </div>
        <div>
          <div className="figure-label">Commute</div>
          <div className="figure-value num">{commute ? <>≈ {commute.minutes}<span className="unit"> min</span></> : <span className="dash">—</span>}</div>
          <div className="figure-note">{commute ? `${commute.variant === 'walk' ? 'Walking' : commute.variant === 'rail' ? 'Rail' : commute.variant === 'bus' ? 'Bus' : MODE_LABELS[commute.mode]} · ${commute.distanceKm.toFixed(1)} km` : 'No destination'}</div>
        </div>
      </div>

      {failing.length ? (
        <ul className="reasons" style={{ gap: 2 }}>
          {failing.map((c) => (
            <li key={c.id} className="fail-reason" style={{ paddingLeft: 0 }}>
              <b>Over your {c.id === 'commute' ? 'commute limit' : c.id === 'rent' ? 'rent limit' : 'housing budget'}</b> by {c.id === 'commute' ? `${c.overBy} min` : money(c.overBy)}. {c.detail}.
            </li>
          ))}
        </ul>
      ) : (
        <>
          {ev.reasons.length ? (
            <ul className="reasons" aria-label="Why it matches">
              {ev.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          ) : null}
          <p className="tradeoff"><b>Tradeoff:</b> {ev.tradeoff}</p>
        </>
      )}

      <IncidentIndexLine ev={ev} dataset={dataset} />
      <IncidentStrip ev={ev} dataset={dataset} />

      {a ? (
        <p className="small muted">
          {plural(a.grocery, 'grocery', 'groceries')} · {plural(a.parks, 'park', 'parks')} · {plural(a.restaurants, 'restaurant or café', 'restaurants and cafés')} · {h.nearestRailM != null ? `rail ${h.nearestRailM < 1000 ? `${Math.round(h.nearestRailM / 10) * 10} m` : `${(h.nearestRailM / 1000).toFixed(1)} km`}` : 'no rail data'}
        </p>
      ) : (
        <p className="small muted">Amenity data not loaded for this area</p>
      )}

      <div className="result-actions" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="btn btn-small" aria-pressed={saved} aria-label={`Save ${h.name}`} title={saved ? 'Saved' : 'Save'} onClick={() => onToggleSave(h.id)}>
          <Icon name="saved" size={16} filled={saved} /> <span className="btn-text">{saved ? 'Saved' : 'Save'}</span>
        </button>
        <button type="button" className="btn btn-small" aria-pressed={comparing} aria-label={`Compare ${h.name}`} title={comparing ? 'In compare' : 'Compare'} onClick={() => onToggleCompare(h.id)}>
          <Icon name={comparing ? 'check' : 'compare'} size={16} /> <span className="btn-text">{comparing ? 'Comparing' : 'Compare'}</span>
        </button>
        <span className="spacer" />
        <a className="btn btn-small btn-ghost" href={zillowRentalsUrl(h, dataset)} target="_blank" rel="noopener noreferrer" aria-label={`Rentals in ${h.name} on Zillow (opens in a new tab)`}>
          Zillow <Icon name="external" size={14} />
        </a>
        <Link className="btn btn-small" to={`/${dataset.city}/n/${h.id}`}>Details</Link>
      </div>
    </article>
  );
});
