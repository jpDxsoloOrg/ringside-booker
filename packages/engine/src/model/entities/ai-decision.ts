/**
 * The rival decision log (AIP1-01): one row per thing a computer-run unit decided.
 *
 * Rows are added and never edited; rows older than `history.keepDetailDays` are pruned
 * (`appendOnly: 'pruneOnly'`, enforced by the transaction layer). A row is kept small on purpose,
 * because eleven rivals write to it all year: the summary is templated text (a content key and a
 * few short params, never a rendered sentence), the refs are capped ID lists, and the Why? sits
 * behind `traceRef`, which points at a summary-only trace (POL4-06: rivals keep summaries, the
 * player keeps full traces).
 *
 * `kind` is an open camelCase key (`rosterReview`, later `push`, `card`, `title`, ...), not an
 * enum, so later rival features add kinds without a save change. `revealOn` keeps a rival's plan
 * hidden from other controllers until it airs (D-07). See docs/design/rival-desk.md#decision-log.
 */

import { z } from 'zod';
import type { GameDate } from '../../core/date';
import type { PromotionId } from '../../core/ids';
import { TraceRefSchema } from '../../core/trace/store';
import { zGameDate, zId, zTemplatedText } from '../primitives';
import { defineTable } from '../table-def';

/** A decision kind: a short lower camelCase key. */
export const AI_DECISION_KIND_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
export const AiDecisionKindSchema = z.string().max(40).regex(AI_DECISION_KIND_PATTERN);

/** The most IDs of one kind a decision row names. */
export const AI_DECISION_MAX_REFS = 12;

export const AiDecisionRefsSchema = z.strictObject({
  personIds: z.array(zId('person')).max(AI_DECISION_MAX_REFS).default([]),
  /** What AIP3 and AIP8 search to find a worker's last push, turn or brand move. */
  employmentIds: z.array(zId('employment')).max(AI_DECISION_MAX_REFS).default([]),
  titleIds: z.array(zId('title')).max(AI_DECISION_MAX_REFS).default([]),
  promotionIds: z.array(zId('promotion')).max(AI_DECISION_MAX_REFS).default([]),
  eventInstanceId: zId('eventInstance').nullable(),
});

export type AiDecisionRefs = z.infer<typeof AiDecisionRefsSchema>;

export const AiDecisionSchema = z.strictObject({
  id: zId('aiDecision'),
  promotionId: zId('promotion'),
  /** Null for a whole-promotion unit; set for a computer-run brand unit. */
  brandId: zId('brand').nullable(),
  date: zGameDate,
  kind: AiDecisionKindSchema,
  summary: zTemplatedText,
  refs: AiDecisionRefsSchema,
  /** The decision's Why? (a summary-only trace); null when it has none. */
  traceRef: TraceRefSchema.nullable(),
  /** Other controllers see the row from this day on (the day the plan airs). */
  revealOn: zGameDate,
  /** 0 = routine, 3 = headline. Screens and news use it to pick what to show. */
  importance: z.int().min(0).max(3),
});

export type AiDecision = z.infer<typeof AiDecisionSchema>;

/** The `byPromotionDate` index key: one promotion's decisions on one day. */
export function aiDecisionDateKey(promotionId: PromotionId, date: GameDate): string {
  return `${promotionId}|${date}`;
}

export const aiDecisionsTable = defineTable({
  kind: 'aiDecision',
  name: 'aiDecisions',
  schema: AiDecisionSchema,
  refs: [
    { path: 'promotionId', target: 'promotion', nullable: false },
    { path: 'brandId', target: 'brand', nullable: true },
    { path: 'refs.personIds[]', target: 'person', nullable: false },
    { path: 'refs.employmentIds[]', target: 'employment', nullable: false },
    { path: 'refs.titleIds[]', target: 'title', nullable: false },
    { path: 'refs.promotionIds[]', target: 'promotion', nullable: false },
    { path: 'refs.eventInstanceId', target: 'eventInstance', nullable: true },
  ],
  indexes: [
    { name: 'byPromotion', key: (decision) => decision.promotionId },
    /** Key `<promotionId>|<date>`. */
    {
      name: 'byPromotionDate',
      key: (decision) => aiDecisionDateKey(decision.promotionId, decision.date),
    },
    { name: 'byRevealOn', key: (decision) => decision.revealOn },
  ],
  appendOnly: 'pruneOnly',
});
