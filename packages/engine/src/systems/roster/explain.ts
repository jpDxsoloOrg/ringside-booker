/**
 * `roster.explain`: the Why? behind one derived number of a roster row, rebuilt when it is asked
 * for.
 *
 * Expected push, push gap, overall and popularity are worked out on read and never stored, so their
 * Why? is rebuilt by running the same formulas on the same inputs as the row ({@link rowInputs}).
 * Stored values (momentum, morale) are explained through the row's `traceRef` instead.
 *
 * Design: docs/design/roster.md#roster-explain.
 */

import { z } from 'zod';
import { viewerPromotionIds, type Viewer } from '../../core/api/controller';
import { defineQuery, type QueryDefinition } from '../../core/api/query';
import type { GameDate } from '../../core/date';
import type { EmploymentId, PromotionId } from '../../core/ids';
import { limitTrace, type TraceNode } from '../../core/trace';
import { zId } from '../../model/primitives';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';
import { PUSH_LABELS } from '../workers/formulas/expectedPush';
import { RATING_ROLE_LABELS } from '../workers/formulas/roleRating';
import {
  oneDecimal,
  rowExpectedPush,
  rowInputs,
  rowOverall,
  rowPopularity,
  rowPushGap,
} from './rowInputs';

/** The derived numbers of a roster row that can be explained. */
export const ROSTER_EXPLAIN_METRICS = ['expectedPush', 'pushGap', 'overall', 'popularity'] as const;
export type RosterExplainMetric = (typeof ROSTER_EXPLAIN_METRICS)[number];

export interface RosterExplainArgs {
  employmentId: EmploymentId;
  metric: RosterExplainMetric;
}

/** One roster number with how it was worked out. Plain JSON only. */
export interface RosterExplanation {
  employmentId: EmploymentId;
  metric: RosterExplainMetric;
  /** What the Why? panel is titled, for example "Expects: Mid card". */
  label: string;
  /** The value the row shows: the push for `expectedPush`, a number otherwise. */
  value: number | string;
  unit: string | null;
  trace: TraceNode;
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'roster.explain': { args: RosterExplainArgs; result: RosterExplanation | null };
  }
}

/** True when `viewer` may see the roster of `promotionId`: its own, or anything when all-seeing. */
function canSee(read: GameWorldView, viewer: Viewer, promotionId: PromotionId): boolean {
  return viewer.kind === 'omniscient' || viewerPromotionIds(read, viewer).includes(promotionId);
}

/**
 * The traced `metric` of the roster row for `employmentId` on `date`, or null when there is no such
 * active contract, the viewer cannot see its promotion's roster, or the metric does not apply (a
 * role with no card position has no expected push or push gap).
 */
export function rosterExplanationOf(
  read: GameWorldView,
  viewer: Viewer,
  date: GameDate,
  args: RosterExplainArgs,
  tunables: EngineTunables,
): RosterExplanation | null {
  const employment = read.tables.employments.get(args.employmentId);
  if (employment?.status !== 'active' || !canSee(read, viewer, employment.promotionId)) {
    return null;
  }
  const inputs = rowInputs(read, employment, date);
  const deps = { tunables };
  const base = { employmentId: employment.id, metric: args.metric };
  switch (args.metric) {
    case 'expectedPush': {
      const expected = rowExpectedPush(inputs, deps);
      if (expected === null) {
        return null;
      }
      return {
        ...base,
        label: `Expects: ${PUSH_LABELS[expected.value]}`,
        value: expected.value,
        unit: null,
        trace: limitTrace(expected.trace),
      };
    }
    case 'pushGap': {
      const push = rowPushGap(inputs, deps);
      if (push === null) {
        return null;
      }
      // The verdict's decision holds the gap's calculation and names roster.expectsMoreSteps, so
      // the Why? explains both the number and the marker beside it.
      return {
        ...base,
        label: 'Push gap',
        value: push.gap.value,
        unit: 'count',
        trace: limitTrace(push.verdict.trace),
      };
    }
    case 'overall': {
      const rating = rowOverall(inputs, deps);
      return {
        ...base,
        label: `Overall as ${RATING_ROLE_LABELS[inputs.role].toLowerCase()}`,
        value: oneDecimal(rating.value),
        unit: 'points',
        trace: limitTrace(rating.trace),
      };
    }
    case 'popularity': {
      const popularity = rowPopularity(inputs, deps);
      return {
        ...base,
        label: `Popularity in ${inputs.promotion.name}'s regions`,
        value: oneDecimal(popularity.value),
        unit: 'points',
        trace: limitTrace(popularity.trace),
      };
    }
  }
}

export const rosterExplainQuery: QueryDefinition<'roster.explain'> = defineQuery('roster.explain', {
  args: z.strictObject({
    employmentId: zId('employment'),
    metric: z.enum(ROSTER_EXPLAIN_METRICS),
  }),
  run: (ctx, args) => rosterExplanationOf(ctx.read, ctx.viewer, ctx.date, args, ctx.tunables),
});
