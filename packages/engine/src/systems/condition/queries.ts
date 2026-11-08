/**
 * The condition system's queries.
 *
 * `condition.fatigue` returns one person's fatigue with a link to the trace that explains it, ready
 * for a "Why?" panel. Fatigue is not secret, so every viewer sees the same answer.
 */

import { z } from 'zod';
import { defineQuery, type QueryDefinition } from '../../core/api/query';
import type { PersonId } from '../../core/ids';
import type { TraceRef } from '../../core/trace/store';
import { zId } from '../../model/primitives';
import { fatigueRecoveryTraceRef } from './phases';

/** `condition.fatigue`: a person's current fatigue and the trace behind it. */
export interface FatigueView {
  personId: PersonId;
  /** 0 to 100. */
  fatigue: number;
  /** The latest recovery trace, or null when none is stored (they have not recovered yet). */
  traceRef: TraceRef | null;
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'condition.fatigue': { args: { personId: PersonId }; result: FatigueView | null };
  }
}

export const fatigueQuery: QueryDefinition<'condition.fatigue'> = defineQuery('condition.fatigue', {
  args: z.strictObject({ personId: zId('person') }),
  run: (ctx, args) => {
    const person = ctx.read.tables.people.get(args.personId);
    if (person === undefined) {
      return null;
    }
    const ref = fatigueRecoveryTraceRef(person.id);
    return {
      personId: person.id,
      fatigue: person.fatigue,
      traceRef: ctx.traces.has(ref) ? ref : null,
    };
  },
});

export const conditionQueries: readonly QueryDefinition[] = [fatigueQuery];
