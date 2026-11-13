/**
 * Hand-written `popularity.showChange` answers for the PopularityChangeList demo and tests: what
 * one show did to its promotion's popularity, region by region. Nothing here calls the engine.
 * Every name is invented or a plain place name; the numbers are made up but follow the engine's
 * shapes (docs/design/promotion-popularity.md#popularityshowchange): regions sit under their
 * country with the show region first, then the largest change; countries go largest change first;
 * a country's change is the population-weighted mean over all of its regions, untouched ones
 * counting 0.
 */
import { parseGameDate, parseId } from '@ringside/engine';
import type {
  EventInstanceId,
  ShowChangeCountryView,
  ShowChangeRegionView,
  ShowChangeStatus,
  ShowPopularityChangeView,
  StoredTrace,
  StoredTraceEntry,
  TraceNode,
  TraceRef,
  TraceSummary,
} from '@ringside/engine';

const UNIT = 'points';
const DOC_REF = 'promotion-popularity.md#show-popularity-change';
const AGGREGATE_DOC_REF = 'geography.md#aggregation';
const TRACE_KIND = 'promoPop.showChange';
const RIVAL_TRACE_KIND = 'promoPop.rivalShowChange';
const SHOW_DATE = parseGameDate('2031-03-14');

/** Two decimals, as the popularity door stores them. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

type Source = ShowChangeRegionView['source'];

/** One reached region, as written by hand. */
interface RegionPlan {
  readonly name: string;
  readonly source: Source;
  /** "Show region", "Neighbour of …" or "TV: …". */
  readonly sourceLabel: string;
  readonly expectation: number;
  readonly before: number;
  readonly change: number;
  readonly capped?: boolean;
  /** Millions of people, for the country's weighting. */
  readonly population: number;
}

interface CountryPlan {
  readonly name: string;
  /** Millions of people in the whole country, reached or not. */
  readonly population: number;
  readonly regions: readonly RegionPlan[];
}

interface ShowPlan {
  /** The ten-character body of the show's id. */
  readonly idBody: string;
  readonly promotionName: string;
  readonly showName: string;
  readonly score: number;
  readonly human: boolean;
  readonly worldBefore: number;
  readonly countries: readonly CountryPlan[];
}

let nextPlaceNumber = 1;
const placeIds = new Map<string, number>();

/** A stable id body per place name, so the same place keeps one id across fixtures. */
function placeIdBody(name: string): string {
  let number = placeIds.get(name);
  if (number === undefined) {
    number = nextPlaceNumber;
    nextPlaceNumber += 1;
    placeIds.set(name, number);
  }
  return String(number).padStart(10, '0');
}

/** The region's Why?: expectation against the score, scaled by reach, with the cap when it bit. */
function regionTrace(region: RegionPlan, score: number, weight: number): TraceNode {
  const gap = score - region.expectation;
  const children: TraceNode[] = [
    { kind: 'input', label: 'Show score', value: score },
    { kind: 'input', label: 'What fans here expected', value: region.expectation },
    {
      kind: 'input',
      label: `How much of the show they saw (${region.sourceLabel})`,
      value: weight,
      unit: 'ratio',
    },
    { kind: 'input', label: 'Popularity before the show', value: region.before, unit: UNIT },
  ];
  if (region.capped === true) {
    children.push({
      kind: 'note',
      label: 'Monthly gain cap reached: the gain was cut',
      value: region.change,
    });
  }
  return {
    kind: 'formula',
    label: `Popularity change in ${region.name}`,
    value: region.change,
    unit: UNIT,
    docRef: DOC_REF,
    children: [
      {
        kind: 'input',
        label:
          gap >= 0 ? 'Show beat what fans expected by' : 'Show fell short of what fans expected by',
        value: Math.abs(gap),
      },
      ...children,
    ],
  };
}

/** A population-weighted mean as a trace: one line per reached region, the rest counting 0. */
function weightedTrace(
  label: string,
  value: number,
  parts: readonly { readonly name: string; readonly change: number; readonly share: number }[],
  restLabel: string,
): TraceNode {
  return {
    kind: 'formula',
    label,
    value,
    unit: UNIT,
    docRef: AGGREGATE_DOC_REF,
    children: [
      ...parts.map((part): TraceNode => ({
        kind: 'input',
        label: `${part.name}: ${String(part.change)} × ${String(Math.round(part.share * 1000) / 10)}% of the people`,
        value: round2(part.change * part.share),
        unit: UNIT,
      })),
      { kind: 'constant', label: restLabel, value: 0, reason: 'the show did not reach them' },
    ],
  };
}

