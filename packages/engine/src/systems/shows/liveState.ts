/**
 * `shows.liveState { eventInstanceId }` (EVT10-01): where the player's show stands on the show
 * screen. The segments run so far with their results (the lines `shows.results` gives), the next
 * segment's billing, how many are left and the show score so far, with its Why?.
 *
 * Only the show's runner (and tools) may read it: the card is the booker's secret until it airs.
 *
 * Design: docs/design/show-night.md#live-show-night.
 */

import { z } from 'zod';
import { defineQuery, type QueryDefinition } from '../../core/api/query';
import { refuseQuery } from '../../core/api/result';
import type { GameDate } from '../../core/date';
import type { EventInstanceId } from '../../core/ids';
import type { TraceNode } from '../../core/trace';
import { zId } from '../../model/primitives';
import { getSetting } from '../newgame/settings';
import { showContextOf } from './context';
import { showScore } from './formulas/showScore';
import { showStars } from './formulas/showStars';
import { isShowLive, ranSegmentIdsOf, segmentsLeft } from './live';
import { SHOW_NOT_FOUND_MESSAGE } from './queries';
import { showResultsView, type SegmentResultView } from './resultsView';
import { canReadCard } from '../booking/control';
import { scoreInputs, storedScores } from './runShow';
import type { ShowNightMode } from './settings';
import type { EngineTunables } from '../tunables';
import type { ShowContext } from './context';

/** Where the show stands: not started, part-way through, or finished. */
export type LiveShowStage = 'notStarted' | 'live' | 'finished';

/** The show score over the segments run so far. */
export interface LiveScoreView {
  score: number;
  /** 0 to 5 in quarter steps. */
  stars: number;
  /** Why the score so far reads what it does. */
  trace: TraceNode;
}

/** `shows.liveState`: the show screen's view of a show being run. */
export interface LiveShowStateView {
  eventInstanceId: EventInstanceId;
  name: string;
  date: GameDate;
  stage: LiveShowStage;
  /** The Show night setting: how Run the show behaves. */
  mode: ShowNightMode;
  /** The segments run so far, in running order, each with its result and rating. */
  segmentsRun: SegmentResultView[];
  /** The next segment to run (its billing; no result yet), or null when none is left. */
  next: SegmentResultView | null;
  /** How many segments are still to run, the next one included. */
  segmentsLeft: number;
  /**
   * The show score over the segments run so far, weighted by slot as the show score is. Card flow
   * and the production ceiling apply only once the show is over. Null before the first segment and
   * once the show is finished (its results page has the final score).
   */
  scoreSoFar: LiveScoreView | null;
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'shows.liveState': {
      args: { eventInstanceId: EventInstanceId };
      result: LiveShowStateView;
    };
  }
}

/** What the player reads above the score so far. */
export const SCORE_SO_FAR_LABEL = 'Show score so far';

/**
 * The show score over the segments run so far: their slots only (a run segment that could not be
 * rated counts as an empty slot, as it will in the final score), and no modifiers.
 */
export function scoreSoFar(context: ShowContext, tunables: EngineTunables): LiveScoreView | null {
  const ran = ranSegmentIdsOf(context.instance);
  if (ran.size === 0) {
    return null;
  }
  const ranSlots = new Set(
    context.segments
      .filter((entry) => ran.has(entry.segment.id))
      .map((entry) => `${String(entry.segment.preShow)}/${String(entry.segment.slot)}`),
  );
  const inputs = scoreInputs({ tunables }, context, storedScores(context));
  const slots = inputs.slots.filter((slot) =>
    ranSlots.has(`${String(slot.preShow)}/${String(slot.slot)}`),
  );
  const { score } = showScore({ ...inputs, slots }, { tunables, modifiers: [] });
  return {
    score: score.value,
    stars: showStars({ score: score.value }, { tunables }).value,
    trace: { ...score.trace, label: SCORE_SO_FAR_LABEL },
  };
}

export const liveStateQuery: QueryDefinition<'shows.liveState'> = defineQuery('shows.liveState', {
  args: z.strictObject({ eventInstanceId: zId('eventInstance') }),
  run: (ctx, args) => {
    const instance = ctx.read.tables.eventInstances.get(args.eventInstanceId);
    if (instance === undefined || !canReadCard(ctx.read, ctx.viewer, instance)) {
      return refuseQuery({ code: 'notFound', message: SHOW_NOT_FOUND_MESSAGE });
    }
    const finished = instance.status === 'completed';
    const stage: LiveShowStage = finished
      ? 'finished'
      : isShowLive(instance)
        ? 'live'
        : 'notStarted';
    const views = showResultsView(ctx.read, instance, {
      viewer: ctx.viewer,
      tunables: ctx.tunables,
      traces: ctx.traces,
    }).segments;
    const viewOf = new Map(views.map((view) => [view.segmentId, view]));
    const ran = ranSegmentIdsOf(instance);
    const context = showContextOf(ctx.read, instance);
    const left = finished || instance.status === 'cancelled' ? [] : segmentsLeft(context);
    const nextId = left[0]?.segment.id;
    return {
      eventInstanceId: instance.id,
      name: instance.name,
      date: instance.date,
      stage,
      mode: getSetting(ctx.read, 'showNight'),
      segmentsRun: finished ? views : views.filter((view) => ran.has(view.segmentId)),
      next: nextId === undefined ? null : (viewOf.get(nextId) ?? null),
      segmentsLeft: left.length,
      scoreSoFar: finished ? null : scoreSoFar(context, ctx.tunables),
    };
  },
});
