/**
 * Fixed venue forecasts and venue lists for the "Venue and crowd" panel and the "Choose a venue"
 * sheet (EVT6-06), for the gallery and the tests. The numbers are made up; the shapes are
 * `boxOffice.forecast` and `boxOffice.venues` answers.
 */
import { parseId } from '@ringside/engine';
import type {
  ShowForecast,
  ShowVenueOptions,
  TraceNode,
  VenueFit,
  VenueOption,
  VenueSummary,
} from '@ringside/engine';

export const GALLERY_VENUE_SHOW = parseId('eventInstance', 'evi_9000000001');

const NORTHEAST = parseId('region', 'reg_9000000002');
const GREAT_LAKES = parseId('region', 'reg_9000000003');
const HARBOR_ARENA = parseId('venue', 'ven_9000000004');
const BAYSIDE_THEATRE = parseId('venue', 'ven_9000000005');
const LONGLEAF_BARN = parseId('venue', 'ven_9000000006');
const STEEL_DOME = parseId('venue', 'ven_9000000007');
const OLD_MILL = parseId('venue', 'ven_9000000008');
const TOKYO_HALL = parseId('venue', 'ven_9000000009');

/** The expected crowd's Why?, with the drivers the forecast lists. */
export function crowdTrace(demand: number): TraceNode {
  return {
    kind: 'formula',
    label: 'Expected crowd',
    value: demand,
    unit: 'count',
    children: [
      { kind: 'input', label: 'Promotion popularity in the region', value: 64, unit: 'points' },
      { kind: 'input', label: 'Marketing', value: 1.05, unit: 'multiplier' },
      { kind: 'input', label: 'Show importance: major', value: 1.4, unit: 'multiplier' },
      { kind: 'input', label: 'Recent form', value: 1.02, unit: 'multiplier' },
      { kind: 'input', label: 'Big-show fatigue', value: 0.97, unit: 'multiplier' },
      { kind: 'input', label: 'Hype for the card', value: 1.08, unit: 'multiplier' },
    ],
  };
}

/** Why the game would pick the suggested venue. */
export const venuePickTrace: TraceNode = {
  kind: 'formula',
  label: 'Venue pick',
  value: 'Harbor Arena',
  children: [
    {
      kind: 'input',
      label: 'Smallest venue in Northeast that fits 16,800 × headroom',
      value: 'Harbor Arena',
    },
    { kind: 'input', label: 'Bayside Theatre: too small', value: 2_400, unit: 'count' },
  ],
};

const HARBOR: VenueSummary = {
  kind: 'venue',
  venueId: HARBOR_ARENA,
  name: 'Harbor Arena',
  capacity: 17_500,
  venueKind: 'arena',
  regionId: NORTHEAST,
  imageRef: null,
  exclusivePromotionId: null,
  regionName: 'Northeast',
  countryName: 'United States',
  choice: { kind: 'venue', venueId: HARBOR_ARENA },
};

const BAYSIDE: VenueSummary = {
  ...HARBOR,
  venueId: BAYSIDE_THEATRE,
  name: 'Bayside Theatre',
  capacity: 2_400,
  venueKind: 'theatre',
  choice: { kind: 'venue', venueId: BAYSIDE_THEATRE },
};

const DOME: VenueSummary = {
  ...HARBOR,
  venueId: STEEL_DOME,
  name: 'Steel City Dome',
  capacity: 60_000,
  venueKind: 'stadium',
  regionId: GREAT_LAKES,
  regionName: 'Great Lakes',
  choice: { kind: 'venue', venueId: STEEL_DOME },
};

const LOCAL_HALL: VenueSummary = {
  kind: 'generic',
  tier: 'hall',
  name: 'Local hall, Northeast',
  capacity: 1_200,
  venueKind: 'hall',
  regionId: NORTHEAST,
  imageRef: 'placeholder:venue',
  regionName: 'Northeast',
  countryName: 'United States',
  choice: { kind: 'generic', tier: 'hall' },
};

const FIT_LABELS: Readonly<Record<VenueFit, string>> = {
  likelySellOut: 'Likely sell-out',
  goodFit: 'Good fit',
  willLookEmpty: 'Will look empty',
};

interface ForecastNumbers {
  readonly demand: number;
  readonly low: number;
  readonly high: number;
  readonly fit: VenueFit;
}

function forecastAt(venue: VenueSummary, numbers: ForecastNumbers, chosen: boolean): ShowForecast {
  const capped = (value: number) => Math.min(value, venue.capacity);
  return {
    eventInstanceId: GALLERY_VENUE_SHOW,
    current: chosen ? venue : null,
    suggested: chosen ? null : venue,
    shown: venue,
    expected: capped(numbers.demand),
    demand: numbers.demand,
    low: capped(numbers.low),
    high: capped(numbers.high),
    capacity: venue.capacity,
    cappedByCapacity: numbers.high > venue.capacity,
    fit: numbers.fit,
    fitLabel: FIT_LABELS[numbers.fit],
    trace: crowdTrace(numbers.demand),
    pickTrace: chosen ? null : venuePickTrace,
  };
}

