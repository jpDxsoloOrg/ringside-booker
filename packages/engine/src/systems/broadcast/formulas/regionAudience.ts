/**
 * Region audience: how many people in one region a promotion could draw on a top network, before
 * the network's reach, kind and timeslot and the show itself are counted.
 *
 * people who care = population × wrestling interest ÷ 100
 * draw            = (popularity ÷ 100) ^ popularityPower
 * region audience = people who care × draw × baseShare
 *
 * The popularity curve is smooth (D-03): a little more popularity always means a few more viewers,
 * with no thresholds. The value is not rounded; the audience formula rounds the total once.
 *
 * Design: docs/design/broadcast.md#audience.
 */

import { inputOf, startCalc, type EntityRef, type Traced } from '../../../core/trace';
import { formatNumber } from '../../world/people/labels';
import type { EngineTunables } from '../../tunables';

export const AUDIENCE_DOC_REF = 'broadcast.md#audience';

/** The note a region's trace carries when the promotion has no popularity there. */
export const NOBODY_KNOWS_YOU_NOTE = 'Nobody there knows you yet';

export interface RegionAudienceInputs {
  readonly regionName: string;
  /** The region, for the trace's link. */
  readonly regionRef?: EntityRef;
  /** People living in the region. */
  readonly population: number;
  /** How much the region cares about wrestling, 0..100. */
  readonly wrestlingInterest: number;
  /** The promotion's popularity in the region, 0..100; 0 when none is stored. */
  readonly popularity: number;
}

/** Popularity and interest are out of 100. */
const OUT_OF_100 = 100;
const OUT_OF_100_REASON = 'Popularity and interest are out of 100';

/** How strongly the promotion's popularity in the region draws, from 0 to 1. */
function draw(inputs: RegionAudienceInputs, tunables: EngineTunables): Traced<number> {
  const calc = startCalc(
    `Your popularity there (${formatNumber(inputs.popularity)})`,
    inputOf(
      `Your popularity there (${formatNumber(inputs.popularity)})`,
      inputs.popularity,
      inputs.regionRef,
      'points',
    ),
    { unit: 'ratio' },
  );
  calc.divide('Out of 100', OUT_OF_100, OUT_OF_100_REASON);
  calc.power(
    'Popularity curve',
    calc.tunable(tunables, 'broadcast.audience.popularityPower', 'Popularity curve'),
  );
  return calc.done();
}

/** One region's audience, in people (not rounded). Deterministic: no rolls. */
export function regionAudience(
  inputs: RegionAudienceInputs,
  deps: { readonly tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc(
    `Audience in ${inputs.regionName}`,
    inputOf(`People in ${inputs.regionName}`, inputs.population, inputs.regionRef, 'count'),
    { unit: 'count', docRef: AUDIENCE_DOC_REF },
  );
  const interest = `Care about wrestling (${formatNumber(inputs.wrestlingInterest)}%)`;
  calc.multiply(interest, inputs.wrestlingInterest / OUT_OF_100, OUT_OF_100_REASON);
  calc.multiply(
    `Your popularity there (${formatNumber(inputs.popularity)})`,
    draw(inputs, tunables),
  );
  if (inputs.popularity <= 0) {
    calc.note(NOBODY_KNOWS_YOU_NOTE);
  }
  calc.multiply(
    'Share a top network draws',
    calc.tunable(tunables, 'broadcast.audience.baseShare', 'Share a top network draws'),
  );
  return calc.done();
}
