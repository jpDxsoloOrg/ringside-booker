/**
 * The finance system's commands.
 *
 * `finance.setPolicy` sets one of a promotion's three staff policies (travel, catering, medical) to
 * a level from 0 (None) to 3 (Premium). Only the controller that runs the promotion may do it. The
 * next costs follow the new level: travel and catering from the next show, medical from the next
 * 1st of the month. ECO1 owns the money side only; what a policy does to injuries or morale belongs
 * to other features, which describe it through `registerPolicyEffect`.
 *
 * Design: docs/design/finances.md#policies.
 */

import { z } from 'zod';
import { defineCommand } from '../../core/api/command';
import { controlsPromotion } from '../../core/api/controller';
import type { Reason } from '../../core/api/result';
import { EntityNotFoundError } from '../../core/errors';
import type { PromotionId } from '../../core/ids';
import type { StepContext } from '../../core/pipeline/context';
import { POLICY_AREAS, type PolicyArea } from '../../model/entities/promotion';
import { zId } from '../../model/primitives';
import { POLICY_AREA_LABELS, POLICY_LEVEL_LABELS, type PolicyLevel } from './policies';

/** What `finance.setPolicy` changed. */
export interface SetPolicyResult {
  area: PolicyArea;
  from: PolicyLevel;
  to: PolicyLevel;
}

export interface SetPolicyArgs {
  promotionId: PromotionId;
  area: PolicyArea;
  level: PolicyLevel;
}

declare module '../../core/api/maps' {
  interface CommandMap {
    'finance.setPolicy': { args: SetPolicyArgs; result: SetPolicyResult };
  }
}

/** The reason codes `finance.setPolicy` can refuse with. */
export const SET_POLICY_REASON_CODES = [
  'notFound',
  'promotionClosed',
  'notYourPromotion',
  'samePolicy',
] as const;
export type SetPolicyReasonCode = (typeof SET_POLICY_REASON_CODES)[number];

/**
 * Sets the promotion's `area` policy to `level` and publishes `finance.policyChanged`. No
 * controller check: the command checks that, and the rival AI (AIP8) calls this directly. Returns
 * what changed; a level equal to the current one writes nothing and publishes nothing.
 */
export function setPolicyIn(
  ctx: StepContext,
  promotionId: PromotionId,
  area: PolicyArea,
  level: PolicyLevel,
): SetPolicyResult {
  const promotion = ctx.read.tables.promotions.get(promotionId);
  if (promotion === undefined) {
    throw new EntityNotFoundError('promotion', promotionId);
  }
  const from = promotion.policies[area];
  if (from === level) {
    return { area, from, to: level };
  }
  ctx.tx.update('promotions', promotionId, (previous) => ({
    ...previous,
    policies: { ...previous.policies, [area]: level },
  }));
  ctx.publish('finance.policyChanged', { promotionId, area, from, to: level });
  ctx.log(
    `${promotion.name}: ${POLICY_AREA_LABELS[area]} from ${POLICY_LEVEL_LABELS[from]} to ${POLICY_LEVEL_LABELS[level]}`,
  );
  return { area, from, to: level };
}

function refusal(code: SetPolicyReasonCode, message: string, promotionId: PromotionId): Reason[] {
  return [{ code, message, subject: { kind: 'promotion', id: promotionId } }];
}

export const setPolicyCommand = defineCommand('finance.setPolicy', {
  args: z.strictObject({
    promotionId: zId('promotion'),
    area: z.enum(POLICY_AREAS),
    level: z.literal([0, 1, 2, 3]),
  }),
  validate: (read, args, issuedBy) => {
    const promotion = read.tables.promotions.get(args.promotionId);
    if (promotion === undefined) {
      return [{ code: 'notFound', message: 'There is no such promotion', field: 'promotionId' }];
    }
    if (promotion.status === 'closed') {
      return refusal('promotionClosed', `${promotion.name} has closed`, promotion.id);
    }
    if (!controlsPromotion(read, promotion.id, issuedBy)) {
      return refusal(
        'notYourPromotion',
        "Only the promotion's own management can change its policies",
        promotion.id,
      );
    }
    if (promotion.policies[args.area] === args.level) {
      return refusal(
        'samePolicy',
        `${POLICY_AREA_LABELS[args.area]} is already ${POLICY_LEVEL_LABELS[args.level]}`,
        promotion.id,
      );
    }
    return [];
  },
  apply: (ctx, args) => setPolicyIn(ctx, args.promotionId, args.area, args.level),
});

export const financeCommands = [setPolicyCommand] as const;
