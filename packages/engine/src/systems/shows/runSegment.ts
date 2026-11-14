/**
 * Running one segment on show night: decide how a match ends, rate the segment, write its result
 * and rating, store its trace, run the result appliers and announce it.
 *
 * Writes only the segment's `outcome`, `match.finishKey` and `rating`. Morale, momentum,
 * popularity and fatigue belong to the features that react (appliers and `segment.completed`
 * subscribers), never to show night itself.
 *
 * Design: docs/design/show-night.md#phase.
 */

import type { PhaseContext } from '../../core/pipeline/context';
import type { PersonId, SegmentId } from '../../core/ids';
import { detachedStream, type RngStream } from '../../core/rng/registry';
import type { StreamName } from '../../core/rng/streams';
import { refKey, traced, type TraceNode, type Traced } from '../../core/trace';
import { compareIds } from '../../model/table';
import type { MatchOutcome, SegmentRating } from '../../model/entities/segment';
import { ANGLE_STREAM } from '../match/angles/streams';
import { MATCH_RATING_STREAM } from '../match/streams';
import { ratingInputFromSegment } from '../match/rating/fromSegment';
import { rateSegment } from '../match/rating/rateSegment';
import type { SegmentRatingResult } from '../match/rating/types';
import { isSegmentRun, type ShowContext, type ShowSegment, type ShowSide } from './context';
import {
  listSegmentResultAppliers,
  matchOutcomeResolver,
  type MatchOutcomeResolution,
  type SegmentResult,
} from './registries';
import { matchResultTraceRef, segmentScoreTraceRef } from './traces';

/** Who won, lost and drew: competitors only, each list by id. */
export interface ResultPeople {
  readonly winnerIds: PersonId[];
  readonly loserIds: PersonId[];
  readonly drawIds: PersonId[];
}

const NOBODY: ResultPeople = { winnerIds: [], loserIds: [], drawIds: [] };

/**
 * The winners, losers and drawers of a result. A win: the competitors on the winning side win and
 * every other side's competitors lose. A draw: every competitor draws. A no contest or an angle
 * (`outcome` null): all three are empty.
 */
export function resultPeople(
  outcome: MatchOutcome | null,
  sides: readonly Pick<ShowSide, 'side' | 'competitorIds'>[],
): ResultPeople {
  if (outcome === null || outcome.kind === 'noContest') {
    return NOBODY;
  }
  const all = sides.flatMap((side) => side.competitorIds);
  if (outcome.kind === 'draw') {
    return { winnerIds: [], loserIds: [], drawIds: [...all].sort(compareIds) };
  }
  const winners = sides
    .filter((side) => side.side === outcome.winningSide)
    .flatMap((side) => side.competitorIds);
  const losers = sides
    .filter((side) => side.side !== outcome.winningSide)
    .flatMap((side) => side.competitorIds);
  return {
    winnerIds: [...winners].sort(compareIds),
    loserIds: [...losers].sort(compareIds),
    drawIds: [],
  };
}

