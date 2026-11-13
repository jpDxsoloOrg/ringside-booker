/**
 * When the game gives a show a venue on its own (EVT6-03). There is no Lock card (EVT2-09), so the
 * last moment is the show itself:
 *
 * - **`boxOffice.assignVenues`** (daily, `housekeeping` 64) looks at the shows dated from today
 *   through today + `boxOffice.rivalVenueLeadDays` that have no venue. A show the computer runs
 *   gets the pick, so the world calendar shows where rival shows are held two weeks ahead. A show a
 *   human runs is left alone ("Not chosen yet") until the day before: the pick for a show dated
 *   tomorrow (or today) is made then, so on show day the booking screen already shows the venue
 *   and its forecast, and the player can still change it.
 * - **`boxOffice.pickOnShowNight`**, a before-a-show-runs hook, picks for any show that reaches
 *   its first segment without a venue, so no show ever runs without one.
 *
 * The pick's Why? is stored for the player's shows only. Design: docs/design/box-office.md#automatic-picks.
 */

import { addDays, compareDates } from '../../core/date';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import type { PhaseContext } from '../../core/pipeline/context';
import type { EventInstance } from '../../model/entities/event-instance';
import { compareIds } from '../../model/table';
import type { DeepReadonly } from '../../model/world';
import { showControllerOf } from '../calendar/control';
import { addDaysWithinCalendar } from '../calendar/schedule';
import { registerBeforeShowRuns, type BeforeShowRunsHook } from '../shows/beforeRun';
import { autoPickVenue, hasVenue } from './venueChoice';

export const ASSIGN_VENUES_PHASE_ID = 'boxOffice.assignVenues';
export const PICK_ON_SHOW_NIGHT_HOOK_ID = 'boxOffice.pickOnShowNight';

type Show = DeepReadonly<EventInstance>;

function isOpen(show: Show): boolean {
  return show.status === 'scheduled' || show.status === 'booked';
}

/**
 * Gives `show` the automatic pick, unless the pick cannot be made (bad data). A failure is logged
 * and skipped, so one broken show never stops the day or the show night.
 */
function pickFor(ctx: PhaseContext, show: Show, human: boolean): boolean {
  try {
    autoPickVenue(ctx, show, { storeTrace: human });
    return true;
  } catch (error) {
    ctx.log(
      `Could not pick a venue for ${show.name} (${show.id}): ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/** Daily: gives rival shows inside the lead window, and the player's shows from tomorrow, a venue. */
export const assignVenuesPhase: PhaseDefinition = definePhase({
  id: ASSIGN_VENUES_PHASE_ID,
  group: 'housekeeping',
  order: 64,
  cadence: { kind: 'daily' },
  run: (ctx) => {
    const leadDays = ctx.tunables.get('boxOffice.rivalVenueLeadDays');
    const humanThrough = addDaysWithinCalendar(ctx.date, 1);
    const computerThrough = addDaysWithinCalendar(ctx.date, leadDays);
    const through =
      compareDates(humanThrough, computerThrough) > 0 ? humanThrough : computerThrough;
    let picked = 0;
    let date = ctx.date;
    for (;;) {
      const shows = ctx.read.tables.eventInstances
        .lookup('byDate', date)
        .filter((show) => isOpen(show) && !hasVenue(show))
        .sort((left, right) => compareIds(left.id, right.id));
      for (const show of shows) {
        const human = showControllerOf(ctx.read, show).kind === 'human';
        const due = compareDates(date, human ? humanThrough : computerThrough) <= 0;
        if (due && pickFor(ctx, show, human)) {
          picked += 1;
        }
      }
      if (compareDates(date, through) >= 0) {
        break;
      }
      date = addDays(date, 1);
    }
    if (picked > 0) {
      ctx.log(`Gave ${String(picked)} show(s) a venue`);
    }
  },
});

/** Before a show runs: a show still without a venue gets the automatic pick. */
export const pickOnShowNightHook: BeforeShowRunsHook = {
  id: PICK_ON_SHOW_NIGHT_HOOK_ID,
  order: 10,
  run: (ctx, { show, human }) => {
    const current = ctx.read.tables.eventInstances.get(show.id);
    if (current === undefined || hasVenue(current)) {
      return;
    }
    if (pickFor(ctx, current, human)) {
      ctx.log(`${current.name} (${current.id}) had no venue when it ran; the game picked one`);
    }
  },
};

registerBeforeShowRuns(pickOnShowNightHook);

export const boxOfficePhases: readonly PhaseDefinition[] = [assignVenuesPhase];
