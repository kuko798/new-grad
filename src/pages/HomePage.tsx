import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cityInfo } from '../lib/cities.ts';
import { windowLabel, labelText } from '../lib/format.ts';
import type { CityId, DataManifest } from '../lib/types.ts';
import { CITY_NAMES, CITY_ORDER, useManifest } from '../state/data.ts';
import { useStore } from '../state/store.tsx';
import { Icon, Mark } from '../components/Icon.tsx';
import { NeighborhoodScene } from '../components/NeighborhoodScene.tsx';

/** Hand-written lines for the first four cities; the others show facts from their data. */
const CITY_DETAILS: Record<CityId, { state: string; character: string; coordinates: string }> = {
  chicago: { state: 'Illinois', character: 'Big city. Neighborhood soul.', coordinates: '41.8781° N · 87.6298° W' },
  nyc: { state: 'New York', character: 'A world on every block.', coordinates: '40.7128° N · 74.0060° W' },
  sf: { state: 'California', character: 'Find your side of the hill.', coordinates: '37.7749° N · 122.4194° W' },
  austin: { state: 'Texas', character: 'A little more room to be you.', coordinates: '30.2672° N · 97.7431° W' },
};

const FEATURED = 8;

function coordinates(center: [number, number] | undefined) {
  if (!center) return '';
  const [lng, lat] = center;
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'} · ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`;
}