/** Harbor Arena with a crowd that suits it. */
export const goodFitForecast = forecastAt(
  HARBOR,
  { demand: 13_900, low: 11_800, high: 15_600, fit: 'goodFit' },
  true,
);

/** Bayside Theatre with more people wanting in than it holds: the range is capped. */
export const sellOutForecast = forecastAt(
  BAYSIDE,
  { demand: 3_100, low: 2_600, high: 3_700, fit: 'likelySellOut' },
  true,
);

/** A stadium far too big for the crowd. */
export const emptyForecast = forecastAt(
  DOME,
  { demand: 9_200, low: 7_800, high: 10_600, fit: 'willLookEmpty' },
  true,
);

/** A generic local hall, with the venue placeholder picture. */
export const genericForecast = forecastAt(
  LOCAL_HALL,
  { demand: 1_000, low: 850, high: 1_150, fit: 'goodFit' },
  true,
);

/** No venue chosen yet: the game's suggestion and why. */
export const notChosenForecast = forecastAt(
  HARBOR,
  { demand: 16_800, low: 14_300, high: 19_300, fit: 'likelySellOut' },
  false,
);

function option(
  summary: VenueSummary,
  overrides: Partial<VenueOption> & Pick<VenueOption, 'group' | 'low' | 'high' | 'fit'>,
): VenueOption {
  return {
    choice: summary.choice,
    name: summary.name,
    regionName: summary.regionName,
    countryName: summary.countryName,
    capacity: summary.capacity,
    venueKind: summary.venueKind,
    imageRef: summary.imageRef,
    expected: Math.round((overrides.low + overrides.high) / 2),
    fitLabel: FIT_LABELS[overrides.fit],
    preferred: false,
    current: false,
    disabled: null,
    ...overrides,
  };
}

const LONGLEAF: VenueSummary = {
  ...BAYSIDE,
  venueId: LONGLEAF_BARN,
  name: 'Longleaf Barn',
  capacity: 900,
  venueKind: 'hall',
  choice: { kind: 'venue', venueId: LONGLEAF_BARN },
};

const MILL: VenueSummary = {
  ...BAYSIDE,
  venueId: OLD_MILL,
  name: 'Old Mill Hall',
  capacity: 3_500,
  venueKind: 'hall',
  choice: { kind: 'venue', venueId: OLD_MILL },
};

const TOKYO: VenueSummary = {
  ...HARBOR,
  venueId: TOKYO_HALL,
  name: 'Kanda Sports Hall',
  capacity: 8_000,
  regionName: 'Kanto',
  countryName: 'Japan',
  choice: { kind: 'venue', venueId: TOKYO_HALL },
};

/** The venue list in the show's country, with one venue of each unavailable kind. */
export const countryVenueOptions: ShowVenueOptions = {
  current: HARBOR,
  suggested: null,
  options: [
    option(LONGLEAF, {
      group: 'region',
      low: 900,
      high: 900,
      fit: 'likelySellOut',
      disabled: {
        code: 'boxOffice.venueExclusive',
        message: 'Exclusive to Longleaf Championship Wrestling',
      },
    }),
    option(BAYSIDE, { group: 'region', low: 2_400, high: 2_400, fit: 'likelySellOut' }),
    option(MILL, {
      group: 'region',
      low: 3_500,
      high: 3_500,
      fit: 'likelySellOut',
      disabled: {
        code: 'boxOffice.venueTaken',
        message: 'Tessen Pro Wrestling runs Iron Hour there that night',
      },
    }),
    option(HARBOR, {
      group: 'region',
      low: 11_800,
      high: 15_600,
      fit: 'goodFit',
      preferred: true,
      current: true,
    }),
    option(DOME, {
      group: 'country',
      low: 7_800,
      high: 10_600,
      fit: 'willLookEmpty',
      disabled: { code: 'boxOffice.venueClosed', message: 'Closed on that date' },
    }),
    option(LOCAL_HALL, { group: 'generic', low: 1_200, high: 1_200, fit: 'likelySellOut' }),
    option(
      { ...LOCAL_HALL, name: 'Local arena, Northeast', capacity: 12_000, venueKind: 'arena' },
      {
        choice: { kind: 'generic', tier: 'arena' },
        group: 'generic',
        low: 11_800,
        high: 12_000,
        fit: 'likelySellOut',
      },
    ),
  ],
};

/** The same list with venues abroad. */
export const worldVenueOptions: ShowVenueOptions = {
  ...countryVenueOptions,
  options: [
    ...countryVenueOptions.options.filter((entry) => entry.group !== 'generic'),
    option(TOKYO, { group: 'abroad', low: 2_100, high: 3_000, fit: 'willLookEmpty' }),
    ...countryVenueOptions.options.filter((entry) => entry.group === 'generic'),
  ],
};
