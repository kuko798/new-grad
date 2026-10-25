// Every covered city, shared by the app and the ingestion pipeline. Ordered by the number of new residents in
// 2024 (Visual Capitalist ranking of Census migration estimates), which is also the order on the home page.
//
// Travel figures are assumptions used by the distance-based commute model (src/lib/travel.ts). Fares are each
// agency's standard adult fare and monthly pass or cap as published in 2025; a fare of 0 means the agency was
// fare-free. They are shown as assumptions and should be checked against the linked fare page.

export interface CityTravel {
  /** Assumed door-to-door average driving speed at commute times, km/h. */
  driveKmh: number;
  /** Assumed average rail speed including stops, km/h. */
  railKmh: number;
  busKmh: number;
  fare: number;
  /** Monthly pass or monthly fare cap; null when the agency offers neither. */
  monthlyPass: number | null;
  passName: string;
  agency: string;
  fareUrl: string;
  faresCheckedAt: string;
}

export interface CityInfo {
  id: string;
  name: string;
  state: string;
  stateName: string;
  travel: CityTravel;
}

type T = CityTravel;
const t = (agency: string, fare: number, monthlyPass: number | null, passName: string, fareUrl: string, driveKmh: number, railKmh = 30, busKmh = 15, faresCheckedAt = '2025'): T => ({
  agency, fare, monthlyPass, passName, fareUrl, driveKmh, railKmh, busKmh, faresCheckedAt,
});

