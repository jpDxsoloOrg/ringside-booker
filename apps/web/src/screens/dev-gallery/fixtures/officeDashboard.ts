import { addDays, parseGameDate, parseId, startCalc } from '@ringside/engine';
import type {
  GameDate,
  OfficeClock,
  OfficeKpi,
  TraceNode,
  TraceUnit,
  WorldOverview,
} from '@ringside/engine';

/**
 * `office.dashboard` pieces as the engine might return them, for the gallery's Office entries:
 * KPI cards, the world clock and the world overview. Gallery data only, all invented; no engine is
 * asked, and every Why? is an inline trace.
 */

const TODAY: GameDate = parseGameDate('2027-01-26');
const LAST_WEEK: GameDate = addDays(TODAY, -8);

/** Eight Mondays and today, oldest first, for an eight-point line ending "now". */
function trendDates(points: number): GameDate[] {
  return Array.from({ length: points }, (_, index) =>
    index === points - 1 ? TODAY : addDays(TODAY, -8 - 7 * (points - 2 - index)),
  );
}

function deltaOf(
  label: string,
  current: number,
  previous: number,
  unit: TraceUnit,
): NonNullable<OfficeKpi['delta']> {
  const trace: TraceNode = startCalc(`Change in ${label} since Mon 18 Jan`, current, {
    unit,
    startLabel: 'This week (Tue 26 Jan)',
  })
    .subtract('Last week (Mon 18 Jan)', previous)
    .done().trace;
  return { value: current - previous, trace, previousDate: LAST_WEEK, previousValue: previous };
}

function liveTrace(label: string, value: number, unit: TraceUnit): TraceNode {
  return startCalc(label, value, { unit, startLabel: label }).done().trace;
}

const CASH_WEEKS = [
  182_000_00, 176_500_00, 171_200_00, 168_900_00, 175_300_00, 169_800_00, 172_450_00, 166_100_00,
  161_250_00,
];

/** Cash with an inline Why?, a fall since last week and a nine-point line. */
export const galleryCashKpi: OfficeKpi = {
  key: 'cash',
  label: 'Cash',
  unit: 'money',
  value: 161_250_00,
  trace: liveTrace('Cash', 161_250_00, 'money'),
  traceRef: null,
  goodWhen: 'up',
  delta: deltaOf('cash', 161_250_00, 166_100_00, 'money'),
  trend: { dates: trendDates(CASH_WEEKS.length), values: CASH_WEEKS },
  footer: null,
};

const POPULARITY_WEEKS = [66.4, 66.9, 67.3, 67.1, 67.8, 68.2, 68.2, 69.0];

/** Popularity in points, up since last week, with its delta's Why?. */
export const galleryPopularityKpi: OfficeKpi = {
  key: 'popularity.headline',
  label: 'Popularity',
  unit: 'points',
  value: 69.04,
  trace: liveTrace('Altura Wrestling popularity', 69.04, 'points'),
  traceRef: null,
  goodWhen: 'up',
  delta: deltaOf('popularity', 69.04, 68.24, 'points'),
  trend: { dates: trendDates(POPULARITY_WEEKS.length), values: POPULARITY_WEEKS },
  footer: 'In Altura',
};

/** A count: the roster, unchanged since last week. */
export const galleryRosterKpi: OfficeKpi = {
  key: 'rosterSize',
  label: 'Roster',
  unit: 'count',
  value: 55,
  trace: liveTrace('Roster', 55, 'count'),
  traceRef: null,
  goodWhen: 'up',
  delta: deltaOf('roster', 55, 55, 'count'),
  trend: { dates: trendDates(3), values: [54, 55, 55] },
  footer: '44 wrestlers · 11 crew',
};

/** Average morale with nobody under contract: "–", nothing to explain. */
export const galleryNoMoraleKpi: OfficeKpi = {
  key: 'averageMorale',
  label: 'Average morale',
  unit: 'points',
  value: null,
  trace: null,
  traceRef: null,
  goodWhen: 'up',
  delta: null,
  trend: { dates: [], values: [] },
  footer: null,
};

/** Prestige on the first day: a stored fact with no Why?, no week-old row and one point. */
export const galleryFirstDayPrestigeKpi: OfficeKpi = {
  key: 'prestige',
  label: 'Prestige',
  unit: 'points',
  value: 58,
  trace: null,
  traceRef: null,
  goodWhen: 'up',
  delta: null,
  trend: { dates: [TODAY], values: [58] },
  footer: null,
};

/** The clock in week 4 of season 1. */
export const galleryClockInSeason: OfficeClock = {
  date: TODAY,
  weekday: 1,
  dayNumber: 23,
  season: {
    number: 1,
    startDate: parseGameDate('2027-01-04'),
    endDate: parseGameDate('2027-12-28'),
    week: 4,
    daysLeft: 336,
  },
  nextSnapshotOn: parseGameDate('2027-02-01'),
};

/** The clock on a Monday before any season exists: the report is taken today. */
export const galleryClockNoSeason: OfficeClock = {
  date: parseGameDate('2027-02-01'),
  weekday: 0,
  dayNumber: 1,
  season: null,
  nextSnapshotOn: parseGameDate('2027-02-01'),
};

/** A small world as a seat that runs no promotion sees it. */
export const galleryWorldOverview: WorldOverview = {
  promotions: [
    {
      promotionId: parseId('promotion', 'pro_00000000g1'),
      name: 'Altura Wrestling Federation',
      shortName: 'AWF',
      logoRef: null,
      color: '#c0392b',
      homeCountryName: 'Altura',
      headline: 71.26,
      prestige: 74,
      rosterSize: 48,
      status: 'active',
    },
    {
      promotionId: parseId('promotion', 'pro_00000000g2'),
      name: 'Harbour Lights Wrestling',
      shortName: 'HLW',
      logoRef: null,
      color: '#2980b9',
      homeCountryName: 'Meridia',
      headline: 54.8,
      prestige: 61,
      rosterSize: 31,
      status: 'active',
    },
    {
      promotionId: parseId('promotion', 'pro_00000000g3'),
      name: 'Northern Iron Pro',
      shortName: 'NIP',
      logoRef: null,
      color: '#27ae60',
      homeCountryName: 'Valdmark',
      headline: 22.35,
      prestige: 38,
      rosterSize: 17,
      status: 'active',
    },
  ],
  freeAgents: 35,
  totals: { promotions: 3, wrestlersUnderContract: 84 },
};
