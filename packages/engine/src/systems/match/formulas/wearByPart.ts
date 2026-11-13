/**
 * Wear by body part: a match's wear load spread over the body (MTCH4-01). Each part loses the load
 * times its `match.wear.part.<part>` weight, so a part weighted 0 takes no wear.
 *
 * Design: docs/design/physical-toll.md#wear.
 */

import { startCalc, type Traced } from '../../../core/trace';
import type { BodyPart } from '../../../model/entities/person';
import { BODY_PART_LABELS } from '../../world/people/labels';
import type { EngineTunables } from '../../tunables';
import { CONDITION_WEAR_DOC_REF } from './conditionWear';

/**
 * Wear per body part, in `BODY_PARTS` order: `load × match.wear.part.<part>`. Every part's trace
 * starts from the load's trace.
 */
export function computeWearByPart(
  load: Traced<number>,
  deps: { tunables: EngineTunables },
): Record<BodyPart, Traced<number>> {
  const part = (bodyPart: BodyPart): Traced<number> => {
    const label = BODY_PART_LABELS[bodyPart];
    const calc = startCalc(`${label} wear`, load, {
      unit: 'points',
      docRef: CONDITION_WEAR_DOC_REF,
    });
    return calc
      .multiply(`${label} weight`, calc.tunable(deps.tunables, `match.wear.part.${bodyPart}`))
      .done();
  };
  // Written out in BODY_PARTS order so the record's key order matches the model's.
  return {
    head: part('head'),
    neck: part('neck'),
    back: part('back'),
    arms: part('arms'),
    torso: part('torso'),
    legs: part('legs'),
  };
}
