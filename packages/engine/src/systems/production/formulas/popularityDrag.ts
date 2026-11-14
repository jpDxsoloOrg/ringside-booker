/**
 * Popularity drag: how much popularity a region loses today because it sits above the promotion's
 * popularity ceiling.
 *
 * Design: docs/design/production.md#popularity-drag. excess = popularity − ceiling. At or under
 * the ceiling there is no drag. Above it the drag is excess × `production.popularityDrag.fractionPerDay`,
 * at least `production.popularityDrag.minPerDay`, and never more than the excess, so the drag
 * never pulls popularity below the ceiling. The result is the positive amount to remove.
 */

import { startCalc } from '../../../core/trace/calc';
import { inputOf } from '../../../core/trace/helpers';
import type { Traced } from '../../../core/trace/types';
import type { EngineTunables } from '../../tunables';
import { POPULARITY_DRAG_DOC_REF } from './shared';

/** The branch recorded when the region is at or under the ceiling. */
export const UNDER_CEILING_NO_DRAG = 'At or under the ceiling: no drag';

export interface PopularityDragInputs {
  regionName: string;
  /** The promotion's popularity in the region today, 0..100. */
  popularity: number;
  /** The promotion's popularity ceiling ({@link popularityCeiling}). */
  ceiling: Traced<number>;
}

/** Popularity to remove in the region today (unit `points/day`, 0 or more). */
export function popularityDrag(
  inputs: PopularityDragInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const calc = startCalc(
    `Popularity drag in ${inputs.regionName}`,
    inputOf(`Popularity in ${inputs.regionName}`, inputs.popularity, undefined, 'points'),
    { unit: 'points/day', docRef: POPULARITY_DRAG_DOC_REF },
  );
  calc.subtract('Popularity ceiling', inputs.ceiling);
  const excess = calc.current;
  if (excess <= 0) {
    return calc.branch(UNDER_CEILING_NO_DRAG, true).multiply('No drag', 0).done();
  }
  calc.branch(UNDER_CEILING_NO_DRAG, false);
  calc.multiply(
    'Share of the excess lost each day',
    calc.tunable(deps.tunables, 'production.popularityDrag.fractionPerDay'),
  );
  calc.max('At least', calc.tunable(deps.tunables, 'production.popularityDrag.minPerDay'));
  return calc.min('Never below the ceiling', excess).done();
}
