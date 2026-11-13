/**
 * `match.prunePhysicalDetail` (MTCH4-04): the player's physical toll traces are kept in full for
 * `history.keepDetailDays` days after the show and then demoted to their summaries (the owner's
 * history rule, POL4-08). Rival shows only ever keep summaries, so there is nothing to demote there.
 *
 * Daily in `periodic` (order 45, after `aip.pruneCardDetail` and `health.pruneInjuryDetail`): demotes the traces of the matches on
 * the shows dated exactly `today - keepDetailDays`. On the 1st of each month a full sweep catches
 * shows a lowered setting or a failed day left behind.
 *
 * Design: docs/design/physical-toll.md#stored-traces.
 */

import { addDays, compareDates, dayOfMonth } from '../../../core/date';
import { definePhase, type PhaseDefinition } from '../../../core/pipeline/phase';
import type { PhaseContext } from '../../../core/pipeline/context';
import type { EventInstance } from '../../../model/entities/event-instance';
import type { DeepReadonly } from '../../../model/world';
import {
  fatigueTraceRef,
  injuryChanceTraceRef,
  injuryRollTraceRef,
  learningTraceRef,
  wearTraceRef,
} from './traceRefs';

export const PRUNE_PHYSICAL_DETAIL_PHASE_ID = 'match.prunePhysicalDetail';

const REFS = [
  fatigueTraceRef,
  wearTraceRef,
  learningTraceRef,
  injuryChanceTraceRef,
  injuryRollTraceRef,
] as const;

/** Demotes every physical toll trace of the matches on `shows`. */
function demoteShows(ctx: PhaseContext, shows: Iterable<DeepReadonly<EventInstance>>): void {
  const { read } = ctx;
  for (const show of shows) {
    for (const segment of read.tables.segments.lookup('byEventInstance', show.id)) {
      if (segment.kind !== 'match') {
        continue;
      }
      for (const participant of read.tables.participants.lookup('bySegment', segment.id)) {
        if (participant.role !== 'competitor') {
          continue;
        }
        // A ref with no full trace (a rival's summary, or an uninjured worker's roll) is left as it is.
        for (const ref of REFS) {
          ctx.demoteTrace(ref(segment.id, participant.personId));
        }
      }
    }
  }
}

export const prunePhysicalDetailPhase: PhaseDefinition = definePhase({
  id: PRUNE_PHYSICAL_DETAIL_PHASE_ID,
  group: 'periodic',
  order: 45,
  cadence: { kind: 'daily' },
  run: (ctx) => {
    const cutoff = addDays(ctx.date, -ctx.tunables.get('history.keepDetailDays'));
    const shows =
      dayOfMonth(ctx.date) === 1
        ? ctx.read.tables.eventInstances
            .values()
            .filter((show) => compareDates(show.date, cutoff) <= 0)
        : ctx.read.tables.eventInstances.lookup('byDate', cutoff);
    demoteShows(ctx, shows);
  },
});
