/**
 * Show night's physical toll applier (MTCH4-04): writes what one run match did to each competitor's
 * body: fatigue up, body condition down per part, the in-match attributes up a little, and an
 * injury handed to the registered injury handler (WRK6's `health.injure`) when one is rolled.
 *
 * Each person is read from `ctx.read` when the segment is applied, so a worker in two segments of
 * one show starts the second from where the first left them, and each worker is written with one
 * `people` update (fatigue, condition and attributes together), so nothing overwrites anything
 * else. Condition never goes below 0, fatigue and attributes never above 100. Attributes are
 * written directly (no attribute door exists yet) and are not held to the hidden ceilings: the
 * learning gate closes the next match instead (docs/design/physical-toll.md#ring-learning).
 *
 * Traces, under `<segmentId>:<personId>` (`traceRefs.ts`): `match.fatigue`, `match.wear`,
 * `match.learning`, `match.injuryChance`, and `match.injuryRoll` for an injured worker only.
 * The player's own shows keep them, cut to a few levels (`STORED_TRACE_DEPTH`), until
 * `match.prunePhysicalDetail` demotes them after `history.keepDetailDays`; a rival show keeps only
 * summaries of fatigue and wear (and of an injury chance above 0, and an injury), so a year of rival
 * cards stays small (docs/design/physical-toll.md#stored-traces).
 *
 * Design: docs/design/physical-toll.md#show-night.
 */

import type { EventInstanceId, PersonId, PromotionId, SegmentId } from '../../../core/ids';
import type { PhaseContext } from '../../../core/pipeline/context';
import { startCalc, type Traced, type TraceValue } from '../../../core/trace';
import { compactTrace, leanTrace } from '../../../core/trace/compact';
import type { TraceRef } from '../../../core/trace/store';
import { BODY_PARTS, type BodyCondition, type Person } from '../../../model/entities/person';
import type { GameWorldView } from '../../../model/tables';
import { showControllerOf } from '../../calendar/control';
import type { EngineTunables } from '../../tunables';
import { CONDITION_WEAR_DOC_REF } from '../formulas/conditionWear';
import { FATIGUE_GAIN_DOC_REF } from '../formulas/fatigueGain';
import { getInjuryHandler, injuryPolicyFor } from './injuries';
import { segmentSpecFromWorld } from './inputs';
import { IN_MATCH_LEARNING } from './learning';
import { INJURY_STREAM, WEAR_STREAM } from './streams';
import {
  computePhysicalToll,
  type AlreadyInjured,
  type PhysicalTollPolicy,
  type PhysicalTollResult,
  type WorkerPhysicalToll,
} from './toll';
import {
  fatigueTraceRef,
  injuryChanceTraceRef,
  injuryRollTraceRef,
  learningTraceRef,
  wearTraceRef,
} from './traceRefs';

/** Logged (once per step) when someone is hurt but no feature applies injuries. */
export const NO_INJURY_HANDLER_LOG = 'In-match injury rolled but no injury handler is registered';

export const FATIGUE_AFTER_LABEL = 'Fatigue after the match';
export const FATIGUE_FROM_MATCH_LABEL = 'Fatigue from this match';
export const CONDITION_LOST_LABEL = 'Condition lost in this match';
export const SPREAD_OVER_BODY_LABEL = 'Spread over the body';

const SCALE_TOP = 100;

/**
 * Levels kept in each stored trace of the player's shows (the root is level 1; `compactTrace`).
 * Every match stores four of these per worker for 28 days, so each keeps the lines its Why? reads
 * first and leaves the deeper working to the formulas' docs and the Match lab, which works the full
 * trace out again. The fatigue trace wraps the gain one level down, so it keeps one level more.
 */
export const STORED_TRACE_DEPTH = {
  fatigue: 4,
  wear: 3,
  learning: 3,
  injuryChance: 3,
  roll: 3,
} as const;

/** Levels a summary reads: the root and its steps. */
const SUMMARY_DEPTH = 2;