function compareRegions(left: ShowChangeRegionView, right: ShowChangeRegionView): number {
  if (left.source === 'show' || right.source === 'show') {
    return left.source === right.source ? 0 : left.source === 'show' ? -1 : 1;
  }
  return (
    Math.abs(right.change) - Math.abs(left.change) || left.name.localeCompare(right.name, 'en')
  );
}

const WEIGHT_BY_SOURCE: Readonly<Record<Source, number>> = { show: 1, neighbour: 0.35, tv: 0.6 };

interface BuiltShow {
  readonly view: ShowPopularityChangeView;
  readonly traces: readonly StoredTrace[];
}

function buildShow(plan: ShowPlan): BuiltShow {
  const eventInstanceId = parseId('eventInstance', `evi_${plan.idBody}`);
  const traces: StoredTrace[] = [];
  let regionsGained = 0;
  let regionsLost = 0;
  let regionsCapped = 0;
  let worldPopulation = 0;
  let worldWeighted = 0;
  const worldParts: { name: string; change: number; share: number }[] = [];

  const countries: ShowChangeCountryView[] = plan.countries.map((country) => {
    const regions = country.regions.map((region): ShowChangeRegionView => {
      const regionId = parseId('region', `reg_${placeIdBody(region.name)}`);
      const change = round2(region.change);
      if (change > 0) regionsGained += 1;
      else if (change < 0) regionsLost += 1;
      if (region.capped === true) regionsCapped += 1;
      const weight = WEIGHT_BY_SOURCE[region.source];
      const ref: TraceRef = {
        kind: plan.human ? TRACE_KIND : RIVAL_TRACE_KIND,
        id: `${eventInstanceId}/${regionId}`,
      };
      traces.push({
        ref,
        date: SHOW_DATE,
        seq: traces.length + 1,
        trace: regionTrace({ ...region, change }, plan.score, weight),
        value: change,
      });
      return {
        regionId,
        name: region.name,
        source: region.source,
        sourceLabel: region.sourceLabel,
        weight,
        expectation: region.expectation,
        before: region.before,
        after: round2(region.before + change),
        change,
        capped: region.capped === true,
        traceRef: ref,
      };
    });
    const parts = regions.map((region, index) => ({
      name: region.name,
      change: region.change,
      share: (country.regions[index]?.population ?? 0) / country.population,
    }));
    const countryChange = round2(parts.reduce((sum, part) => sum + part.change * part.share, 0));
    worldPopulation += country.population;
    worldWeighted += countryChange * country.population;
    worldParts.push({ name: country.name, change: countryChange, share: country.population });
    return {
      countryId: parseId('country', `cty_${placeIdBody(`country:${country.name}`)}`),
      name: country.name,
      change: countryChange,
      trace: weightedTrace(
        `Popularity change in ${country.name}`,
        countryChange,
        parts,
        'Regions the show did not reach',
      ),
      regions: regions.sort(compareRegions),
    };
  });
  countries.sort(
    (left, right) =>
      Math.abs(right.change) - Math.abs(left.change) || left.name.localeCompare(right.name, 'en'),
  );

  // The rest of the world (about 8 billion people) counts 0.
  const everyone = 8000;
  const worldChange = round2(worldWeighted / everyone);
  const regionCount = countries.reduce((sum, country) => sum + country.regions.length, 0);
  return {
    view: {
      eventInstanceId,
      promotionId: parseId('promotion', `pro_${plan.idBody}`),
      promotionName: plan.promotionName,
      showName: plan.showName,
      date: SHOW_DATE,
      score: plan.score,
      status: 'applied',
      summary: {
        regionsGained,
        regionsLost,
        regionsUnchanged: regionCount - regionsGained - regionsLost,
        regionsCapped,
        world: {
          before: plan.worldBefore,
          after: round2(plan.worldBefore + worldChange),
          change: worldChange,
          trace: weightedTrace(
            'Worldwide popularity change',
            worldChange,
            worldParts.map((part) => ({ ...part, share: part.share / everyone })),
            `Countries the show did not reach (${String(Math.round(everyone - worldPopulation))} million people)`,
          ),
        },
      },
      countries,
      pruned: null,
    },
    traces,
  };
}

const NSN = 'TV: National Signal Network';