/** Keeps a stored component within 0..100 (the scale every stored rating uses). */
function stat(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/**
 * The segment's score trace with the outcome decision placed after its leading notes (the slot
 * role and weight), so the Why? panel reads: slot, how the match ended, then the numbers. A
 * decision carries no arithmetic, so the trace still replays.
 */
export function withOutcomeLine(score: Traced<number>, outcome: TraceNode | null): Traced<number> {
  const node = score.trace;
  if (outcome === null || node.kind !== 'formula') {
    return score;
  }
  const [start, ...rest] = node.children;
  const notes: TraceNode[] = [];
  let index = 0;
  while (index < rest.length && rest[index]?.kind === 'note') {
    const note = rest[index];
    if (note !== undefined) {
      notes.push(note);
    }
    index += 1;
  }
  return traced(score.value, {
    ...node,
    children: [...(start === undefined ? [] : [start]), ...notes, outcome, ...rest.slice(index)],
  });
}

function resolveMatch(
  ctx: PhaseContext,
  show: ShowContext,
  entry: ShowSegment,
): MatchOutcomeResolution | null {
  const { segment } = entry;
  if (segment.kind !== 'match') {
    return null;
  }
  const resolution = matchOutcomeResolver().resolve(
    {
      segmentId: segment.id,
      eventInstanceId: show.instance.id,
      promotionId: show.promotionId,
      regionId: show.regionId,
      plan: segment.outcome,
      plannedFinishKey: segment.match.finishKey,
      sides: entry.sides
        .filter((side) => side.competitorIds.length > 0)
        .map((side) => ({ side: side.side, personIds: side.competitorIds })),
    },
    { read: ctx.read, tunables: ctx.tunables, rng: ctx.rng },
  );
  // Written before rating: the stored-segment adapter reads the outcome and finish from the row,
  // so finish effects see the real result.
  ctx.tx.update('segments', segment.id, (previous) =>
    previous.kind === 'match'
      ? {
          ...previous,
          outcome: resolution.outcome,
          match:
            resolution.finishKey === null
              ? previous.match
              : { ...previous.match, finishKey: resolution.finishKey },
        }
      : previous,
  );
  return resolution;
}

function storedRating(rated: SegmentRatingResult, traceId: string): SegmentRating {
  return {
    score: rated.score.value,
    stars: rated.stars.value,
    workRate: rated.workRate === null ? null : stat(rated.workRate.value),
    crowd: stat(rated.crowd.value),
    expectation: stat(rated.expectation.value),
    traceId,
  };
}

/** The key a segment's own streams are derived under (with the stream name and the game seed). */
export function segmentStreamKey(segmentId: SegmentId): string {
  return `showNight/${segmentId}`;
}

/**
 * The step context a segment runs in: the same context, except that every random stream it asks
 * for is the segment's own, derived from the game seed, the stream's name and the segment's id
 * (EVT10-01). A segment then rolls the same numbers whether it runs alone from the show screen,
 * with the rest of its show, or after anything else the player did in between, and it never moves
 * a world stream. Repeat asks for one name return the same stream, so draws continue.
 *
 * Design: docs/design/show-night.md#live-show-night and docs/design/determinism.md.
 */
export function withSegmentStreams(ctx: PhaseContext, segmentId: SegmentId): PhaseContext {
  const streams = new Map<StreamName, RngStream>();
  const seed = ctx.read.meta.seed;
  const key = segmentStreamKey(segmentId);
  return {
    ...ctx,
    rng: (name) => {
      const existing = streams.get(name);
      if (existing !== undefined) {
        return existing;
      }
      const created = detachedStream(seed, name, key);
      streams.set(name, created);
      return created;
    },
  };
}

/**
 * Runs one segment and returns its score, or null when it could not be rated (it then counts as
 * an empty slot). A segment that already has a rating is left as it is and its stored score
 * returned. Everything random in it (the finish, the rating, the appliers) rolls on the segment's
 * own streams ({@link withSegmentStreams}).
 */
export function runSegment(
  stepCtx: PhaseContext,
  show: ShowContext,
  entry: ShowSegment,
): number | null {
  const { segment } = entry;
  // Already run (BRW3's aired draft): keep its rating, and let it count toward the show score.
  if (isSegmentRun(segment)) {
    return segment.rating?.score ?? null;
  }
  const ctx = withSegmentStreams(stepCtx, segment.id);

  const resolution = resolveMatch(ctx, show, entry);
  const rated = rateSegment(ratingInputFromSegment(ctx.read, segment.id), {
    read: ctx.read,
    tunables: ctx.tunables,
    mode: 'live',
    seed: segment.id,
    // A talking segment rolls its beats and crowd on `match.angle` (MTCH5-03).
    rng: ctx.rng(segment.kind === 'angle' ? ANGLE_STREAM : MATCH_RATING_STREAM),
  });
  if (!rated.ok) {
    const reasons = rated.reasons.map((reason) => reason.message).join(' ');
    ctx.log(`Segment ${segment.id} on ${show.instance.id} could not be rated: ${reasons}`);
    return null;
  }

  const ref = segmentScoreTraceRef(segment.id, show.humanShow);
  ctx.tx.update('segments', segment.id, { rating: storedRating(rated.data, refKey(ref)) });
  ctx.recordTrace(ref, ctx.date, withOutcomeLine(rated.data.score, resolution?.trace ?? null));
  if (resolution !== null) {
    // The result line's winner Why? on the results page (EVT3-07).
    ctx.recordTrace(matchResultTraceRef(segment.id, show.humanShow), ctx.date, {
      value: resolution.outcome.kind,
      trace: resolution.trace,
    });
  }

  const outcome = resolution?.outcome ?? null;
  const people = resultPeople(outcome, entry.sides);
  const titleIds = segment.kind === 'match' ? [...segment.match.titleIds] : [];
  const result: SegmentResult = {
    segmentId: segment.id,
    eventInstanceId: show.instance.id,
    promotionId: show.promotionId,
    brandId: show.brandId,
    date: ctx.date,
    importance: show.importance,
    regionId: show.regionId,
    humanShow: show.humanShow,
    kind: segment.kind,
    slot: segment.slot,
    preShow: segment.preShow,
    roleKey: rated.data.slot.role,
    durationClass: rated.data.slot.durationClass,
    sides: entry.sides.map((side) => ({
      side: side.side,
      personIds: side.personIds,
      teamIds: side.teamIds,
    })),
    outcome,
    ...people,
    storylineIds: [...segment.storylineIds],
    titleIds,
    finishKey: resolution?.finishKey ?? null,
    methodKey: resolution?.methodKey ?? null,
    titleCanChange: resolution?.titleCanChange ?? null,
    score: rated.data.score.value,
    stars: rated.data.stars.value,
  };
  for (const applier of listSegmentResultAppliers()) {
    applier.apply(ctx, result);
  }

  ctx.publish('segment.completed', {
    segmentId: segment.id,
    eventInstanceId: show.instance.id,
    promotionId: show.promotionId,
    brandId: show.brandId,
    kind: segment.kind,
    slot: segment.slot,
    preShow: segment.preShow,
    winnerIds: [...people.winnerIds],
    loserIds: [...people.loserIds],
    drawIds: [...people.drawIds],
    storylineIds: [...segment.storylineIds],
    titleIds,
    finishKey: result.finishKey,
    methodKey: result.methodKey,
    score: result.score,
  });
  return result.score;
}
