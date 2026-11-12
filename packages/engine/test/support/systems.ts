/**
 * Engine system lists for tests that are about something other than the gates.
 *
 * The show-day gate (`booking.showNeedsBooking`) stops every skip on the day of a show a human
 * runs until its card is locked. Tests of the calendar's phases or of the day controls advance
 * through those days on purpose, so they run the real systems with that gate taken out. The gate
 * itself is covered by `test/systems/booking/gate.test.ts`.
 */

import type { SystemBundle } from '../../src/core/api/system';
import { defaultSystems } from '../../src/systems';
import { SHOW_NEEDS_BOOKING_GATE_ID } from '../../src/systems/booking/gates';

/** `systems` with the gates named in `gateIds` removed from every bundle. */
export function systemsWithoutGates(
  systems: readonly SystemBundle[],
  gateIds: readonly string[],
): SystemBundle[] {
  return systems.map((system) =>
    system.gates.some((gate) => gateIds.includes(gate.id))
      ? { ...system, gates: system.gates.filter((gate) => !gateIds.includes(gate.id)) }
      : system,
  );
}

/** The default systems without the show-day gate. */
export const SYSTEMS_WITHOUT_SHOW_DAY_GATE: readonly SystemBundle[] = systemsWithoutGates(
  defaultSystems,
  [SHOW_NEEDS_BOOKING_GATE_ID],
);
