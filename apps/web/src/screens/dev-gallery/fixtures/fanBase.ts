/**
 * `office.fanBase` answers as the engine might give them, for the Fan base sheet and popularity
 * chip gallery entries (DAY2-05): a national promotion with fans in three countries and a local
 * one known in a single region. Gallery data only, all invented. The stand-in engine answers
 * `office.fanBase`, `office.series`, `sim.status`, `tunables.list` and the headline's `trace.get`
 * from here.
 */
import { addDays, cents, parseGameDate, parseId, popularityTraceRef } from '@ringside/engine';
import type {
  FanBaseView,
  GameDate,
  OfficeSeries,
  PopularityRollupView,
  PromotionId,
  SimStatus,
  StoredTrace,
  TraceNode,
} from '@ringside/engine';
import type { EngineTransport } from '@/app/engine/transport';
import { popularityRollupOf } from './popularityRollups';
import { createTraceFixtureTransport } from './traceEngine';

export const FAN_BASE_TODAY: GameDate = parseGameDate('2027-01-26');

export const NATIONAL_PROMOTION_ID: PromotionId = parseId('promotion', 'pro_fanbase001');
export const LOCAL_PROMOTION_ID: PromotionId = parseId('promotion', 'pro_fanbase002');

/** The place a fixture promotion calls home, by the demo map's names. */
interface HomePlace {
  readonly continent: string;
  readonly country: string;
  readonly region: string;
}

function findHome(rollup: PopularityRollupView, home: HomePlace) {
  const continent = rollup.continents.find((candidate) => candidate.name === home.continent);
  const country = continent?.countries.find((candidate) => candidate.name === home.country);
  const region = country?.regions.find((candidate) => candidate.name === home.region);
  if (continent === undefined || country === undefined || region === undefined) {
    throw new Error(`The demo map has ${home.region}, ${home.country}`);
  }
  return { continent, country, region };
}

/** One decimal, as the trace notes write it. */
function oneDecimal(value: number): string {
  return value.toFixed(1);
}

/** The headline's Why?, in the shape the office system records it (docs/design/office.md). */
function headlineTrace(
  name: string,
  rollup: PopularityRollupView,
  home: ReturnType<typeof findHome>,
): TraceNode {
  return {
    kind: 'formula',
    label: `${name} popularity`,
    value: home.country.value,
    unit: 'points',
    docRef: 'office.md#headline-popularity',
    children: [
      home.country.trace,
      {
        kind: 'tunable',
        label: 'Shows popularity in the home country',
        key: 'office.popularity.headlineScope',
        value: 'homeCountry',
        defaultValue: 'homeCountry',
        overridden: false,
      },
      { kind: 'note', label: `Worldwide ${oneDecimal(rollup.world.value)}`, value: null },
      {
        kind: 'note',
        label: `Home region ${home.region.name} ${oneDecimal(home.region.value)}`,
        value: null,
      },
    ],
  };
}

interface FanBaseFixture {
  readonly view: FanBaseView;
  readonly trace: StoredTrace;
  /** Weekly records of the headline, oldest first. */
  readonly series: OfficeSeries['points'];
}

function fanBaseFixture(
  promotionId: PromotionId,
  name: string,
  home: HomePlace,
  popularity: Readonly<Record<string, number>>,
  weekly: readonly number[],
): FanBaseFixture {
  const rollup = popularityRollupOf(popularity);
  const place = findHome(rollup, home);
  const trace = headlineTrace(name, rollup, place);
  const ref = popularityTraceRef(promotionId);
  const value = place.country.value;
  return {
    view: {
      promotionId,
      name,
      headline: { value, label: `${name} popularity`, traceRef: ref },
      scope: 'homeCountry',
      rollup,
      home: {
        regionId: place.region.id,
        countryId: place.country.id,
        countryName: place.country.name,
        continentId: place.continent.id,
      },
    },
    trace: { ref, date: FAN_BASE_TODAY, seq: 1, trace, value },
    // Mondays, a week apart, ending yesterday.
    series: weekly.map((weekValue, index) => ({
      date: addDays(FAN_BASE_TODAY, -1 - 7 * (weekly.length - 1 - index)),
      value: weekValue,
      granularity: 'week' as const,
    })),
  };
}

