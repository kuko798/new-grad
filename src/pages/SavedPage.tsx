import { Link } from 'react-router-dom';
import { money } from '../lib/format.ts';
import { rentFigure } from '../lib/cost.ts';
import type { CityId } from '../lib/types.ts';
import { CITY_NAMES, CITY_ORDER, useCity } from '../state/data.ts';
import { useStore } from '../state/store.tsx';

function CitySaved({ city, ids }: { city: CityId; ids: string[] }) {
  const data = useCity(city);
  const { toggleSaved, prefs } = useStore();
  return (
    <section className="panel" aria-labelledby={`saved-${city}`}>
      <div className="panel-head">
        <h2 id={`saved-${city}`} className="section-title">{CITY_NAMES[city]}</h2>
        <Link className="text-link small" to={`/${city}`}>Open results</Link>
      </div>
      {data.status === 'loading' ? <div className="skeleton" style={{ height: 44 }} /> : null}
      {data.status === 'error' ? <p className="small">Couldn't load names. <button className="btn btn-small" onClick={data.retry}>Retry</button></p> : null}
      {data.status === 'ready' ? (
        <ul className="rows">
          {ids.map((id) => {
            const h = data.data.neighborhoods.find((x) => x.id === id);
            const r = h ? rentFigure(h, prefs) : null;
            return (
              <li key={id} className="kv" style={{ minHeight: 44 }}>
                <span>
                  {h ? <Link className="result-name" to={`/${city}/n/${id}`}>{h.name}</Link> : <span className="muted">No longer in the data ({id})</span>}
                  {h ? <span className="small muted"> · {r ? `${money(r.shareGross)}/mo benchmark` : 'rent not published'}</span> : null}
                </span>
                <button className="btn btn-small btn-ghost" onClick={() => toggleSaved(city, id)} aria-label={`Remove ${h?.name ?? id} from saved`}>Remove</button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

export default function SavedPage() {
  const { saved } = useStore();
  const cities = CITY_ORDER.filter((c) => (saved[c] ?? []).length);
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <h1 className="title">Saved neighborhoods</h1>
      <p className="subtitle">Saved in this browser only. Clearing site data removes them.</p>
      <div style={{ marginTop: 20 }}>
        {cities.length ? cities.map((c) => <CitySaved key={c} city={c} ids={saved[c]!} />) : (
          <div className="empty">
            Nothing saved yet. Use Save on any neighborhood to keep it here.
            <Link className="btn" to="/">Choose a city</Link>
          </div>
        )}
      </div>
    </div>
  );
}
