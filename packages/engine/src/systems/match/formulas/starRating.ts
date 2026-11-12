/**
 * Star rating: 0–5 stars in quarter steps, the number a reviewer would give a segment.
 *
 * Stars blend the performance with the crowd (mostly performance), so a great match in front of a
 * dead crowd still rates well but not perfectly. The duration class caps the stars: a short match
 * cannot be a classic. Talking segments have their own cap.
 *
 * Design: docs/design/match-rating.md#star-ratings.
 */

import { startCalc, type Traced } from '../../../core/trace';
import type { DurationClass } from '../slots';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import type { SegmentKind } from '../../../model/entities/segment';
import { SEGMENT_PERFORMANCE_LABELS } from './segmentScore';
import { summaryOf } from './shared';

export const STARS_DOC_REF = 'match-rating.md#star-ratings';

export interface StarRatingInputs {
  kind: SegmentKind;
  /** Work rate for a match, talk for a talking segment, after compression. */
  performance: Traced<number>;
  /** The crowd score, after compression. */
  crowd: Traced<number>;
  /** The match's duration class. Ignored for a talking segment, which has its own cap. */
  durationClass: DurationClass;
  /** The slot and class as the player reads them, such as "Main event (long)". */
  durationLabel: string;
}

export const STARS_LABEL = 'Stars';
export const POINTS_PER_STAR_ZERO_NOTE = 'Points per star is 0';
export const NEAREST_QUARTER_LABEL = 'Nearest quarter star';

const CAP_KEYS = {
  short: 'match.stars.cap.short',
  standard: 'match.stars.cap.standard',
  long: 'match.stars.cap.long',
} as const satisfies Readonly<Record<DurationClass, NumberTunableKey>>;

const QUARTERS_PER_STAR = 4;

/** `performance × share + crowd × (1 − share)`, the score stars are read from. */
function starBase(inputs: StarRatingInputs, tunables: EngineTunables): Traced<number> {
  const performanceLabel = SEGMENT_PERFORMANCE_LABELS[inputs.kind];
  const performancePart = startCalc(
    `${performanceLabel}'s share`,
    summaryOf(inputs.performance, performanceLabel, 'points'),
    { unit: 'points' },
  );
  const share = performancePart.tunable(
    tunables,
    'match.stars.performanceShare',
    'Performance share of stars',
  );
  performancePart.multiply('Performance share', share);
  const crowdShare = 1 - share;
  const crowdPart = startCalc("Crowd's share", summaryOf(inputs.crowd, 'Crowd', 'points'), {
    unit: 'points',
  }).multiply('What the performance leaves', crowdShare);
  return startCalc('Blended for stars', 0, {
    unit: 'points',
    docRef: STARS_DOC_REF,
    startLabel: 'Nothing yet',
  })
    .add(`${performanceLabel} × ${formatNumber(share)}`, performancePart.done())
    .add(`Crowd × ${formatNumber(crowdShare)}`, crowdPart.done())
    .done();
}

/**
 * `(base − zeroAt) ÷ pointsPerStar`, kept between 0 and the cap, rounded to the nearest quarter
 * star. The cap is `match.stars.cap.<class>` for a match and `match.stars.cap.angle` for a talking
 * segment, with the line "<durationLabel>: at most N stars". When `pointsPerStar` is 0 a base above
 * `zeroAt` gets the cap and anything else 0, with the note "Points per star is 0".
 */
export function starRating(
  inputs: StarRatingInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const base = starBase(inputs, tunables);
  const calc = startCalc(STARS_LABEL, base, { unit: 'stars', docRef: STARS_DOC_REF });

  const zeroAt = calc.tunable(tunables, 'match.stars.zeroAt', 'No stars at');
  calc.subtract(`No stars at ${formatNumber(zeroAt)}`, zeroAt);

  const capKey = inputs.kind === 'match' ? CAP_KEYS[inputs.durationClass] : 'match.stars.cap.angle';
  const cap = tunables.get(capKey);

  const pointsPerStar = calc.tunable(tunables, 'match.stars.pointsPerStar', 'Points per star');
  if (pointsPerStar === 0) {
    const above = base.value > zeroAt;
    calc
      .note(POINTS_PER_STAR_ZERO_NOTE)
      .branch(`Above ${formatNumber(zeroAt)}`, above)
      .multiply('Every point is worth the cap or nothing', 0);
    if (above) {
      calc.add('The cap', cap);
    }
  } else {
    calc.divide('Points per star', pointsPerStar);
  }

  // Read the cap through the calc so the clamp line carries its tunable node.
  calc.tunable(tunables, capKey, 'Star cap');
  return calc
    .clamp(0, cap, `${inputs.durationLabel}: at most ${formatNumber(cap)} stars`)
    .multiply('In quarter stars', QUARTERS_PER_STAR)
    .round('round', NEAREST_QUARTER_LABEL)
    .divide('Back to stars', QUARTERS_PER_STAR)
    .done();
}
