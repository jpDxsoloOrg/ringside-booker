/**
 * Condition lost to an injury: the hurt body part loses a little for every week out.
 *
 * Design: docs/design/health.md#injuries. No randomness.
 */

import { startCalc } from '../../../core/trace/calc';
import { constantOf } from '../../../core/trace/helpers';
import type { Traced } from '../../../core/trace/types';
import type { EngineTunables } from '../../tunables';
import { INJURY_DOC_REF } from './injurySeverity';

export interface InjuryConditionLossInputs {
  /** `computeInjuryDays`'s result. */
  daysOut: number | Traced<number>;
  /** The hurt part's condition before the injury, 0 to 100. */
  currentCondition: number;
}

/**
 * `daysOut / 7 × health.injury.conditionLossPerWeek`, kept between 0 and the part's current
 * condition, so a part never goes below 0.
 */
export function computeInjuryConditionLoss(
  inputs: InjuryConditionLossInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const calc = startCalc('Condition lost', inputs.daysOut, {
    unit: 'points',
    docRef: INJURY_DOC_REF,
    startLabel: 'Days out',
  });
  return calc
    .divide('Weeks out', constantOf('Days per week', 7, 'Days per week'))
    .multiply(
      'Loss per week out',
      calc.tunable(deps.tunables, 'health.injury.conditionLossPerWeek', 'Loss per week out'),
    )
    .clamp(0, inputs.currentCondition, 'No more than the part has left')
    .done();
}
