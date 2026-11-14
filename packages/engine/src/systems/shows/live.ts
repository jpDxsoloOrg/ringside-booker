/**
 * Live show night (EVT10-01): running the player's show one segment at a time.
 *
 * A show starts live with its first segment: the before-a-show-runs hooks run (as they do before
 * a show runs all at once) and the show gets a `liveRun` with the segments run so far. Each
 * segment then runs through the same `runSegment` as every other show (outcome, rating, traces,
 * appliers, `segment.completed`), on its own random streams, so the show gives the same results
 * whichever way it is run. The last segment completes the show (`completeShowCard`), which drops
 * the `liveRun`.
 *
 * Progress is the `liveRun` list, not the ratings: a segment that could not be rated is still
 * listed, so the show always moves on and the day can never be stuck on it.
 *
 * Design: docs/design/show-night.md#live-show-night.
 */

import type { EventInstanceId, SegmentId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import type { EventInstance } from '../../model/entities/event-instance';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { runBeforeShowRunsHooks } from './beforeRun';
import { isSegmentRun, showContextOf, type ShowContext, type ShowSegment } from './context';
import { completeShowCard, runShowNow } from './runShow';
import { runSegment } from './runSegment';

type Show = DeepReadonly<EventInstance>;

/** True while the show is part-way through: started live and not finished. */
export function isShowLive(show: Pick<Show, 'liveRun'>): boolean {
  return show.liveRun !== undefined;
}

/** The segments of a live show run so far, by id (empty for a show not started). */
export function ranSegmentIdsOf(show: Pick<Show, 'liveRun'>): ReadonlySet<SegmentId> {
  return new Set(show.liveRun?.ranSegmentIds ?? []);
}

/**
 * The card's segments still to run, in running order (pre-show first): not run live yet, and not
 * already rated before the show (BRW3's aired draft keeps its rating).
 */
export function segmentsLeft(context: ShowContext): ShowSegment[] {
  const ran = ranSegmentIdsOf(context.instance);
  return context.segments.filter(
    (entry) => !ran.has(entry.segment.id) && !isSegmentRun(entry.segment),
  );
}

/** The segments still to run on a show, read from the world. */
export function segmentsLeftOn(read: GameWorldView, show: Show): ShowSegment[] {
  return segmentsLeft(showContextOf(read, show));
}

/**
 * Starts the show live: the before-a-show-runs hooks (run before the day's phases, as Run the show
 * does), then an empty `liveRun`. Returns the show as it now stands.
 */
function startLiveShow(ctx: PhaseContext, show: Show): Show {
  runBeforeShowRunsHooks(ctx, { show, human: true, beforeTheDay: true });
  ctx.tx.update('eventInstances', show.id, { liveRun: { ranSegmentIds: [] } });
  return ctx.read.tables.eventInstances.require(show.id);
}

/** What one step of a live show did. */
export interface LiveStep {
  /** The segment that ran, or null when none was left. */
  readonly segmentId: SegmentId | null;
  /** True when the show is now completed. */
  readonly finished: boolean;
}

/**
 * Runs the next segment of the player's show (starting the show live first if it has not
 * started), and completes the show when that was the last one. With nothing left to run it only
 * completes the show.
 */
export function runNextLiveSegment(ctx: PhaseContext, eventInstanceId: EventInstanceId): LiveStep {
  let show: Show = ctx.read.tables.eventInstances.require(eventInstanceId);
  if (!isShowLive(show)) {
    show = startLiveShow(ctx, show);
  }
  const context = showContextOf(ctx.read, show);
  const [next, ...after] = segmentsLeft(context);
  if (next !== undefined) {
    runSegment(ctx, context, next);
    ctx.tx.update('eventInstances', eventInstanceId, {
      liveRun: { ranSegmentIds: [...ranSegmentIdsOf(show), next.segment.id] },
    });
  }
  const finished = after.length === 0;
  if (finished) {
    completeShowCard(ctx, eventInstanceId);
  }
  return { segmentId: next?.segment.id ?? null, finished };
}

/**
 * Runs everything left of the player's show and completes it. A show not started yet runs all at
 * once, exactly as Run the show does (`runShowNow`); a show under way runs its remaining segments
 * one after another. Returns the segments it ran, in running order.
 */
export function runRestOfShowNow(ctx: PhaseContext, eventInstanceId: EventInstanceId): SegmentId[] {
  const show = ctx.read.tables.eventInstances.require(eventInstanceId);
  if (!isShowLive(show)) {
    const ids = segmentsLeftOn(ctx.read, show).map((entry) => entry.segment.id);
    runShowNow(ctx, show, true, { beforeTheDay: true });
    return ids;
  }
  const ran: SegmentId[] = [];
  for (;;) {
    const step = runNextLiveSegment(ctx, eventInstanceId);
    if (step.segmentId !== null) {
      ran.push(step.segmentId);
    }
    if (step.finished) {
      return ran;
    }
  }
}
