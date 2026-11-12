/**
 * A made-up Match lab result for the gallery: one main-event tag match and 100 Runs of it, so
 * the result layout can be reviewed without an engine. The numbers are invented but consistent
 * (the score is the work rate and crowd blend, the stars sit on a quarter); each traced number has
 * a short breakdown so its Why? opens. Cards are slot-based (D-10): nothing here says how long a
 * match runs.
 */
import { parseContentKey, parseId } from '@ringside/engine';
import type {
  HistogramBin,
  PersonId,
  PreviewBatchResult,
  PreviewResult,
  SimulateBatchResult,
  QuarterCount,
  SegmentWarning,
  Traced,
  TraceUnit,
  WorkerLine,
} from '@ringside/engine';

/** A traced number whose breakdown is one input and the setting that weighed it. */
function traced(label: string, value: number, unit: TraceUnit, input: string): Traced<number> {
  return {
    value,
    trace: {
      kind: 'formula',
      label,
      value,
      unit,
      children: [{ kind: 'input', label: input, value, unit }],
    },
  };
}

interface SampleWorker {
  readonly id: PersonId;
  readonly name: string;
  readonly side: number;
  readonly inRing: number;
  readonly entertainment: number;
  readonly popularity: number;
  readonly momentum: number;
  readonly staminaPenalty: number;
}

const SAMPLE_WORKERS: readonly SampleWorker[] = [
  {
    id: parseId('person', 'per_0000000201'),
    name: 'Gallery Champion',
    side: 0,
    inRing: 81.4,
    entertainment: 74.2,
    popularity: 72.8,
    momentum: 12,
    staminaPenalty: 0,
  },
  {
    id: parseId('person', 'per_0000000202'),
    name: 'Gallery Partner With A Very Long Ring Name',
    side: 0,
    inRing: 68.9,
    entertainment: 61,
    popularity: 55.1,
    momentum: 0,
    staminaPenalty: -4,
  },
  {
    id: parseId('person', 'per_0000000203'),
    name: 'Gallery Challenger',
    side: 1,
    inRing: 77.5,
    entertainment: 80.3,
    popularity: 70.2,
    momentum: -6,
    staminaPenalty: 0,
  },
  {
    id: parseId('person', 'per_0000000204'),
    name: 'Gallery Rookie',
    side: 1,
    inRing: 59.6,
    entertainment: 52.4,
    popularity: 31,
    momentum: 3,
    staminaPenalty: -0.4,
  },
];

function workerLine(worker: SampleWorker): WorkerLine {
  return {
    personId: worker.id,
    name: worker.name,
    side: worker.side,
    inRing: traced(`${worker.name}'s in-ring`, worker.inRing, 'points', 'In-ring rating'),
    entertainment: traced(
      `${worker.name}'s entertainment`,
      worker.entertainment,
      'points',
      'Entertainment rating',
    ),
    talk: null,
    stamina: {
      need: 70,
      have: 70 + worker.staminaPenalty,
      penalty: traced(
        `${worker.name}'s stamina penalty`,
        worker.staminaPenalty,
        'points',
        'Stamina short of the need',
      ),
    },
    popularity: traced(`${worker.name}'s popularity`, worker.popularity, 'percent', 'Popularity'),
    momentum: traced(`${worker.name}'s momentum`, worker.momentum, 'points', 'Momentum'),
  };
}

const SAMPLE_WARNINGS: readonly SegmentWarning[] = [
  {
    code: 'sideCount',
    severity: 'error',
    message: 'Three sides in a Tag Team match: it takes 2',
  },
  {
    code: 'injured',
    severity: 'warning',
    message: 'Gallery Rookie is injured (bruised ribs)',
    personId: parseId('person', 'per_0000000204'),
  },
];

