import { cachedSoql, soql, metadata } from '../sources/socrata.ts';
import { addMonths, completeWindowEnd, titleCase } from '../util.ts';
import { add, emptyCounts, type CityAdapter, type IncidentResult, type KindCounts } from './types.ts';

const DOMAIN = 'data.cityofchicago.org';
const CRIMES = 'ijzp-q8t2';

// FBI/NIBRS-style codes the Chicago Police Department attaches to each record.
const VIOLENT = ['01A', '02', '03', '04A', '04B'];
const PROPERTY = ['05', '06', '07', '09'];
const VEHICLE_DESCRIPTIONS = ['THEFT FROM MOTOR VEHICLE', 'BURGLARY FROM MOTOR VEHICLE', 'ATTEMPT THEFT FROM MOTOR VEHICLE'];

const kindWhere = {
  violent: `fbi_code in (${VIOLENT.map((c) => `'${c}'`).join(',')})`,
  property: `fbi_code in (${PROPERTY.map((c) => `'${c}'`).join(',')})`,
  vehicle: `(fbi_code = '07' OR description in (${VEHICLE_DESCRIPTIONS.map((d) => `'${d}'`).join(',')}))`,
};

export const chicago: CityAdapter = {
  id: 'chicago',
  name: 'Chicago',
  state: 'IL',
  geographyLabel: 'Community area',
  coverage: 'All 77 official community areas of the City of Chicago. Suburbs are not covered.',
  counties: ['17031'],
  boundary: {
    domain: DOMAIN,
    dataset: 'igwz-8jzy',
    title: 'Boundaries – Community Areas',
    publisher: 'City of Chicago',
    pageUrl: 'https://data.cityofchicago.org/d/igwz-8jzy',
    license: 'City of Chicago Data Portal Terms of Use',
    toFeature(f) {
      const num = f.properties.area_numbe ?? f.properties.area_num_1;
      const raw = f.properties.community;
      if (!num || !raw) return null;
      const name = raw === 'OHARE' ? "O'Hare" : titleCase(raw);
      return { id: `chi-${Number(num)}`, name, district: null };
    },
  },
  async incidents(): Promise<IncidentResult> {
    const [latest] = await soql<{ max_date: string }>(DOMAIN, CRIMES, { $select: 'max(date) as max_date', $order: 'max_date' });
    const end = completeWindowEnd(latest.max_date);
    const start = addMonths(end, -12);
    const priorStart = addMonths(end, -24);
    const meta = await metadata(DOMAIN, CRIMES);

    let placed = 0;
    let unplaced = 0;
    async function window(from: string, to: string, countUnplaced: boolean): Promise<KindCounts> {
      const counts = emptyCounts();
      for (const kind of ['violent', 'property', 'vehicle'] as const) {
        const rows = await cachedSoql<{ community_area?: string; n: string }>(DOMAIN, CRIMES, {
          $select: 'community_area, count(distinct case_number) as n',
          $where: `date >= '${from}' AND date < '${to}' AND ${kindWhere[kind]}`,
          $group: 'community_area',
          $order: 'community_area',
        });
        for (const r of rows) {
          const n = Number(r.n);
          if (r.community_area && Number(r.community_area) > 0) {
            add(counts[kind], `chi-${Number(r.community_area)}`, n);
            if (countUnplaced && kind !== 'vehicle') placed += n;
          } else if (countUnplaced && kind !== 'vehicle') unplaced += n;
        }
      }
      return counts;
    }

    const current = await window(start, end, true);
    const prior = await window(priorStart, start, false);

    return {
      current,
      prior,
      window: { start, end },
      priorWindow: { start: priorStart, end: start },
      dateBasis: 'occurrence',
      placed,
      unplaced,
      definitions: {
        violent: 'Homicide, criminal sexual assault, robbery, aggravated assault and aggravated battery (FBI codes 01A, 02, 03, 04A, 04B).',
        property: 'Burglary, larceny/theft, motor vehicle theft and arson (FBI codes 05, 06, 07, 09).',
        vehicle: 'Motor vehicle theft (FBI code 07) plus thefts and burglaries from motor vehicles.',
      },
      dedupe: 'Counted as distinct case numbers. Chicago publishes one row per homicide victim, so counting rows would overstate incidents.',
      notes: [
        'Chicago Police Department reported incidents, derived from CLEAR. The portal withholds the most recent seven days, and records are updated as investigations reclassify them.',
        'Locations are shown at block level by the city, and each record carries the community area assigned by the city.',
        'This is reported crime, not calls for service or arrests.',
      ],
      sources: [
        {
          id: 'chicago-crimes',
          name: 'Crimes – 2001 to Present',
          publisher: 'Chicago Police Department via City of Chicago Data Portal',
          url: 'https://data.cityofchicago.org/d/ijzp-q8t2',
          license: meta.license ?? 'City of Chicago Data Portal Terms of Use',
          observationPeriod: `${priorStart} to ${end} (occurrence date)`,
          retrievedAt: new Date().toISOString(),
          updateFrequency: 'Daily, excluding the most recent seven days',
          staleAfterDays: 21,
          status: 'ok',
          notes: meta.dataUpdatedAt ? `Publisher last updated rows ${meta.dataUpdatedAt.slice(0, 10)}.` : undefined,
        },
      ],
    };
  },
};
