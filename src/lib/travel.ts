// Distance-based commute estimates. No routing service is called: every estimate is straight-line distance
// stretched by a route factor and divided by an assumed speed, plus walking and waiting time. The basis is
// returned with each estimate so the interface can show exactly how it was made.
import { haversineM } from './geo.ts';
import type { TravelMode } from './prefs.ts';
import type { CityId, LngLat } from './types.ts';

export interface CityTravel {
  /** Assumed door-to-door average driving speed at commute times, km/h. */
  driveKmh: number;
  /** Assumed average rail speed including stops, km/h. */
  railKmh: number;
  busKmh: number;
  fare: number;
  monthlyPass: number;
  passName: string;
  fareUrl: string;
  /** When these fares were last checked by a person; shown next to the figures. */
  faresCheckedAt: string;
}

export const CITY_TRAVEL: Record<CityId, CityTravel> = {
  nyc: { driveKmh: 19, railKmh: 28, busKmh: 12, fare: 2.9, monthlyPass: 132, passName: '30-day unlimited', fareUrl: 'https://www.mta.info/fares', faresCheckedAt: '2025' },
  chicago: { driveKmh: 26, railKmh: 30, busKmh: 14, fare: 2.5, monthlyPass: 75, passName: 'CTA 30-day pass', fareUrl: 'https://www.transitchicago.com/fares/', faresCheckedAt: '2025' },
  sf: { driveKmh: 22, railKmh: 26, busKmh: 12, fare: 3, monthlyPass: 86, passName: 'Muni monthly pass', fareUrl: 'https://www.sfmta.com/fares', faresCheckedAt: '2025' },
  austin: { driveKmh: 34, railKmh: 40, busKmh: 16, fare: 1.25, monthlyPass: 41.25, passName: 'CapMetro 31-day pass', fareUrl: 'https://www.capmetro.org/fares', faresCheckedAt: '2025' },
};

export const ROUTE_FACTOR = { walk: 1.25, bike: 1.3, drive: 1.35, rail: 1.25, bus: 1.35 };
export const WALK_M_PER_MIN = 80; // 4.8 km/h
export const BIKE_KMH = 15;
export const RAIL_WAIT_MIN = 5;
export const BUS_WAIT_MIN = 8;
export const BUS_ACCESS_MIN = 4; // walk to a bus stop at each end
export const TRANSFER_MIN = 5;
export const TRANSFER_OVER_KM = 6;
export const MAX_STATION_WALK_M = 1500;
export const PARK_AND_WALK_MIN = 6;

export interface CommuteEstimate {
  minutes: number;
  mode: TravelMode;
  /** The variant used for transit: rail when both ends are near a station, otherwise bus. */
  variant: 'rail' | 'bus' | 'walk' | 'direct';
  distanceKm: number;
  basis: string;
}

