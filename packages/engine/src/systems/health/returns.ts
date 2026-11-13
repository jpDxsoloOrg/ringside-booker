/**
 * Injury returns (WRK6-03): the daily step that brings people back on their return date, and the
 * weekly step that slims old injury traces to summaries.
 *
 * Design: docs/design/health.md#returns.
 */

import { compareDates, diffDays } from '../../core/date';
import type { PhaseContext } from '../../core/pipeline/context';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import type { InjuryRecord } from '../../model/entities/injury';
import type { DeepReadonly } from '../../model/world';
import { isPastDetailWindow } from '../history/note';
import { injuryConditionLossTraceRef, injuryRecordChanceTraceRef, injuryTraceRef } from './injure';

/**
 * Closes every current injury whose `expectedReturn` is today or earlier, in injury id order: the
 * row keeps `returnedOn = today`, the person's `injury` pointer is cleared, and `injury.healed` is
 * published. Draws no random numbers. Only people with a pointer are looked at, so a quiet day
 * costs one pass over the people. Returns how many came back.
 */
export function healInjuries(ctx: PhaseContext): number {
  const due: DeepReadonly<InjuryRecord>[] = [];
  for (const person of ctx.read.tables.people.values()) {
    if (person.injury === null || compareDates(person.injury.expectedReturn, ctx.date) > 0) {
      continue;
    }
    const open = ctx.read.tables.injuries.lookupOne('openByPerson', person.id);
    if (open !== undefined && compareDates(open.expectedReturn, ctx.date) <= 0) {
      due.push(open);
    }
  }
  due.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  for (const injury of due) {
    ctx.tx.update('injuries', injury.id, { returnedOn: ctx.date });
    ctx.tx.update('people', injury.personId, { injury: null });
    ctx.publish('injury.healed', {
      personId: injury.personId,
      injuryId: injury.id,
      kindKey: injury.kindKey,
      daysOut: diffDays(injury.since, ctx.date),
    });
  }
  return due.length;
}

/**
 * Slims the traces of every injury that started before the detail window
 * (`history.keepDetailDays`) to summaries. The rows stay: they are the worker's record. Demoting
 * a trace that is already a summary, or was never stored, does nothing. Returns how many injuries
 * it looked at.
 */
export function pruneInjuryDetail(ctx: PhaseContext): number {
  const keepDetailDays = ctx.tunables.get('history.keepDetailDays');
  let count = 0;
  for (const injury of ctx.read.tables.injuries.values()) {
    if (!isPastDetailWindow(injury.since, ctx.date, keepDetailDays)) {
      continue;
    }
    ctx.demoteTrace(injuryTraceRef(injury.id));
    ctx.demoteTrace(injuryConditionLossTraceRef(injury.id));
    ctx.demoteTrace(injuryRecordChanceTraceRef(injury.id));
    count += 1;
  }
  return count;
}

export const PRUNE_INJURY_DETAIL_PHASE_ID = 'health.pruneInjuryDetail';

/** Weekly on Mondays in `periodic`, after the history roll-up (41) and the rival prunes (42, 43). */
export const pruneInjuryDetailPhase: PhaseDefinition = definePhase({
  id: PRUNE_INJURY_DETAIL_PHASE_ID,
  group: 'periodic',
  order: 44,
  cadence: { kind: 'weekly', weekday: 'mon' },
  run: (ctx) => {
    pruneInjuryDetail(ctx);
  },
});