/** The steps that already logged a missing injury handler. */
const loggedNoHandler = new WeakSet<PhaseContext>();

/**
 * What a step works out once and every segment of it shares: each promotion's injury policy and
 * each show's people. Neither changes while the shows run (the phase writes results and ratings).
 */
interface StepCache {
  readonly policies: Map<PromotionId, PhysicalTollPolicy>;
  readonly cards: Map<EventInstanceId, readonly PersonId[]>;
}

const stepCaches = new WeakMap<PhaseContext, StepCache>();

function stepCacheOf(ctx: PhaseContext): StepCache {
  let cache = stepCaches.get(ctx);
  if (cache === undefined) {
    cache = { policies: new Map(), cards: new Map() };
    stepCaches.set(ctx, cache);
  }
  return cache;
}

/** `min(100, fatigue going in + this match's gain)`, as the `match.fatigue` trace stores it. */
export function fatigueAfterTrace(worker: WorkerPhysicalToll): Traced<number> {
  return startCalc(FATIGUE_AFTER_LABEL, worker.fatigueBefore, {
    unit: 'points',
    startLabel: `${worker.name}'s fatigue going in`,
    docRef: FATIGUE_GAIN_DOC_REF,
  })
    .add(FATIGUE_FROM_MATCH_LABEL, worker.fatigueGain)
    .min('Fatigue tops out at 100', SCALE_TOP)
    .done();
}

/**
 * The condition the worker lost over the whole body, as the `match.wear` trace stores it: the wear
 * load times the body part weights added up. Each part's own amount is the load times its weight.
 */
export function conditionLostTrace(
  worker: WorkerPhysicalToll,
  tunables: EngineTunables,
): Traced<number> {
  const weights = BODY_PARTS.reduce(
    (sum, part) => sum + tunables.get(`match.wear.part.${part}`),
    0,
  );
  return startCalc(CONDITION_LOST_LABEL, worker.wearLoad, {
    unit: 'points',
    docRef: CONDITION_WEAR_DOC_REF,
  })
    .multiply(SPREAD_OVER_BODY_LABEL, weights, 'The body part weights added up')
    .done();
}

/** Everyone on the show in any role, producers included: the mentor line's "on the card". */
export function cardPersonIdsOf(read: GameWorldView, eventInstanceId: EventInstanceId): PersonId[] {
  const ids = new Set<PersonId>();
  for (const segment of read.tables.segments.lookup('byEventInstance', eventInstanceId)) {
    for (const participant of read.tables.participants.lookup('bySegment', segment.id)) {
      ids.add(participant.personId);
    }
    if (segment.crew.producerId !== null) {
      ids.add(segment.crew.producerId);
    }
  }
  return [...ids];
}

function alreadyInjuredOf(
  read: GameWorldView,
  personIds: readonly PersonId[],
  date: string,
): Map<PersonId, AlreadyInjured> {
  const injured = new Map<PersonId, AlreadyInjured>();
  for (const personId of personIds) {
    const injury = read.tables.people.get(personId)?.injury ?? null;
    if (injury !== null) {
      injured.set(personId, injury.since === date ? 'tonight' : 'before');
    }
  }
  return injured;
}

/** One worker's row after the match: one update for fatigue, condition and attributes. */
function wornPerson(previous: Person, worker: WorkerPhysicalToll): Person {
  const condition: BodyCondition = { ...previous.condition };
  for (const part of BODY_PARTS) {
    condition[part] = Math.max(0, previous.condition[part] - worker.wearByPart[part].value);
  }
  const attributes = { ...previous.attributes };
  for (const { attribute } of IN_MATCH_LEARNING) {
    const gain = worker.learningByAttribute[attribute].value;
    attributes[attribute] = Math.min(SCALE_TOP, previous.attributes[attribute] + gain);
  }
  return {
    ...previous,
    fatigue: Math.min(SCALE_TOP, previous.fatigue + worker.fatigueGain.value),
    condition,
    attributes,
  };
}

