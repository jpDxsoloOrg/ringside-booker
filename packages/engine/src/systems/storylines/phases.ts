/**
 * The storylines system's day phases (CRTV3-02):
 *
 * - `storylines.heatCooling` (growth 35, daily): every active storyline past its grace period
 *   loses a little heat, down to the floor. `growth` runs after `shows` and `settlement`, so a
 *   storyline a segment moves on today (CRTV4) never cools on the same day.
 * - `storylines.pruneDetail` (periodic 46, Mondays): the Why?s of storylines that ended before the
 *   detail window (`history.keepDetailDays`) become summaries.
 *
 * Design: docs/design/storylines.md#heat-decay.
 */

import { diffDays } from '../../core/date';
import type { PhaseContext } from '../../core/pipeline/context';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import type { PromotionId } from '../../core/ids';
import type { Storyline } from '../../model/entities/storyline';
import type { DeepReadonly } from '../../model/world';
import { isPastDetailWindow } from '../history/note';
import { heatDecay } from './formulas/heatDecay';
import { keepsFullStorylineTraces } from './lifecycle';
import {
  storylineHeatTraceRef,
  storylinePayoffTraceRef,
  storylineStarterTraceRef,
} from './traceKinds';

export const HEAT_COOLING_PHASE_ID = 'storylines.heatCooling';
/** After WRK5's `momentum.decay` (30) in the `growth` group. */
export const HEAT_COOLING_PHASE_ORDER = 35;

export const PRUNE_STORYLINE_DETAIL_PHASE_ID = 'storylines.pruneDetail';
/** Mondays in `periodic`, after the other detail prunes (40–45). */
export const PRUNE_STORYLINE_DETAIL_PHASE_ORDER = 46;

/** "Started 2027-01-04" or "Last linked segment 2027-02-10". */
function progressLabel(storyline: DeepReadonly<Storyline>): string {
  return storyline.lastProgressOn === null
    ? `Started ${storyline.startedOn}`
    : `Last linked segment ${storyline.lastProgressOn}`;
}

/**
 * Cools every active storyline, in id order. A storyline whose heat does not change gets no new
 * trace, so its Why? stays the latest change (starting heat or the last cooling step). Draws no
 * random numbers. Returns how many storylines cooled.
 */
export function coolStorylines(ctx: PhaseContext): number {
  const graceDays = ctx.tunables.get('storylines.heat.decayGraceDays');
  const floor = ctx.tunables.get('storylines.heat.decayFloor');
  const perDay = ctx.tunables.get('storylines.heat.decayPerDay');
  if (perDay === 0) {
    return 0;
  }
  const fullTraces = new Map<PromotionId, boolean>();
  let cooled = 0;
  for (const storyline of ctx.read.tables.storylines.values()) {
    if (storyline.status !== 'active') {
      continue;
    }
    const days = diffDays(storyline.lastProgressOn ?? storyline.startedOn, ctx.date);
    // The formula's two "unchanged" branches, checked before building a trace: most storylines
    // on most days are inside the grace period or resting on the floor.
    if (days <= graceDays || storyline.heat <= floor) {
      continue;
    }
    const traced = heatDecay(
      {
        heatBefore: storyline.heat,
        daysSinceProgress: days,
        progressLabel: progressLabel(storyline),
      },
      { tunables: ctx.tunables },
    );
    if (traced.value === storyline.heat) {
      continue;
    }
    let full = fullTraces.get(storyline.promotionId);
    if (full === undefined) {
      full = keepsFullStorylineTraces(ctx.read, storyline.promotionId);
      fullTraces.set(storyline.promotionId, full);
    }
    ctx.tx.update('storylines', storyline.id, { heat: traced.value });
    ctx.recordTrace(storylineHeatTraceRef(storyline.id), ctx.date, traced, {
      summaryOnly: !full,
    });
    cooled += 1;
  }
  return cooled;
}

/**
 * Demotes the heat, starter and payoff (CRTV4-03) Why?s of storylines that ended before the detail window to
 * summaries. Active storylines keep theirs: it explains today's heat. Returns how many
 * storylines it looked at.
 */
export function pruneStorylineDetail(ctx: PhaseContext): number {
  const keepDetailDays = ctx.tunables.get('history.keepDetailDays');
  let count = 0;
  for (const storyline of ctx.read.tables.storylines.values()) {
    if (
      storyline.endedOn === null ||
      !isPastDetailWindow(storyline.endedOn, ctx.date, keepDetailDays)
    ) {
      continue;
    }
    ctx.demoteTrace(storylineHeatTraceRef(storyline.id));
    ctx.demoteTrace(storylineStarterTraceRef(storyline.id));
    ctx.demoteTrace(storylinePayoffTraceRef(storyline.id));
    count += 1;
  }
  return count;
}

export const heatCoolingPhase: PhaseDefinition = definePhase({
  id: HEAT_COOLING_PHASE_ID,
  group: 'growth',
  order: HEAT_COOLING_PHASE_ORDER,
  cadence: { kind: 'daily' },
  run: (ctx) => {
    coolStorylines(ctx);
  },
});

export const pruneStorylineDetailPhase: PhaseDefinition = definePhase({
  id: PRUNE_STORYLINE_DETAIL_PHASE_ID,
  group: 'periodic',
  order: PRUNE_STORYLINE_DETAIL_PHASE_ORDER,
  cadence: { kind: 'weekly', weekday: 'mon' },
  run: (ctx) => {
    pruneStorylineDetail(ctx);
  },
});

export const storylinesPhases: readonly PhaseDefinition[] = [
  heatCoolingPhase,
  pruneStorylineDetailPhase,
];
