/**
 * Engine system lists for tests that are about something other than the gates.
 *
 * The show-day gate (`shows.tonight`, EVT2-09) stops every skip on the day of an open show a human
 * runs, until the player runs it with `shows.runTonight`. Tests of the calendar's phases or of the
 * day controls advance through those days on purpose, so they run the real systems with that gate
 * taken out; the player's shows then stay unrun and the calendar closes them as Not run. Tests
 * that need the player's shows to run use `advanceRunningMyShows` (`support/run-my-shows.ts`). The
 * gate itself is covered by `test/systems/shows/tonightGate.test.ts`.
 *
 * The own-injury gate (`health.ownWorkerInjured`, WRK6-04) stops a skip when one of the player's
 * workers gets hurt off-screen, which can happen on any day of a long run; it is taken out with the
 * show-day gate. It is covered by `test/systems/health/gate.test.ts`.
 */

import type { SystemBundle } from '../../src/core/api/system';
import { defaultSystems } from '../../src/systems';
import { OWN_WORKER_INJURED_GATE_ID } from '../../src/systems/health/gate';
import { SHOWS_TONIGHT_GATE_ID } from '../../src/systems/shows/tonight';

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

/** The default systems without the show-day gate and the own-injury gate. */
export const SYSTEMS_WITHOUT_SHOW_DAY_GATE: readonly SystemBundle[] = systemsWithoutGates(
  defaultSystems,
  [SHOWS_TONIGHT_GATE_ID, OWN_WORKER_INJURED_GATE_ID],
);

/**
 * The default systems without the show-day gate and without show night (`shows.runShows`). For
 * the calendar's close-past-shows tests: they check the safety net for shows nothing ran, which
 * show night would otherwise run first.
 */
export const SYSTEMS_WITHOUT_SHOW_NIGHT: readonly SystemBundle[] =
  SYSTEMS_WITHOUT_SHOW_DAY_GATE.map((system) =>
    system.phases.some((phase) => phase.id === 'shows.runShows')
      ? { ...system, phases: system.phases.filter((phase) => phase.id !== 'shows.runShows') }
      : system,
  );

export {
  RUN_MY_SHOWS_PHASE_ID,
  runMyShows,
  runMyShowsSystem,
  runMyShowsSystemFor,
  withMyShowsRun,
  type RunsShow,
} from './run-my-shows';
