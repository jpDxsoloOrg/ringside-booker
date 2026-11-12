/**
 * Worker performance: how well one worker performs tonight on one axis of a segment.
 *
 * The in-ring axis is a weighted mean of the in-ring attributes, plus a small bonus when the
 * worker's style suits the match type, minus fatigue, minus a flat penalty for a non-wrestler or
 * for working hurt. The entertainment axis is a weighted mean of the character attributes minus
 * fatigue. The talk axis uses the angle type's own speaker weights and nothing else.
 *
 * Popularity, momentum, morale and chemistry are not here: popularity and momentum belong to the
 * crowd side, the rest are later rating modifiers.
 *
 * Design: docs/design/match-rating.md#worker-performance.
 */

import { InvalidArgumentError } from '../../../core/errors';
import { startCalc, type Calc, type Traced } from '../../../core/trace';
import type { Attributes, RingStyle } from '../../../model/entities/person';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { ATTRIBUTE_LABELS, formatNumber } from '../../world/people/labels';

export const WORKER_PERFORMANCE_DOC_REF = 'match-rating.md#worker-performance';

/** The axes a worker can be judged on. */
export const PERFORMANCE_AXES = ['inRing', 'entertainment', 'talk'] as const;
export type PerformanceAxis = (typeof PERFORMANCE_AXES)[number];

/** The axes as a trace title reads them: "Kade Morrow: In-ring". */
export const PERFORMANCE_AXIS_LABELS: Readonly<Record<PerformanceAxis, string>> = {
  inRing: 'In-ring',
  entertainment: 'Entertainment',
  talk: 'Talk',
};

/** The attributes a performance reads. */
export type PerformanceAttributeKey =
  'ringwork' | 'psychology' | 'athleticism' | 'safety' | 'mic' | 'charisma' | 'presence';

/** An angle type's speaker weights (`speakerWeights` in the angle type catalog). */
export interface TalkWeights {
  mic: number;
  charisma: number;
  presence: number;
}

export interface WorkerPerformanceInputs {
  personId: string;
  /** The worker's name, for the trace labels. */
  name: string;
  axis: PerformanceAxis;
  attributes: Pick<Attributes, PerformanceAttributeKey>;
  style: RingStyle;
  /** Current fatigue, 0..100. */
  fatigue: number;
  /** True when the worker is working hurt. */
  injured: boolean;
  /** The match type's `styleAffinity`. Read on the in-ring axis only. */
  styleAffinity: readonly RingStyle[];
  /** The angle type's speaker weights. Required on the talk axis, ignored on the others. */
  talkWeights?: TalkWeights;
  /** The angle type's name, for the talk weight labels. Defaults to "the angle type". */
  angleTypeName?: string;
}

export const ALL_WEIGHTS_ZERO_NOTE = 'All weights are 0';
export const SUITS_MATCH_TYPE_LABEL = 'Suits this match type';
export const NON_WRESTLER_LABEL = 'Not a wrestler';
export const WORKING_HURT_LABEL = 'Working hurt';

/** The ends of the performance scale, the same as the attributes it is built from. */
export const PERFORMANCE_MIN = 0;
export const PERFORMANCE_MAX = 100;

const IN_RING_WEIGHT_KEYS = [
  ['ringwork', 'match.perf.inRing.ringwork'],
  ['psychology', 'match.perf.inRing.psychology'],
  ['athleticism', 'match.perf.inRing.athleticism'],
  ['safety', 'match.perf.inRing.safety'],
] as const satisfies readonly (readonly [PerformanceAttributeKey, NumberTunableKey])[];

const ENTERTAINMENT_WEIGHT_KEYS = [
  ['charisma', 'match.perf.entertainment.charisma'],
  ['presence', 'match.perf.entertainment.presence'],
  ['mic', 'match.perf.entertainment.mic'],
] as const satisfies readonly (readonly [PerformanceAttributeKey, NumberTunableKey])[];

const TALK_ATTRIBUTES = ['mic', 'charisma', 'presence'] as const;

/** One counted attribute: its weight and, for a tunable weight, the key to record the read. */
interface WeightedAttribute {
  attribute: PerformanceAttributeKey;
  weight: number;
  key: NumberTunableKey | null;
}

function weightedAttributes(
  inputs: WorkerPerformanceInputs,
  tunables: EngineTunables,
): WeightedAttribute[] {
  switch (inputs.axis) {
    case 'inRing':
      return IN_RING_WEIGHT_KEYS.map(([attribute, key]) => ({
        attribute,
        weight: tunables.get(key),
        key,
      }));
    case 'entertainment':
      return ENTERTAINMENT_WEIGHT_KEYS.map(([attribute, key]) => ({
        attribute,
        weight: tunables.get(key),
        key,
      }));
    case 'talk': {
      const weights = inputs.talkWeights;
      if (weights === undefined) {
        throw new InvalidArgumentError(
          'workerPerformance',
          'talkWeights',
          weights,
          "the angle type's speaker weights on the talk axis",
        );
      }
      return TALK_ATTRIBUTES.map((attribute) => ({
        attribute,
        weight: weights[attribute],
        key: null,
      }));
    }
  }
}