/** A main-event tag match, rated on seed 3. */
export const sampleLabResult: PreviewResult = {
  kind: 'match',
  score: traced('Segment score', 78, 'points', 'Work rate and crowd blend'),
  stars: traced('Stars', 3.75, 'stars', 'Blended for stars'),
  workRate: traced('Work rate', 76.4, 'points', 'Across sides'),
  talk: null,
  crowd: traced('Crowd', 79.2, 'points', 'Delivered'),
  expectation: traced('Crowd expectation', 74.6, 'points', 'Star power'),
  starPower: traced('Star power', 71.5, 'points', 'Most popular on the card'),
  slot: {
    role: 'mainEvent',
    durationClass: 'long',
    weight: 1.75,
    roleTrace: {
      value: 'mainEvent',
      trace: { kind: 'input', label: 'Slot role', value: 'Main event' },
    },
    durationTrace: {
      value: 'long',
      trace: { kind: 'input', label: 'Duration class', value: 'Long' },
    },
    weightTrace: traced('Main event weight', 1.75, 'ratio', 'Main event weight'),
  },
  workers: SAMPLE_WORKERS.map(workerLine),
  warnings: SAMPLE_WARNINGS,
  policy: { label: 'Full rules', simpleInputs: false, skipInMatchInjuries: false },
  previewSeed: 3,
};

/** Counts for the 20 histogram bins, a bell around 78. */
const BIN_COUNTS: readonly number[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 4, 12, 27, 33, 18, 5, 0,
];

const SAMPLE_HISTOGRAM: HistogramBin[] = BIN_COUNTS.map((count, index) => ({
  from: index * 5,
  to: (index + 1) * 5,
  count,
}));

const SAMPLE_QUARTERS: QuarterCount[] = Array.from({ length: 21 }, (_, index) => {
  const stars = index / 4;
  const counts: Readonly<Record<number, number>> = { 3: 6, 3.25: 14, 3.5: 30, 3.75: 34, 4: 16 };
  return { stars, count: counts[stars] ?? 0 };
});

/** Run x100 over the sample match. */
export const sampleLabBatch: PreviewBatchResult = {
  runs: 100,
  score: { mean: 78.3, sd: 4.6, min: 63, p10: 72.4, p50: 78.5, p90: 84, max: 91 },
  stars: {
    mean: 3.6,
    sd: 0.3,
    min: 3,
    p10: 3.25,
    p50: 3.75,
    p90: 4,
    max: 4,
    byQuarter: SAMPLE_QUARTERS,
  },
  workRate: { mean: 76.1, sd: 4.2, min: 64.8, p10: 70.9, p50: 76.3, p90: 81.2, max: 86.4 },
  talk: null,
  crowd: { mean: 79, sd: 3.9, min: 68.1, p10: 74.2, p50: 79.1, p90: 83.6, max: 88.9 },
  expectation: 74.6,
  histogram: SAMPLE_HISTOGRAM,
};

/** The same 100 Runs played out as a match (MTCH2-07): who won, the draws and the finishes. */
export const sampleLabSimulateBatch: SimulateBatchResult = {
  ...sampleLabBatch,
  sides: [
    {
      side: 0,
      names: ['Gallery Champion', 'Gallery Partner With A Very Long Ring Name'],
      wins: 58,
    },
    { side: 1, names: ['Gallery Challenger', 'Gallery Rookie'], wins: 37 },
  ],
  draws: 3,
  noContests: 2,
  finishes: [
    { key: parseContentKey('finish.clean'), name: 'Clean finish', category: 'clean', count: 71 },
    { key: parseContentKey('finish.cheating'), name: 'Cheating', category: 'cheating', count: 14 },
    {
      key: parseContentKey('finish.disqualification'),
      name: 'Disqualification',
      category: 'disqualification',
      count: 8,
    },
    { key: parseContentKey('finish.count-out'), name: 'Count-out', category: 'countOut', count: 2 },
    { key: parseContentKey('finish.stalemate'), name: 'Stalemate', category: 'draw', count: 3 },
    {
      key: parseContentKey('finish.no-contest'),
      name: 'No contest',
      category: 'noContest',
      count: 2,
    },
  ],
  randomWinnersMode: false,
};
