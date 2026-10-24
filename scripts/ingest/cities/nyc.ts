import { cachedSoql, soql, metadata } from '../sources/socrata.ts';
import { addMonths, completeWindowEnd } from '../util.ts';
import { add, emptyCounts, type CityAdapter, type IncidentResult, type KindCounts } from './types.ts';

const DOMAIN = 'data.cityofnewyork.us';
// The NYPD splits complaints by report year: historic (through last year) and current year-to-date.
const CURRENT = '5uac-w243';
const HISTORIC = 'qgea-i56i';

const list = (xs: string[]) => xs.map((x) => `'${x}'`).join(',');
const kindWhere = {
  violent: `ky_cd in (${list(['101', '104', '105', '106'])})`,
  property: `ky_cd in (${list(['107', '109', '110', '341', '342', '114'])})`,
  vehicle: `(ky_cd in (${list(['110', '342'])}) OR pd_desc in (${list(['LARCENY,PETIT FROM AUTO', 'LARCENY,PETIT OF VEHICLE ACCES', 'LARCENY,GRAND FROM VEHICLE/MOTORCYCLE'])}))`,
};

export const nyc: CityAdapter = {
  id: 'nyc',
  name: 'New York City',
  state: 'NY',
  geographyLabel: 'Neighborhood Tabulation Area',
  coverage: 'All five boroughs, using the 2020 Neighborhood Tabulation Areas (NTAs) from NYC Planning. Non-residential NTAs (large parks, airports, cemeteries) are not ranked.',
  counties: ['36005', '36047', '36061', '36081', '36085'],
  boundary: {
    domain: DOMAIN,
    dataset: '9nt8-h7nd',
    title: '2020 Neighborhood Tabulation Areas (NTAs)',
    publisher: 'NYC Department of City Planning',
    pageUrl: 'https://data.cityofnewyork.us/d/9nt8-h7nd',
    license: 'NYC Open Data Terms of Use',
    toFeature(f) {
      // ntatype 0 = residential; 5–9 are parks, airports, cemeteries and other special areas.
      if (f.properties.ntatype !== '0') return null;
      return { id: `nyc-${f.properties.nta2020}`, name: f.properties.ntaname, district: f.properties.boroname };
    },
  },
  async incidents(ctx): Promise<IncidentResult> {
    const [latest] = await soql<{ m: string }>(DOMAIN, CURRENT, { $select: 'max(rpt_dt) as m', $order: 'm' });
    const end = completeWindowEnd(latest.m);
    const start = addMonths(end, -12);
    const priorStart = addMonths(end, -24);
    const metaCurrent = await metadata(DOMAIN, CURRENT);

    let placed = 0;
    let unplaced = 0;
    async function window(from: string, to: string, countUnplaced: boolean): Promise<KindCounts> {
      const counts = emptyCounts();
      for (const kind of ['violent', 'property', 'vehicle'] as const) {
        for (const dataset of [HISTORIC, CURRENT]) {
          const rows = await cachedSoql<{ latitude?: string; longitude?: string; n: string }>(DOMAIN, dataset, {
            $select: 'latitude, longitude, count(distinct cmplnt_num) as n',
            $where: `rpt_dt >= '${from}' AND rpt_dt < '${to}' AND ${kindWhere[kind]}`,
            $group: 'latitude, longitude',
            $order: 'latitude, longitude',
          });
          for (const r of rows) {
            const n = Number(r.n);
            const id = r.latitude && r.longitude ? ctx.locatePoint([Number(r.longitude), Number(r.latitude)]) : null;
            if (id) {
              add(counts[kind], id, n);
              if (countUnplaced && kind !== 'vehicle') placed += n;
            } else if (countUnplaced && kind !== 'vehicle') unplaced += n;
          }
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
        violent: 'Murder and non-negligent manslaughter, rape, robbery and felony assault (NYPD offense codes 101, 104, 105, 106).',
        property: 'Burglary, grand larceny, petit larceny, motor vehicle larceny and arson (codes 107, 109, 110, 341, 342, 114).',
        vehicle: 'Grand and petit larceny of motor vehicles plus larceny from vehicles and of vehicle accessories.',
      },
      dedupe: 'Counted as distinct complaint numbers. Each complaint is placed in an NTA by its published coordinates; the NYPD publishes the current year and earlier years as separate datasets, partitioned by report date, so the two never overlap.',
      notes: [
        'NYPD complaints of felonies, misdemeanors and violations, published quarterly. The newest quarter appears weeks after it ends, so the window ends at the last published month.',
        'Complaints are placed at a mid-block or intersection point, and some complaints in parks, transit and housing developments sit on the boundary of two areas.',
        'Complaints are not calls for service or arrests.',
      ],
      sources: [
        {
          id: 'nyc-complaints',
          name: 'NYPD Complaint Data Current (Year To Date) and Historic',
          publisher: 'New York City Police Department via NYC Open Data',
          url: 'https://data.cityofnewyork.us/d/5uac-w243',
          license: metaCurrent.license ?? 'NYC Open Data Terms of Use',
          observationPeriod: `${priorStart} to ${end} (report date)`,
          retrievedAt: new Date().toISOString(),
          updateFrequency: 'Quarterly',
          staleAfterDays: 120,
          status: 'ok',
          notes: metaCurrent.dataUpdatedAt ? `Publisher last updated rows ${metaCurrent.dataUpdatedAt.slice(0, 10)}.` : undefined,
        },
      ],
    };
  },
};
