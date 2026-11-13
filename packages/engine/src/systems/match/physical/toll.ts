/**
 * The physical toll of one segment (MTCH4-04): the four formulas and the injury roll in one fixed
 * order, shared by the Match lab preview (MTCH4-05) and show night (`apply.ts`).
 *
 * The order is part of the design and never changes (docs/design/physical-toll.md#the-order):
 *
 * 1. `collectPhysicalInputs`: who carries load and what the formulas read about them;
 * 2. `collectRiskContributions` per worker;
 * 3. fatigue gain per worker;
 * 4. wear load and wear by body part per worker, in roll order (side, entrance order, person id),
 *    one `match.wear` draw each;
 * 5. ring learning per worker and attribute (the hidden learning gate and the mentor on the card);
 * 6. injury chance per worker, from fatigue and the worst body part **after** steps 3 and 4;
 * 7. the injury roll (`rollSegmentInjuries`), last, one `match.injury` draw per worker.
 *
 * Nothing here writes to the world: the result is plain JSON, and the caller decides what to store.
 */

import type { PersonId } from '../../../core/ids';
import type { RngStream } from '../../../core/rng/registry';
import { startCalc, type TraceNode, type Traced } from '../../../core/trace';
import type { BodyCondition, BodyPart } from '../../../model/entities/person';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import { computeConditionWear } from '../formulas/conditionWear';
import { computeFatigueGain } from '../formulas/fatigueGain';
import { conditionAfterWear, computeInjuryChance, worstBodyPart } from '../formulas/injuryChance';
import { computeWearByPart } from '../formulas/wearByPart';
import { collectRingLearning } from './collectLearning';
import { rollSegmentInjuries, type InjuryOutcome, type InjuryRollEntry } from './injuries';
import { collectPhysicalInputs, type PhysicalSegmentSpec } from './inputs';
import type { InMatchLearningAttribute } from './learning';
import { collectRiskContributions, type AppliedRiskContribution } from './riskModifiers';

/** The line a worker already hurt before this segment gets on their injury chance. */
export const ALREADY_INJURED_TONIGHT_LABEL = 'Already injured tonight';
/** The line a worker who came into the show injured gets on their injury chance. */
export const ALREADY_INJURED_LABEL = 'Already injured';

/** Fatigue is on a 0..100 scale. */
const FATIGUE_TOP = 100;

/** The promotion's rule on in-match injuries (`injuryPolicyFor`). */
export interface PhysicalTollPolicy {
  readonly skipInMatchInjuries: boolean;
  /** The policy's own trace, shown under the rival-rules line; null to leave it out. */
  readonly trace: TraceNode | null;
}

/** Why a worker is not rolled for an injury: they are already hurt. */
export type AlreadyInjured = 'tonight' | 'before';

export interface PhysicalTollDeps {
  readonly tunables: EngineTunables;
  readonly policy: PhysicalTollPolicy;
  /** `match.wear`: one draw per worker, in roll order. */
  readonly wearRng: RngStream;
  /** `match.injury`: one draw per worker, in roll order. */
  readonly injuryRng: RngStream;
  /**
   * Everyone on the same show in any role, for the mentor line. Left out, the segment's people and
   * its producer (the Match lab rule).
   */
  readonly cardPersonIds?: Iterable<PersonId>;
  /**
   * Workers already injured: they still take the load, but their chance is 0 with the reason, so
   * they are never hurt twice. Their roll is still drawn, so the stream stays aligned.
   */
  readonly alreadyInjured?: ReadonlyMap<PersonId, AlreadyInjured>;
}

/** One worker's injury outcome. */
export interface WorkerInjuryResult {
  readonly injured: boolean;
  /** The roll came up but the segment already had its most injuries. */
  readonly ignoredOverLimit: boolean;
  /** The body part with the lowest condition after this match, for an injured worker. */
  readonly bodyPartHint: BodyPart | null;
  /** The "Injured in this match?" decision. */
  readonly roll: Traced<InjuryOutcome>;
}

