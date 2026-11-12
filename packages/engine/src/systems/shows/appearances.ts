/**
 * Appearance counts (EVT3-04): once per run card, every distinct worker on it (every participant in
 * any role, plus each segment's referee, producer and announcers) gets one more appearance this
 * year on their active contract with the show's promotion. A yearly phase resets the counts on
 * 1 January. Appearance caps, per-appearance fees and the not-booked penalty read these fields.
 *
 * Design: docs/design/show-night.md#appearances.
 */

import type { PersonId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { ShowContext } from './context';

/** Everyone who worked the card, by id: participants in every role and every segment's crew. */
export function showWorkers(read: GameWorldView, show: ShowContext): PersonId[] {
  const people = new Set<PersonId>();
  for (const { segment } of show.segments) {
    for (const participant of read.tables.participants.lookup('bySegment', segment.id)) {
      people.add(participant.personId);
    }
    const { crew } = segment;
    if (crew.refereeId !== null) {
      people.add(crew.refereeId);
    }
    if (crew.producerId !== null) {
      people.add(crew.producerId);
    }
    for (const announcerId of crew.announcerIds) {
      people.add(announcerId);
    }
  }
  return [...people].sort(compareIds);
}

/**
 * Counts one appearance for every worker on the run card who has an active contract with the
 * show's promotion. A guest with no contract there is skipped; a worker in several segments counts
 * once. Not called for shows scored off-screen.
 */
export function countAppearances(ctx: PhaseContext, show: ShowContext): void {
  for (const personId of showWorkers(ctx.read, show)) {
    const employment = ctx.read.tables.employments
      .lookup('byPerson', personId)
      .find((row) => row.status === 'active' && row.promotionId === show.promotionId);
    if (employment === undefined) {
      continue;
    }
    ctx.tx.update('employments', employment.id, {
      appearancesThisYear: employment.appearancesThisYear + 1,
      lastAppearanceOn: ctx.date,
    });
  }
}

/**
 * Yearly, on 1 January, in `housekeeping` (before `shows`, so a show on 1 January counts toward the
 * new year): every employment's `appearancesThisYear` goes back to 0. `lastAppearanceOn` is kept.
 * Order 22: `calendar.extendHorizon` holds housekeeping 20.
 */
export const resetAppearancesPhase: PhaseDefinition = definePhase({
  id: 'shows.resetAppearances',
  group: 'housekeeping',
  order: 22,
  cadence: { kind: 'yearly', month: 1, day: 1 },
  run: (ctx) => {
    let reset = 0;
    for (const employment of ctx.read.tables.employments.values()) {
      if (employment.appearancesThisYear === 0) {
        continue;
      }
      ctx.tx.update('employments', employment.id, { appearancesThisYear: 0 });
      reset += 1;
    }
    if (reset > 0) {
      ctx.log(`Reset the appearance counts of ${String(reset)} contract(s) for the new year`);
    }
  },
});
