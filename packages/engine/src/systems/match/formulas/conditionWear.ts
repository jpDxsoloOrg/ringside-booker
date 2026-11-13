/**
 * Condition wear: how much body condition one worker loses in one match (MTCH4-01). This is the
 * wear load in condition points at part weight 1; `wearByPart` spreads it over the body.
 *
 * Starts from the wear the slot's duration class costs, then moves it by the worker's own style,
 * the roughest opponent's style, how safe the opponents are, body traits, a house show, every risk
 * contribution that reaches the worker, working more than once on the card and keep-it-safe, and
 * finally one roughness roll. Kept between 0 and `match.wear.maxPerSegment`.
 *
 * The roll is drawn exactly once per call, even when `match.wear.spread` is 0, so retuning never
 * shifts the `match.wear` stream.
 *
 * Design: docs/design/physical-toll.md#wear.
 */

import { InvalidArgumentError } from '../../../core/errors';
import { rollFloat } from '../../../core/rng/rolls';
import type { RngStream } from '../../../core/rng/registry';
import { constantOf, startCalc, traced, type Traced } from '../../../core/trace';
import { tunableNode } from '../../../core/trace/tunable-node';
import type { EventImportance } from '../../../model/entities/event-definition';
import type { RingStyle, TraitKey } from '../../../model/entities/person';
import { STYLE_LABELS, formatNumber } from '../../world/people/labels';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import type { PhysicalOpponent } from '../physical/inputs';
import type { RiskContribution } from '../physical/riskModifiers';
import { DURATION_CLASS_LABELS, type DurationClass } from '../slots';
import { applyRepeatMatch, keepItSafeSource } from './fatigueGain';

export const CONDITION_WEAR_DOC_REF = 'physical-toll.md#wear';
export const ROUGHNESS_ROLL_LABEL = 'How rough the match was';

export interface ConditionWearInputs {
  /** The worker's name, for the trace. */
  name: string;
  durationClass: DurationClass;
  style: RingStyle;
  traits: readonly TraitKey[];
  /** Every competitor on another side. */
  opponents: readonly PhysicalOpponent[];
  importance: EventImportance;
  /** The risk contributions that reach this worker, in order (`collectRiskContributions`). */
  contributions: readonly RiskContribution[];
  /** The booker asked for it to be kept safe. A contribution can switch it on as well. */
  keepItSafe: boolean;
  /** Matches this worker works earlier on the same card; 0 for the first. */
  matchesEarlierTonight: number;
}

const WEAR_BASE_KEYS = {
  short: 'match.wear.base.short',
  standard: 'match.wear.base.standard',
  long: 'match.wear.base.long',
} as const satisfies Readonly<Record<DurationClass, NumberTunableKey>>;

/** The middle of the 0..100 safety scale: opponents at 50 neither add wear nor take it off. */
const SAFETY_MIDDLE = 50;

/** The opponent whose style is roughest: the highest `opponentStyle` factor, ties by person id. */
export function roughestOpponentOf(
  opponents: readonly PhysicalOpponent[],
  tunables: EngineTunables,
): PhysicalOpponent | null {
  let roughest: { opponent: PhysicalOpponent; factor: number } | null = null;
  for (const opponent of opponents) {
    const factor = tunables.get(`match.wear.opponentStyle.${opponent.style}`);
    if (
      roughest === null ||
      factor > roughest.factor ||
      (factor === roughest.factor && opponent.personId < roughest.opponent.personId)
    ) {
      roughest = { opponent, factor };
    }
  }
  return roughest?.opponent ?? null;
}

/** `clamp(1 + (50 − mean safety) × safetyWeight, minSafetyFactor, maxSafetyFactor)`. */
function safetyFactor(meanSafety: number, tunables: EngineTunables): Traced<number> {
  const calc = startCalc("Opponents' safety factor", 0, {
    unit: 'multiplier',
    startLabel: 'Nothing yet',
  });
  calc
    .add(
      'Middle of the scale',
      constantOf('Middle of the scale', SAFETY_MIDDLE, 'Safety of 50 neither adds nor takes off'),
    )
    .subtract("Opponents' average safety", meanSafety)
    .multiply(
      'Per point of safety',
      calc.tunable(tunables, 'match.wear.safetyWeight', 'Wear per point of safety'),
    )
    .add('An ordinary opponent', constantOf('No change', 1, 'Safety of 50 leaves wear as it is'))
    .max('Safest it gets', calc.tunable(tunables, 'match.wear.minSafetyFactor'))
    .min('Roughest it gets', calc.tunable(tunables, 'match.wear.maxSafetyFactor'));
  return calc.done();
}

