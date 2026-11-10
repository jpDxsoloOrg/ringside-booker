/**
 * The calendar's new-game setup step: the opening schedule.
 *
 * Order 810 puts it after `wld.storeSettings` (800), so a founded promotion's weekly show is
 * already in the world. See docs/design/new-game.md#setup-steps and docs/design/calendar.md#horizon.
 */

import type { GameTables } from '../../model/tables';
import type { Tx } from '../../model/tx';
import { registerSetupStep, type SetupContext } from '../newgame/steps';
import { addDaysWithinCalendar, scheduleAll } from './schedule';

export const CALENDAR_SETUP_STEP = { id: 'calendar.scheduleOpening', order: 810 } as const;

/**
 * Schedules every show from the start date through the start date plus the horizon. The horizon
 * is read from the session's tunables, so an override chosen in the new-game wizard applies. One
 * summary event is published instead of one event per show, so a new game does not start with a
 * recent-events log full of scheduling.
 */
function scheduleOpening(tx: Tx<GameTables>, ctx: SetupContext): void {
  const horizonDays = ctx.session.tunables.get('calendar.scheduleHorizonDays');
  const from = ctx.startDate;
  const through = addDaysWithinCalendar(from, horizonDays);
  const summary = scheduleAll(tx, ctx.read, from, through);
  ctx.publish('calendar.horizonExtended', { from, through, created: summary.created });
  ctx.log(
    `Scheduled ${String(summary.created)} shows for ${String(summary.createdByPromotion.size)} promotions`,
  );
}

registerSetupStep({ ...CALENDAR_SETUP_STEP, run: scheduleOpening });
