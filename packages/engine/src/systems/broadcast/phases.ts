/**
 * When airings are settled (ECO8-04). Design: docs/design/broadcast.md#settlement.
 *
 * - **`broadcast.airings`** (daily, `settlement` 40): settles every airing due today, for every
 *   promotion. It runs after the box office (`boxOffice.settleShows`, settlement 10), so a show's
 *   crowd is settled first, and before `calendar.closePastShows` (settlement 90), so a show still
 *   scheduled on its air date is seen as it stands before the calendar closes it.
 * - **`broadcast.settleOnShowNight`** (reaction to `show.completed`): the player runs a show before
 *   that day's phases, so its airings are settled the moment it completes, whether it was run in
 *   one go or segment by segment (EVT10), and its results page has its viewers at once. A taped
 *   show completes on its taping day and waits for the phase on its air date.
 *
 * Both skip an airing that already has a row, so each due airing is settled exactly once.
 */

import { defineSubscription, type SubscriptionSpec } from '../../core/api/system';
import type { StepContext } from '../../core/pipeline/context';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import { showControllerOf } from '../calendar/control';
import { airingsDueOn, type DueAiring } from './coverage';
import { alreadySettled, settleAiring } from './settle';

export const SETTLE_AIRINGS_PHASE_ID = 'broadcast.airings';
export const SETTLE_ON_SHOW_NIGHT_SUBSCRIPTION_ID = 'broadcast.settleOnShowNight';

function settleAll(ctx: StepContext, due: readonly DueAiring[]): number {
  let settled = 0;
  for (const airing of due) {
    if (settleAiring(ctx, airing) !== null) {
      settled += 1;
    }
  }
  return settled;
}

/** Daily: settles every airing due today that has no row yet. */
export const settleAiringsPhase: PhaseDefinition = definePhase({
  id: SETTLE_AIRINGS_PHASE_ID,
  group: 'settlement',
  order: 40,
  cadence: { kind: 'daily' },
  run: (ctx) => {
    const settled = settleAll(ctx, airingsDueOn(ctx.read, ctx.date));
    if (settled > 0) {
      ctx.log(`Settled ${String(settled)} airing(s)`);
    }
  },
});

/** On show night: settles today's airings of a show a person runs, as soon as it completes. */
export const settleOnShowNightSubscription: SubscriptionSpec<'show.completed'> = defineSubscription(
  {
    id: SETTLE_ON_SHOW_NIGHT_SUBSCRIPTION_ID,
    type: 'show.completed',
    handler: (event, ctx) => {
      const show = ctx.read.tables.eventInstances.get(event.payload.eventInstanceId);
      if (show?.airDate !== ctx.date || showControllerOf(ctx.read, show).kind !== 'human') {
        return;
      }
      const due = airingsDueOn(ctx.read, ctx.date).filter(
        (airing) =>
          airing.source === 'instance' &&
          airing.instance.id === show.id &&
          !alreadySettled(ctx.read, airing, ctx.date),
      );
      settleAll(ctx, due);
    },
  },
);
