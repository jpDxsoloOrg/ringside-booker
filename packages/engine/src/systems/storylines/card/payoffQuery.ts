/**
 * `storylines.payoff` (CRTV4-03): what ending a storyline today would pay, member by member, or
 * what it paid once it ended. The preview comes from the same planner the real payoff runs, so
 * the two never disagree. Only the storyline's own promotion sees the numbers (and the omniscient
 * viewer); the popularity itself is public through each worker's profile like any other change.
 *
 * Design: docs/design/storylines.md#payoff.
 */

import { z } from 'zod';
import { defineQuery, type QueryDefinition } from '../../../core/api/query';
import type { Reason } from '../../../core/api/result';
import type { StorylineId } from '../../../core/ids';
import type { TraceRef } from '../../../core/trace/store';
import type { StorylinePayoffRecord } from '../../../model/entities/storyline';
import { zId } from '../../../model/primitives';
import { STORYLINE_NOT_FOUND_MESSAGE, STORYLINE_REASONS } from '../queries';
import { seesStorylinesOf } from '../rows';
import { storylinePayoffTraceRef } from '../traceKinds';
import { planPayoff, type PayoffPlan } from './planPayoff';

/** Why `storylines.payoff` has nothing to show. */
export const STORYLINE_PAYOFF_REASONS = {
  notFound: STORYLINE_REASONS.notFound,
  notYourStoryline: 'storylines.notYourStoryline',
  /** Ended before payoffs existed, so there is no record. */
  noRecord: 'storylines.noPayoffRecord',
} as const;

/** `storylines.payoff`: the preview while active, the record once ended, or why neither. */
export type StorylinePayoffView =
  | { kind: 'preview'; plan: PayoffPlan }
  | {
      kind: 'paid' | 'noPayoff';
      record: StorylinePayoffRecord;
      /** The payoff's Why?, or null when it is no longer kept. */
      traceRef: TraceRef | null;
    }
  | { kind: 'unavailable'; reason: Reason };

declare module '../../../core/api/maps' {
  interface QueryMap {
    'storylines.payoff': { args: { storylineId: StorylineId }; result: StorylinePayoffView };
  }
}

export const storylinesPayoffQuery: QueryDefinition<'storylines.payoff'> = defineQuery(
  'storylines.payoff',
  {
    args: z.strictObject({ storylineId: zId('storyline') }),
    run: (ctx, args): StorylinePayoffView => {
      const subject = { kind: 'storyline', id: args.storylineId } as const;
      const storyline = ctx.read.tables.storylines.get(args.storylineId);
      if (storyline === undefined) {
        return {
          kind: 'unavailable',
          reason: {
            code: STORYLINE_PAYOFF_REASONS.notFound,
            message: STORYLINE_NOT_FOUND_MESSAGE,
            subject,
          },
        };
      }
      if (!seesStorylinesOf(ctx.read, ctx.viewer, storyline.promotionId)) {
        const promotion = ctx.read.tables.promotions.get(storyline.promotionId);
        return {
          kind: 'unavailable',
          reason: {
            code: STORYLINE_PAYOFF_REASONS.notYourStoryline,
            message: `${storyline.name} belongs to ${promotion?.name ?? 'another promotion'}; its payoff is private.`,
            subject,
          },
        };
      }
      if (storyline.status === 'active') {
        return { kind: 'preview', plan: planPayoff(ctx.read, ctx.tunables, storyline.id) };
      }
      if (storyline.payoff === null) {
        return {
          kind: 'unavailable',
          reason: {
            code: STORYLINE_PAYOFF_REASONS.noRecord,
            message: `${storyline.name} ended before storyline payoffs, so there is no payoff to show.`,
            subject,
          },
        };
      }
      const ref = storylinePayoffTraceRef(storyline.id);
      return {
        kind: storyline.payoff.paid ? 'paid' : 'noPayoff',
        // A copy, so the result never shares the stored row.
        record: {
          ...storyline.payoff,
          members: storyline.payoff.members.map((member) => ({ ...member })),
        },
        traceRef: ctx.traces.has(ref) ? ref : null,
      };
    },
  },
);