/**
 * Applies one run match's physical toll and returns it, or null for an angle (or a segment the
 * world does not have), which nothing happens to.
 */
export function applyPhysicalToll(
  ctx: PhaseContext,
  segmentId: SegmentId,
): PhysicalTollResult | null {
  const { read, tunables } = ctx;
  const spec = segmentSpecFromWorld(read, segmentId, { tunables });
  if (spec === null || spec.card === undefined || spec.card === null) {
    return null;
  }
  const eventInstanceId = spec.card.eventInstanceId;
  const instance = read.tables.eventInstances.require(eventInstanceId);
  const humanShow = showControllerOf(read, instance).kind === 'human';
  const competitors = spec.sides
    .flat()
    .filter((participant) => participant.role === 'competitor')
    .map((participant) => participant.personId);
  const cache = stepCacheOf(ctx);
  let policy = cache.policies.get(spec.promotionId);
  if (policy === undefined) {
    policy = injuryPolicyFor(read, tunables, spec.promotionId);
    cache.policies.set(spec.promotionId, policy);
  }
  let cardPersonIds = cache.cards.get(eventInstanceId);
  if (cardPersonIds === undefined) {
    cardPersonIds = cardPersonIdsOf(read, eventInstanceId);
    cache.cards.set(eventInstanceId, cardPersonIds);
  }
  const toll = computePhysicalToll(read, spec, {
    tunables,
    policy,
    wearRng: ctx.rng(WEAR_STREAM),
    injuryRng: ctx.rng(INJURY_STREAM),
    cardPersonIds,
    alreadyInjured: alreadyInjuredOf(read, competitors, ctx.date),
    summaryOnly: !humanShow,
  });

  const record = (ref: TraceRef, traced: Traced<TraceValue>, depth: number): void => {
    if (humanShow) {
      ctx.recordTrace(ref, ctx.date, leanTrace(compactTrace(traced, depth)));
    } else {
      // A rival show keeps summaries only (POL4-06). A summary reads the root and its steps, so
      // nothing below them is handed to the store to check.
      ctx.recordTrace(ref, ctx.date, compactTrace(traced, SUMMARY_DEPTH), { summaryOnly: true });
    }
  };
  for (const worker of toll.workers) {
    const { personId } = worker;
    ctx.tx.update('people', personId, (previous) => wornPerson(previous, worker));
    record(
      fatigueTraceRef(segmentId, personId),
      fatigueAfterTrace(worker),
      STORED_TRACE_DEPTH.fatigue,
    );
    record(
      wearTraceRef(segmentId, personId),
      conditionLostTrace(worker, tunables),
      STORED_TRACE_DEPTH.wear,
    );
    // Rivals: no learning trace, and an injury chance only when it is not 0 (by default rival
    // rules skip in-match injuries, so it always is).
    if (humanShow) {
      record(learningTraceRef(segmentId, personId), worker.learning, STORED_TRACE_DEPTH.learning);
    }
    if (humanShow || worker.injuryChance.value > 0) {
      record(
        injuryChanceTraceRef(segmentId, personId),
        worker.injuryChance,
        STORED_TRACE_DEPTH.injuryChance,
      );
    }
    if (!worker.injury.injured || worker.injury.bodyPartHint === null) {
      continue;
    }
    record(injuryRollTraceRef(segmentId, personId), worker.injury.roll, STORED_TRACE_DEPTH.roll);
    const handler = getInjuryHandler();
    if (handler === null) {
      if (!loggedNoHandler.has(ctx)) {
        loggedNoHandler.add(ctx);
        ctx.log(NO_INJURY_HANDLER_LOG);
      }
      continue;
    }
    handler.apply(ctx, {
      personId,
      segmentId,
      eventInstanceId,
      date: ctx.date,
      bodyPartHint: worker.injury.bodyPartHint,
      chanceTrace: worker.injuryChance,
    });
  }
  return toll;
}
