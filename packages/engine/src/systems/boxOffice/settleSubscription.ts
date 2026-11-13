/**
 * The player's shows are settled the moment they run (EVT6-05).
 *
 * The player runs a show from the show screen (`shows.runTonight`, EVT2-09) at the start of its
 * day, before that day's phases, and goes straight to its results. So the box office does not wait
 * for the `settlement` group: this reaction to `show.completed` settles a show a human runs right
 * after the step that ran it, on the same date, and the results page has its Box office at once.
 * Rival shows are settled together by the `boxOffice.settleShows` phase later that day, which also
 * catches a player's show this reaction could not settle (a failed reaction rolls back only its
 * own work, and the phase runs on the same date). Design: docs/design/box-office.md#settlement.
 */

import { defineSubscription, type SubscriptionSpec } from '../../core/api/system';
import { showControllerOf } from '../calendar/control';
import { settleShow } from './settle';

export const SETTLE_SHOW_SUBSCRIPTION_ID = 'boxOffice.settleShow';

export const settleShowSubscription: SubscriptionSpec<'show.completed'> = defineSubscription({
  id: SETTLE_SHOW_SUBSCRIPTION_ID,
  type: 'show.completed',
  handler: (event, ctx) => {
    const show = ctx.read.tables.eventInstances.get(event.payload.eventInstanceId);
    if (show === undefined || showControllerOf(ctx.read, show).kind !== 'human') {
      return;
    }
    settleShow(ctx, show.id);
  },
});