/** A national promotion: fans across the United States, in Canada and a few in London. */
export const nationalFanBase: FanBaseFixture = fanBaseFixture(
  NATIONAL_PROMOTION_ID,
  'Atlantic Coast Wrestling',
  { continent: 'North America', country: 'United States', region: 'Southeast' },
  {
    'us-southeast': 72,
    'us-texas': 48,
    'us-northeast': 55,
    'ca-ontario': 30,
    'ca-quebec': 18,
    'uk-london': 22,
  },
  [55.1, 56.4, 56.0, 57.3, 58.2, 58.9, 59.5],
);

/** A local promotion: known in Texas and nowhere else, no weekly records yet. */
export const localFanBase: FanBaseFixture = fanBaseFixture(
  LOCAL_PROMOTION_ID,
  'Gulf Coast Grappling',
  { continent: 'North America', country: 'United States', region: 'Texas' },
  { 'us-texas': 64 },
  [],
);

const FIXTURES: readonly FanBaseFixture[] = [nationalFanBase, localFanBase];

/** The fixture for a promotion; the national one when none is named (the "viewer's own"). */
export function fanBaseFor(promotionId: PromotionId | undefined): FanBaseFixture {
  return FIXTURES.find((fixture) => fixture.view.promotionId === promotionId) ?? nationalFanBase;
}

/** Every headline Why?, for the stand-in `trace.get`. */
export const fanBaseTraceEntries: readonly StoredTrace[] = FIXTURES.map((fixture) => fixture.trace);

/** `sim.status` for the national promotion, with a headline (or without, a world before DAY2). */
export function fanBaseStatus(withHeadline: boolean): SimStatus {
  const { view } = nationalFanBase;
  const homeRegion = findHome(view.rollup, {
    continent: 'North America',
    country: 'United States',
    region: 'Southeast',
  }).region;
  return {
    date: FAN_BASE_TODAY,
    season: { number: 2, endDate: parseGameDate('2027-06-30') },
    promotion: {
      promotionId: view.promotionId,
      name: view.name,
      shortName: 'ACW',
      cash: cents(184_250_000),
      cashTraceRef: null,
      popularity: {
        homeRegionId: homeRegion.id,
        homeRegion: homeRegion.value,
        prestige: 61,
        headline: withHeadline ? view.headline.value : null,
        headlineLabel: withHeadline ? view.headline.label : null,
        traceRef: withHeadline ? view.headline.traceRef : null,
        trace: {
          kind: 'input',
          label: `Popularity in ${homeRegion.name}`,
          value: homeRegion.value,
          unit: 'points',
        },
      },
    },
  };
}

/** The two office tunables the trend reads, at their defaults. */
const OFFICE_TUNABLES = [
  {
    key: 'office.trend.weeks',
    category: 'Office',
    kind: 'integer' as const,
    unit: 'count' as const,
    description: 'Weeks shown in a KPI sparkline',
    default: 8,
    value: 8,
    overridden: false,
  },
  {
    key: 'office.delta.lookbackDays',
    category: 'Office',
    kind: 'integer' as const,
    unit: 'count' as const,
    description: 'How far back a KPI delta compares',
    default: 7,
    value: 7,
    overridden: false,
  },
];

/**
 * A stand-in engine for the Fan base demos: the national promotion is the viewer's own, the local
 * one a rival; `withHeadline` false gives a `sim.status` from before DAY2.
 */
export function createFanBaseTransport(withHeadline = true): EngineTransport {
  return createTraceFixtureTransport(fanBaseTraceEntries, undefined, {
    'office.fanBase': (args) => fanBaseFor(args.promotionId).view,
    'office.series': (args) => ({
      metric: { key: 'popularity.headline', label: 'Popularity', unit: 'points' },
      points: fanBaseFor(args.subject.id).series,
    }),
    'sim.status': () => fanBaseStatus(withHeadline),
    'tunables.list': () => OFFICE_TUNABLES,
  });
}
