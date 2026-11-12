/**
 * What the built-in raters share: gathering each worker's inputs from the world, and the crowd,
 * score and stars tail that matches and talking segments both run.
 *
 * Every per-worker number is read from that worker's own row and contract, never from a value
 * carried over from the previous worker (research notes, bug-list item 4).
 *
 * Design: docs/design/match-rating.md#pipeline-and-seams.
 */

import { isBefore } from '../../../core/date';
import { InvalidArgumentError } from '../../../core/errors';
import type { PersonId } from '../../../core/ids';
import type { RngStream } from '../../../core/rng/registry';
import { constantOf, inputOf, traced, type Traced, type TraceNode } from '../../../core/trace';
import { promotionStatusKey, type Employment } from '../../../model/entities/employment';
import type { Person } from '../../../model/entities/person';
import type { SegmentKind } from '../../../model/entities/segment';
import type { EngineTunables } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import { crowdExpectation } from '../formulas/crowdExpectation';
import { crowdScore } from '../formulas/crowdScore';
import { segmentScore } from '../formulas/segmentScore';
import { sideAggregate } from '../formulas/sideAggregate';
import { starPower } from '../formulas/starPower';
import { starRating } from '../formulas/starRating';
import { DURATION_CLASS_LABELS, SLOT_ROLE_LABELS } from '../slots';
import type { RatingContext } from './context';
import { runStage } from './runStage';
import type { RatingPolicySummary, SlotDerivation } from './types';

export const NOT_UNDER_CONTRACT_NOTE = 'Not under contract here';
export const NO_MOMENTUM_NOTE = 'No momentum yet';
export const ENTERTAINMENT_LABEL = 'Entertainment';

/** One worker's inputs, read from the world. */
export interface GatheredWorker {
  readonly personId: PersonId;
  /** The ring name with the promotion running the show, else the default ring name. */
  readonly name: string;
  readonly side: number;
  readonly person: Person;
  /** Injured on the show's date. */
  readonly injured: boolean;
  readonly popularity: Traced<number>;
  readonly momentum: Traced<number>;
}

export interface GatheredSide {
  readonly side: number;
  readonly workers: readonly GatheredWorker[];
}

/** "Main event (long)": the slot role and its duration class. */
export function durationLabelOf(slot: Pick<SlotDerivation, 'role' | 'durationClass'>): string {
  return `${SLOT_ROLE_LABELS[slot.role]} (${DURATION_CLASS_LABELS[slot.durationClass].toLowerCase()})`;
}

/** "Slot weight ×1.75". */
export function slotWeightLine(weight: number): string {
  return `Slot weight ×${formatNumber(weight)}`;
}

/** The region's name, or its id when the world has no such region. */
export function regionNameOf(ctx: RatingContext): string {
  const { regionId } = ctx.input.event;
  return ctx.read.tables.regions.get(regionId)?.name ?? regionId;
}

/** The active contracts with the promotion running the show, by person. */
function contractsByPerson(ctx: RatingContext): Map<PersonId, Employment> {
  const contracts = ctx.read.tables.employments.lookup(
    'byPromotionStatus',
    promotionStatusKey(ctx.input.promotionId, 'active'),
  );
  return new Map(contracts.map((employment) => [employment.personId, employment]));
}

function momentumOf(
  name: string,
  personId: PersonId,
  contract: Employment | undefined,
): Traced<number> {
  const label = `${name}'s momentum`;
  if (contract === undefined) {
    return constantOf(label, 0, NOT_UNDER_CONTRACT_NOTE);
  }
  if (contract.momentum === null) {
    return constantOf(label, 0, NO_MOMENTUM_NOTE);
  }
  return inputOf(label, contract.momentum, { kind: 'person', id: personId }, 'points');
}

/**
 * Every side's workers with their inputs, in the input's order.
 *
 * @throws InvalidArgumentError for a person id the world does not have (`rateSegment` refuses
 *   those first).
 */
export function gatherSides(ctx: RatingContext): GatheredSide[] {
  const contracts = contractsByPerson(ctx);
  const regionName = regionNameOf(ctx);
  const { regionId, date } = ctx.input.event;
  return ctx.input.sides.map((side) => ({
    side: side.side,
    workers: side.personIds.map((personId) => {
      const person = ctx.read.tables.people.get(personId);
      if (person === undefined) {
        throw new InvalidArgumentError(
          'gatherSides',
          'personId',
          personId,
          'a person in the world',
        );
      }
      const contract = contracts.get(personId);
      const name = contract?.ringName ?? person.defaultRingName;
      const injury = person.injury;
      return {
        personId,
        name,
        side: side.side,
        person,
        injured: injury !== null && isBefore(date, injury.expectedReturn),
        popularity: inputOf(
          `${name}'s popularity in ${regionName}`,
          person.regionalPop[regionId] ?? 0,
          { kind: 'person', id: personId },
          'points',
        ),
        momentum: momentumOf(name, personId, contract),
      };
    }),
  }));
}

