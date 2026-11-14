/**
 * Angle popularity gain (MTCH5-06): how much one angle raises the popularity of one person in it,
 * in the show's region.
 *
 * ```
 * gain = max(0, angle score − popularityPivot) × popularityPerPoint × share
 * ```
 *
 * There is never a popularity loss from an angle. The caller spreads the gain to the show's
 * neighbours and reached regions with MTCH3's region weights (`segmentRegionWeights`) and writes
 * it through WRK1's `applyPopularityChange`, as a match's gain is. Morale is never touched (D-09).
 *
 * Design: docs/design/angle-rating.md#angle-aftermath.
 */

import { constantOf, startCalc, type Traced } from '../../../../core/trace';
import { formatNumber } from '../../../world/people/labels';
import { ANGLE_AFTERMATH_DOC_REF, angleShare } from './angleShare';
import { IN_NO_BEAT_TEXT, type AngleGainDeps, type AngleGainInputs } from './angleMomentumGain';

export const ANGLE_POPULARITY_GAIN_LABEL = 'Popularity change from this angle';
export const NEVER_A_LOSS_LABEL = 'An angle never costs popularity';

/** The popularity change one angle asks for in the show's region, for one person in it. */
export function anglePopularityGain(inputs: AngleGainInputs, deps: AngleGainDeps): Traced<number> {
  const share = angleShare(inputs);
  if (share.value === 0) {
    return constantOf(ANGLE_POPULARITY_GAIN_LABEL, 0, IN_NO_BEAT_TEXT);
  }
  const { tunables } = deps;
  const calc = startCalc(ANGLE_POPULARITY_GAIN_LABEL, inputs.score, {
    unit: 'points',
    docRef: ANGLE_AFTERMATH_DOC_REF,
    startLabel: `Angle score ${formatNumber(inputs.score)}`,
  });
  calc.subtract(
    'Score popularity starts to grow from',
    calc.tunable(tunables, 'match.angle.popularityPivot', 'Score popularity starts to grow from'),
  );
  calc.max(NEVER_A_LOSS_LABEL, 0);
  calc.multiply(
    'Popularity per point',
    calc.tunable(tunables, 'match.angle.popularityPerPoint', 'Popularity per point'),
  );
  calc.multiply(share.trace.label, share);
  return calc.done();
}
