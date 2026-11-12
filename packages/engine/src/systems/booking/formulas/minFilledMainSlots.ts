/**
 * The fewest main-card slots a card must have filled before it can be locked: the main card's slot
 * count times `booking.minFilledMainShare`, rounded up and kept within 0..slots. At a share of 0
 * there is no minimum; at 1 every slot must be filled.
 *
 * Design: docs/design/booking.md#validation.
 */

import { constantOf, startCalc, type Traced } from '../../../core/trace';
import type { EngineTunables } from '../../tunables';

export const MIN_FILLED_MAIN_SLOTS_DOC_REF = 'booking.md#validation';

/**
 * Taken off before rounding up so that a product like 10 × 0.3 (3.0000000000000004 in floating
 * point) rounds up to 3, not 4. Far smaller than any real fraction of a slot.
 */
const ROUNDING_SLACK = 1e-9;

export interface MinFilledMainSlotsInputs {
  /** The main card's slot count. */
  slots: number;
}

/** `ceil(slots × booking.minFilledMainShare)`, kept within 0..slots. */
export function minFilledMainSlots(
  inputs: MinFilledMainSlotsInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const calc = startCalc('Main card slots that must be filled', inputs.slots, {
    unit: 'count',
    docRef: MIN_FILLED_MAIN_SLOTS_DOC_REF,
    startLabel: 'Main card slots',
  });
  const share = calc.tunable(
    deps.tunables,
    'booking.minFilledMainShare',
    'Share that must be filled',
  );
  return calc
    .multiply('Share that must be filled', share)
    .subtract(
      'Rounding slack',
      constantOf('Rounding slack', ROUNDING_SLACK, 'Keeps a whole number from rounding up a step'),
    )
    .round('ceil', 'Rounded up')
    .clamp(0, Math.max(0, inputs.slots), 'Kept within the main card')
    .done();
}
