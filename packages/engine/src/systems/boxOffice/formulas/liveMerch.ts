/**
 * Live merch takings for one show, in cents: what each fan in the building spends, more after a
 * better show, with one roll for the night.
 *
 * The crowd is the settled crowd and is used once (the reference applied its attendance setting
 * twice here). The roll is drawn exactly once per call, even for an empty building, so the
 * `boxoffice.merch` stream stays aligned. Design: docs/design/box-office.md#live-merch.
 */

import { rollFloat } from '../../../core/rng/rolls';
import type { RngStream } from '../../../core/rng/registry';
import { constantOf, inputOf, startCalc, type Traced } from '../../../core/trace';
import type { EngineTunables } from '../../tunables';
import { formatNumber } from '../../world/people/labels';

export const LIVE_MERCH_DOC_REF = 'box-office.md#live-merch';

export interface LiveMerchInputs {
  /** The crowd on the night, after the venue's cap. */
  readonly attendance: number;
  /** The show's score, 0..100. */
  readonly showScore: number;
}

function showQuality(showScore: number, tunables: EngineTunables): Traced<number> {
  const gap = startCalc(
    'Gap between the worst and best show',
    constantOf('Nothing', 0, 'Built up from the two ends'),
    { unit: 'multiplier' },
  );
  gap.add('Best show', gap.tunable(tunables, 'boxOffice.merch.qualityHigh', 'Best show'));
  gap.subtract('Worst show', gap.tunable(tunables, 'boxOffice.merch.qualityLow', 'Worst show'));

  const calc = startCalc(
    'Show quality',
    inputOf(`Show score: ${formatNumber(showScore)}`, showScore, undefined, 'points'),
    { unit: 'multiplier' },
  );
  calc.clamp(0, 100, 'Scores run from 0 to 100');
  calc.divide('Out of 100', constantOf('Best score', 100, 'Show scores are out of 100'));
  calc.multiply('Gap between the worst and best show', gap.done());
  calc.add('Worst show', calc.tunable(tunables, 'boxOffice.merch.qualityLow', 'Worst show'));
  return calc.done();
}

/** Live merch takings in whole cents, 0 or more. One roll. */
export function computeLiveMerch(
  inputs: LiveMerchInputs,
  deps: { readonly tunables: EngineTunables; readonly rng: RngStream },
): Traced<number> {
  const { tunables, rng } = deps;
  const calc = startCalc('Merch sales', inputOf('Crowd', inputs.attendance, undefined, 'count'), {
    unit: 'money',
    docRef: LIVE_MERCH_DOC_REF,
  });
  calc.multiply(
    'Spent per fan',
    calc.tunable(tunables, 'boxOffice.merch.perHead', 'Spent per fan'),
  );
  calc.multiply('Show quality', showQuality(inputs.showScore, tunables));
  const spread = calc.tunable(tunables, 'boxOffice.merch.spread', 'How far merch can swing');
  const night = rollFloat(rng, 1 - spread, 1 + spread, 'Merch stand on the night');
  calc.roll(night.roll);
  calc.multiply('Merch stand on the night', night.value);
  calc.round('round', 'Rounded to whole cents');
  calc.max('Never below 0', constantOf('Nothing sold', 0, 'Takings cannot be below nothing'));
  return calc.done();
}
