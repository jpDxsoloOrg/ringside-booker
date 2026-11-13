/**
 * Injury chance: the probability that one worker is hurt in one match (MTCH4-02).
 *
 * It reads the worker's state by the end of the match: fatigue going in plus this match's fatigue
 * gain, and body condition after this match's wear. So the chance is worked out after fatigue gain,
 * wear and every risk contribution are known, and the roll (`physical/injuries.ts`) comes last:
 * every line on the Why? panel took part in it.
 *
 * Rival promotions skip in-match injuries only through the rating policy's `skipInMatchInjuries`
 * (D-01), shown as its own line. There is no promotion-kind branch here.
 *
 * Talking segments never get here: angles carry no physical load (`collectPhysicalInputs`).
 *
 * Design: docs/design/physical-toll.md#injury-chance.
 */

import { InvalidArgumentError } from '../../../core/errors';
import {
  constantOf,
  startCalc,
  traced,
  type Calc,
  type TraceNode,
  type Traced,
} from '../../../core/trace';
import { tunableNode } from '../../../core/trace/tunable-node';
import {
  BODY_PARTS,
  type BodyCondition,
  type BodyPart,
  type RingStyle,
  type TraitKey,
} from '../../../model/entities/person';
import { BODY_PART_LABELS, STYLE_LABELS, formatNumber } from '../../world/people/labels';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import type { PhysicalOpponent } from '../physical/inputs';
import type { RiskContribution } from '../physical/riskModifiers';
import { DURATION_CLASS_LABELS, type DurationClass } from '../slots';
import { applyRepeatMatch, keepItSafeSource } from './fatigueGain';

export const INJURY_CHANCE_DOC_REF = 'physical-toll.md#injury-chance';

/** The line the `match.injury.enabled` switch adds when it is off. */
export const INJURIES_OFF_LABEL = 'In-match injuries switched off';
/** The line the rating policy's `skipInMatchInjuries` adds (D-01). */
export const RIVAL_NO_INJURIES_LABEL = 'Rival rules: no in-match injuries';
/** The label of the end-of-match fatigue input. */
export const END_FATIGUE_LABEL = 'Fatigue by the end of the match';

export interface InjuryChanceInputs {
  /** The worker's name, for the trace. */
  name: string;
  durationClass: DurationClass;
  /** Fatigue going in (the stored value, or the lab override). */
  fatigueGoingIn: number;
  /** This match's fatigue gain (`computeFatigueGain`). */
  fatigueGain: Traced<number> | number;
  /** Body condition after this match's wear (`conditionAfterWear`). */
  conditionAfterWear: Readonly<BodyCondition>;
  style: RingStyle;
  traits: readonly TraitKey[];
  /** Every competitor on another side. */
  opponents: readonly PhysicalOpponent[];
  /** The risk contributions that reach this worker, in order (`collectRiskContributions`). */
  contributions: readonly RiskContribution[];
  /** The booker asked for it to be kept safe. A contribution can switch it on as well. */
  keepItSafe: boolean;
  /** Matches this worker works earlier on the same card; 0 for the first. */
  matchesEarlierTonight: number;
  /** The promotion's rating policy says rivals skip in-match injuries (D-01). */
  skipInMatchInjuries: boolean;
  /** The policy's own trace, attached under the rival-rules line when given. */
  policyTrace?: TraceNode | null;
}

const DURATION_KEYS = {
  short: 'match.injury.duration.short',
  standard: 'match.injury.duration.standard',
  long: 'match.injury.duration.long',
} as const satisfies Readonly<Record<DurationClass, NumberTunableKey>>;

/** Fatigue and condition are on a 0..100 scale. */
const SCALE_TOP = 100;
/** The middle of the 0..100 safety scale: an opponent at 50 neither adds nor takes off. */
const SAFETY_MIDDLE = 50;

/** The lowest body part, ties in `BODY_PARTS` order. */
export function worstBodyPart(condition: Readonly<BodyCondition>): {
  part: BodyPart;
  value: number;
} {
  let worst: { part: BodyPart; value: number } | null = null;
  for (const part of BODY_PARTS) {
    const value = condition[part];
    if (worst === null || value < worst.value) {
      worst = { part, value };
    }
  }
  if (worst === null) {
    throw new RangeError('worstBodyPart: there are no body parts');
  }
  return worst;
}

/**
 * Body condition after a match's wear: each part minus its wear, never below 0. `wear` is
 * `computeWearByPart`'s result (or plain numbers in a test).
 */
