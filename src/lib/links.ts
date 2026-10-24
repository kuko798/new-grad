// Outbound rental search and privacy-safe share links.
import { PRIORITY_LABELS, type AmenityKey, type Preferences, type Priority, type SafetyKey } from './prefs.ts';
import type { CityDataset, CityId, Neighborhood } from './types.ts';

/**
 * Zillow's public search accepts a place query in the path ("<place>_rb"). We only put the place in the URL:
 * Zillow's filter parameters are undocumented and change, so price and bedroom filters are listed for the
 * person to apply instead of being guessed. No listing data is fetched or scraped.
 */
export function zillowRentalsUrl(hood: Neighborhood, ds: Pick<CityDataset, 'name' | 'state' | 'city'>): string {
  // Zillow names NYC places by borough ("Greenpoint, Brooklyn"), with Manhattan as "New York".
  const cityName = ds.city === 'nyc' ? (hood.district && hood.district !== 'Manhattan' ? hood.district : 'New York') : ds.name;
  // NTA names carry qualifiers like "(North)"; Zillow's place search ignores them at best.
  const place = hood.name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const query = `${place}, ${cityName}, ${ds.state}`;
  return `https://www.zillow.com/homes/for_rent/${encodeURIComponent(query.replace(/\s+/g, '-')).replace(/%2C/g, ',')}_rb/`;
}

export function zillowFilterHints(prefs: Preferences): string[] {
  const hints: string[] = [];
  if (prefs.maxRent != null) {
    const unitMax = prefs.maxRent * Math.max(1, prefs.people);
    hints.push(`Price: up to $${unitMax.toLocaleString('en-US')}${prefs.people > 1 ? ` for the unit (${prefs.people} people)` : ''}`);
  }
  hints.push(`Beds: ${prefs.bedrooms === 'studio' ? 'Studio' : prefs.bedrooms.replace('br', '') + '+'}`);
  if (prefs.pets) hints.push('Pets: allows dogs or cats');
  if (prefs.hasCar && prefs.needsParking) hints.push('Parking: on-site parking');
  if (prefs.moveDate) hints.push(`Move-in date: ${prefs.moveDate}`);
  return hints;
}

// --- Share links ---------------------------------------------------------------------------------------------
// A shared comparison carries only the city, neighborhood ids and priority levels. Addresses, income, budgets
// and every cost assumption stay on the device that entered them.

const PRIORITY_ORDER: Array<'affordability' | 'commute' | SafetyKey | AmenityKey> = [
  'affordability', 'commute', 'violent', 'property', 'vehicle', 'transit', 'grocery', 'parks', 'restaurants', 'nightlife', 'quiet', 'pets', 'stepFree',
];
const CITY_IDS: CityId[] = ['chicago', 'nyc', 'sf', 'austin'];

export function priorityCode(prefs: Preferences): string {
  return PRIORITY_ORDER.map((k) => {
    if (k === 'affordability' || k === 'commute') return prefs[k];
    if (k === 'violent' || k === 'property' || k === 'vehicle') return prefs.safety[k];
    return prefs.amenities[k];
  }).join('');
}

export function applyPriorityCode(prefs: Preferences, code: string): Preferences {
  if (!/^[0-3]{13}$/.test(code)) return prefs;
  const next: Preferences = { ...prefs, safety: { ...prefs.safety }, amenities: { ...prefs.amenities } };
  PRIORITY_ORDER.forEach((k, i) => {
    const p = Number(code[i]) as Priority;
    if (k === 'affordability' || k === 'commute') next[k] = p;
    else if (k === 'violent' || k === 'property' || k === 'vehicle') next.safety[k] = p;
    else next.amenities[k] = p;
  });
  return next;
}

export function compareShareUrl(origin: string, city: CityId, ids: string[], prefs: Preferences): string {
  const u = new URL('/compare', origin);
  u.searchParams.set('city', city);
  u.searchParams.set('ids', ids.slice(0, 3).join(','));
  u.searchParams.set('p', priorityCode(prefs));
  return u.toString();
}

export interface SharedComparison {
  city: CityId;
  ids: string[];
  priorities: string | null;
}

export function parseCompareParams(params: URLSearchParams): SharedComparison | null {
  const city = params.get('city') as CityId | null;
  if (!city || !CITY_IDS.includes(city)) return null;
  const ids = (params.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-z]{2,4}-[a-z0-9-]+$/i.test(s))
    .slice(0, 3);
  const p = params.get('p');
  return { city, ids, priorities: p && /^[0-3]{13}$/.test(p) ? p : null };
}

export const describePriority = (p: Priority) => PRIORITY_LABELS[p];
