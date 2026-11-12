/**
 * Running one show on show night: its card segment by segment, then its score, then its result.
 * A computer-controlled show with no card is scored off-screen instead.
 *
 * Design: docs/design/show-night.md#phase.
 */

import type { PhaseContext } from '../../core/pipeline/context';
import type { SegmentId } from '../../core/ids';
import { refKey } from '../../core/trace';
import type { JsonValue } from '../../core/json';
import type { EventInstance } from '../../model/entities/event-instance';
import type { DeepReadonly } from '../../model/world';
import { SLOT_ROLE_LABELS, slotRoleOf, slotWeightOf } from '../match/slots';
import { countAppearances } from './appearances';
import { showContextOf, slotRoleInput, type ShowContext, type ShowSegment } from './context';
import { offscreenShowScore } from './formulas/offscreenShowScore';
import { showScore, type ShowScoreInputs, type ShowSlotInput } from './formulas/showScore';
import { runSegment } from './runSegment';
import { listShowScoreModifiers } from './showScoreModifiers';
import { SHOWS_OFFSCREEN_STREAM } from './streams';
import { showScoreTraceRef } from './traces';

/** One slot's entry for the show score: filled with its score, or empty. */
function slotInput(
  ctx: PhaseContext,
  show: ShowContext,
  position: { slot: number; preShow: boolean },
  entry: ShowSegment | undefined,
  score: number | null,
): ShowSlotInput {
  const deps = { tunables: ctx.tunables };
  const role = slotRoleOf(slotRoleInput(position, show.format), deps);
  const filled = entry !== undefined && score !== null;
  const segment = filled ? entry.segment : null;
  return {
    slot: position.slot,
    preShow: position.preShow,
    roleLabel: SLOT_ROLE_LABELS[role.value],
    weight: slotWeightOf({ role: role.value }, deps),
    filled,
    segmentId: segment?.id ?? null,
    kind: segment?.kind ?? null,
    matchTypeKey: segment?.kind === 'match' ? segment.match.matchTypeKey : null,
    score: filled ? score : null,
    participantIds: filled ? [...new Set(entry.sides.flatMap((side) => side.personIds))] : [],
    storylineIds: segment === null ? [] : [...segment.storylineIds],
  };
}

/**
 * The show score's inputs: one entry per main-card slot (filled or not) and one per pre-show slot
 * whose segment has a score. A segment that could not be rated counts as an empty slot.
 */
function scoreInputs(
  ctx: PhaseContext,
  show: ShowContext,
  scores: ReadonlyMap<SegmentId, number | null>,
): ShowScoreInputs {
  const slots: ShowSlotInput[] = [];
  for (const entry of show.segments) {
    const score = scores.get(entry.segment.id) ?? null;
    if (entry.segment.preShow && score !== null) {
      slots.push(slotInput(ctx, show, entry.segment, entry, score));
    }
  }
  for (let slot = 0; slot < show.format.slots; slot += 1) {
    const entry = show.segments.find(
      (candidate) => !candidate.segment.preShow && candidate.segment.slot === slot,
    );
    const score = entry === undefined ? null : (scores.get(entry.segment.id) ?? null);
    slots.push(slotInput(ctx, show, { slot, preShow: false }, entry, score));
  }
  return {
    showName: show.instance.name,
    importance: show.importance,
    format: { slots: show.format.slots, preShowSlots: show.format.preShowSlots },
    slots,
    extras: {},
  };
}

/** Runs every segment of the show's card in running order, scores the show and completes it. */
export function runShowCard(ctx: PhaseContext, instance: DeepReadonly<EventInstance>): void {
  const show = showContextOf(ctx.read, instance);
  const scores = new Map<SegmentId, number | null>();
  for (const entry of show.segments) {
    scores.set(entry.segment.id, runSegment(ctx, show, entry));
  }
  countAppearances(ctx, show);

  const inputs = scoreInputs(ctx, show, scores);
  const modifiers = listShowScoreModifiers();
  const extras: Record<string, JsonValue> = {};
  const current = ctx.read.tables.eventInstances.require(instance.id);
  for (const modifier of modifiers) {
    if (modifier.gather !== undefined) {
      extras[modifier.id] = modifier.gather(ctx.read, current);
    }
  }
  const { score, rawScore } = showScore(
    { ...inputs, extras },
    { tunables: ctx.tunables, modifiers },
  );

  const ref = showScoreTraceRef(instance.id);
  ctx.recordTrace(ref, ctx.date, score);
  ctx.tx.update('eventInstances', instance.id, {
    status: 'completed',
    result: {
      score: score.value,
      rawScore,
      traceId: refKey(ref),
      attendance: null,
      gate: null,
      viewers: null,
    },
  });
  ctx.publish('show.completed', {
    eventInstanceId: instance.id,
    promotionId: instance.promotionId,
    brandId: instance.brandId,
    date: instance.date,
    importance: instance.importance,
    score: score.value,
    rawScore,
    offscreen: false,
    segmentCount: show.segments.length,
  });
}

/**
 * Scores a computer-controlled show that has no card, from its promotion's prestige and
 * popularity in the show's region, its size and one roll on `shows.offscreen`, and completes it.
 * No segment is run, no applier runs and no `segment.completed` is published.
 */
export function runOffscreenShow(ctx: PhaseContext, instance: DeepReadonly<EventInstance>): void {
  const promotion = ctx.read.tables.promotions.require(instance.promotionId);
  const score = offscreenShowScore(
    {
      showName: instance.name,
      importance: instance.importance,
      prestige: promotion.prestige,
      popularityInRegion: promotion.regionalPop[instance.regionId] ?? 0,
      regionName: ctx.read.tables.regions.get(instance.regionId)?.name ?? instance.regionId,
    },
    { tunables: ctx.tunables, rng: ctx.rng(SHOWS_OFFSCREEN_STREAM) },
  );
  const ref = showScoreTraceRef(instance.id);
  ctx.recordTrace(ref, ctx.date, score);
  ctx.tx.update('eventInstances', instance.id, {
    status: 'completed',
    result: {
      score: score.value,
      rawScore: score.value,
      traceId: refKey(ref),
      attendance: null,
      gate: null,
      viewers: null,
    },
  });
  ctx.publish('show.completed', {
    eventInstanceId: instance.id,
    promotionId: instance.promotionId,
    brandId: instance.brandId,
    date: instance.date,
    importance: instance.importance,
    score: score.value,
    rawScore: score.value,
    offscreen: true,
    segmentCount: 0,
  });
}
