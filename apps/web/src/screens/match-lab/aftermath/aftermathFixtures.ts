/**
 * Hand-made `SegmentAftermath` answers for the gallery and the Aftermath panel's tests (MTCH3-04):
 * a singles upset in Northeast with two neighbours and a TV reach region, and a four-way with a
 * worker who has no contract. The traces are small but shaped like the engine's, so every Why?
 * opens with the same steps: the match's change, the region's share, then the value before.
 */
import type {
  AftermathMomentum,
  AftermathNoMomentum,
  AftermathRegionRow,
  AftermathRollupRow,
  AftermathWorker,
  ContinentId,
  CountryId,
  MatchResultForSide,
  PersonId,
  RegionId,
  RegionWeightLine,
  SegmentAftermath,
  Traced,
  TraceNode,
} from '@ringside/engine';
import { parseId } from '@ringside/engine';

export const FIXTURE_PROMOTION_NAME = 'Altura';

const NORTHEAST = parseId('region', 'reg_0000000001');
const LAKESHORE = parseId('region', 'reg_0000000002');
const CAPITAL = parseId('region', 'reg_0000000003');
const COASTLINE = parseId('region', 'reg_0000000004');

const NORTH_COUNTRY = parseId('country', 'cty_0000000001');
const EAST_COUNTRY = parseId('country', 'cty_0000000002');
const CONTINENT = parseId('continent', 'ctn_0000000001');

interface RegionPlace {
  readonly regionId: RegionId;
  readonly name: string;
  readonly countryId: CountryId;
}

const REGIONS: Readonly<Record<'northeast' | 'lakeshore' | 'capital' | 'coastline', RegionPlace>> =
  {
    northeast: { regionId: NORTHEAST, name: 'Northeast', countryId: NORTH_COUNTRY },
    lakeshore: { regionId: LAKESHORE, name: 'Lakeshore', countryId: NORTH_COUNTRY },
    capital: { regionId: CAPITAL, name: 'Capital', countryId: EAST_COUNTRY },
    coastline: { regionId: COASTLINE, name: 'Coastline', countryId: EAST_COUNTRY },
  };

const COUNTRY_NAMES: Readonly<Record<CountryId, string>> = {
  [NORTH_COUNTRY]: 'Norland',
  [EAST_COUNTRY]: 'Eastmark',
};

function person(index: number): PersonId {
  return parseId('person', `per_00000000${String(index).padStart(2, '0')}`);
}

