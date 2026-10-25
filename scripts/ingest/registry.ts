// Every city the pipeline builds. Chicago, New York City, San Francisco and Austin keep their hand-written
// adapters (cities/*.ts); the rest are declared here: where their neighborhood geography comes from (an official
// partition, or ZIP Code Tabulation Areas clipped to the city limits when no clean official one exists), and
// where their reported incidents come from, with the field mapping and classification each source needs.
import { cityInfo } from '../../src/lib/cities.ts';
import { austin } from './cities/austin.ts';
import { chicago } from './cities/chicago.ts';
import { nyc } from './cities/nyc.ts';
import { sf } from './cities/sf.ts';
import type { CityAdapter } from './cities/types.ts';
import { NIBRS_NAME_RULES, labelKinds, nibrsKinds, nibrsKindsAll, type LabelRules } from './generic/classify.ts';
import { num } from './generic/fetch.ts';
import type { GenericIncidentSpec } from './generic/incidents.ts';
import { arcgis, csv, inList, socrata, socrataPoint, years } from './generic/specs.ts';

export interface OfficialGeography {
  kind: 'official';
  label: string;
  title: string;
  publisher: string;
  pageUrl: string;
  license: string;
  source: { type: 'arcgis'; url: string; where?: string } | { type: 'socrata'; domain: string; dataset: string } | { type: 'geojson'; url: string };
  nameField: string;
  districtField?: string;
  /** Turns the published name into the display name. */
  rename?: (name: string) => string;
}

export interface ZctaGeography {
  kind: 'zcta';
}

export interface GenericCity {
  kind: 'generic';
  id: string;
  placeGeoid: string;
  geography: OfficialGeography | ZctaGeography;
  incidents: GenericIncidentSpec | null;
  /** Why incidents are unavailable, shown in the app. */
  incidentsUnavailable?: string;
}

export interface CustomCity {
  kind: 'custom';
  id: string;
  adapter: CityAdapter;
}

export type CityConfig = GenericCity | CustomCity;

const NIBRS_A = ['09A', '11A', '11B', '11C', '120', '13A', '200', '220', '23A', '23B', '23C', '23D', '23E', '23F', '23G', '23H', '240'];
const NOT_CALLS = 'Reported offenses, not calls for service or arrests.';

const OPEN_TERMS = 'Publisher open-data terms of use';

// ---------------------------------------------------------------------------------------------------------------

const la: GenericCity = {
  kind: 'generic',
  id: 'la',
  placeGeoid: '0644000',
  geography: {
    kind: 'official',
    label: 'Neighborhood council',
    title: 'Neighborhood Councils (Certified)',
    publisher: 'City of Los Angeles',
    pageUrl: 'https://geohub.lacity.org/datasets/lahub::neighborhood-councils-certified',
    license: 'City of Los Angeles open data terms',
    source: { type: 'arcgis', url: 'https://maps.lacity.org/lahub/rest/services/Boundaries/MapServer/18' },
    nameField: 'NAME',
    rename: (n) => n.replace(/\s+NC$/i, '').replace(/\bNC\b/g, '').trim(),
  },
  incidents: {
    name: 'LAPD NIBRS Offenses Dataset',
    publisher: 'Los Angeles Police Department via data.lacity.org',
    url: 'https://data.lacity.org/d/k7nn-b2ep',
    license: OPEN_TERMS,
    updateFrequency: 'Weekly',
    staleAfterDays: 30,
    dateBasis: 'report',
    dedupe: 'Counted as distinct case numbers per measure; the dataset has one row per offense.',
    notes: ['LAPD moved to NIBRS in March 2024. Locations are published at the hundred-block level.', NOT_CALLS],
    ...socrata({
      domain: 'data.lacity.org',
      datasets: ['k7nn-b2ep'],
      dateField: 'date_rptd',
      idField: 'caseno',
      select: ['nibr_code', 'hndrdth_lat', 'hndrdth_lon'],
      where: inList('nibr_code', NIBRS_A),
      map: (r) => ({ kinds: nibrsKinds(r.nibr_code), lat: num(r.hndrdth_lat), lon: num(r.hndrdth_lon) }),
    }),
  },
};

const houston: GenericCity = {
  kind: 'generic',
  id: 'houston',
  placeGeoid: '4835000',
  geography: {
    kind: 'official',
    label: 'Super neighborhood',
    title: 'COH Super Neighborhoods',
    publisher: 'City of Houston Planning & Development',
    pageUrl: 'https://cohgis-mycity.opendata.arcgis.com/datasets/coh-super-neighborhoods',
    license: 'City of Houston open data terms',
    source: { type: 'arcgis', url: 'https://mycity2.houstontx.gov/gisweb02/rest/services/HoustonMap/Administrative_Boundary/MapServer/3' },
    nameField: 'SNBNAME',
  },
  incidents: {
    name: 'HPD NIBRS Public View (monthly crime data by street and beat)',
    publisher: 'Houston Police Department',
    url: 'https://www.houstontx.gov/police/cs/Monthly_Crime_Data_by_Street_and_Police_Beat.htm',
    license: OPEN_TERMS,
    updateFrequency: 'Monthly, one to two weeks after the month ends',
    staleAfterDays: 60,
    dateBasis: 'occurrence',
    dedupe: 'Counted as distinct incident numbers per measure; rows are offenses.',
    notes: ['HPD publishes one file per year. Coordinates are approximate block locations.', NOT_CALLS],
    ...csv({
      urls: (from, to) => years(from, to).map((y) => `https://www.houstontx.gov/police/cs/xls/NIBRSPublicView${y}.csv`),
      // HPD renamed its columns in 2025; earlier files use the compact names.
      dateField: ['Occurrence Date', 'RMSOccurrenceDate'],
      idField: 'Incident',
      columns: ['NIBRS Class', 'NIBRSClass', 'Map Latitude', 'MapLatitude', 'Map Longitude', 'MapLongitude'],
      map: (r) => ({ kinds: nibrsKinds(r['NIBRS Class'] || r.NIBRSClass), lat: num(r['Map Latitude'] || r.MapLatitude), lon: num(r['Map Longitude'] || r.MapLongitude) }),
    }),
  },
};

const sanantonio: GenericCity = {
  kind: 'generic',
  id: 'sanantonio',
  placeGeoid: '4865000',
  geography: { kind: 'zcta' },
  incidents: {
    name: 'SAPD Offenses',
    publisher: 'San Antonio Police Department via Open Data SA',
    url: 'https://data.sanantonio.gov/dataset/sapd-offenses',
    license: OPEN_TERMS,
    updateFrequency: 'Weekly',
    staleAfterDays: 30,
    dateBasis: 'report',
    dedupe: 'Counted as distinct report ids per measure.',
    notes: ['SAPD publishes offenses with ZIP codes but no coordinates, so incidents are placed by ZIP.', NOT_CALLS],
    ...csv({
      urls: () => ['https://data.sanantonio.gov/datastore/dump/f36bb931-8fb4-481c-83d9-a3589108bb20'],
      dateField: 'Report_Date',
      idField: 'Report_ID',
      columns: ['NIBRS_Code_Name', 'Zip_Code'],
      map: (r) => ({ kinds: labelKinds(r.NIBRS_Code_Name, NIBRS_NAME_RULES), zip: r.Zip_Code }),
    }),
  },
};

