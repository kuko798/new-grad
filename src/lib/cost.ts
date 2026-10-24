// Monthly and move-in costs. Every line says whether it is a sourced benchmark, a default assumption the person
// can edit, or a figure the person entered, so the total never hides where a number came from.
import { BEDROOM_SHORT, type Preferences } from './prefs.ts';
import { monthlyTransportCost } from './travel.ts';
import type { CityId, Neighborhood } from './types.ts';

export type CostKind = 'sourced' | 'assumption' | 'entered' | 'estimate';

export interface CostLine {
  id: string;
  label: string;
  amount: number;
  kind: CostKind;
  note: string;
}

export interface RentFigure {
  /** Gross rent for the whole unit (rent + utilities). */
  unitGross: number;
  /** The person's share of gross rent. */
  shareGross: number;
  source: 'safmr' | 'acs';
  label: string;
  topCoded: boolean;
}

/**
 * The benchmark a newcomer should plan against: HUD's Small Area FMR (recent movers, 40th percentile) where it
 * exists, otherwise the ACS median that all current renters pay, which is lower than asking rents.
 */
export function rentFigure(hood: Neighborhood, prefs: Pick<Preferences, 'bedrooms' | 'people'>): RentFigure | null {
  const people = Math.max(1, prefs.people);
  const s = hood.safmr?.byBedroom[prefs.bedrooms];
  if (s != null) {
    return { unitGross: s, shareGross: Math.round(s / people), source: 'safmr', label: `HUD FY2026 Small Area FMR, ${BEDROOM_SHORT[prefs.bedrooms]}`, topCoded: false };
  }
  const a = hood.rent?.byBedroom[prefs.bedrooms];
  if (a != null) {
    return {
      unitGross: a,
      shareGross: Math.round(a / people),
      source: 'acs',
      label: `ACS 2020–2024 median gross rent, ${BEDROOM_SHORT[prefs.bedrooms]}`,
      topCoded: Boolean(hood.rent?.topCoded[prefs.bedrooms]),
    };
  }
  return null;
}

/** What the person's rent limit allows in benchmark terms: their rent plus their share of utilities. */
export function grossLimit(prefs: Pick<Preferences, 'maxRent' | 'people' | 'assumptions'>): number | null {
  if (prefs.maxRent == null) return null;
  return prefs.maxRent + Math.round(prefs.assumptions.utilities / Math.max(1, prefs.people));
}

export interface MonthlyCost {
  lines: CostLine[];
  total: number;
  /** Housing-only total (rent, utilities, internet, insurance, parking, fees), compared with the total housing budget. */
  housing: number;
  shareOfTakeHome: number | null;
  missing: string[];
}

export function monthlyCost(
  city: CityId,
  hood: Neighborhood,
  prefs: Preferences,
  trips: Array<{ distanceKm: number; daysPerWeek: number }>,
): MonthlyCost | null {
  const rent = rentFigure(hood, prefs);
  if (!rent) return null;
  const a = prefs.assumptions;
  const people = Math.max(1, prefs.people);
  const share = (n: number) => Math.round(n / people);
  const lines: CostLine[] = [
    {
      id: 'rent',
      label: people > 1 ? `Rent and utilities, your share of ${people}` : 'Rent and utilities',
      amount: rent.shareGross,
      kind: 'sourced',
      note: `${rent.label} for ${hood.name}. Gross rent already includes typical utilities.`,
    },
    { id: 'internet', label: 'Internet', amount: share(a.internet), kind: 'assumption', note: `$${a.internet} a month per household${people > 1 ? ', split' : ''}` },
    { id: 'insurance', label: "Renter's insurance", amount: a.rentersInsurance, kind: 'assumption', note: 'Typical basic policy' },
  ];
  const missing: string[] = [];
  if (prefs.hasCar && prefs.needsParking) {
    if (a.parking != null) lines.push({ id: 'parking', label: 'Parking at home', amount: a.parking, kind: 'entered', note: 'Your figure' });
    else missing.push('parking at home');
  }
  if (a.petFees > 0) lines.push({ id: 'pet', label: 'Pet rent and fees', amount: a.petFees, kind: 'entered', note: 'Your figure' });
  if (a.otherFees > 0) lines.push({ id: 'other', label: 'Other recurring fees', amount: a.otherFees, kind: 'entered', note: 'Your figure' });

  const housing = lines.reduce((s, l) => s + l.amount, 0);

  const mode = prefs.hasCar || prefs.mode !== 'drive' ? prefs.mode : 'transit';
  const transport = monthlyTransportCost(city, mode, trips, a.carCostPerKm, prefs.hasCar ? a.carFixed : null);
  if (trips.length) {
    lines.push({ id: 'transport', label: 'Commuting', amount: transport.amount, kind: 'estimate', note: transport.basis });
  } else missing.push('commute (add a destination)');
  if (prefs.hasCar && a.carFixed == null && mode === 'drive') missing.push('fixed car costs (insurance, payments)');

  const total = lines.reduce((s, l) => s + l.amount, 0);
  return {
    lines,
    total,
    housing,
    shareOfTakeHome: prefs.takeHomePay ? total / prefs.takeHomePay : null,
    missing,
  };
}

export interface MoveInCost {
  lines: CostLine[];
  total: number;
  notes: string[];
}

const DEPOSIT_NOTES: Record<CityId, string> = {
  nyc: 'New York State caps security deposits at one month and application fees at $20. Under the FARE Act (2025), landlords pay the fee of a broker they hired.',
  sf: 'California limits most security deposits to one month of rent (AB 12, from July 2024).',
  chicago: "Chicago's Residential Landlord and Tenant Ordinance governs deposits and requires interest on them; it does not cap the amount.",
  austin: 'Texas does not cap security deposits; many Austin listings also charge an application and administrative fee.',
};

export function moveInCost(city: CityId, hood: Neighborhood, prefs: Preferences): MoveInCost | null {
  const rent = rentFigure(hood, prefs);
  if (!rent) return null;
  const a = prefs.assumptions;
  const firstMonth = rent.shareGross - Math.round(a.utilities / Math.max(1, prefs.people));
  const lines: CostLine[] = [
    { id: 'first', label: "First month's rent", amount: firstMonth, kind: 'estimate', note: 'Benchmark share, minus the utilities assumption' },
    { id: 'deposit', label: 'Security deposit', amount: Math.round(firstMonth * a.depositMonths), kind: 'assumption', note: `${a.depositMonths} month${a.depositMonths === 1 ? '' : 's'} of rent` },
  ];
  if (a.brokerFee > 0) lines.push({ id: 'broker', label: 'Broker fee', amount: a.brokerFee, kind: 'entered', note: 'Your figure' });
  if (a.applicationFees > 0) lines.push({ id: 'application', label: 'Application fees', amount: a.applicationFees, kind: 'entered', note: 'Your figure' });
  if (a.movingCost > 0) lines.push({ id: 'moving', label: 'Moving', amount: a.movingCost, kind: 'entered', note: 'Your figure' });
  if (a.furnitureCost > 0) lines.push({ id: 'furniture', label: 'Furniture and setup', amount: a.furnitureCost, kind: 'entered', note: 'Your figure' });
  return { lines, total: lines.reduce((s, l) => s + l.amount, 0), notes: [DEPOSIT_NOTES[city], 'Rules change; check current law before you sign. This is not legal advice.'] };
}
