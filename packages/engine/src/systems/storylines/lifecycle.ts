/**
 * Starting and ending a storyline. `startStoryline` (CRTV3-02) is the one place a storyline is
 * created, so starting heat is the same whoever starts it: new-game starters, CRTV3-03's
 * `storylines.create` and AIP6's rival storylines. `endStoryline` (CRTV3-03) is the one place one
 * ends.
 *
 * Design: docs/design/storylines.md#starting-heat, #commands.
 */

import { InvariantError } from '../../core/errors';
import type { BrandId, PromotionId, StorylineId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import type { StorylineMember } from '../../model/entities/storyline';
import type { GameWorldView } from '../../model/tables';
import { linkedSegmentIdsOf } from './context';
import type { StorylineStartSource } from './events';
import { startingHeat, type StartingHeatMember } from './formulas/startingHeat';
import { activeEmploymentAt } from './rows';
import { storylineHeatTraceRef } from './traceKinds';

/** What a new storyline is made of. */
export interface StartStorylineSpec {
  readonly promotionId: PromotionId;
  readonly brandId: BrandId | null;
  readonly name: string;
  readonly summary: string;
  readonly members: readonly StorylineMember[];
  readonly source: StorylineStartSource;
}

/**
 * True when the promotion's storyline traces are kept in full: the player's own. A rival's are
 * kept as summaries only, since every rival storyline cools every day (docs/design/storylines.md#heat-decay).
 */
export function keepsFullStorylineTraces(read: GameWorldView, promotionId: PromotionId): boolean {
  return read.tables.promotions.get(promotionId)?.controller.kind === 'human';
}

/** The members as starting heat sees them: ring name here and popularity in the home region. */
export function startingHeatMembers(
  read: GameWorldView,
  promotionId: PromotionId,
  members: readonly StorylineMember[],
): StartingHeatMember[] {
  const promotion = read.tables.promotions.require(promotionId);
  return members.map((member) => {
    const person = read.tables.people.require(member.personId);
    return {
      name: activeEmploymentAt(read, person.id, promotionId)?.ringName ?? person.defaultRingName,
      personId: person.id,
      homePopularity: person.regionalPop[promotion.homeRegionId] ?? 0,
    };
  });
}

/**
 * Creates an active storyline started today with its starting heat, stores the heat's Why? at
 * `storylineHeatTraceRef(id)` (a summary only for a rival) and publishes `storyline.started`.
 */
export function startStoryline(ctx: PhaseContext, spec: StartStorylineSpec): StorylineId {
  const heat = startingHeat(
    { members: startingHeatMembers(ctx.read, spec.promotionId, spec.members) },
    { tunables: ctx.tunables },
  );
  const storyline = ctx.tx.create('storylines', {
    promotionId: spec.promotionId,
    brandId: spec.brandId,
    name: spec.name,
    status: 'active',
    startedOn: ctx.date,
    endedOn: null,
    heat: heat.value,
    members: spec.members.map((member) => ({ personId: member.personId, side: member.side })),
    summary: spec.summary,
    lastProgressOn: null,
    finaleSegmentId: null,
    progress: [],
    payoff: null,
  });
  ctx.recordTrace(storylineHeatTraceRef(storyline.id), ctx.date, heat, {
    summaryOnly: !keepsFullStorylineTraces(ctx.read, spec.promotionId),
  });
  ctx.publish('storyline.started', {
    storylineId: storyline.id,
    promotionId: spec.promotionId,
    source: spec.source,
  });
  return storyline.id;
}

/**
 * What ending a storyline pays (CRTV3-03): `tooFew` below `storylines.payoff.minSegments` linked
 * segments, else `notAvailable` (no payoff yet). CRTV4 changes the second case when the payoff
 * lands. Docs: docs/design/storylines.md#payoff-threshold.
 */
export type StorylineEndPayoff = 'tooFew' | 'notAvailable';

/** The outcome of ending a storyline: how many segments link it and what that pays. */
export interface StorylineEndOutcome {
  readonly linkedSegments: number;
  readonly minSegments: number;
  readonly payoff: StorylineEndPayoff;
}

/** What ending a storyline with `linkedSegments` linked segments would pay today. */
export function endOutcome(linkedSegments: number, minSegments: number): StorylineEndOutcome {
  return {
    linkedSegments,
    minSegments,
    payoff: linkedSegments < minSegments ? 'tooFew' : 'notAvailable',
  };
}

/** The end outcome in plain words, for the confirm dialog. */
export function endOutcomeMessage(outcome: StorylineEndOutcome): string {
  if (outcome.payoff === 'tooFew') {
    const needs = outcome.minSegments === 1 ? 'segment' : 'segments';
    return `Ending now pays nothing: needs ${String(outcome.minSegments)} linked ${needs}, has ${String(outcome.linkedSegments)}.`;
  }
  return 'No payoff yet: payoffs arrive with storyline booking.';
}

/** What {@link endStoryline} needs from a step: a phase or a command context both fit. */
export type StorylineEndContext = Pick<
  PhaseContext,
  'date' | 'tx' | 'read' | 'tunables' | 'publish'
>;

/**
 * Ends an active storyline today: `status: 'ended'`, `endedOn: ctx.date`, and publishes
 * `storyline.ended`. Members, heat, `lastProgressOn` and links stay as they are; storylines are
 * never deleted. The player's `storylines.end` and the rival desk (AIP6) both end storylines here.
 * Throws {@link InvariantError} for an unknown or already ended storyline: callers check first.
 */
export function endStoryline(
  ctx: StorylineEndContext,
  storylineId: StorylineId,
): StorylineEndOutcome {
  const storyline = ctx.read.tables.storylines.get(storylineId);
  if (storyline === undefined) {
    throw new InvariantError(`Cannot end storyline ${storylineId}: it does not exist`, {
      storylineId,
    });
  }
  if (storyline.status === 'ended') {
    throw new InvariantError(`Cannot end storyline ${storylineId}: it has already ended`, {
      storylineId,
    });
  }
  const linkedSegments = linkedSegmentIdsOf(ctx.read, storylineId).length;
  ctx.tx.update('storylines', storylineId, { status: 'ended', endedOn: ctx.date });
  ctx.publish('storyline.ended', {
    storylineId,
    promotionId: storyline.promotionId,
    linkedSegments,
  });
  return endOutcome(linkedSegments, ctx.tunables.get('storylines.payoff.minSegments'));
}
