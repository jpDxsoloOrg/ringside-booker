/**
 * The in-match injury roll and the injury handler seam (MTCH4-02).
 *
 * `rollSegmentInjuries` decides who, if anyone, is hurt in one segment. It runs last: each
 * worker's chance (`computeInjuryChance`) is worked out first from their fatigue gain, wear and
 * every risk contribution. Every listed worker draws exactly once from `match.injury`, in a fixed
 * order, even when their chance is 0 or the segment's limit is already reached, so the stream
 * stays aligned however things are tuned. A hit past `match.injury.maxPerSegment` is kept in the
 * trace with the reason it was ignored.
 *
 * MTCH4 does not own health state. It hands each injury to the one registered handler (WRK6's
 * `health.injure`); with none registered nothing is written, and callers can still read who would
 * have been hurt from the results.
 *
 * Design: docs/design/physical-toll.md#the-injury-roll.
 */

import type { GameDate } from '../../../core/date';
import { RegistryError } from '../../../core/errors';
import type { EventInstanceId, PersonId, PromotionId, SegmentId } from '../../../core/ids';
import type { PhaseContext } from '../../../core/pipeline/context';
import { PHASE_ID_PATTERN } from '../../../core/pipeline/phase';
import type { RngStream } from '../../../core/rng/registry';
import { rollChance } from '../../../core/rng/rolls';
import { startDecision, type TraceNode, type Traced } from '../../../core/trace';
import type { TraceRef } from '../../../core/trace/store';
import type { BodyCondition, BodyPart } from '../../../model/entities/person';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import { INJURY_CHANCE_DOC_REF, worstBodyPart } from '../formulas/injuryChance';
import { ratingPolicyFor } from '../rating/policy';

export const INJURY_ROLL_DOC_REF = 'physical-toll.md#the-injury-roll';
export const INJURY_DECISION_LABEL = 'Injured in this match?';

/** One worker to roll for, with their chance and where they stand in the segment. */
export interface InjuryRollEntry {
  readonly personId: PersonId;
  readonly name: string;
  /** `computeInjuryChance`'s result. */
  readonly chance: Traced<number>;
  /** The stored side, 0-based. */
  readonly side: number;
  /** The participant's entrance order; null (not set) rolls after those with one. */
  readonly entranceOrder: number | null;
  /** Body condition after this segment's wear, for the body part hint. */
  readonly conditionAfterWear: Readonly<BodyCondition>;
}

export type InjuryOutcome = 'injured' | 'unhurt';

/** One worker's roll. */
export interface InjuryRollResult {
  readonly personId: PersonId;
  readonly name: string;
  readonly chance: Traced<number>;
  /** The roll came up, whether or not the per-segment limit let it count. */
  readonly hit: boolean;
  /** The worker is hurt: the roll came up and the segment's limit was not yet reached. */
  readonly injured: boolean;
  /**
   * For an injured worker, the part with the lowest condition after this segment's wear (ties in
   * `BODY_PARTS` order); null otherwise. The handler may use it or ignore it.
   */
  readonly bodyPartHint: BodyPart | null;
  /** The "Injured in this match?" decision: the chance, the roll and any limit line. */
  readonly decision: Traced<InjuryOutcome>;
}