/** Who is on a stored side, in order. */
export function personIdsOf(sides: readonly GatheredSide[], side: number): PersonId[] {
  return (sides.find((entry) => entry.side === side)?.workers ?? []).map(
    (worker) => worker.personId,
  );
}

/** The rng as the formulas take it: left out when there is none. */
export function rngDeps(
  ctx: RatingContext,
): { tunables: EngineTunables } | { tunables: EngineTunables; rng: RngStream } {
  return ctx.rng === null ? { tunables: ctx.tunables } : { tunables: ctx.tunables, rng: ctx.rng };
}

/** `value` with notes placed right after its starting value, at the top of the Why? panel. */
export function withTopNotes(value: Traced<number>, notes: readonly string[]): Traced<number> {
  const node = value.trace;
  if (node.kind !== 'formula' || node.children.length === 0) {
    return value;
  }
  const [start, ...rest] = node.children;
  const noteNodes: TraceNode[] = notes.map((text) => ({ kind: 'note', label: text, value: null }));
  return traced(value.value, {
    ...node,
    children: [...(start === undefined ? [] : [start]), ...noteNodes, ...rest],
  });
}

/** What the crowd, score and stars tail needs from a rater. */
export interface RatingTailInputs {
  readonly kind: SegmentKind;
  /** Work rate or talk, after its stage. */
  readonly performance: Traced<number>;
  readonly workers: readonly GatheredWorker[];
  /** Each worker's entertainment after the `performance` stage, by person. */
  readonly entertainment: ReadonlyMap<PersonId, Traced<number>>;
  readonly crowdFactor: number;
  readonly typeName: string;
}

export interface RatingTail {
  readonly starPower: Traced<number>;
  readonly expectation: Traced<number>;
  readonly crowd: Traced<number>;
  readonly score: Traced<number>;
  readonly stars: Traced<number>;
}

function meanOf(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Star power, the expectation and crowd stages, then the score and stars stages, each carrying the
 * notes "<Role> (<duration class>)" and "Slot weight ×N" at the top.
 */
export function rateTail(ctx: RatingContext, inputs: RatingTailInputs): RatingTail {
  const { tunables } = ctx;
  const promotion = ctx.read.tables.promotions.get(ctx.input.promotionId);
  if (promotion === undefined) {
    throw new InvalidArgumentError(
      'rateTail',
      'promotionId',
      ctx.input.promotionId,
      'a promotion in the world',
    );
  }
  const { workers } = inputs;
  const entertainment = sideAggregate(
    {
      label: ENTERTAINMENT_LABEL,
      members: workers.map((worker) => ({
        id: worker.personId,
        name: worker.name,
        value: inputs.entertainment.get(worker.personId) ?? constantOf('Entertainment', 0, 'None'),
      })),
      decayKey: 'match.side.depthDecay',
    },
    { tunables },
  );
  const stars = starPower(
    {
      regionName: regionNameOf(ctx),
      members: workers.map((worker) => ({
        id: worker.personId,
        name: worker.name,
        popularity: worker.popularity.value,
      })),
    },
    { tunables },
  );
  const expectation = runStage(
    'expectation',
    crowdExpectation(
      {
        starPower: stars,
        momentum: meanOf(workers.map((worker) => worker.momentum.value)),
        role: ctx.role,
        roleLabel: SLOT_ROLE_LABELS[ctx.role],
        importance: ctx.input.event.importance,
        televised: ctx.input.event.televised,
      },
      { tunables },
    ),
    ctx,
  );
  const performanceLabel = inputs.kind === 'match' ? 'Work rate' : 'Talk';
  const crowd = runStage(
    'crowd',
    crowdScore(
      {
        performance: inputs.performance,
        performanceLabel,
        entertainment,
        starPower: stars,
        expectation,
        crowdFactor: inputs.crowdFactor,
        typeName: inputs.typeName,
      },
      rngDeps(ctx),
    ),
    ctx,
  );
  const notes = [durationLabelOf(ctx.slot), slotWeightLine(ctx.slot.weight)];
  const score = runStage(
    'score',
    segmentScore(
      {
        kind: inputs.kind,
        performance: inputs.performance,
        crowd,
        promotionStyle: promotion.style,
        policyBonus: ctx.policy.scoreBonus,
        policyLabel: ctx.policy.lines[0] ?? ctx.policy.label,
      },
      { tunables },
    ),
    ctx,
  );
  const rated = runStage(
    'stars',
    starRating(
      {
        kind: inputs.kind,
        performance: inputs.performance,
        crowd,
        durationClass: ctx.durationClass,
        durationLabel: durationLabelOf(ctx.slot),
      },
      { tunables },
    ),
    ctx,
  );
  return {
    starPower: stars,
    expectation,
    crowd,
    score: withTopNotes(score, notes),
    stars: withTopNotes(rated, notes),
  };
}

/** The policy as the result reports it. */
export function policySummary(ctx: RatingContext): RatingPolicySummary {
  return {
    label: ctx.policy.label,
    simpleInputs: ctx.policy.simpleInputs,
    skipInMatchInjuries: ctx.policy.skipInMatchInjuries,
  };
}
