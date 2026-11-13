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
 * The player's own shows keep them in full (until `match.prunePhysicalDetail` demotes them after
 * `history.keepDetailDays`); a rival show keeps only summaries and no learning trace, so a year of
 * rival cards stays small (docs/design/physical-toll.md#stored-traces).
 *
 * Design: docs/design/physical-toll.md#show-night.
 */

import type { EventInstanceId, PersonId, SegmentId } from '../../../core/ids';
import type { PhaseContext } from '../../../core/pipeline/context';
import { startCalc, type Traced } from '../../../core/trace';
import { BODY_PARTS, type BodyCondition, type Person } from '../../../model/entities/person';
import type { GameWorldView } from '../../../model/tables';
import { showControllerOf } from '../../calendar/control';
import { BODY_PART_LABELS } from '../../world/people/labels';
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

const SCALE_TOP = 100;

/** The steps that already logged a missing injury handler. */
const loggedNoHandler = new WeakSet<PhaseContext>();

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
  const weights = startCalc('Body part weights added up', 0, {
    unit: 'multiplier',
    startLabel: 'Nothing yet',
  });
  for (const part of BODY_PARTS) {
    weights.add(
      `${BODY_PART_LABELS[part]} weight`,
      weights.tunable(tunables, `match.wear.part.${part}`),
    );
  }
  return startCalc(CONDITION_LOST_LABEL, worker.wearLoad, {
    unit: 'points',
    docRef: CONDITION_WEAR_DOC_REF,
  })
    .multiply('Spread over the body', weights.done())
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
  const policy = injuryPolicyFor(read, tunables, spec.promotionId);
  const toll = computePhysicalToll(read, spec, {
    tunables,
    policy,
    wearRng: ctx.rng(WEAR_STREAM),
    injuryRng: ctx.rng(INJURY_STREAM),
    cardPersonIds: cardPersonIdsOf(read, eventInstanceId),
    alreadyInjured: alreadyInjuredOf(read, competitors, ctx.date),
  });

  // A rival show keeps summaries only (POL4-06), and no learning trace at all.
  const kept = { summaryOnly: !humanShow };
  for (const worker of toll.workers) {
    ctx.tx.update('people', worker.personId, (previous) => wornPerson(previous, worker));
    ctx.recordTrace(
      fatigueTraceRef(segmentId, worker.personId),
      ctx.date,
      fatigueAfterTrace(worker),
      kept,
    );
    ctx.recordTrace(
      wearTraceRef(segmentId, worker.personId),
      ctx.date,
      conditionLostTrace(worker, tunables),
      kept,
    );
    if (humanShow) {
      ctx.recordTrace(learningTraceRef(segmentId, worker.personId), ctx.date, worker.learning);
    }
    ctx.recordTrace(
      injuryChanceTraceRef(segmentId, worker.personId),
      ctx.date,
      worker.injuryChance,
      kept,
    );
    if (!worker.injury.injured || worker.injury.bodyPartHint === null) {
      continue;
    }
    ctx.recordTrace(
      injuryRollTraceRef(segmentId, worker.personId),
      ctx.date,
      worker.injury.roll,
      kept,
    );
    const handler = getInjuryHandler();
    if (handler === null) {
      if (!loggedNoHandler.has(ctx)) {
        loggedNoHandler.add(ctx);
        ctx.log(NO_INJURY_HANDLER_LOG);
      }
      continue;
    }
    handler.apply(ctx, {
      personId: worker.personId,
      segmentId,
      eventInstanceId,
      date: ctx.date,
      bodyPartHint: worker.injury.bodyPartHint,
      chanceTrace: worker.injuryChance,
    });
  }
  return toll;
}
