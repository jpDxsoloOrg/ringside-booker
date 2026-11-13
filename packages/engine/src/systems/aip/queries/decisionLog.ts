/**
 * `aip.decisionLog`: a promotion's rival decisions, newest first, a page at a time.
 *
 * A row is shown only when `isRevealedTo` says the viewer may see it: always for the promotion's
 * own controller, in a sandbox game and for the all-seeing viewer, and for anyone else once the
 * reveal day has been simulated. Hidden rows are counted (`hiddenCount`) but never described, so
 * the screen can say "2 plans hidden until they air" without leaking them. Each entry points at
 * its stored Why? only while the trace is still kept. Design: docs/design/rival-desk.md#decision-log.
 */

import { z } from 'zod';
import { defineQuery, type QueryDefinition } from '../../../core/api/query';
import { refuseQuery } from '../../../core/api/result';
import { compareDates, type GameDate } from '../../../core/date';
import type { AiDecisionId, BrandId, PromotionId } from '../../../core/ids';
import type { TraceRef } from '../../../core/trace/store';
import type { AiDecision, AiDecisionRefs } from '../../../model/entities/ai-decision';
import type { TemplatedText } from '../../../model/primitives';
import { zId } from '../../../model/primitives';
import { compareIds } from '../../../model/table';
import type { DeepReadonly } from '../../../model/world';
import { decisionKindOf, decisionKinds } from '../decisionKinds';
import { needSummaryText } from '../formulas/needs';
import {
  CARD_BOOKED_SUMMARY_KEY,
  cardBookedText,
  SHOW_CANCELLED_SUMMARY_KEY,
  showCancelledText,
} from '../card/bookShowJob';
import { ROSTER_REVIEW_SUMMARY_KEY, rosterReviewSummaryText } from '../jobs/rosterReview';
import { isRevealedTo } from '../reveal';
import { resultsSummaryText } from '../results/texts';
import { brandOrRefuse, promotionOrRefuse } from './shared';
import { keepDetailPeriodText } from '../../history/note';

/** Entries one page holds when not told. */
export const DEFAULT_DECISION_LOG_LIMIT = 50;
/** The most entries one page holds. */
export const MAX_DECISION_LOG_LIMIT = 200;
export const DECISION_NOT_FOUND = 'That entry is no longer in the log.';

export interface AipDecisionLogArgs {
  promotionId: PromotionId;
  /** Left out: every row of the promotion; null: the whole-promotion rows; a brand: its rows. */
  brandId?: BrandId | null | undefined;
  /** 1 to 200; left out: 50. */
  limit?: number | undefined;
  /** The last entry of the previous page: the page starts after it. */
  before?: AiDecisionId | undefined;
  /** Only these kinds; left out: every kind. */
  kinds?: string[] | undefined;
}

export interface AipDecisionLogEntry {
  decisionId: AiDecisionId;
  date: GameDate;
  brandId: BrandId | null;
  kind: string;
  /** The filter chip's label, or the kind itself for a kind nobody registered. */
  chip: string;
  summary: TemplatedText;
  /** The summary in plain English. */
  text: string;
  refs: AiDecisionRefs;
  /** The stored Why?, or null when there is none or it has been pruned. */
  traceRef: TraceRef | null;
  importance: number;
}

export interface AipDecisionLogKind {
  kind: string;
  chip: string;
  /** Visible rows of this kind (before the `kinds` filter). */
  count: number;
}

export interface AipDecisionLog {
  entries: AipDecisionLogEntry[];
  /** Registered kinds with at least one visible row, by kind. */
  kinds: AipDecisionLogKind[];
  /** Rows the viewer may not see yet. */
  hiddenCount: number;
  /** Pass as `before` for the next page; null on the last page. */
  nextBefore: AiDecisionId | null;
  /**
   * How long decisions are kept, in plain words, for the end of the list: "Decisions are kept for
   * the last 4 weeks." (`history.keepDetailDays`, POL4-08).
   */
  keptNote: string;
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'aip.decisionLog': { args: AipDecisionLogArgs; result: AipDecisionLog };
  }
}

