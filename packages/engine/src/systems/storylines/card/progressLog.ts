/**
 * A storyline's progress log (CRTV4-02): the linked segments that moved its heat.
 *
 * The log keeps full rows only for the detail window (`history.keepDetailDays`, owner rule
 * POL4-08). Every counted segment also adds to the storyline's all-time `progressTotals` when it is
 * written, so once the weekly history roll-up trims rows past the window (and then deletes their
 * segments), the payoff and the screens still have the story's whole run. A finale segment is kept
 * by the roll-up whatever its age (`segmentsToKeep`).
 *
 * Design: docs/design/storylines.md#heat-after-segment.
 */

import { compareDates, type GameDate } from '../../../core/date';
import type { EventInstanceId } from '../../../core/ids';
import type { PhaseContext } from '../../../core/pipeline/context';
import type { SegmentKind } from '../../../model/entities/segment';
import {
  MAX_STORYLINE_PROGRESS,
  type Storyline,
  type StorylineProgress,
  type StorylineProgressTotals,
} from '../../../model/entities/storyline';
import type { DeepReadonly } from '../../../model/world';
import { traceRefFromKey } from '../../shows/traces';

/** The totals after one more counted segment of `kind` moved heat by `heatAfter − heatBefore`. */
export function addToProgressTotals(
  totals: DeepReadonly<StorylineProgressTotals>,
  kind: SegmentKind,
  heatBefore: number,
  heatAfter: number,
): StorylineProgressTotals {
  const change = heatAfter - heatBefore;
  return {
    segments: totals.segments + 1,
    matches: totals.matches + (kind === 'match' ? 1 : 0),
    angles: totals.angles + (kind === 'angle' ? 1 : 0),
    heatGained: totals.heatGained + Math.max(0, change),
    heatLost: totals.heatLost + Math.max(0, -change),
  };
}

/** The log with `entry` appended, dropping the oldest rows past `MAX_STORYLINE_PROGRESS`. */
export function appendProgress(
  progress: readonly DeepReadonly<StorylineProgress>[],
  entry: StorylineProgress,
): StorylineProgress[] {
  const next = [...progress.map((row) => ({ ...row })), entry];
  return next.length > MAX_STORYLINE_PROGRESS ? next.slice(-MAX_STORYLINE_PROGRESS) : next;
}

/** The storyline's rows for one show, oldest first. */
export function progressOnShow(
  storyline: DeepReadonly<Storyline>,
  eventInstanceId: EventInstanceId,
): DeepReadonly<StorylineProgress>[] {
  return storyline.progress.filter((row) => row.eventInstanceId === eventInstanceId);
}

/**
 * History roll-up step: drops every storyline's progress rows dated before `from` (the first day
 * of the detail window) and demotes their heat-step traces to summaries. Totals are untouched:
 * they already count the dropped rows. Runs before the roll-up deletes old segments, so the
 * segments these rows named can go with the rest of their card. Returns how many rows went.
 */
export function trimStorylineProgress(ctx: PhaseContext, from: GameDate): number {
  let trimmed = 0;
  for (const storyline of ctx.read.tables.storylines.values()) {
    const first = storyline.progress[0];
    if (first === undefined || compareDates(first.date, from) >= 0) {
      continue;
    }
    const kept = storyline.progress.filter((row) => compareDates(row.date, from) >= 0);
    for (const row of storyline.progress) {
      if (compareDates(row.date, from) >= 0) {
        continue;
      }
      const ref = row.traceId === null ? null : traceRefFromKey(row.traceId);
      if (ref !== null) {
        ctx.demoteTrace(ref);
      }
    }
    trimmed += storyline.progress.length - kept.length;
    ctx.tx.update('storylines', storyline.id, {
      progress: kept.map((row) => ({ ...row })),
    });
  }
  return trimmed;
}
