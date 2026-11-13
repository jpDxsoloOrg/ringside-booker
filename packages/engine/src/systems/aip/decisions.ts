/**
 * Writing a rival decision: one `aiDecisions` row, its Why? as a summary-only trace, and an
 * `aip.decisionRecorded` event.
 *
 * Jobs call this through `job.recordDecision(spec)`, which buffers the trace and the event with
 * the rest of the job's work (see `jobs/context.ts`). Setup steps, which have no job context (the
 * day-one booker appointments, AIP2-02), call `writeAiDecision` with their own step context.
 *
 * Rows stay small because eleven rivals write them all year: the summary is templated text, each
 * ref list holds at most 12 IDs, and the trace is stored summary-only (POL4-06). See
 * docs/design/rival-desk.md#decision-log.
 */

import type { GameDate } from '../../core/date';
import { InvalidArgumentError } from '../../core/errors';
import type { AiDecisionId } from '../../core/ids';
import type { StepContext } from '../../core/pipeline/context';
import type { Traced, TraceValue } from '../../core/trace';
import { TRACE_REF_KIND_PATTERN, type TraceRef } from '../../core/trace/store';
import {
  AI_DECISION_MAX_REFS,
  aiDecisionDateKey,
  type AiDecisionRefs,
} from '../../model/entities/ai-decision';
import type { TemplatedText } from '../../model/primitives';
import type { GameTables } from '../../model/tables';
import type { Tx } from '../../model/tx';
import { decisionKindOf } from './decisionKinds';
import type { AiUnit } from './units';

/** The highest decision importance: a headline. */
export const MAX_DECISION_IMPORTANCE = 3;

/** What a job hands `recordDecision`. */
export interface RecordDecisionSpec {
  /** A registered decision kind (`registerDecisionKind`), such as `rosterReview`. */
  readonly kind: string;
  /** Templated text: a content key and a few short params, never a rendered sentence. */
  readonly summary: TemplatedText;
  /** The IDs the decision is about, at most 12 of each. Left out: none. */
  readonly refs?: Partial<AiDecisionRefs>;
  /** The decision's Why?. Stored summary-only; left out: the row has no trace. */
  readonly traced?: Traced<TraceValue>;
  /** The trace's ref kind. Left out: `aip.<kind>`. */
  readonly traceKind?: string;
  /** When other controllers may see the row. Left out: today. */
  readonly revealOn?: GameDate;
  /** 0 (routine) to 3 (headline). Left out: 0. */
  readonly importance?: number;
}

/** What writing a decision needs from the step it runs in. */
export type DecisionWriteContext = Pick<StepContext, 'date' | 'publish' | 'recordTrace'>;

const REF_LIST_KEYS = ['personIds', 'employmentIds', 'titleIds', 'promotionIds'] as const;

function checkedRefs(refs: Partial<AiDecisionRefs> | undefined): AiDecisionRefs {
  const full: AiDecisionRefs = {
    personIds: [...(refs?.personIds ?? [])],
    employmentIds: [...(refs?.employmentIds ?? [])],
    titleIds: [...(refs?.titleIds ?? [])],
    promotionIds: [...(refs?.promotionIds ?? [])],
    eventInstanceId: refs?.eventInstanceId ?? null,
  };
  for (const key of REF_LIST_KEYS) {
    if (full[key].length > AI_DECISION_MAX_REFS) {
      throw new InvalidArgumentError(
        'writeAiDecision',
        `refs.${key}`,
        full[key].length,
        `at most ${String(AI_DECISION_MAX_REFS)} IDs`,
      );
    }
  }
  return full;
}

/**
 * The trace ref of the unit's `sequence`-th decision on `date` (0 first):
 * `{ kind, id: '<unitKey>:<date>:<sequence>' }`.
 */
export function decisionTraceRef(
  kind: string,
  unitKey: string,
  date: GameDate,
  sequence: number,
): TraceRef {
  return { kind, id: `${unitKey}:${date}:${String(sequence)}` };
}

/**
 * Writes one decision for `unit` on `ctx.date` and returns its ID: stores `spec.traced` (when
 * given) summary-only under `<unitKey>:<date>:<n>`, inserts the row pointing at it, then
 * publishes `aip.decisionRecorded`.
 *
 * @throws InvalidArgumentError for an unregistered kind, a bad trace kind, more than 12 IDs in a
 * ref list or an importance outside 0-3. Inside a job the throw rolls back that job only.
 */
export function writeAiDecision(
  tx: Tx<GameTables>,
  ctx: DecisionWriteContext,
  unit: Pick<AiUnit, 'promotionId' | 'brandId' | 'key'>,
  spec: RecordDecisionSpec,
): AiDecisionId {
  if (decisionKindOf(spec.kind) === null) {
    throw new InvalidArgumentError(
      'writeAiDecision',
      'kind',
      spec.kind,
      'a kind added with registerDecisionKind',
    );
  }
  const importance = spec.importance ?? 0;
  if (!Number.isInteger(importance) || importance < 0 || importance > MAX_DECISION_IMPORTANCE) {
    throw new InvalidArgumentError(
      'writeAiDecision',
      'importance',
      importance,
      `a whole number from 0 to ${String(MAX_DECISION_IMPORTANCE)}`,
    );
  }
  const traceKind = spec.traceKind ?? `aip.${spec.kind}`;
  if (!TRACE_REF_KIND_PATTERN.test(traceKind)) {
    throw new InvalidArgumentError(
      'writeAiDecision',
      'traceKind',
      traceKind,
      'dot-separated camelCase words',
    );
  }
  const refs = checkedRefs(spec.refs);
  const date = ctx.date;
  const revealOn = spec.revealOn ?? date;

  let traceRef: TraceRef | null = null;
  if (spec.traced !== undefined) {
    // The unit's decisions so far today number this one; rows rolled back with a job don't count.
    const sequence = tx.view.tables.aiDecisions
      .lookup('byPromotionDate', aiDecisionDateKey(unit.promotionId, date))
      .filter((decision) => decision.brandId === unit.brandId).length;
    traceRef = decisionTraceRef(traceKind, unit.key, date, sequence);
    ctx.recordTrace(traceRef, date, spec.traced, { summaryOnly: true });
  }

  const row = tx.create('aiDecisions', {
    promotionId: unit.promotionId,
    brandId: unit.brandId,
    date,
    kind: spec.kind,
    summary: spec.summary,
    refs,
    traceRef,
    revealOn,
    importance,
  });
  ctx.publish('aip.decisionRecorded', {
    decisionId: row.id,
    promotionId: unit.promotionId,
    brandId: unit.brandId,
    kind: spec.kind,
    revealOn,
    importance,
  });
  return row.id;
}
