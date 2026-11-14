/**
 * Paying a storyline off when it ends (CRTV4-03). The `storylines.payOffOnEnd` subscription reacts
 * to `storyline.ended`, so the player's `storylines.end` and a rival ending its own storylines pay
 * by the same rule (D-01). It runs `planPayoff` and hands each paid member's popularity and
 * momentum to WRK1's doors, then stores the payoff record on the storyline, records the payoff
 * trace and publishes `storyline.paidOff`.
 *
 * Morale is not part of the payoff: a hot storyline's happiness is WRK8's appearance bonus, and a
 * loss inside one never costs morale here (D-09). Design: docs/design/storylines.md#payoff.
 */

import { defineSubscription, type SubscriptionSpec } from '../../../core/api/system';
import type { StorylineId } from '../../../core/ids';
import type { StepContext } from '../../../core/pipeline/context';
import { startDecision } from '../../../core/trace/decision';
import { refKey } from '../../../core/trace/store';
import type { TraceNode } from '../../../core/trace/types';
import type { StorylinePayoffRecord } from '../../../model/entities/storyline';
import { applyMomentumChange, applyPopularityChange, type DoorReason } from '../../workers/doors';
import type { DoorSource } from '../../workers/events';
import { PAYOFF_DOC_REF } from '../formulas/payoffQuality';
import { keepsFullStorylineTraces } from '../lifecycle';
import { storylinePayoffTraceRef } from '../traceKinds';
import { planPayoff, type PayoffPlan, type PayoffPlanMember } from './planPayoff';

export const PAY_OFF_ON_END_SUBSCRIPTION_ID = 'storylines.payOffOnEnd';

/** The reason key WRK1's doors publish for a payoff change. */
export const STORYLINE_PAYOFF_REASON_KEY = 'storyline.payoff';

/** The doors' reason for a storyline's payoff: "Storyline payoff: 'Test Feud'". */
export function storylinePayoffReason(storylineName: string): DoorReason {
  return { key: STORYLINE_PAYOFF_REASON_KEY, label: `Storyline payoff: '${storylineName}'` };
}

/** True when the member is paid: the storyline pays off and they are not skipped. */
export function memberIsPaid(plan: PayoffPlan, member: PayoffPlanMember): boolean {
  return plan.eligible && member.skippedReason === null && member.employmentId !== null;
}

/** One member's line in the payoff trace: what they got, or why they got nothing. */
function memberNode(plan: PayoffPlan, member: PayoffPlanMember): TraceNode {
  const decision = startDecision<'paid' | 'skipped'>(member.name);
  if (member.skippedReason !== null) {
    decision.rule(member.skippedReason, true);
    return decision.choose('skipped', member.skippedReason).trace;
  }
  decision.include('Popularity', member.popularity);
  decision.include('Momentum', member.momentum);
  const chosen = plan.eligible
    ? decision.choose('paid', 'Still works for the promotion')
    : decision.choose('skipped', 'The storyline did not pay off');
  return chosen.trace;
}

/** The outcome in words: "4 linked segments counted" or "No payoff (needs 4 …, has 3)". */
function outcomeReason(plan: PayoffPlan): string {
  return plan.outcome.trace.kind === 'decision' ? plan.outcome.trace.reason : plan.outcome.value;
}

/** The record stored on the storyline. */
function payoffRecord(
  plan: PayoffPlan,
  ctx: Pick<StepContext, 'date'>,
  traceId: string,
): StorylinePayoffRecord {
  return {
    paid: plan.eligible,
    on: ctx.date,
    countedSegments: plan.countedSegments,
    heat: plan.heat,
    members: plan.members.map((member) => {
      const paid = memberIsPaid(plan, member);
      return {
        personId: member.personId,
        popularityDelta: paid ? member.popularity.value : 0,
        momentumDelta: paid ? member.momentum.value : 0,
        skipped: member.skippedReason !== null,
      };
    }),
    traceId,
  };
}

/**
 * Pays an ended storyline off. Does nothing for an unknown or active storyline, or one already
 * paid off (a payoff happens once).
 */
export function payOffStoryline(ctx: StepContext, storylineId: StorylineId): void {
  const storyline = ctx.read.tables.storylines.get(storylineId);
  if (storyline?.status !== 'ended' || storyline.payoff !== null) {
    ctx.log(`Storyline ${storylineId}: not ended or already paid off, no payoff`);
    return;
  }
  const plan = planPayoff(ctx.read, ctx.tunables, storylineId);
  const promotion = ctx.read.tables.promotions.require(plan.promotionId);
  const source: DoorSource = promotion.controller.kind === 'human' ? 'player' : 'ai';
  const reason = storylinePayoffReason(plan.storylineName);

  let memberCount = 0;
  for (const member of plan.members) {
    if (!memberIsPaid(plan, member) || member.employmentId === null) {
      continue;
    }
    memberCount += 1;
    applyPopularityChange(ctx, {
      subject: { kind: 'person', id: member.personId },
      regionWeights: plan.regionWeights,
      delta: member.popularity,
      source,
      reason,
    });
    applyMomentumChange(ctx, {
      employmentId: member.employmentId,
      delta: member.momentum,
      source,
      reason,
    });
  }

  const trace = startDecision<'pay' | 'noPayoff'>(reason.label, { docRef: PAYOFF_DOC_REF });
  trace.include('Does it pay off?', plan.outcome);
  trace.include('Payoff strength', plan.quality);
  for (const member of plan.members) {
    trace.include(member.name, memberNode(plan, member));
  }
  const ref = storylinePayoffTraceRef(storylineId);
  ctx.recordTrace(ref, ctx.date, trace.choose(plan.outcome.value, outcomeReason(plan)), {
    summaryOnly: !keepsFullStorylineTraces(ctx.read, plan.promotionId),
  });
  ctx.tx.update('storylines', storylineId, { payoff: payoffRecord(plan, ctx, refKey(ref)) });
  ctx.publish('storyline.paidOff', {
    storylineId,
    promotionId: plan.promotionId,
    paid: plan.eligible,
    memberCount,
    quality: plan.eligible ? plan.quality.value : 0,
  });
}

export const payOffOnEndSubscription: SubscriptionSpec<'storyline.ended'> = defineSubscription({
  id: PAY_OFF_ON_END_SUBSCRIPTION_ID,
  type: 'storyline.ended',
  handler: (event, ctx) => {
    payOffStoryline(ctx, event.payload.storylineId);
  },
});