/** What one segment did to one worker. Plain JSON. */
export interface WorkerPhysicalToll {
  readonly personId: PersonId;
  readonly name: string;
  /** The stored side, 0-based. */
  readonly side: number;
  readonly safety: number;
  readonly fatigueBefore: number;
  readonly fatigueGain: Traced<number>;
  /** `min(100, before + gain)`. */
  readonly fatigueAfter: number;
  /** The wear load at part weight 1. */
  readonly wearLoad: Traced<number>;
  /** What each body part loses (before the floor at 0). */
  readonly wearByPart: Readonly<Record<BodyPart, Traced<number>>>;
  /** Body condition after this match's wear, never below 0. */
  readonly conditionAfter: Readonly<BodyCondition>;
  readonly worstPartAfter: { readonly part: BodyPart; readonly value: number };
  /** "Learning in this match": the attributes added up. */
  readonly learning: Traced<number>;
  readonly learningByAttribute: Readonly<Record<InMatchLearningAttribute, Traced<number>>>;
  readonly injuryChance: Traced<number>;
  readonly injury: WorkerInjuryResult;
  /** The risk contributions that reached this worker, in order. */
  readonly contributions: readonly AppliedRiskContribution[];
}

export interface PhysicalTollResult {
  /** In roll order: side, entrance order (unset last), person id. Empty for an angle. */
  readonly workers: readonly WorkerPhysicalToll[];
}

/** Roll order: side, entrance order (unset last), person id. Same as `rollSegmentInjuries`. */
function compareRollOrder(
  left: { side: number; entranceOrder: number | null; personId: PersonId },
  right: { side: number; entranceOrder: number | null; personId: PersonId },
): number {
  if (left.side !== right.side) {
    return left.side - right.side;
  }
  if (left.entranceOrder !== right.entranceOrder) {
    if (left.entranceOrder === null) {
      return 1;
    }
    if (right.entranceOrder === null) {
      return -1;
    }
    return left.entranceOrder - right.entranceOrder;
  }
  if (left.personId === right.personId) {
    return 0;
  }
  return left.personId < right.personId ? -1 : 1;
}

function entranceOrdersOf(spec: PhysicalSegmentSpec): Map<PersonId, number | null> {
  const orders = new Map<PersonId, number | null>();
  for (const side of spec.sides) {
    for (const participant of side) {
      if (participant.role === 'competitor' && !orders.has(participant.personId)) {
        orders.set(participant.personId, participant.entranceOrder ?? null);
      }
    }
  }
  return orders;
}

/** The chance with an "already injured" line: × 0, so the roll cannot come up. */
function notRolledAgain(chance: Traced<number>, why: AlreadyInjured): Traced<number> {
  const label = why === 'tonight' ? ALREADY_INJURED_TONIGHT_LABEL : ALREADY_INJURED_LABEL;
  const calc = startCalc(chance.trace.label, chance, { unit: 'probability' });
  calc.branch(label, true);
  return calc.multiply(label, 0).done();
}

/**
 * The physical toll of one segment, in the fixed order above. An angle gives no workers and draws
 * nothing.
 *
 * @throws NotFoundError (from `people.require`) for a person the world does not have.
 */
