import { cachedSoql, soql, metadata } from '../sources/socrata.ts';
import { addMonths, completeWindowEnd, titleCase } from '../util.ts';
import { add, emptyCounts, slug, type CityAdapter, type IncidentResult, type KindCounts } from './types.ts';

const DOMAIN = 'data.austintexas.gov';
const CRIMES = 'fdj4-gpfu';

const list = (xs: string[]) => xs.map((x) => `'${x}'`).join(',');
const VEHICLE_TYPES = ['AUTO THEFT', 'BURGLARY OF VEHICLE', 'BURGLARY OF VEH-NO SUSPECT/FU', 'THEFT FROM AUTO', 'THEFT OF AUTO PARTS', 'THEFT CATALYTIC CONVERTER', 'THEFT OF LICENSE PLATE'];
const kindWhere = {
  violent: `category_description in (${list(['Murder', 'Rape', 'Robbery', 'Aggravated Assault'])})`,
  property: `category_description in (${list(['Burglary', 'Theft', 'Auto Theft'])})`,
  vehicle: `(category_description = 'Auto Theft' OR crime_type in (${list(VEHICLE_TYPES)}))`,
};

const NAME_FIXES: Record<string, string> = { MLK: 'MLK', 'MLK-183': 'MLK-183', RMMA: 'RMMA (Mueller)', UT: 'UT', 'ST. JOHN': 'St. John', 'ST. EDWARDS': "St. Edward's" };

export const austin: CityAdapter = {
  id: 'austin',
  name: 'Austin',
  state: 'TX',
  geographyLabel: 'Neighborhood planning area',
  coverage: "The City of Austin's adopted neighborhood planning areas, which cover central, east, south and north-central Austin. Much of northwest, far north, far south and southwest Austin has no planning area and is not covered yet.",
  counties: ['48453', '48491', '48209'],
  boundary: {
    domain: DOMAIN,
    dataset: 'inrm-c3ee',
    title: 'Boundaries: City of Austin Neighborhoods (Neighborhood Planning Areas)',
    publisher: 'City of Austin Planning Department',
    pageUrl: 'https://data.austintexas.gov/d/inrm-c3ee',
    license: 'City of Austin Open Data Terms of Use',
    toFeature(f) {
      const raw = f.properties.planning_area_name;
      if (!raw) return null;
      const name = NAME_FIXES[raw] ?? titleCase(raw);
      const combined = f.properties.combined_npa;
      const district = combined && combined.toUpperCase() !== raw ? titleCase(combined).replace(/ Npa$/, ' NPA') : null;
      return { id: `atx-${slug(raw)}`, name, district };
    },
  },
  async incidents(ctx): Promise<IncidentResult> {
    const [latest] = await soql<{ m: string }>(DOMAIN, CRIMES, { $select: 'max(rep_date) as m', $order: 'm' });
    const end = completeWindowEnd(latest.m);
    const start = addMonths(end, -12);
    const priorStart = addMonths(end, -24);
    const meta = await metadata(DOMAIN, CRIMES);

    let placed = 0;
    let unplaced = 0;
    async function window(from: string, to: string, countUnplaced: boolean): Promise<KindCounts> {
      const counts = emptyCounts();
      for (const kind of ['violent', 'property', 'vehicle'] as const) {
        const rows = await cachedSoql<{ census_block_group?: string; n: string }>(DOMAIN, CRIMES, {
          $select: 'census_block_group, count(distinct incident_report_number) as n',
          $where: `rep_date >= '${from}' AND rep_date < '${to}' AND ${kindWhere[kind]}`,
          $group: 'census_block_group',
          $order: 'census_block_group',
        });
        for (const r of rows) {
          const n = Number(r.n);
          // census_block_group is county (3) + tract (6) + block group (1), without the state code.
          const bg = r.census_block_group;
          const shares = bg && bg.length === 10 ? ctx.blockGroupShares(`48${bg}`) : [];
          let inside = 0;
          for (const [id, share] of shares) {
            add(counts[kind], id, n * share);
            inside += share;
          }
          if (countUnplaced && kind !== 'vehicle') {
            placed += n * inside;
            unplaced += n * (1 - inside);
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
        violent: 'Murder, rape, robbery and aggravated assault (UCR Part I categories).',
        property: 'Burglary, theft and auto theft (UCR Part I categories). Texas "burglary of vehicle" is counted as theft.',
        vehicle: 'Auto theft plus burglary of and theft from vehicles, auto parts, catalytic converters and license plates.',
      },
      dedupe: 'Counted as distinct incident report numbers. APD publishes only the most serious offense per incident, so an incident with both a robbery and a theft appears once, as a robbery.',
      notes: [
        "Austin Police Department crime reports where a report was written. APD no longer publishes coordinates, so incidents are placed by Census block group. A block group that straddles planning areas is split between them by the share of its 2020 residents living in each, so counts here can be fractional before rounding.",
        'Many records fall outside the planning areas covered here; those count toward the unplaced share.',
        'Reports are not calls for service or arrests.',
      ],
      sources: [
        {
          id: 'austin-crime',
          name: 'Crime Reports',
          publisher: 'Austin Police Department via Austin Open Data',
          url: 'https://data.austintexas.gov/d/fdj4-gpfu',
          license: meta.license ?? 'City of Austin Open Data Terms of Use',
          observationPeriod: `${priorStart} to ${end} (report date)`,
          retrievedAt: new Date().toISOString(),
          updateFrequency: 'Weekly',
          staleAfterDays: 30,
          status: 'ok',
          notes: meta.dataUpdatedAt ? `Publisher last updated rows ${meta.dataUpdatedAt.slice(0, 10)}.` : undefined,
        },
      ],
    };
  },
};
