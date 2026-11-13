/**
 * The read side of a rival's results (AIP5-04): what the booker planned for one segment and why,
 * and what happened once the show ran. Shared by `aip.segmentDecision` and (once AIP4-06's
 * `aip.showCards` is merged) the rival show cards, so both say the same thing.
 *
 * Nothing here checks who is looking: callers apply the reveal rule (`isRevealedTo`) first.
 * Reasons come from the stored decision rows (title decisions keep their reason in the row) and
 * from the winner trace while it is still kept in full; a trace ref is returned only while the store
 * still has it. See docs/design/rival-booking.md#how-a-rival-shows-results-are-decided.
 */

import type { GameDate } from '../../../core/date';
import type { PersonId, PromotionId, SegmentId, TitleId } from '../../../core/ids';
import type { TraceReader } from '../../../core/api/query';
import { isFullTrace, type TraceRef } from '../../../core/trace/store';
import type { AiDecision } from '../../../model/entities/ai-decision';
import { aiDecisionDateKey } from '../../../model/entities/ai-decision';
import type { EventInstance } from '../../../model/entities/event-instance';
import { methodOf } from '../../../model/catalogs';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { employmentAt } from '../inputs';
import { TITLE_DECISION_KIND, WINNER_DECISION_KIND } from './decisionKinds';
import { followsText } from './texts';
import { titleTraceRef, winnerTraceRef } from './traces';

/** Shown when the winner's full Why? is no longer kept. */
export const REASON_NOT_KEPT = "The booker's full reasons are no longer kept";

export type SegmentTitlePlan = 'retain' | 'change' | 'crown' | 'follow';
export type SegmentTitleActual = 'pending' | 'retained' | 'newChampion';

export interface SegmentDecisionWinner {
  /** `noContest` only when no way of winning fitted the match (a content problem). */
  kind: 'win' | 'draw' | 'noContest';
  /** The winners' ring names joined with " & ", or null for a draw. */
  sideLabel: string | null;
  personIds: PersonId[];
  methodName: string | null;
  /** MTCH2's finish once one is planned or the show has run, else null. */
  finishName: string | null;
}

export interface SegmentDecisionTitle {
  titleId: TitleId;
  titleName: string;
  plan: SegmentTitlePlan;
  reasonText: string;
  /** The change chance in percent, when the title rules rolled one. */
  chance: number | null;
  /** How long the reign had lasted on the show date, when there was one. */
  reignDays: number | null;
  traceRef: TraceRef | null;
  actual: SegmentTitleActual;
}

export interface SegmentDecisionView {
  segmentId: SegmentId;
  eventInstanceId: EventInstance['id'];
  winner: SegmentDecisionWinner;
  reasonText: string;
  winnerTraceRef: TraceRef | null;
  titles: SegmentDecisionTitle[];
}

/** AIP5's decisions of `kind` for the show, stored on the day the card was booked. */
export function showDecisionsOf(
  read: GameWorldView,
  promotionId: PromotionId,
  date: GameDate,
  eventInstanceId: EventInstance['id'],
  kind: string,
): DeepReadonly<AiDecision>[] {
  return read.tables.aiDecisions
    .lookup('byPromotionDate', aiDecisionDateKey(promotionId, date))
    .filter((row) => row.kind === kind && row.refs.eventInstanceId === eventInstanceId);
}

/** The `title` decision AIP5 recorded for one title on one segment, if it is still kept. */
export function titleDecisionOf(
  read: GameWorldView,
  instance: DeepReadonly<EventInstance>,
  segmentId: SegmentId,
  titleId: TitleId,
): DeepReadonly<AiDecision> | null {
  return (
    showDecisionsOf(
      read,
      instance.promotionId,
      instance.date,
      instance.id,
      TITLE_DECISION_KIND,
    ).find(
      (row) => row.summary.params['segment'] === segmentId && row.refs.titleIds.includes(titleId),
    ) ?? null
  );
}

function keptRef(traces: TraceReader, ref: TraceRef): TraceRef | null {
  return traces.has(ref) ? ref : null;
}

/** The root reason of a full decision trace, else null. */
function traceReason(traces: TraceReader, ref: TraceRef): string | null {
  const entry = traces.get(ref);
  if (entry === undefined || !isFullTrace(entry) || entry.trace.kind !== 'decision') {
    return null;
  }
  return entry.trace.reason;
}