/** A big company's televised weekly show: 17 regions over 2 countries, small gains, one loss. */
const BIG_TELEVISED = buildShow({
  idBody: '0000000801',
  promotionName: 'Summit Wrestling Alliance',
  showName: 'Monday Thunder',
  score: 68,
  human: true,
  worldBefore: 21.4,
  countries: [
    {
      name: 'United States',
      population: 335,
      regions: [
        {
          name: 'Northeast',
          source: 'show',
          sourceLabel: 'Show region',
          expectation: 61,
          before: 58.2,
          change: 0.31,
          population: 56,
        },
        {
          name: 'Mid-Atlantic',
          source: 'neighbour',
          sourceLabel: 'Neighbour of Northeast',
          expectation: 60,
          before: 55.1,
          change: 0.19,
          population: 32,
        },
        {
          name: 'New England',
          source: 'neighbour',
          sourceLabel: 'Neighbour of Northeast',
          expectation: 63,
          before: 52.4,
          change: 0.12,
          population: 15,
        },
        {
          name: 'Great Lakes',
          source: 'tv',
          sourceLabel: NSN,
          expectation: 62,
          before: 49.8,
          change: 0.14,
          population: 34,
        },
        {
          name: 'Southeast',
          source: 'tv',
          sourceLabel: NSN,
          expectation: 66,
          before: 47.3,
          change: 0.05,
          population: 60,
        },
        {
          name: 'Texas',
          source: 'tv',
          sourceLabel: NSN,
          expectation: 72,
          before: 51.6,
          change: -0.12,
          population: 30,
        },
        {
          name: 'California',
          source: 'tv',
          sourceLabel: NSN,
          expectation: 64,
          before: 44.0,
          change: 0.09,
          population: 39,
        },
        {
          name: 'Pacific Northwest',
          source: 'tv',
          sourceLabel: NSN,
          expectation: 63,
          before: 38.5,
          change: 0.1,
          population: 12,
        },
        {
          name: 'Mountain West',
          source: 'tv',
          sourceLabel: NSN,
          expectation: 67,
          before: 36.2,
          change: 0,
          population: 13,
        },
        {
          name: 'Upper Midwest',
          source: 'tv',
          sourceLabel: NSN,
          expectation: 65,
          before: 41.7,
          change: 0.06,
          population: 15,
        },
        {
          name: 'Plains',
          source: 'tv',
          sourceLabel: NSN,
          expectation: 68,
          before: 35.9,
          change: 0,
          population: 10,
        },
        {
          name: 'Southwest',
          source: 'tv',
          sourceLabel: NSN,
          expectation: 66,
          before: 37.4,
          change: 0.04,
          population: 19,
        },
      ],
    },
    {
      name: 'Canada',
      population: 40,
      regions: [
        {
          name: 'Ontario',
          source: 'tv',
          sourceLabel: NSN,
          expectation: 62,
          before: 33.8,
          change: 0.15,
          population: 15,
        },
        {
          name: 'Quebec',
          source: 'tv',
          sourceLabel: NSN,
          expectation: 65,
          before: 28.1,
          change: 0.07,
          population: 9,
        },
        {
          name: 'British Columbia',
          source: 'tv',
          sourceLabel: NSN,
          expectation: 67,
          before: 25.5,
          change: 0,
          population: 5,
        },
        {
          name: 'Prairies',
          source: 'tv',
          sourceLabel: NSN,
          expectation: 68,
          before: 24.9,
          change: 0,
          population: 7,
        },
        {
          name: 'Atlantic Canada',
          source: 'tv',
          sourceLabel: NSN,
          expectation: 68,
          before: 22.6,
          change: 0,
          population: 2,
        },
      ],
    },
  ],
});

/** A small company's untelevised show: 6 regions over 2 countries, larger gains, one capped. */
const SMALL_UNTELEVISED = buildShow({
  idBody: '0000000802',
  promotionName: 'Borderline Pro Wrestling',
  showName: 'Friday Night Brawl',
  score: 62,
  human: true,
  worldBefore: 1.8,
  countries: [
    {
      name: 'Canada',
      population: 40,
      regions: [
        {
          name: 'Ontario',
          source: 'show',
          sourceLabel: 'Show region',
          expectation: 41,
          before: 18.3,
          change: 2.4,
          capped: true,
          population: 15,
        },
        {
          name: 'Quebec',
          source: 'neighbour',
          sourceLabel: 'Neighbour of Ontario',
          expectation: 44,
          before: 9.6,
          change: 1.48,
          population: 9,
        },
        {
          name: 'Prairies',
          source: 'neighbour',
          sourceLabel: 'Neighbour of Ontario',
          expectation: 46,
          before: 6.2,
          change: 1.21,
          population: 7,
        },
      ],
    },
    {
      name: 'United States',
      population: 335,
      regions: [
        {
          name: 'Great Lakes',
          source: 'neighbour',
          sourceLabel: 'Neighbour of Ontario',
          expectation: 47,
          before: 4.1,
          change: 1.05,
          population: 34,
        },
        {
          name: 'Northeast',
          source: 'neighbour',
          sourceLabel: 'Neighbour of Ontario',
          expectation: 49,
          before: 3.2,
          change: 0.88,
          population: 56,
        },
        {
          name: 'Upper Midwest',
          source: 'neighbour',
          sourceLabel: 'Neighbour of Ontario',
          expectation: 48,
          before: 2.7,
          change: 0.92,
          population: 15,
        },
      ],
    },
  ],
});

