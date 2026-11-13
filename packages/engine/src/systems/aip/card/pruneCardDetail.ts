/**
 * `aip.pruneCardDetail`: rival show detail is kept in full only for a while (AIP4-05).
 *
 * The save keeps roughly the last month in detail and the current numbers. A rival card's plan
 * trace (`aip.cardPlan`) is summary-only from the start; each written segment's short Why?
 * (`aip.cardSlot`) is kept in full for `aip.card.keepDetailDays` days after the show and then
 * demoted to its summary. The cards themselves (who was on which show, the results) are public
 * facts other features read and are not touched here.
 *
 * Daily in `periodic` (order 43, after `aip.pruneDecisionLog`): demotes the slots of the computer
 * shows dated exactly `today - keepDetailDays`, read through the `byDate` index. On the 1st of each
 * month a full sweep catches shows a lowered setting or a failed day left behind. See
 * docs/design/rival-booking.md#show-day.
 */

import { addDays, compareDates, dayOfMonth, type GameDate } from '../../../core/date';
import { definePhase, type PhaseDefinition } from '../../../core/pipeline/phase';
import type { PhaseContext } from '../../../core/pipeline/context';
import type { EventInstance } from '../../../model/entities/event-instance';
import type { DeepReadonly } from '../../../model/world';
import { showControllerOf } from '../../calendar/control';
import { CARD_SLOT_TRACE_KIND } from './bookShowJob';

export const AIP_PRUNE_CARD_DETAIL_PHASE_ID = 'aip.pruneCardDetail';

/** Demotes the slot traces of the computer shows among `shows`; returns how many shows. */
function demoteSlots(ctx: PhaseContext, shows: Iterable<DeepReadonly<EventInstance>>): number {
  let count = 0;
  for (const show of shows) {
    if (showControllerOf(ctx.read, show).kind !== 'computer') {
      continue;
    }
    const segments = ctx.read.tables.segments.lookup('byEventInstance', show.id);
    for (const segment of segments) {
      ctx.demoteTrace({ kind: CARD_SLOT_TRACE_KIND, id: segment.id });
    }
    count += segments.length > 0 ? 1 : 0;
  }
  return count;
}

/** The last show date whose detail goes today. */
export function cardDetailCutoff(today: GameDate, keepDetailDays: number): GameDate {
  return addDays(today, -keepDetailDays);
}

export const pruneCardDetailPhase: PhaseDefinition = definePhase({
  id: AIP_PRUNE_CARD_DETAIL_PHASE_ID,
  group: 'periodic',
  order: 43,
  cadence: { kind: 'daily' },
  run: (ctx) => {
    const cutoff = cardDetailCutoff(ctx.date, ctx.tunables.get('history.keepDetailDays'));
    const shows =
      dayOfMonth(ctx.date) === 1
        ? ctx.read.tables.eventInstances
            .values()
            .filter((show) => compareDates(show.date, cutoff) <= 0)
        : ctx.read.tables.eventInstances.lookup('byDate', cutoff);
    const pruned = demoteSlots(ctx, shows);
    if (pruned > 0) {
      ctx.log(`Kept only a summary of ${String(pruned)} rival card(s) from ${cutoff} or before`);
    }
  },
});