function input(label: string, value: number): TraceNode {
  return { kind: 'input', label, value, unit: 'points' };
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/** The popularity formula's answer: a few of its real lines, kept short. */
function popularityDelta(resultLine: string, value: number): Traced<number> {
  return {
    value,
    trace: {
      kind: 'formula',
      label: 'Popularity from the match',
      value,
      unit: 'points',
      children: [
        input(resultLine, value),
        {
          kind: 'clamp',
          label: 'Per-match limit',
          value,
          min: -3,
          max: 4,
          before: value,
          after: value,
          applied: false,
        },
      ],
    },
  };
}

/** The door's after-value: the change × the region's share, plus the value before. */
function regionTrace(name: string, delta: number, weight: number, before: number): TraceNode {
  const shared = delta * weight;
  const after = round(Math.min(100, Math.max(0, before + shared)), 2);
  return {
    kind: 'formula',
    label: `Popularity in ${name}`,
    value: after,
    unit: 'points',
    children: [
      input('Change asked for', delta),
      {
        kind: 'multiply',
        label: `Share for ${name}`,
        value: shared,
        operand: weight,
        before: delta,
        after: shared,
      },
      {
        kind: 'add',
        label: 'Popularity before',
        value: before + shared,
        operand: before,
        before: shared,
        after: before + shared,
      },
      {
        kind: 'clamp',
        label: 'Popularity limits',
        value: after,
        min: 0,
        max: 100,
        before: before + shared,
        after,
        applied: false,
      },
    ],
  };
}

interface Spread {
  readonly place: RegionPlace;
  readonly weight: number;
  readonly source: string;
  readonly reason: string;
}

const SINGLES_SPREAD: readonly Spread[] = [
  { place: REGIONS.northeast, weight: 1, source: 'show', reason: 'Show region' },
  { place: REGIONS.lakeshore, weight: 0.4, source: 'neighbour', reason: 'Neighbour of Northeast' },
  { place: REGIONS.capital, weight: 0.4, source: 'neighbour', reason: 'Neighbour of Northeast' },
  { place: REGIONS.coastline, weight: 0.25, source: 'tv', reason: 'TV reach: Coastline Sports' },
];

const FOUR_WAY_SPREAD: readonly Spread[] = SINGLES_SPREAD.slice(0, 3);

function weightLines(spread: readonly Spread[]): RegionWeightLine[] {
  return spread.map(({ place, weight, source, reason }) => ({
    regionId: place.regionId,
    name: place.name,
    weight,
    source,
    reason,
  }));
}

function rollup<Id extends string>(
  id: Id,
  name: string,
  rows: readonly AftermathRegionRow[],
): AftermathRollupRow<Id> {
  const before = round(rows.reduce((sum, row) => sum + row.before, 0) / rows.length, 2);
  const after = round(rows.reduce((sum, row) => sum + row.after, 0) / rows.length, 2);
  const change = after - before;
  return {
    id,
    name,
    before,
    after,
    change,
    trace: {
      kind: 'formula',
      label: `Popularity in ${name}`,
      value: change,
      unit: 'points',
      children: [
        input('After roll-up (population-weighted)', after),
        {
          kind: 'subtract',
          label: 'Before roll-up (population-weighted)',
          value: change,
          operand: before,
          before: after,
          after: change,
        },
      ],
    },
  };
}

interface WorkerSpec {
  readonly index: number;
  readonly name: string;
  readonly side: number;
  readonly outcome: MatchResultForSide;
  readonly resultLine: string;
  readonly popularity: number;
  readonly delta: number;
  /** Momentum before and the change; null for no contract. */
  readonly momentum: { readonly before: number; readonly change: number } | null;
}

function momentumOf(spec: WorkerSpec): AftermathMomentum | AftermathNoMomentum {
  if (spec.momentum === null) return { none: 'noContract' };
  const { before, change } = spec.momentum;
  const after = Math.max(-100, Math.min(100, before + change));
  return {
    employmentId: parseId('employment', `emp_00000000${String(spec.index).padStart(2, '0')}`),
    before,
    started: false,
    after,
    change: after - before,
    delta: { value: change, trace: input(spec.resultLine, change) },
    trace: {
      kind: 'formula',
      label: 'Momentum',
      value: after,
      children: [
        input('Momentum before', before),
        {
          kind: 'add',
          label: spec.resultLine,
          value: before + change,
          operand: change,
          before,
          after: before + change,
        },
        {
          kind: 'clamp',
          label: 'Momentum limits',
          value: after,
          min: -100,
          max: 100,
          before: before + change,
          after,
          applied: false,
        },
      ],
    },
  };
}

function workerOf(spec: WorkerSpec, spread: readonly Spread[]): AftermathWorker {
  const delta = popularityDelta(spec.resultLine, spec.delta);
  const regions = spread.map(({ place, weight, source, reason }): AftermathRegionRow => {
    const trace = regionTrace(place.name, spec.delta, weight, spec.popularity);
    const after = typeof trace.value === 'number' ? trace.value : spec.popularity;
    return {
      regionId: place.regionId,
      name: place.name,
      source,
      reason,
      weight,
      before: spec.popularity,
      after,
      change: after - spec.popularity,
      trace,
    };
  });
  const byCountry = new Map<CountryId, AftermathRegionRow[]>();
  spread.forEach(({ place }, index) => {
    const row = regions[index];
    if (row !== undefined) {
      byCountry.set(place.countryId, [...(byCountry.get(place.countryId) ?? []), row]);
    }
  });
  return {
    personId: person(spec.index),
    name: spec.name,
    side: spec.side,
    outcome: spec.outcome,
    resultLine: spec.resultLine,
    popularity: {
      delta,
      regions,
      countries: [...byCountry.entries()].map(([id, rows]) =>
        rollup(id, COUNTRY_NAMES[id] ?? id, rows),
      ),
      continents: [rollup<ContinentId>(CONTINENT, 'North Continent', regions)],
    },
    momentum: momentumOf(spec),
  };
}

function aftermathOf(specs: readonly WorkerSpec[], spread: readonly Spread[]): SegmentAftermath {
  return {
    segmentId: null,
    eventInstanceId: null,
    showRegionId: NORTHEAST,
    showRegionName: 'Northeast',
    weights: weightLines(spread),
    notes: [],
    workers: specs.map((spec) => workerOf(spec, spread)),
  };
}

/** A singles upset in Northeast: the underdog wins, with two neighbours and a TV reach region. */
export function singlesUpsetAftermath(): SegmentAftermath {
  return aftermathOf(
    [
      {
        index: 1,
        name: 'Kara Voss',
        side: 0,
        outcome: 'win',
        resultLine: 'Beat Rex Harlan',
        popularity: 42,
        delta: 4,
        momentum: { before: 12, change: 10 },
      },
      {
        index: 2,
        name: 'Rex Harlan',
        side: 1,
        outcome: 'loss',
        resultLine: 'Lost to Kara Voss',
        popularity: 73,
        delta: -1.5,
        momentum: { before: 30, change: -7 },
      },
    ],
    SINGLES_SPREAD,
  );
}

/** A four-way won by side 3; the side 4 worker has no contract with the promotion. */
export function fourWayAftermath(): SegmentAftermath {
  return aftermathOf(
    [
      {
        index: 3,
        name: 'Vic Moreno',
        side: 0,
        outcome: 'loss',
        resultLine: 'Lost to Dee Lux',
        popularity: 35,
        delta: -0.4,
        momentum: { before: 5, change: -2 },
      },
      {
        index: 4,
        name: 'Jo Tanaka',
        side: 1,
        outcome: 'loss',
        resultLine: 'Lost to Dee Lux',
        popularity: 28,
        delta: -0.02,
        momentum: { before: -10, change: -3 },
      },
      {
        index: 5,
        name: 'Dee Lux',
        side: 2,
        outcome: 'win',
        resultLine: 'Beat Vic Moreno, Jo Tanaka and Sam Ortiz',
        popularity: 50,
        delta: 1.2,
        momentum: { before: 0, change: 6 },
      },
      {
        index: 6,
        name: 'Sam Ortiz',
        side: 3,
        outcome: 'loss',
        resultLine: 'Lost to Dee Lux',
        popularity: 20,
        delta: -0.3,
        momentum: null,
      },
    ],
    FOUR_WAY_SPREAD,
  );
}