export const CITIES: CityInfo[] = [
  { id: 'nyc', name: 'New York City', state: 'NY', stateName: 'New York', travel: t('MTA', 2.9, 132, '30-day unlimited', 'https://www.mta.info/fares', 19, 28, 12) },
  { id: 'la', name: 'Los Angeles', state: 'CA', stateName: 'California', travel: t('LA Metro', 1.75, 78, 'weekly fare cap ($18), about a month', 'https://www.metro.net/riding/fares/', 24, 32, 15) },
  { id: 'houston', name: 'Houston', state: 'TX', stateName: 'Texas', travel: t('METRO', 1.25, null, 'no monthly pass', 'https://www.ridemetro.org/fares', 32, 30, 16) },
  { id: 'chicago', name: 'Chicago', state: 'IL', stateName: 'Illinois', travel: t('CTA', 2.5, 75, 'CTA 30-day pass', 'https://www.transitchicago.com/fares/', 26, 30, 14) },
  { id: 'sanantonio', name: 'San Antonio', state: 'TX', stateName: 'Texas', travel: t('VIA', 1.3, 38, 'VIA 31-day pass', 'https://www.viainfo.net/fares/', 36, 30, 17) },
  { id: 'phoenix', name: 'Phoenix', state: 'AZ', stateName: 'Arizona', travel: t('Valley Metro', 2, 64, '31-day pass', 'https://www.valleymetro.org/how-to-ride/fares', 36, 30, 17) },
  { id: 'austin', name: 'Austin', state: 'TX', stateName: 'Texas', travel: t('CapMetro', 1.25, 41.25, 'CapMetro 31-day pass', 'https://www.capmetro.org/fares', 34, 40, 16) },
  { id: 'philadelphia', name: 'Philadelphia', state: 'PA', stateName: 'Pennsylvania', travel: t('SEPTA', 2.9, 112, 'TransPass (monthly)', 'https://www.septa.org/fares/', 24, 28, 13) },
  { id: 'dallas', name: 'Dallas', state: 'TX', stateName: 'Texas', travel: t('DART', 2.5, 96, 'local monthly pass', 'https://www.dart.org/fare/general-fares-and-overview', 34, 35, 17) },
  { id: 'sandiego', name: 'San Diego', state: 'CA', stateName: 'California', travel: t('MTS', 2.5, 72, 'monthly fare cap', 'https://www.sdmts.com/fares', 32, 30, 16) },
  { id: 'columbus', name: 'Columbus', state: 'OH', stateName: 'Ohio', travel: t('COTA', 2, 62, '31-day pass', 'https://www.cota.com/fares/', 38, 30, 17) },
  { id: 'jacksonville', name: 'Jacksonville', state: 'FL', stateName: 'Florida', travel: t('JTA', 1.75, 50, '31-day pass', 'https://www.jtafla.com/ride-jta/fares/', 40, 30, 18) },
  { id: 'seattle', name: 'Seattle', state: 'WA', stateName: 'Washington', travel: t('King County Metro / Sound Transit', 3, 108, 'ORCA monthly pass ($3 value)', 'https://kingcounty.gov/en/dept/metro/fares-and-payment', 24, 32, 14) },
  { id: 'fortworth', name: 'Fort Worth', state: 'TX', stateName: 'Texas', travel: t('Trinity Metro', 2, 60, 'monthly pass', 'https://ridetrinitymetro.org/fares/', 38, 30, 17) },
  { id: 'charlotte', name: 'Charlotte', state: 'NC', stateName: 'North Carolina', travel: t('CATS', 2.2, 88, '31-day pass', 'https://www.charlottenc.gov/cats/Fares-Passes', 36, 32, 17) },
  { id: 'nashville', name: 'Nashville', state: 'TN', stateName: 'Tennessee', travel: t('WeGo', 2, 60, '31-day pass', 'https://www.wegotransit.com/ride/fares/', 36, 30, 17) },
  { id: 'denver', name: 'Denver', state: 'CO', stateName: 'Colorado', travel: t('RTD', 2.75, 88, 'monthly pass', 'https://www.rtd-denver.com/fares-passes', 32, 35, 16) },
  { id: 'sf', name: 'San Francisco', state: 'CA', stateName: 'California', travel: t('Muni', 3, 86, 'Muni monthly pass', 'https://www.sfmta.com/fares', 22, 26, 12) },
  { id: 'indianapolis', name: 'Indianapolis', state: 'IN', stateName: 'Indiana', travel: t('IndyGo', 1.75, 60, '31-day pass', 'https://www.indygo.net/fares/', 38, 30, 17) },
  { id: 'boston', name: 'Boston', state: 'MA', stateName: 'Massachusetts', travel: t('MBTA', 2.4, 90, 'monthly LinkPass', 'https://www.mbta.com/fares', 20, 28, 12) },
  { id: 'okc', name: 'Oklahoma City', state: 'OK', stateName: 'Oklahoma', travel: t('EMBARK', 1.75, 50, '31-day pass', 'https://embarkok.com/fares', 42, 30, 18) },
  { id: 'atlanta', name: 'Atlanta', state: 'GA', stateName: 'Georgia', travel: t('MARTA', 2.5, 95, '30-day pass', 'https://itsmarta.com/fare-programs.aspx', 30, 35, 15) },
  { id: 'tucson', name: 'Tucson', state: 'AZ', stateName: 'Arizona', travel: t('Sun Tran', 0, 0, 'fare-free', 'https://www.suntran.com/fares-passes/', 38, 20, 16) },
  { id: 'portland', name: 'Portland', state: 'OR', stateName: 'Oregon', travel: t('TriMet', 2.8, 100, 'monthly pass', 'https://trimet.org/fares/', 28, 28, 15) },
  { id: 'sanjose', name: 'San Jose', state: 'CA', stateName: 'California', travel: t('VTA', 2.5, 90, 'monthly pass', 'https://www.vta.org/go/fares', 32, 30, 16) },
  { id: 'raleigh', name: 'Raleigh', state: 'NC', stateName: 'North Carolina', travel: t('GoRaleigh', 0, 0, 'fare-free', 'https://goraleigh.org/fares', 38, 30, 17) },
  { id: 'coloradosprings', name: 'Colorado Springs', state: 'CO', stateName: 'Colorado', travel: t('Mountain Metro', 1.75, 63, '31-day pass', 'https://coloradosprings.gov/mountain-metro/page/fares', 40, 30, 18) },
  { id: 'detroit', name: 'Detroit', state: 'MI', stateName: 'Michigan', travel: t('DDOT', 2, 50, '31-day pass', 'https://detroitmi.gov/departments/detroit-department-transportation/fares', 38, 25, 16) },
  { id: 'milwaukee', name: 'Milwaukee', state: 'WI', stateName: 'Wisconsin', travel: t('MCTS', 2, 72, 'monthly fare cap', 'https://www.ridemcts.com/fares', 36, 25, 16) },
  { id: 'lasvegas', name: 'Las Vegas', state: 'NV', stateName: 'Nevada', travel: t('RTC', 2, 65, '30-day pass', 'https://www.rtcsnv.com/ways-to-travel/transit/fares-passes/', 36, 30, 17) },
  { id: 'minneapolis', name: 'Minneapolis', state: 'MN', stateName: 'Minnesota', travel: t('Metro Transit', 2, 76, '31-day pass', 'https://www.metrotransit.org/fares', 32, 30, 15) },
  { id: 'louisville', name: 'Louisville', state: 'KY', stateName: 'Kentucky', travel: t('TARC', 1.75, 50, 'monthly pass', 'https://www.ridetarc.org/fares/', 40, 30, 17) },
  { id: 'albuquerque', name: 'Albuquerque', state: 'NM', stateName: 'New Mexico', travel: t('ABQ RIDE', 0, 0, 'fare-free', 'https://www.cabq.gov/transit/fares-passes', 40, 30, 18) },
  { id: 'memphis', name: 'Memphis', state: 'TN', stateName: 'Tennessee', travel: t('MATA', 1.75, 50, '31-day pass', 'https://www.matatransit.com/fares/', 40, 30, 17) },
  { id: 'omaha', name: 'Omaha', state: 'NE', stateName: 'Nebraska', travel: t('Metro Transit (Omaha)', 1.5, 55, '31-day pass', 'https://ometro.com/fares/', 40, 30, 17) },
  { id: 'baltimore', name: 'Baltimore', state: 'MD', stateName: 'Maryland', travel: t('MTA Maryland', 2, 77, 'monthly pass', 'https://www.mta.maryland.gov/fares', 28, 28, 14) },
  { id: 'mesa', name: 'Mesa', state: 'AZ', stateName: 'Arizona', travel: t('Valley Metro', 2, 64, '31-day pass', 'https://www.valleymetro.org/how-to-ride/fares', 38, 30, 17) },
  { id: 'kansascity', name: 'Kansas City', state: 'MO', stateName: 'Missouri', travel: t('RideKC', 0, 0, 'fare-free (check current fares)', 'https://ridekc.org/fares', 40, 25, 17) },
  { id: 'orlando', name: 'Orlando', state: 'FL', stateName: 'Florida', travel: t('LYNX', 2, 50, '30-day pass', 'https://www.golynx.com/fares-passes/', 36, 30, 16) },
  { id: 'fresno', name: 'Fresno', state: 'CA', stateName: 'California', travel: t('FAX', 1.25, 48, '31-day pass', 'https://www.fresno.gov/transportation/fares/', 40, 30, 17) },
];