/** The order workers roll in: side, then entrance order (unset last), then person id. */
function compareRollOrder(left: InjuryRollEntry, right: InjuryRollEntry): number {
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

/** "Already 1 injured in this segment (most per segment: 1)". */
export function injuryLimitLine(injuredSoFar: number, maxPerSegment: number): string {
  return `Already ${String(injuredSoFar)} injured in this segment (most per segment: ${String(maxPerSegment)})`;
}

/**
 * Rolls every worker's injury once, in roll order (side, entrance order, person id), and returns
 * the results in that order. At most `match.injury.maxPerSegment` workers are injured; a later hit
 * is recorded with the limit line and counts as unhurt.
 */
export function rollSegmentInjuries(
  entries: readonly InjuryRollEntry[],
  deps: { tunables: EngineTunables; rng: RngStream },
): InjuryRollResult[] {
  const maxPerSegment = deps.tunables.get('match.injury.maxPerSegment');
  let injuredSoFar = 0;
  return [...entries].sort(compareRollOrder).map((entry) => {
    // Exactly one draw per worker, whatever the chance or the limit.
    const roll = rollChance(deps.rng, entry.chance.value, `Injury roll: ${entry.name}`);
    const decision = startDecision<InjuryOutcome>(INJURY_DECISION_LABEL, {
      docRef: INJURY_ROLL_DOC_REF,
    })
      .consider('injured', entry.chance, 'Injury chance')
      .consider('unhurt', 1 - entry.chance.value, 'Chance of getting through unhurt')
      .roll(roll.roll);
    const hit = roll.value;
    let injured = false;
    let outcome: Traced<InjuryOutcome>;
    if (!hit) {
      outcome = decision.choose('unhurt', 'The injury roll did not come up');
    } else if (injuredSoFar >= maxPerSegment) {
      outcome = decision
        .rule(injuryLimitLine(injuredSoFar, maxPerSegment), true)
        .choose('unhurt', 'The injury roll came up, but the segment already had its most injuries');
    } else {
      injured = true;
      injuredSoFar += 1;
      outcome = decision.choose('injured', 'The injury roll came up');
    }
    return {
      personId: entry.personId,
      name: entry.name,
      chance: entry.chance,
      hit,
      injured,
      bodyPartHint: injured ? worstBodyPart(entry.conditionAfterWear).part : null,
      decision: outcome,
    };
  });
}

/**
 * Whether a promotion's rating policy skips in-match injuries (D-01), with a trace of the policy for
 * the rival-rules line. Asks the registered policy provider; with none, the neutral policy says no.
 */
export function injuryPolicyFor(
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
): { skipInMatchInjuries: boolean; trace: TraceNode } {
  const policy = ratingPolicyFor(read, tunables, promotionId);
  const decision = startDecision<boolean>(policy.label, { docRef: INJURY_CHANCE_DOC_REF });
  for (const line of policy.lines) {
    decision.note(line);
  }
  const skip = policy.skipInMatchInjuries;
  return {
    skipInMatchInjuries: skip,
    trace: decision.choose(
      skip,
      skip ? 'This promotion skips in-match injuries' : 'In-match injuries apply',
    ).trace,
  };
}

/** What the handler is asked to apply for one injured worker. */
export interface InjuryRequest {
  readonly personId: PersonId;
  readonly segmentId: SegmentId;
  readonly eventInstanceId: EventInstanceId;
  readonly date: GameDate;
  readonly bodyPartHint: BodyPart;
  /** The worker's injury chance, for the injury's own Why? */
  readonly chanceTrace: Traced<number>;
}

/** The one feature that turns an in-match injury into health state (WRK6's `health.injure`). */
export interface InjuryHandler {
  /** `system.camelName`, like a phase id, for example `health.injure`. */
  readonly id: string;
  /** Runs in the phase context the segment result applier runs in. */
  readonly apply: (ctx: PhaseContext, request: InjuryRequest) => { injuryTraceRef: TraceRef | null };
}

let handler: InjuryHandler | null = null;

/**
 * Registers the injury handler. There is at most one. Returns a function that removes it again.
 *
 * @throws RegistryError for a malformed id, or when a handler is already registered (naming both).
 */
export function registerInjuryHandler(spec: InjuryHandler): () => void {
  if (!PHASE_ID_PATTERN.test(spec.id)) {
    throw new RegistryError(
      `Injury handler "${spec.id}": the id must look like "system.camelName", for example "health.injure"`,
      { handlerId: spec.id },
    );
  }
  if (handler !== null) {
    throw new RegistryError(
      `Injury handler "${spec.id}": "${handler.id}" is already registered; there can be only one`,
      { handlerId: spec.id, registered: handler.id },
    );
  }
  const stored: InjuryHandler = { ...spec };
  handler = stored;
  return () => {
    if (handler === stored) {
      handler = null;
    }
  };
}

/** The registered injury handler, or null when no feature applies injuries. */
export function getInjuryHandler(): InjuryHandler | null {
  return handler;
}
