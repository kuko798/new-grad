// Offense classification shared by the generic city configs. Most departments now publish FBI NIBRS offense
// codes; the rest publish labels, which are matched with explicit, per-city patterns.
import type { IncidentKind } from '../../../src/lib/types.ts';

// FBI NIBRS Group A codes.
const VIOLENT = new Set(['09A', '11A', '11B', '11C', '120', '13A']);
const PROPERTY = new Set(['200', '220', '23A', '23B', '23C', '23D', '23E', '23F', '23G', '23H', '240']);
const VEHICLE = new Set(['240', '23F', '23G']);

export function nibrsKinds(code: unknown): IncidentKind[] {
  const c = String(code ?? '').trim().toUpperCase();
  const out: IncidentKind[] = [];
  if (VIOLENT.has(c)) out.push('violent');
  if (PROPERTY.has(c)) out.push('property');
  if (VEHICLE.has(c)) out.push('vehicle');
  return out;
}

/** Union of kinds over several codes (a row listing more than one offense). */
export function nibrsKindsAll(codes: unknown[]): IncidentKind[] {
  return [...new Set(codes.flatMap(nibrsKinds))];
}

export const NIBRS_DEFINITIONS: Record<IncidentKind, string> = {
  violent: 'Murder and non-negligent manslaughter, rape, sodomy, sexual assault with an object, robbery and aggravated assault (NIBRS 09A, 11A–11C, 120, 13A).',
  property: 'Burglary, larceny/theft, motor vehicle theft and arson (NIBRS 220, 23A–23H, 240, 200).',
  vehicle: 'Motor vehicle theft, theft from motor vehicles and theft of vehicle parts (NIBRS 240, 23F, 23G).',
};

export interface LabelRules {
  violent: RegExp;
  property: RegExp;
  vehicle: RegExp;
  /** Labels matching this are never counted (for example simple assault inside an "assault" family). */
  exclude?: RegExp;
}

export function labelKinds(label: unknown, rules: LabelRules): IncidentKind[] {
  const s = String(label ?? '').trim();
  if (!s || rules.exclude?.test(s)) return [];
  const out: IncidentKind[] = [];
  if (rules.violent.test(s)) out.push('violent');
  if (rules.property.test(s)) out.push('property');
  if (rules.vehicle.test(s)) out.push('vehicle');
  return out;
}

/** NIBRS offense names as published by agencies that list names instead of codes. */
export const NIBRS_NAME_RULES: LabelRules = {
  violent: /^(murder|rape|sodomy|sexual assault with an object|robbery|aggravated assault)/i,
  property: /^(burglary|pocket-?picking|purse-?snatching|shoplifting|theft from|theft of motor vehicle parts|all other larceny|motor vehicle theft|arson|larceny)/i,
  vehicle: /^(motor vehicle theft|theft from motor vehicle|theft of motor vehicle parts)/i,
  exclude: /statutory rape/i,
};
