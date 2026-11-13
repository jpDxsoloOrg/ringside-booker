/**
 * The crowd on the night: the forecast crowd with one roll for how the night went, capped at the
 * venue's capacity.
 *
 * The roll is drawn exactly once per call, before the cap, so a show that sells out still moves
 * the `boxoffice.crowd` stream by one draw and every later show rolls the same way however the
 * numbers are tuned. Design: docs/design/box-office.md#crowd-roll.
 */

import { rollFloat } from '../../../core/rng/rolls';
import type { RngStream } from '../../../core/rng/registry';
import { constantOf, startCalc, type Traced } from '../../../core/trace';
import type { EngineTunables } from '../../tunables';

export const ACTUAL_ATTENDANCE_DOC_REF = 'box-office.md#crowd-roll';

export interface ActualAttendanceInputs {
  /** The forecast crowd from `forecastAttendance`, kept as the first line of the Why?. */
  readonly expected: Traced<number>;
  /** The venue's capacity, the most people who can get in. */
  readonly capacity: number;
  readonly venueName: string;
}

/** The real crowd, a whole number of people from 0 to the venue's capacity. One roll. */
export function computeActualAttendance(
  inputs: ActualAttendanceInputs,
  deps: { readonly tunables: EngineTunables; readonly rng: RngStream },
): Traced<number> {
  const { tunables, rng } = deps;
  const calc = startCalc('Crowd', inputs.expected, {
    unit: 'count',
    docRef: ACTUAL_ATTENDANCE_DOC_REF,
  });
  const spread = calc.tunable(tunables, 'boxOffice.crowd.spread', 'How far the crowd can swing');
  const night = rollFloat(rng, 1 - spread, 1 + spread, 'Crowd on the night');
  calc.roll(night.roll);
  calc.multiply('Crowd on the night', night.value);
  calc.round('round', 'Rounded to whole people');
  calc.min(`Capacity of ${inputs.venueName}`, inputs.capacity);
  calc.max('Never below 0', constantOf('Empty', 0, 'A crowd cannot be smaller than nobody'));
  return calc.done();
}
