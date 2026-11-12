/**
 * Crowd expectation: what a crowd expects from these workers in this slot (D-02).
 *
 * A crowd judges a segment against what it expected, not mostly by how popular the workers are.
 * The expectation starts from a base, rises with star power and momentum, and moves with the slot,
 * the size of the event and whether it is on TV. `crowdScore` then compares what was delivered with
 * this number. Each term is one labelled line, so the "Why?" panel reads like a list of reasons.
 *
 * Design: docs/design/match-rating.md#crowd-and-expectation-d-02.
 */

import { inputOf, startCalc, type Traced } from '../../../core/trace';
import type { EventImportance } from '../../../model/entities/event-definition';
import type { SlotRole } from '../slots';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import { signedNumber, summaryOf } from './shared';

export const EXPECTATION_DOC_REF = 'match-rating.md#crowd-and-expectation-d-02';

/** Event importance as the "Event size" line reads it. */
export const EVENT_IMPORTANCE_LABELS: Readonly<Record<EventImportance, string>> = {
  house: 'House show',
  minor: 'Minor',
  regular: 'Regular',
  major: 'Major',
  flagship: 'Flagship',
};

export interface CrowdExpectationInputs {
  /** The segment's star power (`starPower`). Read as one flat line (see `summaryOf`). */
  starPower: Traced<number>;
  /**
   * The mean of the participants' employment momentum with the promoting promotion, −100..100.
   * A null momentum counts as 0.
   */
  momentum: number;
  role: SlotRole;
  /** The role as the player reads it, such as "Main event". */
  roleLabel: string;
  importance: EventImportance;
  televised: boolean;
}

const SLOT_KEYS = {
  preShow: 'match.expectation.slot.preShow',
  opener: 'match.expectation.slot.opener',
  midcard: 'match.expectation.slot.midcard',
  semiMain: 'match.expectation.slot.semiMain',
  mainEvent: 'match.expectation.slot.mainEvent',
} as const satisfies Readonly<Record<SlotRole, NumberTunableKey>>;

const IMPORTANCE_KEYS = {
  house: 'match.expectation.importance.house',
  minor: 'match.expectation.importance.minor',
  regular: 'match.expectation.importance.regular',
  major: 'match.expectation.importance.major',
  flagship: 'match.expectation.importance.flagship',
} as const satisfies Readonly<Record<EventImportance, NumberTunableKey>>;

export const EXPECTATION_LABEL = 'Expected';
export const NOT_TELEVISED_LABEL = 'Not on TV +0';

/** The ends of the expectation scale, the same as the crowd score's. */
const EXPECTATION_MIN = 0;
const EXPECTATION_MAX = 100;

/**
 * `base + starPower × starWeight + momentum × momentumWeight + slot.<role> + importance.<importance>
 * + (televised ? televised : 0)`, kept between 0 and 100. Six lines, one per term: "Base
 * expectation +25", "Star power 92.8 × 0.5", "Momentum 0 × 0.1", "Card position: Main event +8",
 * "Event size: Regular +0" and "On TV +2" (or "Not on TV +0").
 */
export function crowdExpectation(
  inputs: CrowdExpectationInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc(EXPECTATION_LABEL, 0, {
    unit: 'points',
    docRef: EXPECTATION_DOC_REF,
    startLabel: 'Nothing expected yet',
  });

  const base = calc.tunable(tunables, 'match.expectation.base', 'Base expectation');
  calc.add(`Base expectation ${signedNumber(base)}`, base);

  // Star power's own story is told where it is delivered (`crowdScore`); here it is one line, so the
  // crowd trace stays inside the depth limit.
  const fromStars = startCalc(
    'From star power',
    summaryOf(inputs.starPower, inputs.starPower.trace.label, 'points'),
    { unit: 'points' },
  );
  const starWeight = fromStars.tunable(tunables, 'match.expectation.starWeight', 'Star weight');
  fromStars.multiply('Star weight', starWeight);
  calc.add(
    `Star power ${formatNumber(inputs.starPower.value)} × ${formatNumber(starWeight)}`,
    fromStars.done(),
  );

  const fromMomentum = startCalc(
    'From momentum',
    inputOf('Momentum with the promotion', inputs.momentum, undefined, 'points'),
    { unit: 'points' },
  );
  const momentumWeight = fromMomentum.tunable(
    tunables,
    'match.expectation.momentumWeight',
    'Momentum weight',
  );
  fromMomentum.multiply('Momentum weight', momentumWeight);
  calc.add(
    `Momentum ${signedNumber(inputs.momentum)} × ${formatNumber(momentumWeight)}`,
    fromMomentum.done(),
  );

  const slot = calc.tunable(tunables, SLOT_KEYS[inputs.role], `${inputs.roleLabel} expectation`);
  calc.add(`Card position: ${inputs.roleLabel} ${signedNumber(slot)}`, slot);

  const importanceLabel = EVENT_IMPORTANCE_LABELS[inputs.importance];
  const importance = calc.tunable(
    tunables,
    IMPORTANCE_KEYS[inputs.importance],
    `${importanceLabel} expectation`,
  );
  calc.add(`Event size: ${importanceLabel} ${signedNumber(importance)}`, importance);

  if (inputs.televised) {
    const televised = calc.tunable(tunables, 'match.expectation.televised', 'On TV expectation');
    calc.add(`On TV ${signedNumber(televised)}`, televised);
  } else {
    calc.add(NOT_TELEVISED_LABEL, 0);
  }

  return calc.clamp(EXPECTATION_MIN, EXPECTATION_MAX).done();
}
