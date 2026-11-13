/**
 * `aip.pruneCardDetail`: rival show detail is kept in full only for a while (AIP4-05).
 *
 * The save keeps roughly the last month in detail and the current numbers. A rival card's short
 * plan Why? (`aip.cardPlan`, the booker's notes, AIP4-09) and each written segment's short Why?
 * (`aip.cardSlot`) are kept in full for `history.keepDetailDays` days after the show and then
 * demoted to its summary, and so are AIP5's winner and title decisions (`aip.winner`,
 * `aip.title`). The cards themselves are not touched here: the weekly `history.rollUp`
 * (POL4-08) summarises them on the same window.
 *
 * The player's own slots that Auto-fill wrote (AIP4-06) carry the same short Why? and go the same
 * way, so every show is swept, not only the computer's; a show without such traces costs nothing.
 *
 * Daily in `periodic` (order 43, after `aip.pruneDecisionLog`): demotes the slots of the shows
 * dated exactly `today - keepDetailDays`, read through the `byDate` index. On the 1st of each
 * month a full sweep catches shows a lowered setting or a failed day left behind. See
 * docs/design/rival-booking.md#show-day.
 */

import { addDays, compareDates, dayOfMonth, type GameDate } from '../../../core/date';
import { definePhase, type PhaseDefinition } from '../../../core/pipeline/phase';
import type { PhaseContext } from '../../../core/pipeline/context';
import type { EventInstance } from '../../../model/entities/event-instance';
import type { DeepReadonly } from '../../../model/world';
import { titleTraceRef, winnerTraceRef } from '../results/traces';
import { CARD_PLAN_TRACE_KIND, CARD_SLOT_TRACE_KIND } from './bookShowJob';

export const AIP_PRUNE_CARD_DETAIL_PHASE_ID = 'aip.pruneCardDetail';

/**
 * Demotes the plan and slot traces of the shows among `shows`; returns how many shows had
 * segments.
 */
function demoteSlots(ctx: PhaseContext, shows: Iterable<DeepReadonly<EventInstance>>): number {
  let count = 0;
  for (const show of shows) {
    ctx.demoteTrace({ kind: CARD_PLAN_TRACE_KIND, id: show.id });
    const segments = ctx.read.tables.segments.lookup('byEventInstance', show.id);
    for (const segment of segments) {
      ctx.demoteTrace({ kind: CARD_SLOT_TRACE_KIND, id: segment.id });
      // AIP5: the winner and title decisions follow the same rule.
      if (segment.kind === 'match') {
        ctx.demoteTrace(winnerTraceRef(segment.id));
        for (const titleId of segment.match.titleIds) {
          ctx.demoteTrace(titleTraceRef(segment.id, titleId));
        }
      }
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
      ctx.log(`Kept only a summary of ${String(pruned)} booked card(s) from ${cutoff} or before`);
    }
  },
});
