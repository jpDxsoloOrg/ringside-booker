/**
 * One region's popularity after a change.
 *
 * The caller says how big the change is and how much of it this region gets. The formula adds the
 * one rule that belongs to popularity itself: a person's gains slow down once they are above their
 * anchor, so nobody climbs forever. Losses are never slowed, and promotions have no anchor.
 *
 * Design: docs/design/workers.md#popularity-door.
 */

import { constantOf, startCalc, type Traced } from '../../../core/trace';
import type { EngineTunables } from '../../tunables';
import { POPULARITY_DOC_REF, POPULARITY_MAX, POPULARITY_MIN } from './popularityAnchor';

/** Whose popularity is changing. Only people have an anchor, so only their gains taper. */
export type PopularitySubjectKind = 'person' | 'promotion';

export interface PopularityChangeInputs {
  subjectKind: PopularitySubjectKind;
  /** The region's name, for the trace labels. */
  regionName: string;
  /** The region's stored popularity before the change; 0 when nothing is stored. */
  before: number;
  /** The change asked for, in points, before the region's weight. */
  delta: number | Traced<number>;
  /** How much of the change this region gets. Kept between 0 and 1. */
  weight: number;
  /** The person's popularity anchor. Null for a promotion. */
  anchor: Traced<number> | null;
}

/** The ends of a region weight. A share of a change, so fixed and not tunable. */
const WEIGHT_MIN = 0;
const WEIGHT_MAX = 1;

/** Popularity is stored in hundredths of a point. */
const HUNDREDTHS_PER_POINT = 100;
export const POPULARITY_ROUNDING_REASON = 'Stored to two decimal places';

function regionWeight(inputs: PopularityChangeInputs): Traced<number> {
  const calc = startCalc(`Weight of ${inputs.regionName}`, inputs.weight, {
    unit: 'ratio',
    startLabel: 'Weight given',
  });
  calc.clamp(WEIGHT_MIN, WEIGHT_MAX);
  if (calc.current !== inputs.weight) {
    calc.note(
      `A weight of ${String(inputs.weight)} is outside ${String(WEIGHT_MIN)} to ${String(WEIGHT_MAX)}, so ${String(calc.current)} is used`,
    );
  }
  return calc.done();
}

/**
 * The share of a gain that still lands above the anchor:
 * `max(taperFloor, 1 − (before − anchor) ÷ taperSpan)`. A span of 0 means the floor applies as
 * soon as the person is above the anchor, with no division.
 */
function taperAboveAnchor(
  before: number,
  anchor: Traced<number>,
  tunables: EngineTunables,
): Traced<number> {
  const calc = startCalc('Share of the gain kept above the anchor', before, {
    unit: 'ratio',
    docRef: POPULARITY_DOC_REF,
    startLabel: 'Popularity before',
  });
  calc.subtract('Popularity anchor', anchor, 'How far above the anchor they already are');
  const span = calc.tunable(tunables, 'workers.popularity.taperSpan', 'Taper span');
  if (span === 0) {
    calc.multiply('No span to taper over', 0, 'A span of 0 applies the floor straight away');
  } else {
    calc
      .divide('Taper span', span, 'Share of the span already used')
      .multiply('Counts against the gain', -1)
      .add('A gain at the anchor lands in full', 1);
  }
  return calc
    .max('Taper floor', calc.tunable(tunables, 'workers.popularity.taperFloor', 'Taper floor'))
    .done();
}

/**
 * A region's popularity after a change: `before + delta × weight × taper`, kept between 0 and 100
 * and rounded to two decimal places. `taper` only applies to a person gaining while already above
 * their anchor.
 */
export function popularityChange(
  inputs: PopularityChangeInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const calc = startCalc(`Popularity in ${inputs.regionName}`, inputs.delta, {
    unit: 'points',
    docRef: POPULARITY_DOC_REF,
    startLabel: 'Change asked for',
  });
  calc.multiply(`Share for ${inputs.regionName}`, regionWeight(inputs));

  if (inputs.anchor !== null && inputs.subjectKind === 'person') {
    const tapered = calc.current > 0 && inputs.before > inputs.anchor.value;
    calc.branch('A gain while already above the popularity anchor', tapered);
    if (tapered) {
      calc.multiply(
        'Slowed above the anchor',
        taperAboveAnchor(inputs.before, inputs.anchor, deps.tunables),
      );
    }
  }

  const hundredths = constantOf(
    'Hundredths in a point',
    HUNDREDTHS_PER_POINT,
    POPULARITY_ROUNDING_REASON,
  );
  return calc
    .add('Popularity before', inputs.before)
    .clamp(POPULARITY_MIN, POPULARITY_MAX)
    .multiply('In hundredths', hundredths)
    .round('round', 'Rounded to the nearest hundredth')
    .divide('Back to points', hundredths)
    .done();
}
