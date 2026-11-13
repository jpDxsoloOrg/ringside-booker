/**
 * Expected attendance: the crowd a show is forecast to draw, before the venue caps it.
 *
 * Popularity in the show's region drives a convex curve (a company twice as popular draws far more
 * than twice the crowd), plus a walk-up crowd every show gets. Marketing, the show's size, recent
 * form, big-show fatigue and hype then each multiply the crowd once, on their own Why? line.
 * Popularity and hype are separate lines (D-02). The venue's capacity is not part of the forecast;
 * the caller caps the range and the real crowd. Design: docs/design/box-office.md#forecast.
 */

import type { EventImportance } from '../../../model/entities/event-definition';
import type { EntityRef } from '../../../core/trace';
import { constantOf, inputOf, startCalc, type Traced } from '../../../core/trace';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import { showSizeLabel } from './labels';

export const EXPECTED_ATTENDANCE_DOC_REF = 'box-office.md#forecast';

export interface ExpectedAttendanceInputs {
  /** The promotion's popularity in the show's region, 0..100; 0 when none is stored. */
  readonly popularity: number;
  readonly regionName: string;
  /** The region, for the popularity line's link. */
  readonly regionRef?: EntityRef;
  /** The promotion's marketing level, 0..10. */
  readonly marketingLevel: number;
  readonly importance: EventImportance;
  readonly recentForm: Traced<number>;
  readonly bigShowFatigue: Traced<number>;
  readonly hype: Traced<number>;
}

const IMPORTANCE_KEYS = {
  house: 'boxOffice.importance.house',
  minor: 'boxOffice.importance.minor',
  regular: 'boxOffice.importance.regular',
  major: 'boxOffice.importance.major',
  flagship: 'boxOffice.importance.flagship',
} as const satisfies Readonly<Record<EventImportance, NumberTunableKey>>;

function marketingMultiplier(marketingLevel: number, tunables: EngineTunables): Traced<number> {
  const calc = startCalc(
    'Marketing',
    inputOf('Marketing level', marketingLevel, undefined, 'count'),
    { unit: 'multiplier' },
  );
  calc.multiply(
    'Crowd added per level',
    calc.tunable(tunables, 'boxOffice.marketing.perLevel', 'Crowd added per level'),
  );
  calc.add(
    'Without marketing',
    constantOf('Without marketing', 1, 'With no marketing the crowd is unchanged'),
  );
  return calc.done();
}

/** The forecast crowd, a whole number of people, 0 or more. Deterministic: no rolls. */
export function computeExpectedAttendance(
  inputs: ExpectedAttendanceInputs,
  deps: { readonly tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc(
    'Expected crowd',
    inputOf(
      `Popularity in ${inputs.regionName}: ${formatNumber(inputs.popularity)}`,
      inputs.popularity,
      inputs.regionRef,
      'points',
    ),
    { unit: 'count', docRef: EXPECTED_ATTENDANCE_DOC_REF },
  );
  calc.divide('Out of 100', constantOf('Full popularity', 100, 'Popularity is out of 100'));
  calc.power(
    'Popularity curve',
    calc.tunable(tunables, 'boxOffice.draw.curve', 'Popularity curve'),
  );
  calc.multiply(
    'Crowd at full popularity',
    calc.tunable(tunables, 'boxOffice.draw.atFullPopularity', 'Crowd at full popularity'),
  );
  calc.add('Walk-up crowd', calc.tunable(tunables, 'boxOffice.draw.walkUp', 'Walk-up crowd'));
  calc.multiply(
    `Marketing level ${formatNumber(inputs.marketingLevel)}`,
    marketingMultiplier(inputs.marketingLevel, tunables),
  );
  calc.multiply(
    showSizeLabel(inputs.importance),
    calc.tunable(tunables, IMPORTANCE_KEYS[inputs.importance], 'Show size'),
  );
  calc.multiply('Recent form', inputs.recentForm);
  calc.multiply('Big-show fatigue', inputs.bigShowFatigue);
  calc.multiply('Hype', inputs.hype);
  calc.round('round', 'Rounded to whole people');
  calc.max('Never below 0', constantOf('Empty', 0, 'A crowd cannot be smaller than nobody'));
  return calc.done();
}
