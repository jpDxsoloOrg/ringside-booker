/**
 * Region expectation: the show score fans in one region expected from a promotion (D-02).
 *
 * Fans expect more from a promotion they already like, from a prestigious one and from a big
 * event. The popularity part grows with event size; prestige does not, because a prestigious
 * company is held to its name at any show. Hype multiplies the whole expectation once ECO3 tracks
 * it. `showPopularityChange` then compares the show's score with this number.
 *
 * Design: docs/design/promotion-popularity.md#region-expectation.
 */

import type { EventImportance } from '../../../model/entities/event-definition';
import { inputOf, startCalc, type Traced } from '../../../core/trace';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import { importanceLabel } from './labels';

export const REGION_EXPECTATION_DOC_REF = 'promotion-popularity.md#region-expectation';

export interface RegionExpectationInputs {
  readonly regionName: string;
  /** The promotion's popularity in this region (`regionalPop`), 0 when none is stored. */
  readonly popularity: number;
  /** The promotion's prestige, 0..100. */
  readonly prestige: number;
  readonly importance: EventImportance;
  /** The show's hype multiplier from ECO3, or null while hype is not tracked. */
  readonly hype: Traced<number> | null;
}

const EXPECT_IMPORTANCE_KEYS = {
  house: 'promoPop.expect.importance.house',
  minor: 'promoPop.expect.importance.minor',
  regular: 'promoPop.expect.importance.regular',
  major: 'promoPop.expect.importance.major',
  flagship: 'promoPop.expect.importance.flagship',
} as const satisfies Readonly<Record<EventImportance, NumberTunableKey>>;

const EXPECTATION_MIN = 0;
const EXPECTATION_MAX = 100;

function popularityTerm(inputs: RegionExpectationInputs, tunables: EngineTunables): Traced<number> {
  const calc = startCalc(
    'Expected because of popularity here',
    inputOf('Popularity here', inputs.popularity, undefined, 'points'),
    { unit: 'points' },
  );
  const weight = tunables.get('promoPop.expect.popularityWeight');
  calc.multiply(
    `Popularity here ${formatNumber(inputs.popularity)} × ${formatNumber(weight)}`,
    calc.tunable(tunables, 'promoPop.expect.popularityWeight', 'Popularity weight'),
  );
  const key = EXPECT_IMPORTANCE_KEYS[inputs.importance];
  calc.multiply(
    `Event size: ${importanceLabel(inputs.importance)} × ${formatNumber(tunables.get(key))}`,
    calc.tunable(tunables, key, 'Event size effect'),
  );
  return calc.done();
}

function prestigeTerm(inputs: RegionExpectationInputs, tunables: EngineTunables): Traced<number> {
  const calc = startCalc(
    'Expected because of prestige',
    inputOf('Prestige', inputs.prestige, undefined, 'points'),
    { unit: 'points' },
  );
  const weight = tunables.get('promoPop.expect.prestigeWeight');
  calc.multiply(
    `Prestige ${formatNumber(inputs.prestige)} × ${formatNumber(weight)}`,
    calc.tunable(tunables, 'promoPop.expect.prestigeWeight', 'Prestige weight'),
  );
  return calc.done();
}

/** The show score fans in one region expected, 0..100. Deterministic: no rolls. */
export function regionExpectation(
  inputs: RegionExpectationInputs,
  deps: { readonly tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc(`What fans in ${inputs.regionName} expected`, 0, {
    unit: 'points',
    docRef: REGION_EXPECTATION_DOC_REF,
    startLabel: 'Nothing expected yet',
  });
  const fromPopularity = popularityTerm(inputs, tunables);
  calc.add(
    `Popularity here ${formatNumber(inputs.popularity)}, ${importanceLabel(inputs.importance)} show`,
    fromPopularity,
  );
  const fromPrestige = prestigeTerm(inputs, tunables);
  calc.add(`Prestige ${formatNumber(inputs.prestige)}`, fromPrestige);
  if (inputs.hype === null) {
    calc.note("Hype isn't tracked yet");
  } else {
    const direction = inputs.hype.value < 1 ? 'fans expect less' : 'fans expect more';
    calc.multiply(`Hype: ${direction} × ${formatNumber(inputs.hype.value)}`, inputs.hype);
  }
  calc.clamp(EXPECTATION_MIN, EXPECTATION_MAX, 'Expectations stay within 0–100');
  return calc.done();
}
