import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useStore } from '../state/store.tsx';
import { Icon, Mark, type IconName } from './Icon.tsx';
import { CITY_ORDER } from '../state/data.ts';

function RailLink({ to, icon, label, short, count, end }: { to: string; icon: IconName; label: string; short?: string; count?: number; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className="rail-item" aria-label={count ? `${label}, ${count} selected` : label}>
      <Icon name={icon} />
      <span className="rail-label">{short ?? label}</span>
      <span className="tip" aria-hidden="true">{label}</span>
      {count ? <span className="rail-count" aria-hidden="true">{count}</span> : null}
    </NavLink>
  );
}

export function Shell() {
  const { prefs, compare, saved, toast } = useStore();
  const { pathname } = useLocation();
  const savedCount = Object.values(saved).reduce((s, l) => s + (l?.length ?? 0), 0);
  const searchTo = prefs.city ? `/${prefs.city}` : '/start';
  return (
    <div className={`app ${pathname === '/' ? 'app-home' : 'app-planner'}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      <nav className="rail" aria-label="Main">
        <NavLink to="/" className="rail-mark" aria-label="Your Next Corner home">
          <Mark size={30} />
        </NavLink>
        <RailLink to="/" icon="home" label="Home" end />
        <NavLink to={searchTo} className="rail-item" aria-label="Neighborhoods" aria-current={pathname.startsWith('/start') || CITY_ORDER.some(city => pathname === `/${city}` || pathname.startsWith(`/${city}/`)) ? 'page' : undefined}>
          <Icon name="map" />
          <span className="rail-label">Explore</span>
          <span className="tip" aria-hidden="true">Neighborhoods</span>
        </NavLink>
        <RailLink to="/compare" icon="compare" label="Compare" count={compare.ids.length} />
        <RailLink to="/saved" icon="saved" label="Saved" count={savedCount} />
        <span className="rail-spacer" />
        <RailLink to="/data" icon="data" label="Data and methods" short="Data" />
      </nav>
      <main id="main" className="canvas" tabIndex={-1}>
        {pathname !== '/' ? <header className="planner-masthead"><NavLink to="/" className="corner-brand"><Mark size={28} />Your Next Corner</NavLink><NavLink to="/" className="planner-city-link">Change city <Icon name="arrowUpRight" size={16} /></NavLink></header> : null}
        <Outlet />
      </main>
      <div className="sr-only" aria-live="polite">{toast}</div>
      {toast ? (
        <div className="toast" aria-hidden="true">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
