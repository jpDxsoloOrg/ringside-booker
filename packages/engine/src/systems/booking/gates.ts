/**
 * The show-day gate: Next Day stops on the day of a show a human player runs until its card is
 * locked.
 *
 * The check only reads the day's shows through the `byDate` index, so it costs a handful of rows
 * per day of a skip. Computer-run shows never stop the clock, so headless runs of a world without a
 * human promotion are unaffected.
 *
 * Design notes: docs/design/booking.md#gate.
 */

import type { GateHit, GateSpec } from '../../core/pipeline/gates';
import { compareIds } from '../../model/table';
import { showControllerOf } from '../calendar/control';
import { hasCard } from './card';

export const SHOW_NEEDS_BOOKING_GATE_ID = 'booking.showNeedsBooking';

/**
 * Stops the skip before a day that has a `scheduled` (not yet locked) show run by a human player.
 * With several such shows on one day the lowest id leads; once it is locked the gate names the
 * next.
 */
export const showNeedsBookingGate: GateSpec = {
  id: SHOW_NEEDS_BOOKING_GATE_ID,
  label: 'Show needs booking',
  check: (view, date): GateHit | null => {
    const [show] = view.tables.eventInstances
      .lookup('byDate', date)
      .filter(
        (instance) =>
          instance.status === 'scheduled' && showControllerOf(view, instance).kind === 'human',
      )
      .sort((left, right) => compareIds(left.id, right.id));
    if (show === undefined) {
      return null;
    }
    const reason = hasCard(view, show.id)
      ? `Your card for '${show.name}' on ${date} isn't locked yet`
      : `Your show '${show.name}' on ${date} has no card yet`;
    return {
      gateId: SHOW_NEEDS_BOOKING_GATE_ID,
      reason,
      subject: { kind: 'eventInstance', id: show.id },
      actionHint: 'booking',
    };
  },
};

export const bookingGates: readonly GateSpec[] = [showNeedsBookingGate];