export function conditionAfterWear(
  condition: Readonly<BodyCondition>,
  wear: Readonly<Record<BodyPart, Traced<number> | number>>,
): BodyCondition {
  const amount = (part: BodyPart): number => {
    const lost = wear[part];
    return typeof lost === 'number' ? lost : lost.value;
  };
  return {
    head: Math.max(0, condition.head - amount('head')),
    neck: Math.max(0, condition.neck - amount('neck')),
    back: Math.max(0, condition.back - amount('back')),
    arms: Math.max(0, condition.arms - amount('arms')),
    torso: Math.max(0, condition.torso - amount('torso')),
    legs: Math.max(0, condition.legs - amount('legs')),
  };
}

/** The opponent with the lowest safety, ties by person id. */
export function leastSafeOpponentOf(
  opponents: readonly PhysicalOpponent[],
): PhysicalOpponent | null {
  let least: PhysicalOpponent | null = null;
  for (const opponent of opponents) {
    if (
      least === null ||
      opponent.safety < least.safety ||
      (opponent.safety === least.safety && opponent.personId < least.personId)
    ) {
      least = opponent;
    }
  }
  return least;
}

/** The opponent whose style raises the injury chance most: highest factor, ties by person id. */
export function riskiestOpponentOf(
  opponents: readonly PhysicalOpponent[],
  tunables: EngineTunables,
): PhysicalOpponent | null {
  let riskiest: { opponent: PhysicalOpponent; factor: number } | null = null;
  for (const opponent of opponents) {
    const factor = tunables.get(`match.injury.opponentStyle.${opponent.style}`);
    if (
      riskiest === null ||
      factor > riskiest.factor ||
      (factor === riskiest.factor && opponent.personId < riskiest.opponent.personId)
    ) {
      riskiest = { opponent, factor };
    }
  }
  return riskiest?.opponent ?? null;
}

function checkInputs(inputs: InjuryChanceInputs): void {
  if (!Number.isInteger(inputs.matchesEarlierTonight) || inputs.matchesEarlierTonight < 0) {
    throw new InvalidArgumentError(
      'computeInjuryChance',
      'matchesEarlierTonight',
      inputs.matchesEarlierTonight,
      'a whole number of at least 0',
    );
  }
}

/** `min(100, fatigue going in + this match's gain) × perFatiguePoint`. */
function fatigueTerm(inputs: InjuryChanceInputs, tunables: EngineTunables): Traced<number> {
  const endFatigue = startCalc(END_FATIGUE_LABEL, inputs.fatigueGoingIn, {
    unit: 'points',
    startLabel: `${inputs.name}'s fatigue going in`,
  })
    .add('Fatigue from this match', inputs.fatigueGain)
    .min(
      'Fatigue tops out at 100',
      constantOf('Most fatigue', SCALE_TOP, 'Fatigue is on a 0 to 100 scale'),
    )
    .done();
  const term = startCalc('Fatigue risk', endFatigue, { unit: 'probability' });
  return term
    .multiply(
      'Per point of fatigue',
      term.tunable(tunables, 'match.injury.perFatiguePoint', 'Injury chance per point of fatigue'),
    )
    .done();
}

/** `(100 − worst condition after this match's wear) × perConditionPointLost`. */
function conditionTerm(
  worst: { part: BodyPart; value: number },
  tunables: EngineTunables,
): Traced<number> {
  const term = startCalc(
    'Body condition risk',
    constantOf('Full condition', SCALE_TOP, 'Condition is on a 0 to 100 scale'),
    { unit: 'probability' },
  );
  return term
    .subtract(`${BODY_PART_LABELS[worst.part]} after this match`, worst.value)
    .multiply(
      'Per point lost',
      term.tunable(
        tunables,
        'match.injury.perConditionPointLost',
        'Injury chance per point of condition lost',
      ),
    )
    .done();
}

/** `clamp(1 + (50 − lowest opponent safety) × opponentSafetyWeight, min, max)`. */
function opponentSafetyFactor(safety: number, tunables: EngineTunables): Traced<number> {
  const calc = startCalc('Opponent safety factor', 0, {
    unit: 'multiplier',
    startLabel: 'Nothing yet',
  });
  calc
    .add(
      'Middle of the scale',
      constantOf('Middle of the scale', SAFETY_MIDDLE, 'Safety of 50 neither adds nor takes off'),
    )
    .subtract("Least safe opponent's safety", safety)
    .multiply(
      'Per point of safety',
      calc.tunable(tunables, 'match.injury.opponentSafetyWeight', 'Injury chance per point'),
    )
    .add(
      'An ordinary opponent',
      constantOf('No change', 1, 'Safety of 50 leaves the chance as it is'),
    )
    .max('Safest it gets', calc.tunable(tunables, 'match.injury.minSafetyFactor'))
    .min('Riskiest it gets', calc.tunable(tunables, 'match.injury.maxSafetyFactor'));
  return calc.done();
}