export function nearestDistanceM(p: LngLat, points: LngLat[]): number | null {
  let best = Infinity;
  for (const q of points) {
    const d = haversineM(p, q);
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? best : null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function estimateCommute(
  city: CityId,
  from: LngLat,
  fromRailM: number | null,
  to: LngLat,
  toRailM: number | null,
  mode: TravelMode,
): CommuteEstimate {
  const t = CITY_TRAVEL[city];
  const km = haversineM(from, to) / 1000;
  const dist = `${r1(km)} km straight-line`;

  if (mode === 'walk') {
    const minutes = (km * 1000 * ROUTE_FACTOR.walk) / WALK_M_PER_MIN;
    return { minutes: Math.round(minutes), mode, variant: 'direct', distanceKm: km, basis: `${dist} × ${ROUTE_FACTOR.walk} route factor at 4.8 km/h` };
  }
  if (mode === 'bike') {
    const minutes = ((km * ROUTE_FACTOR.bike) / BIKE_KMH) * 60 + 2;
    return { minutes: Math.round(minutes), mode, variant: 'direct', distanceKm: km, basis: `${dist} × ${ROUTE_FACTOR.bike} at ${BIKE_KMH} km/h, plus 2 min to park the bike` };
  }
  if (mode === 'drive') {
    const minutes = ((km * ROUTE_FACTOR.drive) / t.driveKmh) * 60 + PARK_AND_WALK_MIN;
    return {
      minutes: Math.round(minutes),
      mode,
      variant: 'direct',
      distanceKm: km,
      basis: `${dist} × ${ROUTE_FACTOR.drive} at an assumed ${t.driveKmh} km/h commute-hour average, plus ${PARK_AND_WALK_MIN} min to park and walk`,
    };
  }

  // Transit: the faster of a rail trip (when both ends are within walking distance of a station) and a bus trip.
  const options: CommuteEstimate[] = [];
  if (fromRailM !== null && toRailM !== null && fromRailM <= MAX_STATION_WALK_M && toRailM <= MAX_STATION_WALK_M) {
    const walk = ((fromRailM + toRailM) * ROUTE_FACTOR.walk) / WALK_M_PER_MIN;
    const ride = ((km * ROUTE_FACTOR.rail) / t.railKmh) * 60;
    const transfer = km > TRANSFER_OVER_KM ? TRANSFER_MIN : 0;
    options.push({
      minutes: Math.round(walk + RAIL_WAIT_MIN + ride + transfer),
      mode,
      variant: 'rail',
      distanceKm: km,
      basis: `rail: ${Math.round(fromRailM)} m and ${Math.round(toRailM)} m walks to stations, ${RAIL_WAIT_MIN} min wait, ${dist} × ${ROUTE_FACTOR.rail} at ${t.railKmh} km/h${transfer ? `, ${TRANSFER_MIN} min for a likely transfer` : ''}`,
    });
  }
  const bus = BUS_ACCESS_MIN * 2 + BUS_WAIT_MIN + ((km * ROUTE_FACTOR.bus) / t.busKmh) * 60;
  options.push({
    minutes: Math.round(bus),
    mode,
    variant: 'bus',
    distanceKm: km,
    basis: `bus: ${BUS_ACCESS_MIN} min walk at each end, ${BUS_WAIT_MIN} min wait, ${dist} × ${ROUTE_FACTOR.bus} at ${t.busKmh} km/h`,
  });
  const walkMinutes = (km * 1000 * ROUTE_FACTOR.walk) / WALK_M_PER_MIN;
  if (km < 1.5) options.push({ minutes: Math.round(walkMinutes), mode, variant: 'walk', distanceKm: km, basis: `walk: ${dist} × ${ROUTE_FACTOR.walk} at 4.8 km/h (shorter than waiting for transit)` });
  return options.reduce((a, b) => (b.minutes < a.minutes ? b : a));
}

export const WEEKS_PER_MONTH = 52 / 12;

/** Monthly transport cost for the trips described, with its basis. Car fixed costs only when the person entered them. */
export function monthlyTransportCost(
  city: CityId,
  mode: TravelMode,
  trips: Array<{ distanceKm: number; daysPerWeek: number }>,
  carCostPerKm: number,
  carFixed: number | null,
): { amount: number; basis: string } {
  const t = CITY_TRAVEL[city];
  const roundTrips = trips.reduce((s, x) => s + x.daysPerWeek * WEEKS_PER_MONTH, 0);
  if (roundTrips === 0) return { amount: mode === 'drive' && carFixed ? carFixed : 0, basis: 'No commute days entered' };
  if (mode === 'transit') {
    const payPerRide = roundTrips * 2 * t.fare;
    if (payPerRide <= t.monthlyPass)
      return { amount: Math.round(payPerRide), basis: `${Math.round(roundTrips * 2)} rides × $${t.fare.toFixed(2)} fare (cheaper than the ${t.passName})` };
    return { amount: Math.round(t.monthlyPass), basis: `${t.passName}, $${t.monthlyPass.toFixed(2)}` };
  }
  if (mode === 'drive') {
    const km = trips.reduce((s, x) => s + x.distanceKm * ROUTE_FACTOR.drive * 2 * x.daysPerWeek * WEEKS_PER_MONTH, 0);
    const running = km * carCostPerKm;
    return {
      amount: Math.round(running + (carFixed ?? 0)),
      basis: `${Math.round(km)} km a month × $${carCostPerKm.toFixed(2)}/km running cost${carFixed ? ` + $${carFixed} fixed car costs` : ''}`,
    };
  }
  return { amount: 0, basis: mode === 'bike' ? 'Cycling: no fare counted' : 'Walking: no fare counted' };
}
