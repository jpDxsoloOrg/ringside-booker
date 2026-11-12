/**
 * The shows system's day phase: show night. `shows.runShows` resolves every show dated today, the
 * player's and the rivals', so results (and later attendance and money) all share the show's date.
 *
 * Design: docs/design/show-night.md#phase.
 */

import { compareDates } from '../../core/date';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import type { EventInstance } from '../../model/entities/event-instance';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { hasCard } from '../booking/card';
import { showControllerOf } from '../calendar/control';
import { resetAppearancesPhase } from './appearances';
import { runOffscreenShow, runShowCard } from './runShow';

/** True for a show that has neither run nor been cancelled. */
function isOpen(instance: DeepReadonly<EventInstance>): boolean {
  return instance.status === 'scheduled' || instance.status === 'booked';
}

/** By air date (a live episode before one taped the same night), then id. */
function compareShows(
  left: DeepReadonly<EventInstance>,
  right: DeepReadonly<EventInstance>,
): number {
  return compareDates(left.airDate, right.airDate) || compareIds(left.id, right.id);
}

/** The shows dated today that have not run or been cancelled, in the order they run. */
export function showsToRunToday(view: GameWorldView): DeepReadonly<EventInstance>[] {
  return view.tables.eventInstances
    .lookup('byDate', view.meta.currentDate)
    .filter(isOpen)
    .sort(compareShows);
}

/** True when a show dated today is still open. The phase is skipped on a day without one. */
export function hasShowsToday(view: GameWorldView): boolean {
  return view.tables.eventInstances.lookup('byDate', view.meta.currentDate).some(isOpen);
}

/**
 * Daily, in the `shows` group: runs every open show dated today.
 *
 * - A show a human runs is run only once its card is locked (`booked`); otherwise it is left for
 *   the calendar's close-past-shows rule, which marks it Not run.
 * - A show the computer runs runs its card when it has one, and is scored off-screen otherwise.
 * - Cancelled and completed shows are never touched.
 *
 * The whole day's shows are one step: if anything throws, every show of the day rolls back and
 * stays unrun.
 */
export const runShowsPhase: PhaseDefinition = definePhase({
  id: 'shows.runShows',
  group: 'shows',
  order: 10,
  cadence: { kind: 'daily' },
  when: (view) => hasShowsToday(view),
  run: (ctx) => {
    let ran = 0;
    for (const show of showsToRunToday(ctx.read)) {
      const human = showControllerOf(ctx.read, show).kind === 'human';
      if (human && show.status !== 'booked') {
        ctx.log(`${show.name} (${show.id}) was not run: its card is not locked`);
        continue;
      }
      if (!human && !hasCard(ctx.read, show.id)) {
        runOffscreenShow(ctx, show);
      } else {
        runShowCard(ctx, show);
      }
      ran += 1;
    }
    if (ran > 0) {
      ctx.log(`Ran ${String(ran)} show(s)`);
    }
  },
});

export const showsPhases: readonly PhaseDefinition[] = [resetAppearancesPhase, runShowsPhase];