export function computePhysicalToll(
  read: GameWorldView,
  spec: PhysicalSegmentSpec,
  deps: PhysicalTollDeps,
): PhysicalTollResult {
  const { tunables } = deps;
  // (1) Who carries load.
  const inputs = collectPhysicalInputs(read, spec);
  if (inputs.length === 0) {
    return { workers: [] };
  }
  const entrance = entranceOrdersOf(spec);
  const workers = inputs
    .map((input) => ({ input, entranceOrder: entrance.get(input.personId) ?? null }))
    .sort((left, right) =>
      compareRollOrder(
        { ...left, side: left.input.side, personId: left.input.personId },
        { ...right, side: right.input.side, personId: right.input.personId },
      ),
    );

  // (2) Risk contributions per worker.
  const riskContext = { ...spec, read };
  const contributions = workers.map(({ input }) =>
    collectRiskContributions(riskContext, input.personId),
  );

  // (3) Fatigue gain per worker.
  const fatigueGains = workers.map(({ input }, index) =>
    computeFatigueGain(
      {
        name: input.name,
        durationClass: spec.durationClass,
        workersInMatch: input.workersInMatch,
        stamina: input.stamina,
        style: input.style,
        traits: input.traits,
        importance: spec.importance,
        contributions: contributions[index] ?? [],
        keepItSafe: spec.keepItSafe,
        matchesEarlierTonight: input.matchesEarlierTonight,
      },
      { tunables },
    ),
  );

  // (4) Wear per worker, in roll order: one `match.wear` draw each.
  const wear = workers.map(({ input }, index) => {
    const load = computeConditionWear(
      {
        name: input.name,
        durationClass: spec.durationClass,
        style: input.style,
        traits: input.traits,
        opponents: input.opponents,
        importance: spec.importance,
        contributions: contributions[index] ?? [],
        keepItSafe: spec.keepItSafe,
        matchesEarlierTonight: input.matchesEarlierTonight,
      },
      { tunables, rng: deps.wearRng },
    );
    const byPart = computeWearByPart(load, { tunables });
    return { load, byPart, after: conditionAfterWear(input.condition, byPart) };
  });

  // (5) Ring learning per worker and attribute.
  const learningDeps =
    deps.cardPersonIds === undefined
      ? { tunables }
      : { tunables, cardPersonIds: deps.cardPersonIds };
  const learning = new Map(
    collectRingLearning(read, spec, learningDeps).map((entry) => [entry.personId, entry]),
  );

  // (6) Injury chance per worker, from the state after steps 3 and 4.
  const chances = workers.map(({ input }, index) => {
    const after = wear[index];
    const gain = fatigueGains[index];
    if (after === undefined || gain === undefined) {
      throw new RangeError(`computePhysicalToll: no fatigue or wear for ${input.personId}`);
    }
    const chance = computeInjuryChance(
      {
        name: input.name,
        durationClass: spec.durationClass,
        fatigueGoingIn: input.fatigue,
        fatigueGain: gain,
        conditionAfterWear: after.after,
        style: input.style,
        traits: input.traits,
        opponents: input.opponents,
        contributions: contributions[index] ?? [],
        keepItSafe: spec.keepItSafe,
        matchesEarlierTonight: input.matchesEarlierTonight,
        skipInMatchInjuries: deps.policy.skipInMatchInjuries,
        policyTrace: deps.policy.trace,
      },
      { tunables },
    );
    const already = deps.alreadyInjured?.get(input.personId);
    return already === undefined ? chance : notRolledAgain(chance, already);
  });

  // (7) The injury roll, last.
  const entries: InjuryRollEntry[] = workers.map(({ input, entranceOrder }, index) => {
    const chance = chances[index];
    const after = wear[index];
    if (chance === undefined || after === undefined) {
      throw new RangeError(`computePhysicalToll: no chance for ${input.personId}`);
    }
    return {
      personId: input.personId,
      name: input.name,
      chance,
      side: input.side,
      entranceOrder,
      conditionAfterWear: after.after,
    };
  });
  const rolls = new Map(
    rollSegmentInjuries(entries, { tunables, rng: deps.injuryRng }).map((roll) => [
      roll.personId,
      roll,
    ]),
  );

  return {
    workers: workers.map(({ input }, index) => {
      const gain = fatigueGains[index];
      const worn = wear[index];
      const chance = chances[index];
      const roll = rolls.get(input.personId);
      const learned = learning.get(input.personId);
      if (
        gain === undefined ||
        worn === undefined ||
        chance === undefined ||
        roll === undefined ||
        learned === undefined
      ) {
        throw new RangeError(`computePhysicalToll: incomplete toll for ${input.personId}`);
      }
      return {
        personId: input.personId,
        name: input.name,
        side: input.side,
        safety: input.safety,
        fatigueBefore: input.fatigue,
        fatigueGain: gain,
        fatigueAfter: Math.min(FATIGUE_TOP, input.fatigue + gain.value),
        wearLoad: worn.load,
        wearByPart: worn.byPart,
        conditionAfter: worn.after,
        worstPartAfter: worstBodyPart(worn.after),
        learning: learned.total,
        learningByAttribute: learned.perAttribute,
        injuryChance: chance,
        injury: {
          injured: roll.injured,
          ignoredOverLimit: roll.hit && !roll.injured,
          bodyPartHint: roll.bodyPartHint,
          roll: roll.decision,
        },
        contributions: contributions[index] ?? [],
      };
    }),
  };
}
