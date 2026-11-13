/**
 * A stand-in for the player pressing Run the show, for tests about show night itself.
 *
 * Since EVT2-09 the shows phase never runs a show a human runs: the day stops on it
 * (`shows.tonight`) and the player runs it with `shows.runTonight`, which runs it through
 * `runShowNow`, the same code the phase uses for everyone else. Tests of what show night does
 * (ratings, appliers, titles, money, results) want a whole day with the player's show in it, so
 * they add this phase: it runs every open show a human runs dated today through that same
 * `runShowNow`, just before `shows.runShows`. The command itself, its refusals and its equality
 * with this path are covered by `test/systems/shows/runTonight.test.ts`.
 */

import type { SystemBundle } from '../../src/core/api/system';
import { defineSystem } from '../../src/core/api/system';
import type { PhaseContext } from '../../src/core/pipeline/context';
import { definePhase } from '../../src/core/pipeline/phase';
import type { EventInstance } from '../../src/model/entities/event-instance';
import type { DeepReadonly } from '../../src/model/world';
import { OWN_WORKER_INJURED_GATE_ID } from '../../src/systems/health/gate';
import { runShowNow } from '../../src/systems/shows/runShow';
import { myShowsOn, SHOWS_TONIGHT_GATE_ID } from '../../src/systems/shows/tonight';

export const RUN_MY_SHOWS_PHASE_ID = 'testPlayer.runMyShows';

/** Which of the day's shows the stand-in player runs. */
export type RunsShow = (show: DeepReadonly<EventInstance>) => boolean;

const EVERY_SHOW: RunsShow = () => true;

/**
 * Runs the open shows a human runs on `ctx.date` (those `runs` picks, every one by default), as
 * pressing Run the show would.
 */
export function runMyShows(ctx: PhaseContext, runs: RunsShow = EVERY_SHOW): void {
  for (const show of myShowsOn(ctx.read, ctx.date)) {
    if (runs(show)) {
      runShowNow(ctx, show, true);
    }
  }
}

/** The stand-in player's phase: after the card-every-show test phase (order 5), before `shows.runShows`. */
export function runMyShowsSystemFor(runs: RunsShow = EVERY_SHOW): SystemBundle {
  return defineSystem({
    id: 'testPlayer',
    phases: [
      definePhase({
        id: RUN_MY_SHOWS_PHASE_ID,
        group: 'shows',
        order: 8,
        cadence: { kind: 'daily' },
        when: (view) => myShowsOn(view, view.meta.currentDate).some(runs),
        run: (ctx) => {
          runMyShows(ctx, runs);
        },
      }),
    ],
  });
}

/** The stand-in player who runs every show of theirs. */
export const runMyShowsSystem: SystemBundle = runMyShowsSystemFor();

/** The gates a stand-in player always gets past: show night and their own workers' injuries. */
const PLAYER_GATE_IDS: readonly string[] = [SHOWS_TONIGHT_GATE_ID, OWN_WORKER_INJURED_GATE_ID];

/**
 * `systems` with the show-day gate (and the own-injury gate, WRK6-04) taken out and the player's
 * shows (those `runs` picks) run inside the day: a game whose player presses Run the show on every
 * show day and reads every injury notice.
 */
export function withMyShowsRun(
  systems: readonly SystemBundle[],
  runs: RunsShow = EVERY_SHOW,
): SystemBundle[] {
  return [
    ...systems.map((system) =>
      system.gates.some((gate) => PLAYER_GATE_IDS.includes(gate.id))
        ? { ...system, gates: system.gates.filter((gate) => !PLAYER_GATE_IDS.includes(gate.id)) }
        : system,
    ),
    runMyShowsSystemFor(runs),
  ];
}