/** Step 1: `Σ(weight × attribute) ÷ Σ weight` over the weights above 0; 0 when none are. */
function addWeightedMean(
  calc: Calc,
  inputs: WorkerPerformanceInputs,
  tunables: EngineTunables,
): void {
  const counted = weightedAttributes(inputs, tunables).filter((entry) => entry.weight > 0);
  if (counted.length === 0) {
    calc.note(ALL_WEIGHTS_ZERO_NOTE);
    return;
  }
  const angleTypeName = inputs.angleTypeName ?? 'the angle type';
  let totalWeight = 0;
  for (const { attribute, weight, key } of counted) {
    const label = ATTRIBUTE_LABELS[attribute];
    if (key !== null) {
      calc.tunable(tunables, key, `${label} weight`);
    }
    const value = inputs.attributes[attribute];
    const reason = key === null ? `Weight set by ${angleTypeName}` : undefined;
    calc.add(
      `${label} ${formatNumber(value)} × weight ${formatNumber(weight)}`,
      value * weight,
      reason,
    );
    totalWeight += weight;
  }
  calc.divide(`Total weight ${formatNumber(totalWeight)}`, totalWeight);
}

/** Step 2: the in-ring style bonus and the non-wrestler penalty. */
function addStyle(calc: Calc, inputs: WorkerPerformanceInputs, tunables: EngineTunables): void {
  const suits = inputs.styleAffinity.includes(inputs.style);
  calc.branch(SUITS_MATCH_TYPE_LABEL, suits);
  if (suits) {
    calc.add(
      SUITS_MATCH_TYPE_LABEL,
      calc.tunable(tunables, 'match.perf.styleAffinityBonus', 'Style bonus'),
    );
  }
  const nonWrestler = inputs.style === 'nonWrestler';
  calc.branch(NON_WRESTLER_LABEL, nonWrestler);
  if (nonWrestler) {
    calc.subtract(
      NON_WRESTLER_LABEL,
      calc.tunable(tunables, 'match.perf.nonWrestlerPenalty', 'Non-wrestler penalty'),
    );
  }
}

/** Step 3: `fatigue × match.perf.fatiguePenaltyPerPoint`. */
function subtractFatigue(
  calc: Calc,
  inputs: WorkerPerformanceInputs,
  tunables: EngineTunables,
): void {
  const perPoint = calc.tunable(tunables, 'match.perf.fatiguePenaltyPerPoint', 'Fatigue cost');
  calc.subtract(
    `Fatigue ${formatNumber(inputs.fatigue)} × ${formatNumber(perPoint)}`,
    inputs.fatigue * perPoint,
  );
}

/** Step 4: the flat penalty for working hurt. */
function subtractInjury(
  calc: Calc,
  inputs: WorkerPerformanceInputs,
  tunables: EngineTunables,
): void {
  calc.branch(WORKING_HURT_LABEL, inputs.injured);
  if (inputs.injured) {
    calc.subtract(
      WORKING_HURT_LABEL,
      calc.tunable(tunables, 'match.perf.injuredPenalty', 'Injury penalty'),
    );
  }
}

/**
 * A worker's performance on one axis, kept between 0 and 100:
 *
 * - in-ring: weighted mean of ringwork, psychology, athleticism and safety, + style bonus when the
 *   style suits the match type, − non-wrestler penalty, − fatigue × rate, − injury penalty;
 * - entertainment: weighted mean of charisma, presence and mic, − fatigue × rate;
 * - talk: weighted mean of mic, charisma and presence with the angle type's speaker weights.
 *
 * A weight of 0 leaves its attribute out; when every weight is 0 the mean is 0, with a note. The
 * result is not rounded.
 */
export function workerPerformance(
  inputs: WorkerPerformanceInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const calc = startCalc(`${inputs.name}: ${PERFORMANCE_AXIS_LABELS[inputs.axis]}`, 0, {
    unit: 'points',
    docRef: WORKER_PERFORMANCE_DOC_REF,
    startLabel: 'Nothing counted yet',
  });
  addWeightedMean(calc, inputs, deps.tunables);
  if (inputs.axis === 'inRing') {
    addStyle(calc, inputs, deps.tunables);
  }
  if (inputs.axis !== 'talk') {
    subtractFatigue(calc, inputs, deps.tunables);
  }
  if (inputs.axis === 'inRing') {
    subtractInjury(calc, inputs, deps.tunables);
  }
  return calc.clamp(PERFORMANCE_MIN, PERFORMANCE_MAX).done();
}
