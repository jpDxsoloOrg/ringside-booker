/**
 * The calendar's day phases: keep the stored schedule a fixed number of days ahead, and close the
 * shows whose day ended without them running.
 *
 * Design notes: docs/design/calendar.md#horizon and docs/design/calendar.md#lifecycle.
 */

import { compareDates } from '../../core/date';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import { cancelShow } from './cancel';
import { addDaysWithinCalendar, scheduleAll } from './schedule';

/**
 * Daily: schedules every definition from tomorrow through tomorrow plus the horizon.
 *
 * The clock moves to `date + 1` when the day closes, so starting one day ahead leaves the player
 * looking at today through today plus the horizon. The window never includes the day being
 * simulated: a definition created or changed today cannot get a show on a day that is already
 * running. On an unchanged world only the newly reached date gets shows.
 */
export const extendHorizonPhase: PhaseDefinition = definePhase({
  id: 'calendar.extendHorizon',
  group: 'housekeeping',
  order: 20,
  cadence: { kind: 'daily' },
  run: (ctx) => {
    const horizonDays = ctx.tunables.get('calendar.scheduleHorizonDays');
    const from = addDaysWithinCalendar(ctx.date, 1);
    if (from === ctx.date) {
      // The last supported game date has no tomorrow to schedule.
      return;
    }
    const through = addDaysWithinCalendar(from, horizonDays);
    const summary = scheduleAll(ctx.tx, ctx.read, from, through, {
      tunables: ctx.tunables,
      recordTrace: { record: ctx.recordTrace, date: ctx.date },
    });
    for (const instanceId of summary.instanceIds) {
      const instance = ctx.read.tables.eventInstances.get(instanceId);
      if (instance !== undefined) {
        ctx.publish('show.scheduled', {
          eventInstanceId: instance.id,
          promotionId: instance.promotionId,
          date: instance.date,
        });
      }
    }
    if (summary.created > 0) {
      ctx.log(
        `Scheduled ${String(summary.created)} show(s) for ${String(summary.createdByPromotion.size)} promotion(s) through ${through}`,
      );
    }
  },
});

/** The statuses of a show that has neither run nor been cancelled. */
const OPEN_STATUSES = ['scheduled', 'booked'] as const;

/**
 * Daily: closes every show that is still open (`scheduled` or `booked`) and dated today or
 * earlier, as cancelled with reason `notRun`.
 *
 * It sits in `settlement` at order 90, after the whole `shows` group, so a show that ran today is
 * already `completed` and is left alone. "Today or earlier" rather than "today" means a show left
 * open because a step failed on an earlier day is closed on the next run. Shows are closed in id
 * order, one `show.cancelled` each. A later feature that must act on an unrun show subscribes to
 * that event instead of moving this phase.
 */
export const closePastShowsPhase: PhaseDefinition = definePhase({
  id: 'calendar.closePastShows',
  group: 'settlement',
  order: 90,
  cadence: { kind: 'daily' },
  run: (ctx) => {
    const unrun = OPEN_STATUSES.flatMap((status) =>
      ctx.read.tables.eventInstances.lookup('byStatus', status),
    )
      .filter((show) => compareDates(show.date, ctx.date) <= 0)
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    for (const show of unrun) {
      cancelShow(ctx, show, 'notRun');
    }
    if (unrun.length > 0) {
      ctx.log(`Closed ${String(unrun.length)} show(s) that did not run`);
    }
  },
});

export const calendarPhases: readonly PhaseDefinition[] = [extendHorizonPhase, closePastShowsPhase];