function Outline({ preview }: { preview: DataManifest['cities'][number]['preview'] }) {
  return <svg viewBox={`-2 -2 104 ${preview.height + 4}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">{preview.paths.map((d, i) => <path key={i} d={d} strokeWidth={0.4} strokeLinejoin="round" />)}</svg>;
}

export function HomePage() {
  const manifest = useManifest();
  const { prefs, setPrefs } = useStore();
  const navigate = useNavigate();
  const byCity = new Map(manifest.status === 'ready' ? manifest.data.cities.map((c) => [c.city, c] as const) : []);
  const neighborhoodCount = manifest.status === 'ready' ? manifest.data.cities.reduce((sum, city) => sum + city.neighborhoods, 0) : null;
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const q = query.trim().toLowerCase();
  const matching = CITY_ORDER.filter((c) => {
    if (!q) return true;
    const info = cityInfo(c);
    return [info.name, info.state, info.stateName].some((v) => v.toLowerCase().includes(q));
  });
  const visible = q || showAll ? matching : matching.slice(0, FEATURED);
  const cityCount = CITY_ORDER.length;
  const choose = (city: CityId) => {
    setPrefs((p) => ({ ...p, city, destinations: p.city === city ? p.destinations : [] }));
    navigate(prefs.onboarded ? `/${city}` : '/start');
  };

  return (
    <div className="home-page">
      <header className="home-header">
        <Link to="/" className="wordmark" aria-label="Your Next Corner home"><Mark size={30} />Your Next Corner<span className="wordmark-period">.</span></Link>
        <nav className="home-nav" aria-label="Discover Your Next Corner"><a href="#cities">Explore cities</a><a href="#how-it-works">How it works</a><Link to="/data">Our approach <Icon name="external" size={13} /></Link></nav>
        <Link to={prefs.onboarded && prefs.city ? `/${prefs.city}` : '/start'} className="btn home-header-cta">{prefs.onboarded ? 'Your neighborhoods' : 'Find your place'}<Icon name="chevron" size={15} /></Link>
      </header>

      <section className="home-hero" aria-labelledby="home-title">
        <div className="hero-copy">
          <p className="eyebrow"><span className="status-dot" /> A fresh start, a little more clarity</p>
          <h1 id="home-title" className="home-title">A new city.<br />A new chapter.<br /><em>Your kind of place.</em></h1>
          <p className="home-lede">The right neighborhood changes everything. Find the one that fits your budget, your commute, and the way you want to live.</p>
          <div className="hero-actions"><Link className="btn btn-primary hero-cta" to="/start">Find my neighborhood <Icon name="chevron" size={18} /></Link><a className="hero-secondary" href="#cities">Explore the cities <Icon name="arrowUpRight" size={13} /></a></div>
          <div className="hero-assurance"><Icon name="check" size={15} /><span>Free to explore</span><span className="assurance-dot">·</span><span>No account needed</span><span className="assurance-dot">·</span><span>Always your call</span></div>
        </div>
        <div className="hero-art">
          <div className="art-topline"><span>THE ART OF FEELING AT HOME</span><Icon name="arrowUpRight" size={13} /></div>
          <NeighborhoodScene />
          <div className="art-caption"><span>A shorter commute.<br />A favorite corner café.<br /><strong>A place that feels like you.</strong></span><span className="art-compass" aria-hidden="true">N<Icon name="arrowUp" size={25} /></span></div>
          <div className="art-note"><span className="art-note-icon"><Icon name="pin" size={20} /></span><span>More than a pin on a map.<strong>Find your everyday.</strong></span></div>
        </div>
      </section>

      <div className="trust-strip"><p>BIG LIFE DECISION.<br /><strong>A clearer place to start.</strong></p><div><Icon name="map" size={20} /><span><strong>{cityCount} cities</strong> to make your own</span></div><div><Icon name="pin" size={20} /><span><strong>{neighborhoodCount ?? 'Hundreds of'} neighborhoods</strong> to discover</span></div><div><Icon name="data" size={20} /><span><strong>Real, sourced data.</strong> Clearly explained.</span></div></div>

      <section id="cities" className="cities-section" aria-labelledby="cities-title">
        <div className="section-heading"><div><p className="eyebrow">{cityCount} CITIES. ENDLESS POSSIBILITIES.</p><h2 id="cities-title">Where’s your next chapter?</h2></div><p>Different rhythms. Different possibilities.<br />Let’s find where you fit.</p></div>
        <div className="city-search">
          <label htmlFor="city-search" className="sr-only">Find a city</label>
          <input id="city-search" className="input" type="search" placeholder={`Search ${cityCount} cities by name or state`} value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
          <span className="small muted" aria-live="polite">{q ? `${matching.length} ${matching.length === 1 ? 'city' : 'cities'}` : 'Ordered by new residents in 2024'}</span>
        </div>
        <div className="city-grid">
          {visible.map((c) => {
            const i = CITY_ORDER.indexOf(c);
            const m = byCity.get(c);
            const info = cityInfo(c);
            const detail = CITY_DETAILS[c] ?? {
              state: info.stateName,
              coordinates: coordinates(m?.center),
              character: m
                ? `${m.geographyKind === 'zcta' ? 'ZIP code areas' : `${m.neighborhoods} ${labelText(m.geographyLabel)}s`} · ${m.incidentWindow ? `incidents through ${windowLabel(m.incidentWindow).split(' – ')[1]}` : 'incident data not published'}`
                : '',
            };
            return (
              <button key={c} type="button" className={`city-card city-${c} ${prefs.city === c ? 'is-current' : ''}`} onClick={() => choose(c)} disabled={manifest.status !== 'ready' || !m} aria-describedby={`meta-${c}`}>
                <span className="city-card-heading"><span className="city-name">{CITY_NAMES[c]}</span><span className="city-arrow" aria-hidden="true"><Icon name="chevron" size={17} /></span></span>
                <span className="city-state">{detail.state}</span>
                <span className="city-art"><span className="city-index" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>{m ? <Outline preview={m.preview} /> : <span className="skeleton" />}<span className="city-coordinates">{detail.coordinates}</span></span>
                <span className="city-character">{detail.character}</span>
                <span id={`meta-${c}`} className="city-meta">{m ? `${m.neighborhoods} ${m.geographyKind === 'zcta' ? 'ZIP areas' : 'neighborhoods'} to explore` : manifest.status === 'error' ? 'City data unavailable' : manifest.status === 'ready' ? 'Data not built yet' : 'Loading neighborhoods…'}<Icon name="arrowUpRight" size={13} /></span>
                {m?.incidentWindow ? <span className="sr-only">Reported incidents: {windowLabel(m.incidentWindow)}</span> : null}
              </button>
            );
          })}
        </div>
        {!q && matching.length > FEATURED ? (
          <div className="city-more">
            <button type="button" className="btn" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>{showAll ? 'Show fewer cities' : `Show all ${matching.length} cities`}</button>
          </div>
        ) : null}
        {q && !matching.length ? <p className="empty" style={{ marginTop: 12 }}>No covered city matches “{query}”.</p> : null}
        {manifest.status === 'error' ? <p className="notice">City data could not load. <button className="btn btn-small" onClick={manifest.retry}>Try again</button></p> : null}
      </section>

      <section id="how-it-works" className="how-section" aria-labelledby="how-title">
        <div className="section-heading"><div><p className="eyebrow">LESS OVERWHELM. MORE POSSIBILITY.</p><h2 id="how-title">Your move, made a little simpler.</h2></div><Link to="/start" className="text-link">Let’s get started <Icon name="arrowUpRight" size={13} /></Link></div>
        <div className="how">
          <article><span className="how-number">01 <Icon name="sliders" size={22} /></span><h3>Start with your everyday.</h3><p>Your rent limit. Your commute. The things you’d love around the corner. Tell us what matters, and what’s non-negotiable.</p><span className="how-tag">Your life sets the brief</span></article>
          <article><span className="how-number">02 <Icon name="map" size={22} /></span><h3>Meet your neighborhoods.</h3><p>Explore places that fit your limits, ranked by your priorities. See the trade-offs clearly, and adjust as you go.</p><span className="how-tag">A fit you can actually explain</span></article>
          <article><span className="how-number">03 <Icon name="saved" size={22} /></span><h3>Make your shortlist.</h3><p>Save the places you love, compare up to three side by side, and share your favorites. The next chapter is yours to choose.</p><span className="how-tag">From “what if” to “this could be it”</span></article>
        </div>
      </section>

      <section className="method-banner" aria-labelledby="method-title"><div className="method-symbol" aria-hidden="true"><Icon name="data" size={38} /></div><div><p className="eyebrow">A LITTLE TRANSPARENCY GOES A LONG WAY</p><h2 id="method-title">Real places. Real data. An honest picture.</h2><p>Every figure has a source and a date. Missing data stays missing. Reported incidents are shown with context, never as a safety grade. Your preferences are saved in your browser.</p></div><Link to="/data" className="btn">Behind the numbers <Icon name="chevron" size={16} /></Link></section>

      <footer className="home-footer"><div><Link to="/" className="wordmark"><Mark size={24} />Your Next Corner<span className="wordmark-period">.</span></Link><p>A better place to begin.</p></div><p>Built on open data. Made for your next chapter.<br /><Link to="/data" className="text-link">Sources, methods & limitations <Icon name="arrowUpRight" size={13} /></Link></p><a href="#home-title" className="back-top">Back to top <Icon name="arrowUp" size={13} /></a></footer>
    </div>
  );
}
