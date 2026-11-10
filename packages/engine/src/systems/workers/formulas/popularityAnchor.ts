/**
 * The popularity anchor: the level a person's popularity settles around, read off their charisma.
 *
 * Gains above the anchor are tapered by the popularity door, and popularity drift pulls towards the
 * same number, so both use this one function.
 *
 * Design: docs/design/workers.md#popularity-door.
 */

import { startCalc, type Traced } from '../../../core/trace';
import type { EngineTunables } from '../../tunables';

export const POPULARITY_DOC_REF = 'workers.md#popularity-door';

/** The ends of the popularity scale. Fixed by the schemas (`regionalPop` values), not tunable. */
export const POPULARITY_MIN = 0;
export const POPULARITY_MAX = 100;

/** What the formula needs to know about the person. */
export interface PopularityAnchorInputs {
  /** The person's charisma attribute, 0 to 100. */
  charisma: number;
}

/**
 * A person's popularity anchor: charisma times `workers.popularity.anchorFromCharisma`, kept
 * between 0 and 100.
 */
export function popularityAnchor(
  inputs: PopularityAnchorInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const calc = startCalc('Popularity anchor', inputs.charisma, {
    unit: 'points',
    docRef: POPULARITY_DOC_REF,
    startLabel: 'Charisma',
  });
  return calc
    .multiply(
      'Anchor from charisma',
      calc.tunable(deps.tunables, 'workers.popularity.anchorFromCharisma', 'Anchor from charisma'),
    )
    .clamp(POPULARITY_MIN, POPULARITY_MAX)
    .done();
}
