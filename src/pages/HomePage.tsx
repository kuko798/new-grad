import { Link, useNavigate } from 'react-router-dom';
import { windowLabel } from '../lib/format.ts';
import type { CityId, DataManifest } from '../lib/types.ts';
import { CITY_NAMES, CITY_ORDER, useManifest } from '../state/data.ts';
import { useStore } from '../state/store.tsx';
import { Mark } from '../components/Icon.tsx';

function Outline({ preview, label }: { preview: DataManifest['cities'][number]['preview']; label: string }) {
  return (
    <svg viewBox={`-2 -2 104 ${preview.height + 4}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}>
      {preview.paths.map((d, i) => (
        <path key={i} d={d} fill="#dce1e7" stroke="#ffffff" strokeWidth={0.35} strokeLinejoin="round" />
      ))}
    </svg>
  );
}

function compact(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} million` : `${Math.round(n / 1000).toLocaleString('en-US')},000`;
}

export function HomePage() {
  const manifest = useManifest();
  const { prefs, setPrefs } = useStore();
  const navigate = useNavigate();
  const byCity = new Map(manifest.status === 'ready' ? manifest.data.cities.map((c) => [c.city, c] as const) : []);

  const choose = (city: CityId) => {
    setPrefs((p) => ({ ...p, city, destinations: p.city === city ? p.destinations : [] }));
    navigate(prefs.onboarded ? `/${city}` : '/start');
  };

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Mark size={24} />
        <span style={{ fontWeight: 700, fontSize: 16 }}>Landing</span>
      </div>
      <section className="home-hero" aria-labelledby="home-title">
        <div>
          <h1 id="home-title" className="home-title">Find neighborhoods that fit your move</h1>
          <p className="home-lede">
            Set your rent limit and commute, then rank neighborhoods in Chicago, New York, San Francisco and Austin by what matters to you. Every
            figure shows its source and date.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 24, flexWrap: 'wrap' }}>
            <Link className="btn btn-primary" to="/start" style={{ height: 40, padding: '0 18px' }}>
              Start with your budget
            </Link>
            {prefs.onboarded && prefs.city ? (
              <Link className="btn" to={`/${prefs.city}`} style={{ height: 40 }}>
                Back to {CITY_NAMES[prefs.city]}
              </Link>
            ) : null}
          </div>
          <p className="muted" style={{ marginTop: 24, maxWidth: '46ch' }}>
            Free, with no account. Your budget, pay and addresses stay in this browser; shared links carry only neighborhood names and priority levels.
          </p>
        </div>

        <div aria-labelledby="cities-title">
          <h2 id="cities-title" className="section-title" style={{ marginBottom: 12 }}>Or choose a city to begin</h2>
          <div className="city-grid">
            {CITY_ORDER.map((c) => {
              const m = byCity.get(c);
              const ready = manifest.status === 'ready';
              return (
                <button key={c} type="button" className={`city-card ${prefs.city === c ? 'is-current' : ''}`} onClick={() => choose(c)} disabled={ready && !m} aria-describedby={`meta-${c}`}>
                  <span className="city-name">{CITY_NAMES[c]}</span>
                  {m ? <Outline preview={m.preview} label={`Outline of the ${m.neighborhoods} covered areas`} /> : <span className="skeleton" style={{ display: 'block', height: 132 }} />}
                  <span id={`meta-${c}`} className="city-meta">
                    {m ? (
                      <>
                        {m.neighborhoods} {m.geographyLabel.toLowerCase()}s · {compact(m.population)} residents
                        <br />
                        {m.incidentWindow ? `Incidents ${windowLabel(m.incidentWindow)}` : 'Incident data unavailable'}
                      </>
                    ) : manifest.status === 'error' ? (
                      'Could not load city data'
                    ) : ready ? (
                      'Data not loaded yet'
                    ) : (
                      'Loading…'
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {manifest.status === 'error' ? (
            <p className="notice" style={{ marginTop: 12 }}>
              City data could not load. <button className="btn btn-small" onClick={manifest.retry}>Try again</button>
            </p>
          ) : null}
        </div>
      </section>

      <section className="how" aria-label="How matching works">
        <div>
          <h2>Your limits come first</h2>
          <p>A neighborhood above your rent limit, or over a commute you mark as a limit, is never shown as a match. When nothing fits, you see which limit is the conflict and what changing it would add.</p>
        </div>
        <div>
          <h2>Then your priorities</h2>
          <p>Fit is a weighted average of the things you rank, each compared within the city. Open any neighborhood to see what each priority added to its score, and change the weights.</p>
        </div>
        <div>
          <h2>Reported incidents, not a safety grade</h2>
          <p>We show police-reported incident rates per resident, and a 0–10 index of them within each city, with dates and coverage. We never label a place safe or dangerous. Missing data is marked as missing, not counted as low.</p>
        </div>
      </section>

      <p className="small muted" style={{ marginTop: 48 }}>
        Data from city open-data portals, the U.S. Census Bureau, HUD and OpenStreetMap contributors. <Link className="text-link" to="/data">Sources and methods</Link>
      </p>
    </div>
  );
}