const PHOENIX_RULES: LabelRules = {
  violent: /^(MURDER AND NON-NEGLIGENT MANSLAUGHTER|RAPE|ROBBERY|AGGRAVATED ASSAULT)$/,
  property: /^(BURGLARY|LARCENY-THEFT|MOTOR VEHICLE THEFT|ARSON)$/,
  vehicle: /^MOTOR VEHICLE THEFT$/,
};
const phoenix: GenericCity = {
  kind: 'generic',
  id: 'phoenix',
  placeGeoid: '0455000',
  geography: { kind: 'zcta' },
  incidents: {
    name: 'Crime Data',
    publisher: 'Phoenix Police Department via Phoenix Open Data',
    url: 'https://www.phoenixopendata.com/dataset/crime-data',
    license: OPEN_TERMS,
    updateFrequency: 'Daily, through seven days before posting',
    staleAfterDays: 30,
    dateBasis: 'occurrence',
    definitions: {
      violent: 'Murder and non-negligent manslaughter, rape, robbery and aggravated assault (UCR categories).',
      property: 'Burglary, larceny-theft, motor vehicle theft and arson (UCR categories).',
      vehicle: 'Motor vehicle theft only: Phoenix does not publish theft from vehicles as its own category.',
    },
    dedupe: 'Counted as distinct incident numbers per measure; Phoenix publishes the highest UCR category per incident.',
    notes: ['Phoenix publishes ZIP codes and hundred blocks but no coordinates, so incidents are placed by ZIP.', NOT_CALLS],
    ...csv({
      urls: () => ['https://www.phoenixopendata.com/datastore/dump/0ce3411a-2fc6-4302-a33f-167f68608a20'],
      dateField: 'OCCURRED ON',
      idField: 'INC NUMBER',
      columns: ['UCR CRIME CATEGORY', 'ZIP'],
      map: (r) => ({ kinds: labelKinds(r['UCR CRIME CATEGORY'], PHOENIX_RULES), zip: r.ZIP }),
    }),
  },
};

const PHILLY_RULES: LabelRules = {
  violent: /^(Homicide - Criminal|Rape|Robbery Firearm|Robbery No Firearm|Aggravated Assault Firearm|Aggravated Assault No Firearm)$/,
  property: /^(Burglary Residential|Burglary Non-Residential|Thefts|Theft from Vehicle|Motor Vehicle Theft|Arson)$/,
  vehicle: /^(Theft from Vehicle|Motor Vehicle Theft)$/,
};
const philadelphia: GenericCity = {
  kind: 'generic',
  id: 'philadelphia',
  placeGeoid: '4260000',
  geography: {
    kind: 'official',
    label: 'Neighborhood',
    title: 'Philadelphia Neighborhoods',
    publisher: 'OpenDataPhilly (Abaca Labs)',
    pageUrl: 'https://opendataphilly.org/datasets/philadelphia-neighborhoods/',
    license: 'CC BY 4.0, attribution to Abaca Labs',
    source: { type: 'geojson', url: 'https://raw.githubusercontent.com/opendataphilly/open-geo-data/master/philadelphia-neighborhoods/philadelphia-neighborhoods.geojson' },
    nameField: 'LISTNAME',
  },
  incidents: {
    name: 'Crime Incidents (Part I and Part II)',
    publisher: 'Philadelphia Police Department via OpenDataPhilly',
    url: 'https://opendataphilly.org/datasets/crime-incidents/',
    license: 'City of Philadelphia License',
    updateFrequency: 'Daily',
    staleAfterDays: 21,
    dateBasis: 'report',
    definitions: {
      violent: 'Criminal homicide, rape, robbery and aggravated assault (PPD general offense codes).',
      property: 'Burglary, thefts, theft from vehicle, motor vehicle theft and arson.',
      vehicle: 'Motor vehicle theft and theft from vehicles.',
    },
    dedupe: 'Counted as distinct incident keys (dc_key); PPD publishes one general offense code per incident.',
    notes: ['Dates are dispatch dates. Points are placed at the hundred block.', NOT_CALLS],
    ...arcgis({
      urls: ['https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/INCIDENTS_PART1_PART2/FeatureServer/0'],
      dateField: 'dispatch_date_time',
      idField: 'dc_key',
      fields: ['text_general_code', 'point_x', 'point_y'],
      where: inList('text_general_code', ['Homicide - Criminal', 'Rape', 'Robbery Firearm', 'Robbery No Firearm', 'Aggravated Assault Firearm', 'Aggravated Assault No Firearm', 'Burglary Residential', 'Burglary Non-Residential', 'Thefts', 'Theft from Vehicle', 'Motor Vehicle Theft', 'Arson']),
      map: (a) => ({ kinds: labelKinds(a.text_general_code, PHILLY_RULES), lon: num(a.point_x), lat: num(a.point_y) }),
    }),
  },
};

const dallas: GenericCity = {
  kind: 'generic',
  id: 'dallas',
  placeGeoid: '4819000',
  geography: { kind: 'zcta' },
  incidents: {
    name: 'Police Incidents',
    publisher: 'Dallas Police Department via Dallas OpenData',
    url: 'https://www.dallasopendata.com/d/qv6i-rri7',
    license: OPEN_TERMS,
    updateFrequency: 'Daily',
    staleAfterDays: 21,
    dateBasis: 'occurrence',
    dedupe: 'Counted as distinct incident numbers per measure; Dallas publishes a row per person involved.',
    notes: ['Dallas has no official neighborhood geography, so ZIP areas within the city limits are used.', NOT_CALLS],
    ...socrata({
      domain: 'www.dallasopendata.com',
      datasets: ['qv6i-rri7'],
      dateField: 'date1',
      idField: 'incidentnum',
      select: ['nibrs_code', 'geocoded_column', 'zip_code'],
      where: inList('nibrs_code', NIBRS_A),
      map: (r) => ({ kinds: nibrsKinds(r.nibrs_code), ...socrataPoint(r.geocoded_column), zip: String(r.zip_code ?? '') }),
    }),
  },
};

const sandiego: GenericCity = {
  kind: 'generic',
  id: 'sandiego',
  placeGeoid: '0666000',
  geography: {
    kind: 'official',
    label: 'Police-beat neighborhood',
    title: 'Neighborhoods defined by the San Diego Police Department',
    publisher: 'City of San Diego',
    pageUrl: 'https://data.sandiego.gov/datasets/police-beats/',
    license: 'City of San Diego open data terms',
    source: { type: 'arcgis', url: 'https://services.arcgis.com/oxInpRhVIBxlo4pO/arcgis/rest/services/Neighborhoods_defined_by_police_dept/FeatureServer/0' },
    nameField: 'NAME',
  },
  incidents: {
    name: 'Police NIBRS Crime Offenses',
    publisher: 'San Diego Police Department',
    url: 'https://data.sandiego.gov/datasets/police-nibrs/',
    license: 'City of San Diego open data terms',
    updateFrequency: 'Daily',
    staleAfterDays: 21,
    dateBasis: 'occurrence',
    dedupe: 'Counted as distinct case numbers per measure; rows are offenses.',
    notes: ['Records are placed at the hundred block and may change as investigations proceed.', NOT_CALLS],
    ...arcgis({
      urls: ['https://webmaps.sandiego.gov/arcgis/rest/services/SDPD/SDPD_NIBRS_Crime_Offenses_Geo/FeatureServer/0'],
      dateField: 'OCCURED_ON',
      idField: 'CASE_NUMBER',
      fields: ['IBR_OFFENSE', 'NEIGHBORHOOD'],
      where: inList('IBR_OFFENSE', NIBRS_A),
      geometry: true,
      map: (a) => ({ kinds: nibrsKinds(a.IBR_OFFENSE), name: a.NEIGHBORHOOD ? String(a.NEIGHBORHOOD) : undefined }),
    }),
  },
};