function applyOpponents(
  calc: Calc,
  opponents: readonly PhysicalOpponent[],
  tunables: EngineTunables,
): void {
  const leastSafe = leastSafeOpponentOf(opponents);
  const riskiest = riskiestOpponentOf(opponents, tunables);
  if (leastSafe === null || riskiest === null) {
    calc.note('No opponents');
    return;
  }
  calc
    .multiply(
      `Least safe opponent: ${leastSafe.name}, safety ${formatNumber(leastSafe.safety)}`,
      opponentSafetyFactor(leastSafe.safety, tunables),
    )
    .multiply(
      `Riskiest opponent: ${riskiest.name} (${STYLE_LABELS[riskiest.style]})`,
      calc.tunable(tunables, `match.injury.opponentStyle.${riskiest.style}`),
    );
}

function applySwitches(calc: Calc, inputs: InjuryChanceInputs, tunables: EngineTunables): void {
  if (!tunables.get('match.injury.enabled')) {
    calc.branch(INJURIES_OFF_LABEL, true);
    calc.tunable(tunables, 'match.injury.enabled', 'In-match injuries');
    calc.multiply(INJURIES_OFF_LABEL, 0);
  }
  if (inputs.skipInMatchInjuries) {
    calc.branch(RIVAL_NO_INJURIES_LABEL, true);
    const policy = inputs.policyTrace;
    calc.multiply(
      RIVAL_NO_INJURIES_LABEL,
      policy === undefined || policy === null
        ? 0
        : traced(0, { kind: 'input', label: 'Rating policy', value: 0, children: [policy] }),
    );
  }
}

/**
 * The chance one worker is injured in one match, as a probability:
 *
 * `(baseChance + min(100, fatigue in + gain) × perFatiguePoint + (100 − worst part after wear)
 * × perConditionPointLost) × duration.<class> × least safe opponent's factor × selfStyle.<style>
 * × riskiest opponent's opponentStyle × injuryProne/durable`, then `+ each contribution's
 * injuryAdd`, `× each injuryMultiplier`, `× injury.repeatMatch^earlier`, `× keep it safe`, kept
 * within 0..`match.injury.maxChance`; finally × 0 when `match.injury.enabled` is off or the policy
 * skips in-match injuries, each with its own line.
 *
 * @throws InvalidArgumentError for a negative or fractional `matchesEarlierTonight`.
 */
export function computeInjuryChance(
  inputs: InjuryChanceInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  checkInputs(inputs);
  const { tunables } = deps;
  const base = traced(
    tunables.get('match.injury.baseChance'),
    tunableNode(tunables, 'match.injury.baseChance', 'Base injury chance'),
  );
  const calc = startCalc(`Injury chance for ${inputs.name}`, base, {
    unit: 'probability',
    docRef: INJURY_CHANCE_DOC_REF,
  });

  const worst = worstBodyPart(inputs.conditionAfterWear);
  calc
    .add(END_FATIGUE_LABEL, fatigueTerm(inputs, tunables))
    .add(
      `Worst body part: ${BODY_PART_LABELS[worst.part]} ${formatNumber(worst.value)}`,
      conditionTerm(worst, tunables),
    )
    .multiply(
      `${DURATION_CLASS_LABELS[inputs.durationClass]} duration class`,
      calc.tunable(tunables, DURATION_KEYS[inputs.durationClass]),
    );

  applyOpponents(calc, inputs.opponents, tunables);

  calc.multiply(
    `${STYLE_LABELS[inputs.style]} style`,
    calc.tunable(tunables, `match.injury.selfStyle.${inputs.style}`),
  );
  if (inputs.traits.includes('injuryProne')) {
    calc.multiply('Injury prone', calc.tunable(tunables, 'match.injury.injuryProneFactor'));
  }
  if (inputs.traits.includes('durable')) {
    calc.multiply('Durable', calc.tunable(tunables, 'match.injury.durableFactor'));
  }
  for (const contribution of inputs.contributions) {
    if (contribution.injuryAdd !== undefined) {
      calc.add(contribution.source, contribution.injuryAdd);
    }
  }
  for (const contribution of inputs.contributions) {
    if (contribution.injuryMultiplier !== undefined) {
      calc.multiply(contribution.source, contribution.injuryMultiplier);
    }
  }
  applyRepeatMatch(calc, inputs.matchesEarlierTonight, tunables, 'match.injury.repeatMatch');
  const safe = keepItSafeSource(inputs);
  if (safe.on) {
    calc.multiply(safe.label, calc.tunable(tunables, 'match.injury.keepItSafeFactor'));
  }

  calc.clamp(
    0,
    calc.tunable(tunables, 'match.injury.maxChance'),
    'Between 0 and the highest chance one match can carry',
  );
  applySwitches(calc, inputs, tunables);
  return calc.done();
}