/** `1 + spread × (2u − 1)`. */
function roughnessFactor(roll: number, tunables: EngineTunables): Traced<number> {
  const calc = startCalc('Roughness', roll, {
    unit: 'multiplier',
    startLabel: ROUGHNESS_ROLL_LABEL,
  });
  calc
    .multiply(
      'Either way',
      constantOf('Either way', 2, 'Turns a 0..1 roll into −1..1 with the next step'),
    )
    .subtract('Centred on an ordinary match', constantOf('Centre', 1, 'The middle of −1..1 is 0'))
    .multiply('Spread', calc.tunable(tunables, 'match.wear.spread', 'Roughness spread'))
    .add(
      'An ordinary match',
      constantOf('No change', 1, 'A roll in the middle leaves wear as it is'),
    );
  return calc.done();
}

function checkInputs(inputs: ConditionWearInputs): void {
  if (!Number.isInteger(inputs.matchesEarlierTonight) || inputs.matchesEarlierTonight < 0) {
    throw new InvalidArgumentError(
      'computeConditionWear',
      'matchesEarlierTonight',
      inputs.matchesEarlierTonight,
      'a whole number of at least 0',
    );
  }
}

/** Mean safety of the opponents. */
function meanSafetyOf(opponents: readonly PhysicalOpponent[]): number {
  return opponents.reduce((sum, opponent) => sum + opponent.safety, 0) / opponents.length;
}

/**
 * The wear load for one worker in one match, in condition points at part weight 1:
 *
 * `base.<class> × selfStyle.<style> × roughest opponent's opponentStyle × opponents' safety factor
 * × durable/injuryProne × house show × each contribution's wearMultiplier × repeatMatch^earlier
 * × keep it safe × (1 + spread × (2u − 1))`, kept within 0..`match.wear.maxPerSegment`.
 *
 * @throws InvalidArgumentError for a negative `matchesEarlierTonight`.
 */
export function computeConditionWear(
  inputs: ConditionWearInputs,
  deps: { tunables: EngineTunables; rng: RngStream },
): Traced<number> {
  checkInputs(inputs);
  const { tunables } = deps;
  const baseKey = WEAR_BASE_KEYS[inputs.durationClass];
  const base = traced(
    tunables.get(baseKey),
    tunableNode(tunables, baseKey, `${DURATION_CLASS_LABELS[inputs.durationClass]} duration class`),
  );
  const calc = startCalc(`Wear for ${inputs.name}`, base, {
    unit: 'points',
    docRef: CONDITION_WEAR_DOC_REF,
  });

  calc.multiply(
    `${STYLE_LABELS[inputs.style]} style`,
    calc.tunable(tunables, `match.wear.selfStyle.${inputs.style}`),
  );

  const roughest = roughestOpponentOf(inputs.opponents, tunables);
  if (roughest === null) {
    calc.note('No opponents');
  } else {
    calc
      .multiply(
        `Roughest opponent: ${roughest.name} (${STYLE_LABELS[roughest.style]})`,
        calc.tunable(tunables, `match.wear.opponentStyle.${roughest.style}`),
      )
      .multiply(
        `Opponents' safety ${formatNumber(meanSafetyOf(inputs.opponents))}`,
        safetyFactor(meanSafetyOf(inputs.opponents), tunables),
      );
  }

  if (inputs.traits.includes('durable')) {
    calc.multiply('Durable', calc.tunable(tunables, 'match.wear.durableFactor'));
  }
  if (inputs.traits.includes('injuryProne')) {
    calc.multiply('Injury prone', calc.tunable(tunables, 'match.wear.injuryProneFactor'));
  }
  if (inputs.importance === 'house') {
    calc.multiply('House show', calc.tunable(tunables, 'match.wear.houseShowFactor'));
  }
  for (const contribution of inputs.contributions) {
    if (contribution.wearMultiplier !== undefined) {
      calc.multiply(contribution.source, contribution.wearMultiplier);
    }
  }
  applyRepeatMatch(calc, inputs.matchesEarlierTonight, tunables);
  const safe = keepItSafeSource(inputs);
  if (safe.on) {
    calc.multiply(safe.label, calc.tunable(tunables, 'match.wear.keepItSafeFactor'));
  }

  // Exactly one draw per call, whatever the tunables say.
  const roll = rollFloat(deps.rng, 0, 1, ROUGHNESS_ROLL_LABEL);
  calc.roll(roll.roll).multiply(ROUGHNESS_ROLL_LABEL, roughnessFactor(roll.value, tunables));

  return calc
    .clamp(
      0,
      calc.tunable(tunables, 'match.wear.maxPerSegment'),
      'Between 0 and the most one match can cost',
    )
    .done();
}