/** A weak show from a mid-sized company: the score fell short almost everywhere. */
const WEAK_SHOW = buildShow({
  idBody: '0000000803',
  promotionName: 'Gulf Coast Grappling',
  showName: 'Bayou Bash',
  score: 38,
  human: false,
  worldBefore: 6.3,
  countries: [
    {
      name: 'United States',
      population: 335,
      regions: [
        {
          name: 'Southeast',
          source: 'show',
          sourceLabel: 'Show region',
          expectation: 55,
          before: 31.4,
          change: -1.48,
          population: 60,
        },
        {
          name: 'Texas',
          source: 'neighbour',
          sourceLabel: 'Neighbour of Southeast',
          expectation: 52,
          before: 22.8,
          change: -0.96,
          population: 30,
        },
        {
          name: 'Mid-Atlantic',
          source: 'neighbour',
          sourceLabel: 'Neighbour of Southeast',
          expectation: 50,
          before: 12.1,
          change: -0.61,
          population: 32,
        },
        {
          name: 'Southwest',
          source: 'tv',
          sourceLabel: 'TV: Gulf Sports Net',
          expectation: 44,
          before: 8.9,
          change: -0.22,
          population: 19,
        },
        {
          name: 'Plains',
          source: 'tv',
          sourceLabel: 'TV: Gulf Sports Net',
          expectation: 37,
          before: 6.5,
          change: 0.03,
          population: 10,
        },
      ],
    },
    {
      name: 'Mexico',
      population: 128,
      regions: [
        {
          name: 'Northeast Mexico',
          source: 'tv',
          sourceLabel: 'TV: Gulf Sports Net',
          expectation: 46,
          before: 11.2,
          change: -0.34,
          population: 14,
        },
        {
          name: 'Gulf Coast',
          source: 'tv',
          sourceLabel: 'TV: Gulf Sports Net',
          expectation: 43,
          before: 7.7,
          change: -0.18,
          population: 12,
        },
      ],
    },
  ],
});

interface WideCountry {
  readonly name: string;
  readonly population: number;
  readonly regions: readonly string[];
}

/** Forty regions over eight countries, for the worldwide pay-per-view. */
const WORLD_MAP: readonly WideCountry[] = [
  {
    name: 'United States',
    population: 335,
    regions: [
      'Northeast',
      'Mid-Atlantic',
      'Great Lakes',
      'Southeast',
      'Texas',
      'California',
      'Pacific Northwest',
      'Southwest',
    ],
  },
  {
    name: 'Japan',
    population: 124,
    regions: ['Kanto', 'Kansai', 'Chubu', 'Kyushu', 'Hokkaido', 'Tohoku'],
  },
  {
    name: 'Mexico',
    population: 128,
    regions: ['Mexico City', 'Jalisco', 'Northeast Mexico', 'Gulf Coast', 'Yucatan'],
  },
  {
    name: 'United Kingdom',
    population: 68,
    regions: ['London', 'North West England', 'Midlands', 'Scotland', 'Wales'],
  },
  {
    name: 'Canada',
    population: 40,
    regions: ['Ontario', 'Quebec', 'Prairies', 'British Columbia'],
  },
  {
    name: 'Germany',
    population: 84,
    regions: ['Bavaria', 'North Rhine-Westphalia', 'Berlin-Brandenburg', 'Hamburg'],
  },
  {
    name: 'Australia',
    population: 27,
    regions: ['New South Wales', 'Victoria', 'Queensland', 'Western Australia'],
  },
  {
    name: 'Brazil',
    population: 216,
    regions: ['Sao Paulo', 'Rio de Janeiro', 'Minas Gerais', 'Bahia'],
  },
];

