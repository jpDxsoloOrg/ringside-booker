/**
 * Angle momentum gain (MTCH5-06): how much one angle moves the momentum of one person in it.
 *
 * ```
 * delta = (angle score − momentumPivot) × momentumPerPoint × share
 * share = beats the person was in ÷ beats that ran
 * ```
 *
 * A good angle builds momentum, a flat one costs a little. Someone in no beat gets nothing. The
 * result is the delta WRK1's `applyMomentumChange` takes; the door keeps momentum within
 * −100..100. Morale is never touched (D-09).
 *
 * Design: docs/design/angle-rating.md#angle-aftermath.
 */

import { constantOf, startCalc, type Traced } from '../../../../core/trace';
import type { EngineTunables } from '../../../tunables';
import { formatNumber } from '../../../world/people/labels';
import { ANGLE_AFTERMATH_DOC_REF, angleShare, type AngleShareInputs } from './angleShare';

export const ANGLE_MOMENTUM_GAIN_LABEL = 'Momentum change from this angle';
export const IN_NO_BEAT_TEXT = 'Was in none of the beats that ran: no change';

export interface AngleGainInputs extends AngleShareInputs {
  /** The angle's score, 0..100. */
  readonly score: number;
}

export interface AngleGainDeps {
  readonly tunables: EngineTunables;
}

/** The momentum change one angle asks for, for one person in it. */
export function angleMomentumGain(inputs: AngleGainInputs, deps: AngleGainDeps): Traced<number> {
  const share = angleShare(inputs);
  if (share.value === 0) {
    return constantOf(ANGLE_MOMENTUM_GAIN_LABEL, 0, IN_NO_BEAT_TEXT);
  }
  const { tunables } = deps;
  const calc = startCalc(ANGLE_MOMENTUM_GAIN_LABEL, inputs.score, {
    unit: 'points',
    docRef: ANGLE_AFTERMATH_DOC_REF,
    startLabel: `Angle score ${formatNumber(inputs.score)}`,
  });
  calc.subtract(
    'Score where momentum stays put',
    calc.tunable(tunables, 'match.angle.momentumPivot', 'Score where momentum stays put'),
  );
  calc.multiply(
    'Momentum per point',
    calc.tunable(tunables, 'match.angle.momentumPerPoint', 'Momentum per point'),
  );
  calc.multiply(share.trace.label, share);
  return calc.done();
}
