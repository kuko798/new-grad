import type { BedroomKey, CityId, LngLat } from './types.ts';

/** 0 = not a factor, 1 = nice to have, 2 = important, 3 = very important. */
export type Priority = 0 | 1 | 2 | 3;
export const PRIORITY_LABELS: Record<Priority, string> = { 0: 'Not a factor', 1: 'Nice to have', 2: 'Important', 3: 'Very important' };
export const PRIORITY_WEIGHTS: Record<Priority, number> = { 0: 0, 1: 1, 2: 2, 3: 4 };

export type TravelMode = 'transit' | 'drive' | 'bike' | 'walk';
export const MODE_LABELS: Record<TravelMode, string> = { transit: 'Transit', drive: 'Driving', bike: 'Cycling', walk: 'Walking' };

export interface Destination {
  /** Shown only on this device; never put in URLs or sent anywhere except the geocoder at entry time. */
  label: string;
  point: LngLat;
  daysPerWeek: number;
}

export type SafetyKey = 'violent' | 'property' | 'vehicle';
export type AmenityKey = 'transit' | 'grocery' | 'parks' | 'restaurants' | 'nightlife' | 'quiet' | 'pets' | 'stepFree';

export interface CostAssumptions {
  /** Utilities a renter pays on top of contract rent, per unit per month. Benchmarks are gross rents and include these. */
  utilities: number;
  internet: number;
  rentersInsurance: number;
  /** Monthly parking at home; null means not entered and not counted. */
  parking: number | null;
  /** Monthly fixed car costs the person wants counted (insurance, payment); null means not counted. */
  carFixed: number | null;
  carCostPerKm: number;
  otherFees: number;
  petFees: number;
  depositMonths: number;
  brokerFee: number;
  applicationFees: number;
  movingCost: number;
  furnitureCost: number;
}

export interface Preferences {
  city: CityId | null;
  /** Monthly contract rent the person is willing to pay for their share. Always a hard constraint. */
  maxRent: number | null;
  /** Optional ceiling on everything housing-related per month (rent share, utilities, parking, fees). */
  totalHousingBudget: number | null;
  bedrooms: BedroomKey;
  /** People living in the unit, including the person. 1 = living alone. */
  people: number;
  takeHomePay: number | null;
  destinations: Destination[];
  /** 0–1: how much the first destination counts when there are two. */
  destinationBalance: number;
  maxCommute: number;
  commuteHard: boolean;
  mode: TravelMode;
  hasCar: boolean;
  needsParking: boolean;
  moveDate: string | null;
  pets: boolean;
  affordability: Priority;
  commute: Priority;
  safety: Record<SafetyKey, Priority>;
  amenities: Record<AmenityKey, Priority>;
  assumptions: CostAssumptions;
  onboarded: boolean;
}

export const DEFAULT_UTILITIES: Record<BedroomKey, number> = { studio: 110, br1: 130, br2: 170, br3: 210 };

export function defaultAssumptions(bedrooms: BedroomKey = 'br1'): CostAssumptions {
  return {
    utilities: DEFAULT_UTILITIES[bedrooms],
    internet: 60,
    rentersInsurance: 15,
    parking: null,
    carFixed: null,
    carCostPerKm: 0.14,
    otherFees: 0,
    petFees: 0,
    depositMonths: 1,
    brokerFee: 0,
    applicationFees: 0,
    movingCost: 0,
    furnitureCost: 0,
  };
}

export function defaultPreferences(): Preferences {
  return {
    city: null,
    maxRent: null,
    totalHousingBudget: null,
    bedrooms: 'br1',
    people: 1,
    takeHomePay: null,
    destinations: [],
    destinationBalance: 0.5,
    maxCommute: 45,
    commuteHard: true,
    mode: 'transit',
    hasCar: false,
    needsParking: false,
    moveDate: null,
    pets: false,
    affordability: 2,
    commute: 2,
    safety: { violent: 2, property: 1, vehicle: 0 },
    amenities: { transit: 1, grocery: 1, parks: 1, restaurants: 0, nightlife: 0, quiet: 0, pets: 0, stepFree: 0 },
    assumptions: defaultAssumptions('br1'),
    onboarded: false,
  };
}

export const BEDROOM_LABELS: Record<BedroomKey, string> = { studio: 'Studio', br1: '1 bedroom', br2: '2 bedrooms', br3: '3 bedrooms' };
export const BEDROOM_SHORT: Record<BedroomKey, string> = { studio: 'studio', br1: '1-bed', br2: '2-bed', br3: '3-bed' };