function worldwidePlan(): ShowPlan {
  let index = 0;
  const countries = WORLD_MAP.map((country, countryIndex): CountryPlan => {
    const reach = countryIndex < 2 ? 1 : 0.5;
    return {
      name: country.name,
      population: country.population,
      regions: country.regions.map((name, regionIndex): RegionPlan => {
        index += 1;
        const isShowRegion = countryIndex === 0 && regionIndex === 0;
        // A spread of small gains with a few losses, all made up.
        const swing = ((index * 37) % 23) / 100 - 0.05;
        return {
          name,
          source: isShowRegion ? 'show' : 'tv',
          sourceLabel: isShowRegion ? 'Show region' : 'TV: Global Fight Channel',
          expectation: 64 + ((index * 7) % 11),
          before: round2(12 + ((index * 53) % 470) / 10),
          change: round2((isShowRegion ? 0.9 : swing) * reach),
          population: Math.max(1, Math.round(country.population / country.regions.length)),
        };
      }),
    };
  });
  return {
    idBody: '0000000804',
    promotionName: 'Summit Wrestling Alliance',
    showName: 'Summit Supreme',
    score: 74,
    human: true,
    worldBefore: 21.4,
    countries,
  };
}

const WORLDWIDE = buildShow(worldwidePlan());

/** The big company's televised show: 17 regions over the United States and Canada. */
export const bigTelevisedShowChange: ShowPopularityChangeView = BIG_TELEVISED.view;
/** The small company's untelevised show: 6 regions, one capped. */
export const smallUntelevisedShowChange: ShowPopularityChangeView = SMALL_UNTELEVISED.view;
/** A rival's weak show: mostly losses. */
export const weakShowChange: ShowPopularityChangeView = WEAK_SHOW.view;
/** A worldwide pay-per-view reaching 40 regions in 8 countries. */
export const worldwideShowChange: ShowPopularityChangeView = WORLDWIDE.view;

const SHOW_CHANGE_STATUS_DIGITS: Readonly<Record<Exclude<ShowChangeStatus, 'applied'>, number>> = {
  notCompleted: 1,
  pruned: 2,
  notApplied: 3,
};

/** The same show with nothing to list: it has not run, its record was cleared, or nothing changed. */
export function showChangeWithStatus(
  status: Exclude<ShowChangeStatus, 'applied'>,
  base: ShowPopularityChangeView = bigTelevisedShowChange,
): ShowPopularityChangeView {
  return {
    ...base,
    eventInstanceId: parseId(
      'eventInstance',
      `evi_000000090${String(SHOW_CHANGE_STATUS_DIGITS[status])}`,
    ),
    score: status === 'notCompleted' ? null : base.score,
    status,
    summary: null,
    countries: [],
  };
}

/** The region whose full breakdown has been summarised, for the "only kept for recent results" case. */
export const SUMMARISED_REGION_NAME = 'Quebec';

function summarised(entry: StoredTrace): TraceSummary {
  return {
    ref: entry.ref,
    date: entry.date,
    seq: entry.seq,
    label: `Popularity change in ${SUMMARISED_REGION_NAME}`,
    value: entry.value,
    unit: UNIT,
    topContributors: [{ label: 'Show beat what fans expected', effect: 1.1 }],
  };
}

/**
 * The Why? entries every fixture's region refs point at, as the engine's trace store keeps them.
 * The small show's Quebec entry is a summary: its full breakdown is "no longer kept".
 */
export function showChangeTraceEntries(): StoredTraceEntry[] {
  const smallQuebec = SMALL_UNTELEVISED.view.countries
    .flatMap((country) => country.regions)
    .find((region) => region.name === SUMMARISED_REGION_NAME)?.traceRef;
  return [BIG_TELEVISED, SMALL_UNTELEVISED, WEAK_SHOW, WORLDWIDE].flatMap((show) =>
    show.traces.map((entry): StoredTraceEntry =>
      smallQuebec?.kind === entry.ref.kind && smallQuebec.id === entry.ref.id
        ? summarised(entry)
        : entry,
    ),
  );
}

/** Every fixture by show id, for a stand-in `popularity.showChange`. */
export function showChangeFixtures(): ReadonlyMap<EventInstanceId, ShowPopularityChangeView> {
  const views = [
    bigTelevisedShowChange,
    smallUntelevisedShowChange,
    weakShowChange,
    worldwideShowChange,
    showChangeWithStatus('notCompleted'),
    showChangeWithStatus('pruned'),
    showChangeWithStatus('notApplied'),
  ];
  return new Map(views.map((view) => [view.eventInstanceId, view]));
}
