/**
 * Running one show on show night: its card segment by segment, then its score, then its result.
 * A computer-controlled show with no card is scored off-screen instead.
 *
 * Design: docs/design/show-night.md#phase.
 */

import type { PhaseContext } from '../../core/pipeline/context';
import type { EventInstanceId, SegmentId } from '../../core/ids';
import { refKey, startCalc, type Traced } from '../../core/trace';
import type { JsonValue } from '../../core/json';
import type { EventInstance } from '../../model/entities/event-instance';
import type { DeepReadonly } from '../../model/world';
import { SLOT_ROLE_LABELS, slotRoleOf, slotWeightOf } from '../match/slots';
import { countAppearances } from './appearances';
import { runBeforeShowRunsHooks } from './beforeRun';
import { hasCard } from '../booking/card';
import { showContextOf, slotRoleInput, type ShowContext, type ShowSegment } from './context';
import { OFFSCREEN_SHOW_SCORE_DOC_REF, offscreenShowScore } from './formulas/offscreenShowScore';
import { showScore, type ShowScoreInputs, type ShowSlotInput } from './formulas/showScore';
import { runSegment } from './runSegment';
import {
  applyCapModifiers,
  listShowScoreModifiers,
  scoreBeforeCapLabel,
  showScoreCeilingOf,
} from './showScoreModifiers';
import { SHOWS_OFFSCREEN_STREAM } from './streams';
import { showScoreTraceRef } from './traces';

/** What the score inputs read besides the show. */
interface ScoreInputDeps {
  readonly tunables: PhaseContext['tunables'];
}