/**
 * A decision's summary in plain English: the review's or the card's own sentence, a need's, else
 * the key.
 */
export function decisionSummaryText(summary: TemplatedText): string {
  switch (summary.key) {
    case ROSTER_REVIEW_SUMMARY_KEY:
      return rosterReviewSummaryText(summary);
    case CARD_BOOKED_SUMMARY_KEY:
      return cardBookedText(summary);
    case SHOW_CANCELLED_SUMMARY_KEY:
      return showCancelledText(summary);
    default:
      return resultsSummaryText(summary) ?? needSummaryText(summary);
  }
}

/** Newest first: date, then ID, both descending. */
function newestFirst(left: DeepReadonly<AiDecision>, right: DeepReadonly<AiDecision>): number {
  return compareDates(right.date, left.date) || compareIds(right.id, left.id);
}

export const aipDecisionLogQuery: QueryDefinition<'aip.decisionLog'> = defineQuery(
  'aip.decisionLog',
  {
    args: z.strictObject({
      promotionId: zId('promotion'),
      brandId: zId('brand').nullable().optional(),
      limit: z.number().int().min(1).max(MAX_DECISION_LOG_LIMIT).optional(),
      before: zId('aiDecision').optional(),
      kinds: z.array(z.string().min(1).max(40)).max(50).optional(),
    }),
    run: (ctx, args) => {
      const { read, viewer } = ctx;
      const promotion = promotionOrRefuse(read, args.promotionId);
      if (args.brandId !== undefined && args.brandId !== null) {
        brandOrRefuse(read, promotion.id, args.brandId);
      }
      const rows = read.tables.aiDecisions
        .lookup('byPromotion', promotion.id)
        .filter((row) => args.brandId === undefined || row.brandId === args.brandId)
        .sort(newestFirst);

      let hiddenCount = 0;
      const visible: DeepReadonly<AiDecision>[] = [];
      for (const row of rows) {
        if (isRevealedTo(read, viewer, promotion.id, row.revealOn)) {
          visible.push(row);
        } else {
          hiddenCount += 1;
        }
      }

      const counts = new Map<string, number>();
      for (const row of visible) {
        counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
      }
      const kinds = decisionKinds()
        .filter((kind) => (counts.get(kind.kind) ?? 0) > 0)
        .map((kind) => ({ kind: kind.kind, chip: kind.chip, count: counts.get(kind.kind) ?? 0 }));

      const wanted = args.kinds === undefined ? null : new Set(args.kinds);
      let page = visible.filter((row) => wanted === null || wanted.has(row.kind));
      if (args.before !== undefined) {
        const cursor = read.tables.aiDecisions.get(args.before);
        if (cursor?.promotionId !== promotion.id) {
          return refuseQuery({ code: 'notFound', message: DECISION_NOT_FOUND, field: 'before' });
        }
        page = page.filter((row) => newestFirst(cursor, row) < 0);
      }
      const limit = args.limit ?? DEFAULT_DECISION_LOG_LIMIT;
      const entries = page.slice(0, limit).map((row): AipDecisionLogEntry => ({
        decisionId: row.id,
        date: row.date,
        brandId: row.brandId,
        kind: row.kind,
        chip: decisionKindOf(row.kind)?.chip ?? row.kind,
        summary: { key: row.summary.key, params: { ...row.summary.params } },
        text: decisionSummaryText(row.summary),
        refs: {
          personIds: [...row.refs.personIds],
          employmentIds: [...row.refs.employmentIds],
          titleIds: [...row.refs.titleIds],
          promotionIds: [...row.refs.promotionIds],
          eventInstanceId: row.refs.eventInstanceId,
        },
        traceRef:
          row.traceRef !== null && ctx.traces.has(row.traceRef) ? { ...row.traceRef } : null,
        importance: row.importance,
      }));
      const last = entries.at(-1);
      return {
        entries,
        kinds,
        hiddenCount,
        nextBefore: page.length > limit && last !== undefined ? last.decisionId : null,
        keptNote: `Decisions are kept for the last ${keepDetailPeriodText(
          ctx.tunables.get('history.keepDetailDays'),
        )}.`,
      };
    },
  },
);