// Columbus publishes incident points and offense codes in two related tables joined on InstanceId.
const COLUMBUS_REPORTS = 'https://services1.arcgis.com/9yy6msODkIBzkUXU/arcgis/rest/services/Police_Incident_Reports/FeatureServer/0';
const COLUMBUS_OFFENSES = 'https://services1.arcgis.com/9yy6msODkIBzkUXU/arcgis/rest/services/Police_Incident_Offense_Records/FeatureServer/2';
const columbusReports = arcgis({
  urls: [COLUMBUS_REPORTS],
  dateField: 'ReportedOn',
  idField: 'IncidentNo',
  fields: ['InstanceId', 'ZIP'],
  geometry: true,
  map: (a) => ({ kinds: [], zip: a.ZIP ? String(a.ZIP) : undefined, name: String(a.InstanceId ?? '') }),
});
const columbus: GenericCity = {
  kind: 'generic',
  id: 'columbus',
  placeGeoid: '3918000',
  geography: { kind: 'zcta' },
  incidents: {
    name: 'Police Incident Reports and Offense Records',
    publisher: 'Columbus Division of Police via Columbus Open Data',
    url: 'https://opendata.columbus.gov/',
    license: OPEN_TERMS,
    updateFrequency: 'Monthly',
    staleAfterDays: 75,
    dateBasis: 'report',
    dedupe: 'Counted as distinct incident numbers per measure, after joining each incident to all of its offenses.',
    notes: ['Columbus publishes incident locations and offense codes in separate tables, joined here on their shared record id.', NOT_CALLS],
    latest: columbusReports.latest,
    async rows(from, to) {
      const { arcgisRows } = await import('./generic/fetch.ts');
      const offenses = await arcgisRows(COLUMBUS_OFFENSES, inList('IBRCode', NIBRS_A), ['InstanceId', 'IBRCode']);
      const codes = new Map<string, string[]>();
      for (const o of offenses) {
        const k = String(o.a.InstanceId);
        codes.set(k, [...(codes.get(k) ?? []), String(o.a.IBRCode)]);
      }
      const reports = await columbusReports.rows(from, to);
      return reports.map((r) => ({ ...r, kinds: nibrsKindsAll(codes.get(r.name ?? '') ?? []), name: undefined }));
    },
  },
};

const jacksonville: GenericCity = {
  kind: 'generic',
  id: 'jacksonville',
  placeGeoid: '1235000',
  geography: { kind: 'zcta' },
  incidents: null,
  incidentsUnavailable: "The Jacksonville Sheriff's Office publishes annual reports and homicide data, but no incident-level crime dataset.",
};

const seattle: GenericCity = {
  kind: 'generic',
  id: 'seattle',
  placeGeoid: '5363000',
  geography: {
    kind: 'official',
    label: 'Neighborhood',
    title: 'Neighborhood Map Atlas Neighborhoods',
    publisher: 'City of Seattle Office of Planning and Community Development',
    pageUrl: 'https://data-seattlecitygis.opendata.arcgis.com/datasets/neighborhood-map-atlas-neighborhoods',
    license: 'City of Seattle open data terms',
    source: { type: 'arcgis', url: 'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/nma_nhoods_sub/FeatureServer/0' },
    nameField: 'S_HOOD',
    districtField: 'L_HOOD',
  },
  incidents: {
    name: 'SPD Crime Data: 2008–Present',
    publisher: 'Seattle Police Department via data.seattle.gov',
    url: 'https://data.seattle.gov/d/tazs-3rd5',
    license: 'Public domain',
    updateFrequency: 'Daily',
    staleAfterDays: 21,
    dateBasis: 'occurrence',
    dedupe: 'Counted as distinct report numbers per measure; rows are offenses.',
    notes: ['Coordinates are generalized to the hundred block; some sensitive offenses carry no location.', NOT_CALLS],
    ...socrata({
      domain: 'data.seattle.gov',
      datasets: ['tazs-3rd5'],
      dateField: 'offense_date',
      idField: 'report_number',
      select: ['nibrs_offense_code', 'latitude', 'longitude'],
      where: inList('nibrs_offense_code', NIBRS_A),
      map: (r) => ({ kinds: nibrsKinds(r.nibrs_offense_code), lat: num(r.latitude), lon: num(r.longitude) }),
    }),
  },
};

