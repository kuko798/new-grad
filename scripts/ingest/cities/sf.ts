import { cachedSoql, soql, metadata } from '../sources/socrata.ts';
import { addMonths, completeWindowEnd } from '../util.ts';
import { add, emptyCounts, slug, type CityAdapter, type IncidentResult, type KindCounts } from './types.ts';

const DOMAIN = 'data.sfgov.org';
const INCIDENTS = 'wg3w-h783';

const list = (xs: string[]) => xs.map((x) => `'${x}'`).join(',');
const kindWhere = {
  violent: `(incident_category in (${list(['Homicide', 'Rape', 'Robbery'])}) OR incident_subcategory = 'Aggravated Assault')`,
  property: `incident_category in (${list(['Burglary', 'Larceny Theft', 'Motor Vehicle Theft', 'Motor Vehicle Theft?', 'Arson'])})`,
  vehicle: `(incident_category in (${list(['Motor Vehicle Theft', 'Motor Vehicle Theft?'])}) OR incident_subcategory in (${list(['Larceny - From Vehicle', 'Theft From Vehicle', 'Larceny - Auto Parts'])}))`,
};

export const sf: CityAdapter = {
  id: 'sf',
  name: 'San Francisco',
  state: 'CA',
  geographyLabel: 'Analysis neighborhood',
  coverage: 'The City and County of San Francisco, using the 41 analysis neighborhoods defined by DataSF. Parkland areas with very few residents are excluded from ranking. Other Bay Area cities are not covered.',
  counties: ['06075'],
  boundary: {
    domain: DOMAIN,
    dataset: 'j2bu-swwd',
    title: 'Analysis Neighborhoods',
    publisher: 'DataSF',
    pageUrl: 'https://data.sfgov.org/d/j2bu-swwd',
    license: 'Open Data Commons Public Domain Dedication and License (PDDL)',
    toFeature(f) {
      const name = f.properties.nhood;
      return name ? { id: `sf-${slug(name)}`, name, district: null } : null;
    },
  },
  async incidents(ctx): Promise<IncidentResult> {
    const [latest] = await soql<{ m: string }>(DOMAIN, INCIDENTS, { $select: 'max(report_datetime) as m', $order: 'm' });
    const end = completeWindowEnd(latest.m);
    const start = addMonths(end, -12);
    const priorStart = addMonths(end, -24);
    const meta = await metadata(DOMAIN, INCIDENTS);

    let placed = 0;
    let unplaced = 0;
    async function window(from: string, to: string, countUnplaced: boolean): Promise<KindCounts> {
      const counts = emptyCounts();
      for (const kind of ['violent', 'property', 'vehicle'] as const) {
        const rows = await cachedSoql<{ analysis_neighborhood?: string; n: string }>(DOMAIN, INCIDENTS, {
          $select: 'analysis_neighborhood, count(distinct incident_id) as n',
          // Initial reports only (II, VI); supplements (IS, VS) update an incident already counted.
          $where: `report_datetime >= '${from}' AND report_datetime < '${to}' AND report_type_code in ('II','VI') AND ${kindWhere[kind]}`,
          $group: 'analysis_neighborhood',
          $order: 'analysis_neighborhood',
        });
        for (const r of rows) {
          const n = Number(r.n);
          const id = r.analysis_neighborhood ? ctx.nameToNeighborhood(r.analysis_neighborhood) : null;
          if (id) {
            add(counts[kind], id, n);
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
      dateBasis: 'report',
      placed,
      unplaced,
      definitions: {
        violent: 'Homicide, rape, robbery and aggravated assault. Simple assault is excluded.',
        property: 'Burglary, larceny/theft, motor vehicle theft and arson.',
        vehicle: 'Motor vehicle theft plus larceny from vehicles and of auto parts.',
      },
      dedupe: 'Counted as distinct incident IDs from initial reports only. SFPD publishes one row per offense and adds supplemental reports, so counting rows would double count.',
      notes: [
        'San Francisco Police Department incident reports, including reports filed online. Records are placed by SFPD in an analysis neighborhood; records without a location are not placed.',
        'Incident reports are not calls for service or arrests.',
      ],
      sources: [
        {
          id: 'sf-incidents',
          name: 'Police Department Incident Reports: 2018 to Present',
          publisher: 'San Francisco Police Department via DataSF',
          url: 'https://data.sfgov.org/d/wg3w-h783',
          license: meta.license ?? 'Open Data Commons PDDL',
          observationPeriod: `${priorStart} to ${end} (report date)`,
          retrievedAt: new Date().toISOString(),
          updateFrequency: 'Daily',
          staleAfterDays: 21,
          status: 'ok',
          notes: meta.dataUpdatedAt ? `Publisher last updated rows ${meta.dataUpdatedAt.slice(0, 10)}.` : undefined,
        },
      ],
    };
  },
};