function numberParam(row: DeepReadonly<AiDecision>, name: string): number | null {
  const value = row.summary.params[name];
  return typeof value === 'number' ? value : null;
}

function planOf(row: DeepReadonly<AiDecision>): SegmentTitlePlan {
  const plan = row.summary.params['plan'];
  // A vacant title nobody here could win stays where it was: shown as kept.
  return plan === 'change' || plan === 'crown' ? plan : 'retain';
}

/**
 * What the computer booker planned for a segment, and what happened, or null when no computer
 * booker decided it (an angle, a human-booked match, or one whose records are gone).
 */
export function segmentDecisionView(
  read: GameWorldView,
  traces: TraceReader,
  segmentId: SegmentId,
): SegmentDecisionView | null {
  const segment = read.tables.segments.get(segmentId);
  if (segment?.kind !== 'match') {
    return null;
  }
  const instance = read.tables.eventInstances.get(segment.eventInstanceId);
  if (instance === undefined) {
    return null;
  }
  const ref = winnerTraceRef(segmentId);
  const decided =
    traces.has(ref) ||
    showDecisionsOf(read, instance.promotionId, instance.date, instance.id, WINNER_DECISION_KIND)
      .length > 0;
  if (!decided) {
    return null;
  }

  const participants = read.tables.participants
    .lookup('bySegment', segmentId)
    .filter((participant) => participant.role === 'competitor');
  const outcome = segment.outcome;
  const winningSide = outcome?.kind === 'win' ? outcome.winningSide : null;
  const personIds = participants
    .filter((participant) => participant.side === winningSide)
    .map((participant) => participant.personId)
    .sort(compareIds);
  const names = personIds.map(
    (personId) =>
      employmentAt(read, personId, instance.promotionId, instance.date)?.ringName ??
      read.tables.people.get(personId)?.defaultRingName ??
      personId,
  );
  const finishKey = segment.match.finishKey;
  const winner: SegmentDecisionWinner = {
    kind: outcome === null || outcome.kind === 'noContest' ? 'noContest' : outcome.kind,
    sideLabel: winningSide === null ? null : names.join(' & '),
    personIds,
    methodName: outcome?.kind === 'win' ? (methodOf(read, outcome.methodKey)?.name ?? null) : null,
    finishName:
      finishKey === null ? null : (read.meta.catalogs.finishes?.[finishKey]?.name ?? null),
  };

  const titles = segment.match.titleIds
    .map((titleId) => read.tables.titles.get(titleId))
    .filter((title) => title !== undefined)
    .sort((left, right) => right.prestige - left.prestige || compareIds(left.id, right.id));
  const lead = titles[0];
  const completed = instance.status === 'completed';
  const titleViews = titles.map((title): SegmentDecisionTitle => {
    const titleRef = titleTraceRef(segmentId, title.id);
    const won = read.tables.titleReigns
      .lookup('byTitle', title.id)
      .some((reign) => reign.wonInSegmentId === segmentId);
    const actual: SegmentTitleActual = won ? 'newChampion' : completed ? 'retained' : 'pending';
    const row = titleDecisionOf(read, instance, segmentId, title.id);
    if (row === null) {
      return {
        titleId: title.id,
        titleName: title.name,
        plan: 'follow',
        reasonText: traceReason(traces, titleRef) ?? followsText(lead?.name ?? title.name),
        chance: null,
        reignDays: null,
        traceRef: keptRef(traces, titleRef),
        actual,
      };
    }
    return {
      titleId: title.id,
      titleName: title.name,
      plan: planOf(row),
      reasonText: String(row.summary.params['reason'] ?? ''),
      chance: numberParam(row, 'chance'),
      reignDays: numberParam(row, 'reignDays'),
      traceRef: row.traceRef !== null ? keptRef(traces, row.traceRef) : null,
      actual,
    };
  });

  return {
    segmentId,
    eventInstanceId: instance.id,
    winner,
    reasonText: traceReason(traces, ref) ?? REASON_NOT_KEPT,
    winnerTraceRef: keptRef(traces, ref),
    titles: titleViews,
  };
}