const FORT_WORTH_RULES: LabelRules = {
  violent: /(capital murder|\bmurder\b|sexual assault|\brape\b|robbery|aggravated assault|agg assault|aggravated sexual)/i,
  property: /(burglary|theft|\bUUMV\b|unauthorized use of motor vehicle|auto theft|arson)/i,
  vehicle: /(burglary (of )?vehicle|burglary vehicle|\bUUMV\b|unauthorized use of motor vehicle|auto theft|\(auto|theft from motor|motor vehicle theft)/i,
  exclude: /(theft of service|attempt to commit capital|bodily injury)/i,
};
const fortworth: GenericCity = {
  kind: 'generic',
  id: 'fortworth',
  placeGeoid: '4827000',
  geography: { kind: 'zcta' },
  incidents: {
    name: 'CFW Police Crime Data',
    publisher: 'Fort Worth Police Department',
    url: 'https://data.fortworthtexas.gov/d/k6ic-7kp7',
    license: OPEN_TERMS,
    updateFrequency: 'Daily',
    staleAfterDays: 21,
    dateBasis: 'report',
    definitions: {
      violent: 'Murder, sexual assault, robbery and aggravated assault, matched from Texas Penal Code offense descriptions.',
      property: 'Burglary (including Texas "burglary of vehicle"), theft, unauthorized use of a motor vehicle, auto theft and arson, matched from offense descriptions.',
      vehicle: 'Auto theft, unauthorized use of a motor vehicle and burglary of vehicles, matched from offense descriptions.',
    },
    dedupe: 'Counted as distinct case numbers per measure.',
    notes: ['Fort Worth publishes Texas Penal Code descriptions rather than NIBRS codes; they are matched by text, which is less precise than codes.', NOT_CALLS],
    ...arcgis({
      urls: ['https://mapit.fortworthtexas.gov/ags/rest/services/CIVIC/Crime_Data/MapServer/0'],
      dateField: 'Reported_Date',
      idField: 'Case_No',
      fields: ['Offense_Desc', 'Latitude', 'Longitude'],
      map: (a) => ({ kinds: labelKinds(a.Offense_Desc, FORT_WORTH_RULES), lat: num(a.Latitude), lon: num(a.Longitude) }),
    }),
  },
};

const charlotte: GenericCity = {
  kind: 'generic',
  id: 'charlotte',
  placeGeoid: '3712000',
  geography: { kind: 'zcta' },
  incidents: {
    name: 'CMPD Incidents',
    publisher: 'Charlotte-Mecklenburg Police Department',
    url: 'https://gis.charlottenc.gov/arcgis/rest/services/CMPD/CMPDIncidents/MapServer/0',
    license: OPEN_TERMS,
    updateFrequency: 'Weekly',
    staleAfterDays: 30,
    dateBasis: 'report',
    dedupe: 'Counted as distinct incident report ids; CMPD publishes the highest NIBRS offense per incident, so an incident with a robbery and a theft counts once, as a robbery.',
    notes: ['CMPD Incidents covers the Charlotte-Mecklenburg jurisdiction; only incidents inside the Charlotte city limits are counted.', NOT_CALLS],
    ...arcgis({
      urls: ['https://gis.charlottenc.gov/arcgis/rest/services/CMPD/CMPDIncidents/MapServer/0'],
      dateField: 'DATE_REPORTED',
      idField: 'INCIDENT_REPORT_ID',
      fields: ['HIGHEST_NIBRS_CODE', 'LATITUDE_PUBLIC', 'LONGITUDE_PUBLIC'],
      where: inList('HIGHEST_NIBRS_CODE', NIBRS_A),
      map: (a) => ({ kinds: nibrsKinds(a.HIGHEST_NIBRS_CODE), lat: num(a.LATITUDE_PUBLIC), lon: num(a.LONGITUDE_PUBLIC) }),
    }),
  },
};

const nashville: GenericCity = {
  kind: 'generic',
  id: 'nashville',
  placeGeoid: '4752006',
  geography: { kind: 'zcta' },
  incidents: {
    name: 'Metro Nashville Police Department Incidents',
    publisher: 'Metro Nashville Police Department via Nashville Open Data',
    url: 'https://data.nashville.gov/',
    license: OPEN_TERMS,
    updateFrequency: 'Daily',
    staleAfterDays: 21,
    dateBasis: 'report',
    dedupe: 'Counted as distinct incident numbers per measure; MNPD publishes a row per offense and victim.',
    notes: ['Coverage is the Nashville-Davidson balance (Metro Nashville minus its satellite cities).', NOT_CALLS],
    ...arcgis({
      urls: ['https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Metro_Nashville_Police_Department_Incidents_view/FeatureServer/0'],
      dateField: 'Incident_Reported',
      idField: 'Incident_Number',
      fields: ['Offense_NIBRS', 'Latitude', 'Longitude'],
      where: inList('Offense_NIBRS', NIBRS_A),
      map: (a) => ({ kinds: nibrsKinds(a.Offense_NIBRS), lat: num(a.Latitude), lon: num(a.Longitude) }),
    }),
  },
};

const DENVER_RULES: LabelRules = {
  violent: /^(murder|robbery|aggravated-assault)$/,
  property: /^(burglary|larceny|theft-from-motor-vehicle|auto-theft|arson)$/,
  vehicle: /^(theft-from-motor-vehicle|auto-theft)$/,
};
const denver: GenericCity = {
  kind: 'generic',
  id: 'denver',
  placeGeoid: '0820000',
  geography: {
    kind: 'official',
    label: 'Statistical neighborhood',
    title: 'Statistical Neighborhoods',
    publisher: 'City and County of Denver',
    pageUrl: 'https://opendata-geospatialdenver.hub.arcgis.com/',
    license: 'CC BY 3.0',
    source: { type: 'arcgis', url: 'https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_ADMN_NEIGHBORHOOD_A/FeatureServer/13' },
    nameField: 'NBHD_NAME',
  },
  incidents: {
    name: 'Crime (offenses)',
    publisher: 'Denver Police Department via Denver Open Data',
    url: 'https://opendata-geospatialdenver.hub.arcgis.com/',
    license: 'CC BY 3.0',
    updateFrequency: 'Daily',
    staleAfterDays: 21,
    dateBasis: 'report',
    definitions: {
      violent: 'Murder, robbery and aggravated assault. Denver publishes sexual assaults separately and only in aggregate, so they are not included.',
      property: 'Burglary, larceny, theft from motor vehicle, auto theft and arson (DPD offense categories).',
      vehicle: 'Auto theft and theft from motor vehicles.',
    },
    dedupe: 'Counted as distinct incident ids per measure; rows are offenses.',
    notes: ['Sexual assaults are excluded from the public incident file to protect victims.', NOT_CALLS],
    ...arcgis({
      urls: ['https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_CRIME_OFFENSES_P/FeatureServer/324'],
      dateField: 'REPORTED_DATE',
      idField: 'INCIDENT_ID',
      fields: ['OFFENSE_CATEGORY_ID', 'GEO_LAT', 'GEO_LON'],
      where: "IS_CRIME = 1",
      map: (a) => ({ kinds: labelKinds(a.OFFENSE_CATEGORY_ID, DENVER_RULES), lat: num(a.GEO_LAT), lon: num(a.GEO_LON) }),
    }),
  },
};

const indianapolis: GenericCity = {
  kind: 'generic',
  id: 'indianapolis',
  placeGeoid: '1836003',
  geography: { kind: 'zcta' },
  incidents: {
    name: 'IMPD NIBRS Data for Public Consumption',
    publisher: 'Indianapolis Metropolitan Police Department',
    url: 'https://gis.indy.gov/server/rest/services/IMPD/IMPD_NIBRS_Public/MapServer',
    license: OPEN_TERMS,
    updateFrequency: 'Monthly',
    staleAfterDays: 75,
    dateBasis: 'occurrence',
    dedupe: 'Counted as distinct case numbers per measure.',
    notes: ['IMPD publishes ZIP codes but no coordinates, so incidents are placed by ZIP. Coverage is the Indianapolis balance (Marion County minus its excluded cities).', NOT_CALLS],
    ...arcgis({
      urls: ['https://gis.indy.gov/server/rest/services/IMPD/IMPD_NIBRS_Public/MapServer/2'],
      dateField: 'OccurredFrom',
      idField: 'CaseNum',
      fields: ['NIBRSClassIBRcode', 'Geo_Zip'],
      where: inList('NIBRSClassIBRcode', NIBRS_A),
      map: (a) => ({ kinds: nibrsKinds(a.NIBRSClassIBRcode), zip: a.Geo_Zip ? String(a.Geo_Zip) : undefined }),
    }),
  },
};

const BOSTON_RULES: LabelRules = {
  violent: /^(MURDER|MANSLAUGHTER|ROBBERY|ASSAULT - AGGRAVATED|RAPE|SEXUAL ASSAULT)/,
  property: /^(BURGLARY|LARCENY|AUTO THEFT|ARSON|BREAKING AND ENTERING)/,
  vehicle: /(AUTO THEFT|FROM MV|MV PARTS|MOTOR VEHICLE PARTS|ACCESSORY)/,
  exclude: /(LEASED|RECOVERED|ATTEMPT TO COMMIT)/,
};
const boston: GenericCity = {
  kind: 'generic',
  id: 'boston',
  placeGeoid: '2507000',
  geography: {
    kind: 'official',
    label: 'Neighborhood',
    title: 'BPDA Neighborhoods',
    publisher: 'Boston Planning Department',
    pageUrl: 'https://data.boston.gov/dataset/bpda-neighborhood-boundaries',
    license: 'Open Data Commons Public Domain Dedication and License',
    source: { type: 'arcgis', url: 'https://gis.bostonplans.org/hosting/rest/services/Hosted/Boston_Neighborhood_Boundaries/FeatureServer/5' },
    nameField: 'name',
  },
  incidents: {
    name: 'Crime Incident Reports (2023 to present)',
    publisher: 'Boston Police Department via Analyze Boston',
    url: 'https://data.boston.gov/dataset/crime-incident-reports-august-2015-to-date-source-new-system',
    license: 'Open Data Commons Public Domain Dedication and License',
    updateFrequency: 'Daily',
    staleAfterDays: 21,
    dateBasis: 'occurrence',
    definitions: {
      violent: 'Murder, manslaughter, rape and sexual assault, robbery and aggravated assault (BPD offense descriptions). Massachusetts law withholds some sexual-assault records from the public file.',
      property: 'Burglary, larceny, auto theft and arson (BPD offense descriptions).',
      vehicle: 'Auto theft and larceny from or of motor vehicle parts.',
    },
    dedupe: 'Counted as distinct incident numbers per measure; rows are offenses.',
    notes: ['The public file omits records covered by MGL ch. 41 s. 98F.', NOT_CALLS],
    ...csv({
      urls: () => ['https://data.boston.gov/datastore/dump/b973d8cb-eeb2-4e7e-99da-c92938efc9c0'],
      dateField: 'OCCURRED_ON_DATE',
      idField: 'INCIDENT_NUMBER',
      columns: ['OFFENSE_DESCRIPTION', 'Lat', 'Long'],
      map: (r) => ({ kinds: labelKinds(r.OFFENSE_DESCRIPTION, BOSTON_RULES), lat: num(r.Lat), lon: num(r.Long) }),
    }),
  },
};

const okc: GenericCity = {
  kind: 'generic',
  id: 'okc',
  placeGeoid: '4055000',
  geography: { kind: 'zcta' },
  incidents: null,
  incidentsUnavailable: 'Oklahoma City Police publish monthly neighborhood reports as PDFs, but no incident-level open dataset.',
};

const atlanta: GenericCity = {
  kind: 'generic',
  id: 'atlanta',
  placeGeoid: '1304000',
  geography: {
    kind: 'official',
    label: 'Neighborhood',
    title: 'Official Neighborhoods',
    publisher: 'City of Atlanta Department of City Planning',
    pageUrl: 'https://dpcd-coaplangis.opendata.arcgis.com/',
    license: 'City of Atlanta open data terms',
    source: { type: 'arcgis', url: 'https://gis.atlantaga.gov/dpcd/rest/services/AdministrativeArea/GeopoliticalArea/MapServer/1' },
    nameField: 'NAME',
    districtField: 'NPU',
  },
  incidents: {
    name: 'APD Open Data crime (NIBRS)',
    publisher: 'Atlanta Police Department',
    url: 'https://opendata.atlantapd.org/',
    license: OPEN_TERMS,
    updateFrequency: 'Daily',
    staleAfterDays: 21,
    dateBasis: 'report',
    dedupe: 'Counted as distinct incident numbers per measure; rows are offenses.',
    notes: ['Includes incidents handled by APD inside the city limits.', NOT_CALLS],
    ...arcgis({
      urls: ['https://services3.arcgis.com/Et5Qfajgiyosiw4d/arcgis/rest/services/OpenDataWebsite_Crime_view/FeatureServer/0'],
      dateField: 'ReportDate',
      idField: 'IncidentNumber',
      fields: ['NibrsUcrCode', 'Latitude', 'Longitude', 'NhoodName'],
      where: inList('NibrsUcrCode', NIBRS_A),
      map: (a) => ({ kinds: nibrsKinds(a.NibrsUcrCode), lat: num(a.Latitude), lon: num(a.Longitude), name: a.NhoodName ? String(a.NhoodName) : undefined }),
    }),
  },
};

const TUCSON_RULES: LabelRules = {
  violent: /^(HOMICIDE|SEXUAL ASSAULT|ROBBERY|ASSAULT, AGGRAVATED)$/,
  property: /^(BURGLARY|LARCENY|GTA|ARSON)$/,
  vehicle: /^GTA$/,
};
const TUCSON = 'https://gis.tucsonaz.gov/arcgis/rest/services/PublicMaps/OpenData_PublicSafety/MapServer';
const tucson: GenericCity = {
  kind: 'generic',
  id: 'tucson',
  placeGeoid: '0477000',
  geography: { kind: 'zcta' },
  incidents: {
    name: 'Tucson Police Incidents (open data, by year)',
    publisher: 'Tucson Police Department',
    url: 'https://gisdata.tucsonaz.gov/',
    license: OPEN_TERMS,
    updateFrequency: 'Weekly',
    staleAfterDays: 45,
    dateBasis: 'occurrence',
    definitions: {
      violent: 'Homicide, sexual assault, robbery and aggravated assault (TPD UCR summary categories).',
      property: 'Burglary, larceny, grand theft auto and arson (TPD UCR summary categories).',
      vehicle: 'Grand theft auto only: Tucson does not publish theft from vehicles as its own category.',
    },
    dedupe: 'Counted as distinct incident ids per measure.',
    notes: ['Tucson publishes one incident layer per completed year, so the newest months appear only after the year closes; addresses are rounded to the hundred block.', NOT_CALLS],
    ...arcgis({
      // Layer 24 (TPD_INCIDENTS_PUBLIC) is a sparse mixed-year layer without the UCR fields; the yearly layers are complete.
      urls: [`${TUCSON}/81`, `${TUCSON}/80`],
      // DATE_OCCU is empty on most rows; DATETIME_OCCU is always filled.
      dateField: 'DATETIME_OCCU',
      idField: 'INCI_ID',
      fields: ['UCRSummaryDesc'],
      // The LAT and LONG columns are zero-filled; the point geometry carries the location.
      geometry: true,
      map: (a) => ({ kinds: labelKinds(a.UCRSummaryDesc, TUCSON_RULES) }),
    }),
  },
};

const portland: GenericCity = {
  kind: 'generic',
  id: 'portland',
  placeGeoid: '4159000',
  geography: {
    kind: 'official',
    label: 'Neighborhood',
    title: 'Neighborhood Boundaries',
    publisher: 'City of Portland',
    pageUrl: 'https://gis-pdx.opendata.arcgis.com/datasets/neighborhood-boundaries',
    license: 'City of Portland open data terms',
    source: { type: 'arcgis', url: 'https://www.portlandmaps.com/od/rest/services/COP_OpenData_Boundary/MapServer/3' },
    nameField: 'MAPLABEL',
  },
  incidents: {
    name: 'Reported crime data (New Offense Data, by year)',
    publisher: 'Portland Police Bureau',
    url: 'https://www.portland.gov/police/open-data/reported-crime-data',
    license: OPEN_TERMS,
    updateFrequency: 'Monthly, about 30 days after the month ends',
    staleAfterDays: 75,
    dateBasis: 'occurrence',
    dedupe: 'Counted as distinct case numbers per measure; rows are offenses.',
    notes: ['Person crimes are published without coordinates; they are placed by the neighborhood PPB assigns.', NOT_CALLS],
    ...csv({
      urls: (from, to) => years(from, to).map((y) => `https://public.tableau.com/views/PPBOpenDataDownloads/New_Offense_Data_${y}.csv?:showVizHome=no`),
      dateField: 'OccurDate',
      idField: 'CaseNumber',
      columns: ['OffenseType', 'OpenDataLat', 'OpenDataLon', 'Neighborhood'],
      map: (r) => ({ kinds: labelKinds(r.OffenseType, NIBRS_NAME_RULES), lat: num(r.OpenDataLat), lon: num(r.OpenDataLon), name: r.Neighborhood || undefined }),
    }),
  },
};

const sanjose: GenericCity = {
  kind: 'generic',
  id: 'sanjose',
  placeGeoid: '0668000',
  geography: { kind: 'zcta' },
  incidents: null,
  incidentsUnavailable: 'San José publishes police calls for service, not recorded offenses, and calls are not counted as crimes here.',
};

const RALEIGH_RULES: LabelRules = {
  violent: /^(MURDER|ROBBERY|AGGRAVATED ASSAULT)$/,
  property: /^(LARCENY|LARCENY FROM MV|MV THEFT|BURGLARY\/RESIDENTIAL|BURGLARY\/COMMERCIAL|ARSON)$/,
  vehicle: /^(LARCENY FROM MV|MV THEFT)$/,
};
const raleigh: GenericCity = {
  kind: 'generic',
  id: 'raleigh',
  placeGeoid: '3755000',
  geography: { kind: 'zcta' },
  incidents: {
    name: 'Raleigh Police Incidents (NIBRS)',
    publisher: 'Raleigh Police Department via Raleigh Open Data',
    url: 'https://data.raleighnc.gov/',
    license: OPEN_TERMS,
    updateFrequency: 'Daily',
    staleAfterDays: 21,
    dateBasis: 'report',
    definitions: {
      violent: 'Murder, robbery and aggravated assault (RPD crime categories). Raleigh withholds rape and most sex offenses from public data.',
      property: 'Burglary, larceny, larceny from motor vehicle, motor vehicle theft and arson.',
      vehicle: 'Motor vehicle theft and larceny from motor vehicles.',
    },
    dedupe: 'Counted as distinct case numbers per measure.',
    notes: ['Rape and most other sex offenses are not included in public data.', NOT_CALLS],
    ...arcgis({
      urls: ['https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Police_Incidents/FeatureServer/0'],
      dateField: 'reported_date',
      idField: 'case_number',
      fields: ['crime_category', 'latitude', 'longitude'],
      where: inList('crime_category', ['MURDER', 'ROBBERY', 'AGGRAVATED ASSAULT', 'LARCENY', 'LARCENY FROM MV', 'MV THEFT', 'BURGLARY/RESIDENTIAL', 'BURGLARY/COMMERCIAL', 'ARSON']),
      map: (a) => ({ kinds: labelKinds(a.crime_category, RALEIGH_RULES), lat: num(a.latitude), lon: num(a.longitude) }),
    }),
  },
};

const coloradosprings: GenericCity = {
  kind: 'generic',
  id: 'coloradosprings',
  placeGeoid: '0816000',
  geography: {
    kind: 'official',
    label: 'Neighborhood',
    title: 'Neighborhoods',
    publisher: 'Colorado Springs Police Department',
    pageUrl: 'https://policedata.coloradosprings.gov/d/c3wu-4b4t',
    license: OPEN_TERMS,
    source: { type: 'socrata', domain: 'policedata.coloradosprings.gov', dataset: 'c3wu-4b4t' },
    nameField: 'name',
  },
  incidents: {
    name: 'Crime Level Data',
    publisher: 'Colorado Springs Police Department',
    url: 'https://policedata.coloradosprings.gov/d/bc88-hemr',
    license: OPEN_TERMS,
    updateFrequency: 'Daily',
    staleAfterDays: 21,
    dateBasis: 'report',
    dedupe: 'Counted as distinct case numbers per measure; rows are offenses.',
    notes: [NOT_CALLS],
    ...socrata({
      domain: 'policedata.coloradosprings.gov',
      datasets: ['bc88-hemr'],
      dateField: 'reporteddate',
      idField: 'casenumber',
      select: ['crimecode', 'location_point'],
      where: inList('crimecode', NIBRS_A),
      map: (r) => ({ kinds: nibrsKinds(r.crimecode), ...socrataPoint(r.location_point) }),
    }),
  },
};

const DETROIT_RULES: LabelRules = {
  violent: /^(HOMICIDE|SEXUAL ASSAULT|ROBBERY|AGGRAVATED ASSAULT)$/,
  property: /^(BURGLARY|LARCENY|STOLEN VEHICLE|ARSON)$/,
  vehicle: /^STOLEN VEHICLE$/,
};
const detroit: GenericCity = {
  kind: 'generic',
  id: 'detroit',
  placeGeoid: '2622000',
  geography: {
    kind: 'official',
    label: 'Neighborhood',
    title: 'Current City of Detroit Neighborhoods',
    publisher: 'City of Detroit',
    pageUrl: 'https://data.detroitmi.gov/datasets/current-city-of-detroit-neighborhoods',
    license: 'Public domain',
    source: { type: 'arcgis', url: 'https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/Current_City_of_Detroit_Neighborhoods/FeatureServer/0' },
    nameField: 'nhood_name',
  },
  incidents: {
    name: 'RMS Crime Incidents',
    publisher: 'Detroit Police Department via Detroit Open Data',
    url: 'https://data.detroitmi.gov/datasets/rms-crime-incidents',
    license: 'Public domain',
    updateFrequency: 'Daily',
    staleAfterDays: 21,
    dateBasis: 'occurrence',
    definitions: {
      violent: 'Homicide, sexual assault, robbery and aggravated assault (DPD offense categories).',
      property: 'Burglary, larceny, stolen vehicle and arson (DPD offense categories), excluding recovered-vehicle records.',
      vehicle: 'Stolen vehicles plus larceny from motor vehicles and of vehicle parts.',
    },
    dedupe: 'Counted as distinct report numbers per measure; rows are offenses.',
    notes: ['Locations are published at the nearest intersection or block.', NOT_CALLS],
    ...arcgis({
      urls: ['https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/RMS_Crime_Incidents/FeatureServer/0'],
      dateField: 'incident_occurred_at',
      idField: 'report_number',
      fields: ['offense_category', 'offense_description', 'latitude', 'longitude'],
      where: inList('offense_category', ['HOMICIDE', 'SEXUAL ASSAULT', 'ROBBERY', 'AGGRAVATED ASSAULT', 'BURGLARY', 'LARCENY', 'STOLEN VEHICLE', 'ARSON']),
      map: (a) => {
        const desc = String(a.offense_description ?? '');
        if (/RECOVERED ONLY/.test(desc)) return { kinds: [] };
        const kinds = labelKinds(a.offense_category, DETROIT_RULES);
        if (/FROM MOTOR VEHICLE|MOTOR VEHICLE PARTS/.test(desc) && !kinds.includes('vehicle')) kinds.push('vehicle');
        return { kinds, lat: num(a.latitude), lon: num(a.longitude) };
      },
    }),
  },
};

const milwaukee: GenericCity = {
  kind: 'generic',
  id: 'milwaukee',
  placeGeoid: '5553000',
  geography: {
    kind: 'official',
    label: 'Neighborhood',
    title: 'Neighborhoods (Department of City Development)',
    publisher: 'City of Milwaukee',
    pageUrl: 'https://data.milwaukee.gov/',
    license: OPEN_TERMS,
    source: { type: 'arcgis', url: 'https://services5.arcgis.com/8Q02ELWlq5TYUASS/arcgis/rest/services/Milwaukee_Neighborhoods/FeatureServer/0' },
    nameField: 'Neighborho',
  },
  incidents: {
    name: 'NIBRS Crime Data (Current)',
    publisher: 'Milwaukee Police Department via Milwaukee Open Data',
    url: 'https://data.milwaukee.gov/dataset/wibr',
    license: OPEN_TERMS,
    updateFrequency: 'Daily',
    staleAfterDays: 21,
    dateBasis: 'occurrence',
    dedupe: 'Counted as distinct case numbers per measure; a case listing several offenses counts once in each measure it touches.',
    notes: [NOT_CALLS],
    ...csv({
      urls: () => ['https://data.milwaukee.gov/datastore/dump/87843297-a6fa-46d4-ba5d-cb342fb2d3bb'],
      dateField: 'Incident_Date',
      idField: 'Case_Number',
      columns: ['Offense_All', 'Address_Latitude', 'Address_Longitude'],
      map: (r) => ({ kinds: nibrsKindsAll(r.Offense_All.split(/[;,]/)), lat: num(r.Address_Latitude), lon: num(r.Address_Longitude) }),
    }),
  },
};

const lasvegas: GenericCity = {
  kind: 'generic',
  id: 'lasvegas',
  placeGeoid: '3240000',
  geography: { kind: 'zcta' },
  incidents: {
    name: 'LVMPD Reported NIBRS Crimes',
    publisher: 'Las Vegas Metropolitan Police Department',
    url: 'https://services.arcgis.com/jjSk6t82vIntwDbs/arcgis/rest/services/Weekly_Public_Crimes/FeatureServer/0',
    license: OPEN_TERMS,
    updateFrequency: 'Weekly',
    staleAfterDays: 30,
    dateBasis: 'report',
    dedupe: 'Counted as distinct event numbers per measure.',
    notes: ['LVMPD serves the City of Las Vegas and unincorporated Clark County; only incidents inside the city limits are counted. Public data starts in January 2025.', NOT_CALLS],
    ...arcgis({
      urls: ['https://services.arcgis.com/jjSk6t82vIntwDbs/arcgis/rest/services/Weekly_Public_Crimes/FeatureServer/0'],
      dateField: 'ReportedOn',
      idField: 'Event_Number',
      fields: ['NIBRSOffenseCode', 'Latitude', 'Longitude'],
      where: inList('NIBRSOffenseCode', NIBRS_A),
      map: (a) => ({ kinds: nibrsKinds(a.NIBRSOffenseCode), lat: num(a.Latitude), lon: num(a.Longitude) }),
    }),
  },
};

const MPLS_VIOLENT = ['MURDR', 'CSCR', 'ROBPAG', 'ROBPER', 'ROBBIZ', 'CARJCK', 'ASLT1', 'ASLT2', 'ASLT3', 'DASLT1', 'DASLT2', 'DASLT3'];
const MPLS_PROPERTY = ['AUTOTH', 'TFMV', 'THEFT', 'BURGD', 'BURGB', 'BIKETF', 'TMVP', 'SHOPLF', 'THFTSW', 'TBLDG', 'TFPER', 'ARSON', 'MVTHFT', 'COINOP', 'POCKET', 'SCRAP', 'CARGO', 'PETIT', 'WLKOFF'];
const MPLS_VEHICLE = ['AUTOTH', 'TFMV', 'TMVP', 'MVTHFT', 'CARJCK'];
const minneapolis: GenericCity = {
  kind: 'generic',
  id: 'minneapolis',
  placeGeoid: '2743000',
  geography: {
    kind: 'official',
    label: 'Neighborhood',
    title: 'Minneapolis Neighborhoods',
    publisher: 'City of Minneapolis',
    pageUrl: 'https://opendata.minneapolismn.gov/datasets/minneapolis-neighborhoods',
    license: OPEN_TERMS,
    source: { type: 'arcgis', url: 'https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/Minneapolis_Neighborhoods/FeatureServer/0' },
    nameField: 'BDNAME',
  },
  incidents: {
    name: 'Police Incidents (last two years)',
    publisher: 'Minneapolis Police Department via Open Minneapolis',
    url: 'https://opendata.minneapolismn.gov/',
    license: OPEN_TERMS,
    updateFrequency: 'Daily',
    staleAfterDays: 21,
    dateBasis: 'report',
    definitions: {
      violent: 'Murder, criminal sexual conduct (rape), robbery including carjacking, and first- to third-degree and domestic aggravated assault (MPD offense codes).',
      property: 'Burglary, theft (including from and of motor vehicles), auto theft and arson (MPD offense codes).',
      vehicle: 'Auto theft, theft from and of motor vehicle parts, and carjacking.',
    },
    dedupe: 'Counted as distinct case numbers per measure.',
    notes: ['The public file covers the most recent two years.', NOT_CALLS],
    ...arcgis({
      urls: ['https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/Police_Incidents_Last_2Years/FeatureServer/0'],
      dateField: 'reportedDate',
      idField: 'caseNumber',
      fields: ['offense', 'centerLat', 'centerLong'],
      where: inList('offense', [...new Set([...MPLS_VIOLENT, ...MPLS_PROPERTY])]),
      map: (a) => {
        const o = String(a.offense ?? '');
        const kinds = [MPLS_VIOLENT.includes(o) && 'violent', MPLS_PROPERTY.includes(o) && 'property', MPLS_VEHICLE.includes(o) && 'vehicle'].filter(Boolean) as Array<'violent' | 'property' | 'vehicle'>;
        return { kinds, lat: num(a.centerLat), lon: num(a.centerLong) };
      },
    }),
  },
};

const LOUISVILLE = 'https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services';
const louisville: GenericCity = {
  kind: 'generic',
  id: 'louisville',
  placeGeoid: '2148006',
  geography: { kind: 'zcta' },
  incidents: {
    name: 'Louisville Metro KY – Crime Data (by year)',
    publisher: 'Louisville Metro Police Department via Louisville Open Data',
    url: 'https://data.louisvilleky.gov/',
    license: OPEN_TERMS,
    updateFrequency: 'Weekly',
    staleAfterDays: 30,
    dateBasis: 'occurrence',
    dedupe: 'Counted as distinct incident numbers per measure; rows are offenses.',
    notes: ['LMPD publishes ZIP codes and hundred blocks but no coordinates, so incidents are placed by ZIP.', NOT_CALLS],
    ...arcgis({
      urls: [`${LOUISVILLE}/crime_data_2026/FeatureServer/0`, `${LOUISVILLE}/crime_data_2025/FeatureServer/0`, `${LOUISVILLE}/crimedata2024/FeatureServer/0`],
      dateField: 'date_occurred',
      idField: 'incident_number',
      fields: ['nibrs_code', 'zip_code'],
      where: inList('nibrs_code', NIBRS_A),
      map: (a) => ({ kinds: nibrsKinds(a.nibrs_code), zip: a.zip_code ? String(a.zip_code) : undefined }),
    }),
  },
};

const albuquerque: GenericCity = {
  kind: 'generic',
  id: 'albuquerque',
  placeGeoid: '3502000',
  geography: { kind: 'zcta' },
  incidents: null,
  incidentsUnavailable: "Albuquerque's public incident layer is built from calls for service, and the city says it should not be used for crime trends.",
};

const MEMPHIS_RULES: LabelRules = {
  violent: /^(HOMICIDE|ROBBERY|AGGRAVATED ASSAULT)$/,
  property: /^(BURG\/BREAK & ENTER|LARCENY\/THEFT|MOTOR VEHICLE THEFT|ARSON)$/,
  vehicle: /^MOTOR VEHICLE THEFT$/,
};
const memphis: GenericCity = {
  kind: 'generic',
  id: 'memphis',
  placeGeoid: '4748000',
  geography: {
    kind: 'official',
    label: 'Community neighborhood',
    title: 'Community Neighborhoods Boundaries',
    publisher: 'City of Memphis',
    pageUrl: 'https://data.memphistn.gov/',
    license: OPEN_TERMS,
    source: { type: 'arcgis', url: 'https://services2.arcgis.com/saWmpKJIUAjyyNVc/arcgis/rest/services/Community_Neighborhoods_Boundaries/FeatureServer/0' },
    nameField: 'name',
  },
  incidents: {
    name: 'MPD Public Safety Incidents',
    publisher: 'Memphis Police Department via Memphis Data Hub',
    url: 'https://data.memphistn.gov/',
    license: OPEN_TERMS,
    updateFrequency: 'Daily',
    staleAfterDays: 21,
    dateBasis: 'occurrence',
    definitions: {
      violent: 'Homicide, robbery and aggravated assault (MPD UCR categories). Sex offenses are not in the public file.',
      property: 'Burglary, larceny/theft, motor vehicle theft and arson (MPD UCR categories).',
      vehicle: 'Motor vehicle theft plus theft from motor vehicles and of vehicle parts.',
    },
    dedupe: 'Counted as distinct agency crime ids per measure; rows are offenses.',
    notes: [NOT_CALLS],
    ...arcgis({
      urls: ['https://services2.arcgis.com/saWmpKJIUAjyyNVc/arcgis/rest/services/MPD_Public_Safety_Incidents/FeatureServer/0'],
      dateField: 'Offense_Datetime',
      idField: 'Agency_Crime_ID',
      fields: ['UCR_Category', 'UCR_Description', 'Latitude', 'Longitude'],
      where: inList('UCR_Category', ['HOMICIDE', 'ROBBERY', 'AGGRAVATED ASSAULT', 'BURG/BREAK & ENTER', 'LARCENY/THEFT', 'MOTOR VEHICLE THEFT', 'ARSON']),
      map: (a) => {
        const kinds = labelKinds(a.UCR_Category, MEMPHIS_RULES);
        if (/THEFT FROM A MOTOR VEHICLE|THEFT OF MV PARTS/.test(String(a.UCR_Description ?? '')) && !kinds.includes('vehicle')) kinds.push('vehicle');
        return { kinds, lat: num(a.Latitude), lon: num(a.Longitude) };
      },
    }),
  },
};

const OMAHA_RULES: LabelRules = {
  violent: /^(Homicide Offenses|Robbery|Assault Offenses)$/,
  property: /^(Larceny\/Theft Offenses|Burglary\/Breaking & Entering|Motor Vehicle Theft|Arson)$/,
  vehicle: /^Motor Vehicle Theft$/,
};
const omaha: GenericCity = {
  kind: 'generic',
  id: 'omaha',
  placeGeoid: '3137000',
  geography: { kind: 'zcta' },
  incidents: {
    name: 'Omaha Police Incident Data',
    publisher: 'Omaha Police Department',
    url: 'https://services1.arcgis.com/tIBLyYZX96jUntYm/arcgis/rest/services/Omaha_Police_Incident_Data_(View)/FeatureServer/0',
    license: OPEN_TERMS,
    updateFrequency: 'Daily',
    staleAfterDays: 21,
    dateBasis: 'occurrence',
    definitions: {
      violent: 'Homicide, robbery and all assaults. Omaha publishes NIBRS offense groups only, so aggravated and simple assault cannot be separated, and sex offenses are not published.',
      property: 'Burglary, larceny/theft, motor vehicle theft and arson (NIBRS offense groups).',
      vehicle: 'Motor vehicle theft only: theft from vehicles is not separated from other larceny.',
    },
    dedupe: 'Counted as distinct report numbers per measure.',
    notes: ['Violent counts here include simple assaults, so they run higher than in cities that count aggravated assault only. Compare Omaha neighborhoods with each other, not with other cities.', NOT_CALLS],
    ...arcgis({
      urls: ['https://services1.arcgis.com/tIBLyYZX96jUntYm/arcgis/rest/services/Omaha_Police_Incident_Data_(View)/FeatureServer/0'],
      dateField: 'dteMidpoint',
      idField: 'RB',
      fields: ['NIBRSCategory', 'LatBlock', 'LonBlock'],
      map: (a) => ({ kinds: labelKinds(a.NIBRSCategory, OMAHA_RULES), lat: num(a.LatBlock), lon: num(a.LonBlock) }),
    }),
  },
};

const BALTIMORE_RULES: LabelRules = {
  violent: /^(HOMICIDE|RAPE|ROBBERY|ROBBERY - COMMERCIAL|ROBBERY - CARJACKING|AGG\. ASSAULT)$/,
  property: /^(BURGLARY|LARCENY|SHOPLIFTING|AUTO THEFT|LARCENY FROM AUTO|LARCENY OF MOTOR VEHICLE PARTS OR ACCESSORIES|ARSON)$/,
  vehicle: /^(AUTO THEFT|LARCENY FROM AUTO|LARCENY OF MOTOR VEHICLE PARTS OR ACCESSORIES|ROBBERY - CARJACKING)$/,
};
const baltimore: GenericCity = {
  kind: 'generic',
  id: 'baltimore',
  placeGeoid: '2404000',
  geography: {
    kind: 'official',
    label: 'Neighborhood statistical area',
    title: 'Neighborhood Statistical Area (NSA) Boundaries',
    publisher: 'Baltimore City Department of Planning',
    pageUrl: 'https://data.baltimorecity.gov/',
    license: OPEN_TERMS,
    source: { type: 'arcgis', url: 'https://baltegis.baltimorecity.gov/server/rest/services/CityView/Neighborhoods/FeatureServer/0' },
    nameField: 'Name',
  },
  incidents: {
    name: 'NIBRS Group A Crime Data',
    publisher: 'Baltimore Police Department via Open Baltimore',
    url: 'https://data.baltimorecity.gov/',
    license: OPEN_TERMS,
    updateFrequency: 'Weekly',
    staleAfterDays: 30,
    dateBasis: 'occurrence',
    definitions: {
      violent: 'Homicide, rape, robbery (including commercial and carjacking) and aggravated assault (BPD descriptions).',
      property: 'Burglary, larceny, shoplifting, auto theft, larceny from auto and of vehicle parts, and arson.',
      vehicle: 'Auto theft, larceny from autos and of vehicle parts, and carjacking.',
    },
    dedupe: 'Counted as distinct CC numbers per measure; rows are offenses.',
    notes: [NOT_CALLS],
    ...arcgis({
      urls: ['https://services1.arcgis.com/UWYHeuuJISiGmgXx/arcgis/rest/services/NIBRS_GroupA_Crime_Data/FeatureServer/0'],
      dateField: 'CrimeDateTime',
      idField: 'CCNumber',
      fields: ['Description', 'Latitude', 'Longitude'],
      map: (a) => ({ kinds: labelKinds(a.Description, BALTIMORE_RULES), lat: num(a.Latitude), lon: num(a.Longitude) }),
    }),
  },
};

const mesa: GenericCity = {
  kind: 'generic',
  id: 'mesa',
  placeGeoid: '0446000',
  geography: { kind: 'zcta' },
  incidents: null,
  incidentsUnavailable: "Mesa's incident-level dataset ends in 2019; newer records are police dispatch events (calls), which are not counted as crimes here.",
};

const kansascity: GenericCity = {
  kind: 'generic',
  id: 'kansascity',
  placeGeoid: '2938000',
  geography: { kind: 'zcta' },
  incidents: {
    name: 'KCPD Crime Data (by year)',
    publisher: 'Kansas City Police Department via Open Data KC',
    url: 'https://data.kcmo.org/',
    license: OPEN_TERMS,
    updateFrequency: 'Weekly',
    staleAfterDays: 30,
    dateBasis: 'report',
    dedupe: 'Counted as distinct report numbers per measure; KCPD publishes a row per person involved.',
    notes: ['Kansas City has no clean official neighborhood partition in open data, so ZIP areas within the city limits are used.', NOT_CALLS],
    ...socrata({
      domain: 'data.kcmo.org',
      // The 2024 file uses older column names.
      datasets: [{ id: 'isbe-v4d8', fields: { report_date: 'reported_date', report: 'report_no', zipcode: 'zip_code' } }, 'dmnp-9ajg', 'f7wj-ckmw'],
      dateField: 'report_date',
      idField: 'report',
      select: ['ibrs', 'location', 'zipcode'],
      where: inList('ibrs', NIBRS_A),
      map: (r) => ({ kinds: nibrsKinds(r.ibrs), ...socrataPoint(r.location), zip: r.zipcode ? String(r.zipcode) : undefined }),
    }),
  },
};

const orlando: GenericCity = {
  kind: 'generic',
  id: 'orlando',
  placeGeoid: '1253000',
  geography: {
    kind: 'official',
    label: 'Neighborhood',
    title: 'Orlando Neighborhoods',
    publisher: 'City of Orlando',
    pageUrl: 'https://data.cityoforlando.net/d/yskk-n7cw',
    license: OPEN_TERMS,
    source: { type: 'socrata', domain: 'data.cityoforlando.net', dataset: 'yskk-n7cw' },
    nameField: 'neighborhoodname',
  },
  incidents: null,
  incidentsUnavailable: 'The City of Orlando publishes neighborhood crime summaries as web pages, but no incident-level crime dataset.',
};

const fresno: GenericCity = {
  kind: 'generic',
  id: 'fresno',
  placeGeoid: '0627000',
  geography: { kind: 'zcta' },
  incidents: null,
  incidentsUnavailable: 'Fresno Police publish no incident-level open crime dataset.',
};

const custom = (adapter: CityAdapter): CustomCity => ({ kind: 'custom', id: adapter.id, adapter });

export const REGISTRY: CityConfig[] = [
  custom(nyc), la, houston, custom(chicago), sanantonio, phoenix, custom(austin), philadelphia, dallas, sandiego, columbus, jacksonville,
  seattle, fortworth, charlotte, nashville, denver, custom(sf), indianapolis, boston, okc, atlanta, tucson, portland, sanjose, raleigh,
  coloradosprings, detroit, milwaukee, lasvegas, minneapolis, louisville, albuquerque, memphis, omaha, baltimore, mesa, kansascity,
  orlando, fresno,
];

// Every registered city must exist in the shared city list, and vice versa.
for (const c of REGISTRY) if (!cityInfo(c.id).state) throw new Error(`registry: ${c.id} missing from src/lib/cities.ts`);
