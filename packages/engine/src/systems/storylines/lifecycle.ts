/**
 * Starting a storyline (CRTV3-02): the one place a storyline is created, so starting heat is the
 * same whoever starts it. New-game starters call it now; CRTV3-03's `storylines.create` and AIP6's
 * rival storylines call it later.
 *
 * Design: docs/design/storylines.md#starting-heat.
 */

import type { BrandId, PromotionId, StorylineId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import type { StorylineMember } from '../../model/entities/storyline';
import type { GameWorldView } from '../../model/tables';
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
