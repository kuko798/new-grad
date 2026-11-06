import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cityInfo } from '../lib/cities.ts';
import type { CityId, DataManifest } from '../lib/types.ts';
import { CITY_NAMES, CITY_ORDER, useManifest } from '../state/data.ts';
import { useStore } from '../state/store.tsx';
import { Icon, Mark } from '../components/Icon.tsx';

function Outline({ preview }: { preview: DataManifest['cities'][number]['preview'] }) {
  return <svg viewBox={`-2 -2 104 ${preview.height + 4}`} aria-hidden="true">{preview.paths.map((d, i) => <path key={i} d={d} strokeWidth={0.4} strokeLinejoin="round" />)}</svg>;
}
export function HomePage() {
  const manifest = useManifest();
  const { prefs, setPrefs } = useStore();
  const navigate = useNavigate();
  const byCity = new Map(manifest.status === 'ready' ? manifest.data.cities.map(c => [c.city, c] as const) : []);
  const neighborhoodCount = manifest.status === 'ready' ? manifest.data.cities.reduce((sum, c) => sum + c.neighborhoods, 0) : null;
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const q = query.trim().toLowerCase();
  const matching = CITY_ORDER.filter(c => !q || [cityInfo(c).name, cityInfo(c).state, cityInfo(c).stateName].some(v => v.toLowerCase().includes(q)));
  const visible = q || showAll ? matching : matching.slice(0, 8);
  const choose = (city: CityId) => {
    setPrefs(p => ({ ...p, city, destinations: p.city === city ? p.destinations : [] }));
    navigate(prefs.onboarded ? `/${city}` : '/start');
  };
  return <div className="corner-home">
    <div className="corner-opening">
      <header className="corner-header">
        <Link to="/" className="corner-brand"><Mark size={26} /><span>Your Next Corner</span></Link>
        <nav aria-label="Discover Your Next Corner"><a href="#cities">Cities</a><a href="#how-it-works">How it works</a><Link to="/data">Our data</Link></nav>
        <Link className="corner-header-action" to={prefs.onboarded && prefs.city ? `/${prefs.city}` : '/start'}>{prefs.onboarded ? 'Your neighborhoods' : 'Find your place'} <Icon name="arrowUpRight" size={18} /></Link>
      </header>
      <section className="corner-hero" aria-labelledby="home-title">
        <h1 id="home-title">Find your <span className="corner-inline-photo"><img src="/images/chicago.jpg" width="1920" height="929" alt="Chicago skyline at dusk" /></span><br />next corner.</h1>
        <div className="corner-intro"><p>A neighborhood finder for life after college. Weigh the rent, the commute, and the everyday before you make your move.</p><div><Link to="/start" className="corner-action">Find my neighborhood <Icon name="arrowUpRight" size={20} /></Link><span className="corner-assurance">Free to explore. No account needed.</span></div></div>
        <figure className="corner-panorama"><img src="/images/chicago.jpg" width="1920" height="929" alt="Chicago buildings and park paths in the evening" /><figcaption><span>A city is only the beginning.</span><span>Chicago, Illinois</span></figcaption></figure>
      </section>
    </div>
    <section id="cities" className="corner-cities" aria-labelledby="cities-title">
      <div className="corner-section-head"><h2 id="cities-title">Start with a city.</h2><p>{CITY_ORDER.length} cities. {neighborhoodCount ? `${neighborhoodCount.toLocaleString()} neighborhoods and areas.` : 'Hundreds of neighborhoods.'}<br />Find a smaller piece of a big place.</p></div>
      <div className="corner-city-search"><label htmlFor="city-search">Where are you headed?</label><div><Icon name="pin" size={22} /><input id="city-search" aria-label="Find a city" type="search" placeholder="Search by city or state" value={query} onChange={e => setQuery(e.target.value)} autoComplete="off" /></div><p aria-live="polite">{q ? `${matching.length} ${matching.length === 1 ? 'city' : 'cities'} found` : 'Cities ordered by new residents in 2024'}</p></div>
      <div className="corner-city-list" data-ui>{visible.map(c => {
        const m = byCity.get(c);
        return <button key={c} type="button" className={`city-card corner-city ${prefs.city === c ? 'is-current' : ''}`} onClick={() => choose(c)} disabled={manifest.status !== 'ready' || !m} aria-describedby={`meta-${c}`}>
          <span className="corner-city-copy"><span className="corner-city-name">{CITY_NAMES[c]}</span><span>{cityInfo(c).stateName}</span><span id={`meta-${c}`}>{m ? `${m.neighborhoods} ${m.geographyKind === 'zcta' ? 'ZIP areas' : 'neighborhoods'}` : manifest.status === 'error' ? 'City data unavailable' : manifest.status === 'ready' ? 'Data not built yet' : 'Loading neighborhoods…'}</span></span>
          <span className="corner-city-map">{m ? <Outline preview={m.preview} /> : null}</span><Icon name="arrowUpRight" size={22} />
        </button>;
      })}</div>
      {!q && matching.length > 8 ? <button className="corner-more" type="button" onClick={() => setShowAll(v => !v)} aria-expanded={showAll}>{showAll ? 'Show fewer cities' : `Explore all ${matching.length} cities`} <Icon name="chevron" size={18} /></button> : null}
      {q && !matching.length ? <p className="corner-empty">No covered city matches “{query}”. Try another city or state.</p> : null}
      {manifest.status === 'error' ? <p className="notice">City data could not load. <button className="btn" onClick={manifest.retry}>Try again</button></p> : null}
    </section>
    <section id="how-it-works" className="corner-how" aria-labelledby="how-title">
      <div className="corner-how-heading"><h2 id="how-title">Picture your<br />everyday.</h2><p>The first job is a big decision.<br />Your neighborhood deserves a little thought, too.</p><Link to="/start" className="corner-action">Find my neighborhood <Icon name="arrowUpRight" size={20} /></Link></div>
      <div className="corner-how-list">
        <article><h3>Room in your budget.</h3><p>Set a monthly rent limit. See which neighborhoods fit, with housing costs and assumptions in plain sight.</p></article>
        <article><h3>A commute that works.</h3><p>Add your workplace or school. Compare travel estimates alongside the places you could call home.</p></article>
        <article><h3>Your kind of nearby.</h3><p>Choose what matters day to day. Adjust your priorities and see how each neighborhood’s fit changes.</p></article>
        <article><h3>A shortlist worth visiting.</h3><p>Save your favorites, compare up to three side by side, and share your shortlist before seeing them in person.</p></article>
      </div>
    </section>
    <section className="corner-perspective" aria-labelledby="perspective-title"><div className="corner-section-head"><h2 id="perspective-title">Look a little closer.</h2><p>From the skyline to your daily walk.<br />The place you choose becomes the life you live.</p></div><div className="corner-photo-story"><figure><img src="/images/street.jpg" width="1920" height="823" loading="lazy" alt="Gowanus Canal and surrounding buildings in Brooklyn" /><figcaption>Gowanus, Brooklyn.</figcaption></figure><figure><img src="/images/waterfront.jpg" width="1920" height="356" loading="lazy" alt="Chicago skyline seen from the waterfront" /><figcaption>Chicago, from the waterfront.</figcaption></figure><figure><img src="/images/sunrise.jpg" width="1920" height="711" loading="lazy" alt="Sunrise over the Chicago skyline" /><figcaption>A new morning in Chicago.</figcaption></figure></div></section>
    <section className="corner-method" aria-labelledby="method-title"><h2 id="method-title">Behind the<br />numbers.</h2><div><p>Every figure has a source and a date. Missing data stays missing. Reported incidents come with context, never a safety grade.</p><p>Your priorities shape the results. Your preferences stay in your browser. The final call is yours.</p><Link to="/data">Read our sources and methods <Icon name="arrowUpRight" size={18} /></Link></div></section>
    <footer className="corner-footer"><div><Link to="/" className="corner-brand"><Mark size={26} />Your Next Corner</Link><a href="#home-title">Back to top ↑</a></div><p>Your next chapter<br />starts somewhere.</p><div><span>Built on open data. Made for your move.</span><Link to="/partners">Property partnerships</Link><Link to="/saved">Saved places</Link><Link to="/compare">Compare</Link><a href="/images/credits.html">Photography credits</a></div></footer>
  </div>;
}
