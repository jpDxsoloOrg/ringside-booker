/**
 * The calendar's day phase: keep the stored schedule a fixed number of days ahead.
 *
 * Design notes: docs/design/calendar.md#horizon.
 */

import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
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
    const summary = scheduleAll(ctx.tx, ctx.read, from, through);
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

export const calendarPhases: readonly PhaseDefinition[] = [extendHorizonPhase];
