/**
 * Show stars: a show score on the star scale the player reads.
 *
 * MTCH1's `starRating` blends performance and crowd per segment, so it cannot take a show score.
 * This is the show's own straight line: zero stars at `shows.stars.zeroAt`, one more star per
 * `shows.stars.pointsPerStar`, kept within 0..5 and rounded to the nearest quarter star.
 *
 * Design: docs/design/show-night.md#show-score.
 */

import { constantOf, startCalc, type Traced } from '../../../core/trace';
import type { EngineTunables } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import { SHOW_SCORE_DOC_REF } from './showScore';

/** The ends of the star scale. Fixed: the results page always shows 0 to 5 stars. */
export const SHOW_STARS_MIN = 0;
export const SHOW_STARS_MAX = 5;

/** Stars move in quarters. Fixed, so every star rating in the game reads the same way. */
const QUARTERS_PER_STAR = 4;
const QUARTER_REASON = 'Stars are shown in quarter steps';

export interface ShowStarsInputs {
  /** The show score, 0 to 100. */
  score: number;
}

/**
 * The show's stars: `(score − zeroAt) / pointsPerStar`, kept within 0..5 and rounded to the
 * nearest quarter. At `pointsPerStar` 0 it is 5 for any score above `zeroAt` and 0 otherwise.
 */
export function showStars(
  inputs: ShowStarsInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const calc = startCalc('Show stars', inputs.score, {
    unit: 'stars',
    docRef: SHOW_SCORE_DOC_REF,
    startLabel: 'Show score',
  });
  const zeroAt = calc.tunable(deps.tunables, 'shows.stars.zeroAt', 'Score for zero stars');
  calc.subtract('Score for zero stars', zeroAt);
  const pointsPerStar = calc.tunable(deps.tunables, 'shows.stars.pointsPerStar', 'Points per star');

  if (pointsPerStar === 0) {
    const above = calc.current > 0;
    calc.note('Points per star is 0');
    calc.branch(`Score above ${formatNumber(zeroAt)}`, above);
    calc.multiply('No steps between zero and five stars', 0);
    if (above) {
      calc.add(
        'Full stars',
        constantOf('Full stars', SHOW_STARS_MAX, 'The most stars a show can earn'),
      );
    }
    return calc.done();
  }

  return calc
    .divide('Points per star', pointsPerStar)
    .clamp(SHOW_STARS_MIN, SHOW_STARS_MAX)
    .multiply('Quarters', constantOf('Quarters per star', QUARTERS_PER_STAR, QUARTER_REASON))
    .round('round', 'Nearest quarter star')
    .divide('Back to stars', constantOf('Quarters per star', QUARTERS_PER_STAR, QUARTER_REASON))
    .done();
}