const BY_ID = new Map(CITIES.map((c) => [c.id, c] as const));
export const CITY_IDS = CITIES.map((c) => c.id);
export const isCityId = (s: string | undefined | null): s is string => !!s && BY_ID.has(s);
export const cityInfo = (id: string): CityInfo => BY_ID.get(id) ?? { id, name: id, state: '', stateName: '', travel: t('local transit', 2, 60, 'monthly pass', '', 36) };
export const cityName = (id: string) => cityInfo(id).name;

/** Security-deposit and fee notes by state, only where the rule is well established; otherwise a general pointer. */
const DEPOSIT_RULES: Record<string, string> = {
  NY: 'New York State caps security deposits at one month and application fees at $20. Under the FARE Act (2025), landlords in New York City pay the fee of a broker they hired.',
  CA: 'California limits most security deposits to one month of rent (AB 12, from July 2024).',
  MA: 'Massachusetts caps security deposits at one month of rent and requires a separate interest-bearing account. Since August 2025, the party who hires a broker pays the fee.',
  AZ: 'Arizona caps security deposits at one and a half months of rent.',
  NV: 'Nevada caps security deposits at three months of rent.',
  MI: 'Michigan caps security deposits at one and a half months of rent.',
  NC: 'North Carolina caps security deposits at two months of rent for leases longer than two months.',
  PA: 'Pennsylvania caps security deposits at two months of rent in the first year of a lease and one month after that.',
  IL: "Chicago's Residential Landlord and Tenant Ordinance governs deposits and requires interest on them; Illinois does not cap the amount.",
  TX: 'Texas does not cap security deposits; many listings also charge application and administrative fees.',
};

export function depositNote(city: CityInfo): string {
  return DEPOSIT_RULES[city.state] ?? `Deposit limits and fees vary by state; check current ${city.stateName} rules before you sign.`;
}