/** One slot's entry for the show score: filled with its score, or empty. */
function slotInput(
  deps: ScoreInputDeps,
  show: ShowContext,
  position: { slot: number; preShow: boolean },
  entry: ShowSegment | undefined,
  score: number | null,
): ShowSlotInput {
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

/** Each segment's stored score: its rating's, or null when it has none (not run, or not rated). */
export function storedScores(show: ShowContext): Map<SegmentId, number | null> {
  return new Map(
    show.segments.map((entry) => [entry.segment.id, entry.segment.rating?.score ?? null]),
  );
}

/**
 * The show score's inputs: one entry per main-card slot (filled or not) and one per pre-show slot
 * whose segment has a score. A segment that could not be rated counts as an empty slot.
 */
export function scoreInputs(
  deps: ScoreInputDeps,
  show: ShowContext,
  scores: ReadonlyMap<SegmentId, number | null>,
): ShowScoreInputs {
  const slots: ShowSlotInput[] = [];
  for (const entry of show.segments) {
    const score = scores.get(entry.segment.id) ?? null;
    if (entry.segment.preShow && score !== null) {
      slots.push(slotInput(deps, show, entry.segment, entry, score));
    }
  }
  for (let slot = 0; slot < show.format.slots; slot += 1) {
    const entry = show.segments.find(
      (candidate) => !candidate.segment.preShow && candidate.segment.slot === slot,
    );
    const score = entry === undefined ? null : (scores.get(entry.segment.id) ?? null);
    slots.push(slotInput(deps, show, { slot, preShow: false }, entry, score));
  }
  return {
    showName: show.instance.name,
    importance: show.importance,
    format: { slots: show.format.slots, preShowSlots: show.format.preShowSlots },
    slots,
    extras: {},
  };
}

/**
 * Completes a show whose segments have all run: counts the appearances, scores the show from its
 * segments' stored ratings (a segment with none counts as an empty slot), stores the score and its
 * trace, ends any live run (EVT10-01) and announces `show.completed`. The one ending both ways of
 * running a card share: all at once ({@link runShowCard}) and one segment at a time (`live.ts`).
 */
export function completeShowCard(ctx: PhaseContext, instanceId: EventInstanceId): void {
  const current = ctx.read.tables.eventInstances.require(instanceId);
  const show = showContextOf(ctx.read, current);
  countAppearances(ctx, show);

  const inputs = scoreInputs(ctx, show, storedScores(show));
  const modifiers = listShowScoreModifiers();
  const extras: Record<string, JsonValue> = {};
  for (const modifier of modifiers) {
    if (modifier.gather !== undefined) {
      extras[modifier.id] = modifier.gather(ctx.read, current);
    }
  }
  const { score, rawScore } = showScore(
    { ...inputs, extras },
    { tunables: ctx.tunables, modifiers },
  );
  const ceiling = showScoreCeilingOf(modifiers, extras, { tunables: ctx.tunables });

  const ref = showScoreTraceRef(current.id);
  ctx.recordTrace(ref, ctx.date, score);
  ctx.tx.update('eventInstances', current.id, (previous) => {
    const next: EventInstance = {
      ...previous,
      status: 'completed',
      result: {
        score: score.value,
        rawScore,
        traceId: refKey(ref),
        attendance: null,
        gate: null,
        viewers: null,
        ceiling,
      },
    };
    delete next.liveRun;
    return next;
  });
  ctx.publish('show.completed', {
    eventInstanceId: current.id,
    promotionId: current.promotionId,
    brandId: current.brandId,
    date: current.date,
    importance: current.importance,
    score: score.value,
    rawScore,
    offscreen: false,
    segmentCount: show.segments.length,
  });
}

/** Runs every segment of the show's card in running order, scores the show and completes it. */
export function runShowCard(ctx: PhaseContext, instance: DeepReadonly<EventInstance>): void {
  const show = showContextOf(ctx.read, instance);
  for (const entry of show.segments) {
    runSegment(ctx, show, entry);
  }
  completeShowCard(ctx, instance.id);
}

/**
 * Holds an off-screen score to the `cap` modifiers (EVT4-02's production ceiling), the same caps a
 * carded show gets. With no cap registered the score is returned as it is. Otherwise the off-screen
 * trace becomes the first line ("Score before any cap") of a trace with the same label, so the
 * Why? reads the same as before plus the cap lines.
 */
function capOffscreenScore(
  ctx: PhaseContext,
  instance: DeepReadonly<EventInstance>,
  raw: Traced<number>,
): { score: Traced<number>; ceiling: number | null } {
  const caps = listShowScoreModifiers().filter((modifier) => modifier.stage === 'cap');
  if (caps.length === 0) {
    return { score: raw, ceiling: null };
  }
  const calc = startCalc(
    raw.trace.label,
    { value: raw.value, trace: { ...raw.trace, label: scoreBeforeCapLabel(raw.value) } },
    { unit: 'points', docRef: OFFSCREEN_SHOW_SCORE_DOC_REF },
  );
  const { ceiling } = applyCapModifiers(
    calc,
    {
      showName: instance.name,
      importance: instance.importance,
      format: { slots: instance.format.slots, preShowSlots: instance.format.preShowSlots },
      slots: [],
      extras: {},
    },
    ctx.read,
    instance,
    { tunables: ctx.tunables, modifiers: caps },
  );
  return { score: calc.done(), ceiling };
}

/**
 * Scores a computer-controlled show that has no card, from its promotion's prestige and
 * popularity in the show's region, its size and one roll on `shows.offscreen`, and completes it.
 * No segment is run, no applier runs and no `segment.completed` is published.
 */
export function runOffscreenShow(ctx: PhaseContext, instance: DeepReadonly<EventInstance>): void {
  const promotion = ctx.read.tables.promotions.require(instance.promotionId);
  const raw = offscreenShowScore(
    {
      showName: instance.name,
      importance: instance.importance,
      prestige: promotion.prestige,
      popularityInRegion: promotion.regionalPop[instance.regionId] ?? 0,
      regionName: ctx.read.tables.regions.get(instance.regionId)?.name ?? instance.regionId,
    },
    { tunables: ctx.tunables, rng: ctx.rng(SHOWS_OFFSCREEN_STREAM) },
  );
  const { score, ceiling } = capOffscreenScore(ctx, instance, raw);
  const ref = showScoreTraceRef(instance.id);
  ctx.recordTrace(ref, ctx.date, score);
  ctx.tx.update('eventInstances', instance.id, {
    status: 'completed',
    result: {
      score: score.value,
      rawScore: raw.value,
      traceId: refKey(ref),
      attendance: null,
      gate: null,
      viewers: null,
      ceiling,
    },
  });
  ctx.publish('show.completed', {
    eventInstanceId: instance.id,
    promotionId: instance.promotionId,
    brandId: instance.brandId,
    date: instance.date,
    importance: instance.importance,
    score: score.value,
    rawScore: raw.value,
    offscreen: true,
    segmentCount: 0,
  });
}

/**
 * Runs one show now: the before-a-show-runs hooks first, then its card, or, for a computer show
 * with no card, its off-screen score. The one path both the shows phase (every show a computer
 * runs) and `shows.runTonight` (the player's show) take, so a show gives the same result whichever
 * of them runs it. `beforeTheDay` is true only from `shows.runTonight`, which runs the show before
 * its day's phases (see `BeforeShowRunsInput.beforeTheDay`).
 */
export function runShowNow(
  ctx: PhaseContext,
  instance: DeepReadonly<EventInstance>,
  human: boolean,
  { beforeTheDay = false }: { beforeTheDay?: boolean } = {},
): void {
  runBeforeShowRunsHooks(ctx, { show: instance, human, beforeTheDay });
  // Re-read: a hook may have changed the show (EVT6-03 picks a venue for a show without one).
  const show = ctx.read.tables.eventInstances.require(instance.id);
  if (!human && !hasCard(ctx.read, show.id)) {
    runOffscreenShow(ctx, show);
  } else {
    runShowCard(ctx, show);
  }
}
