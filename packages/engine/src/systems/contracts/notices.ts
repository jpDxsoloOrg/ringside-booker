/**
 * Expiry notices (ECO4-02): "this contract of yours runs out soon".
 *
 * After each day's lifecycle (an `afterLifecycle` hook, so renewals have already moved end dates),
 * every active contract of a promotion the player runs that ends within `contracts.expiringSoon.days`
 * days, for a worker pushed at `contracts.expiringSoon.minPush` or higher, gets a notice on its
 * concern row: `{ raisedOn: today, seenOn: null }`. A contract keeps its notice until it ends
 * (`endEmployment` clears it) or its end date moves out of the window (a renewal), which clears it
 * here. With `contracts.expiringSoon.stopSkip` off a new notice is written as already seen, so the
 * Contracts screen still lists it but nothing stops the day.
 *
 * The gate `contracts.expiringSoon` (`gates.ts`) cannot read tunables, so the decision is made here
 * and the gate only reads the `unseenExpiry` index. Rival contracts never get notices.
 *
 * Design: docs/design/contracts.md#expiring-soon.
 */

import { diffDays } from '../../core/date';
import type { PromotionId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import { isEmptyConcern, type ContractConcern } from '../../model/entities/contract-concern';
import { promotionStatusKey, type Employment } from '../../model/entities/employment';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { isPushAtOrAbove } from './formulas/aiRenewalDecision';
import { registerAfterLifecycle, type AfterLifecycleHook } from './lifecycle';

export const EXPIRY_NOTICES_HOOK_ID = 'contracts.expiryNotices';

/** The promotions a human runs, in id order. */
export function humanPromotionIds(read: GameWorldView): PromotionId[] {
  return read.tables.promotions
    .values()
    .filter((promotion) => promotion.controller.kind === 'human')
    .map((promotion) => promotion.id);
}

/** True while the contract is active and ends within `days` days of `ctx.date`. */
function inWindow(
  ctx: PhaseContext,
  employment: DeepReadonly<Employment> | undefined,
  days: number,
): boolean {
  return (
    employment?.status === 'active' &&
    employment.endsOn !== null &&
    diffDays(ctx.date, employment.endsOn) <= days
  );
}

function clearNotice(ctx: PhaseContext, concern: DeepReadonly<ContractConcern>): void {
  if (isEmptyConcern({ ...concern, expiryNotice: null })) {
    ctx.tx.delete('contractConcerns', concern.id);
  } else {
    ctx.tx.update('contractConcerns', concern.id, { expiryNotice: null });
  }
}

/** Raises and clears the day's expiry notices. Idempotent within a day. */
export function raiseExpiryNotices(ctx: PhaseContext): void {
  const days = ctx.tunables.get('contracts.expiringSoon.days');
  const minPush = ctx.tunables.get('contracts.expiringSoon.minPush');
  const stopSkip = ctx.tunables.get('contracts.expiringSoon.stopSkip');
  for (const promotionId of humanPromotionIds(ctx.read)) {
    // Notices whose contract has moved out of the window (renewed) go.
    for (const concern of ctx.read.tables.contractConcerns.lookup('byPromotion', promotionId)) {
      if (concern.expiryNotice === null) {
        continue;
      }
      const employment = ctx.read.tables.employments.get(concern.employmentId);
      if (days === 0 || !inWindow(ctx, employment, days)) {
        clearNotice(ctx, concern);
      }
    }
    if (days === 0) {
      continue;
    }
    const active = ctx.read.tables.employments.lookup(
      'byPromotionStatus',
      promotionStatusKey(promotionId, 'active'),
    );
    for (const employment of active) {
      if (!inWindow(ctx, employment, days) || !isPushAtOrAbove(employment.push, minPush)) {
        continue;
      }
      const notice = { raisedOn: ctx.date, seenOn: stopSkip ? null : ctx.date };
      const concern = ctx.read.tables.contractConcerns.lookupOne('byEmployment', employment.id);
      if (concern === undefined) {
        ctx.tx.insert('contractConcerns', {
          id: ctx.tx.mintId('contractConcerns'),
          employmentId: employment.id,
          personId: employment.personId,
          promotionId: employment.promotionId,
          expiryNotice: notice,
          unhappy: null,
          request: null,
          ending: null,
        });
      } else if (concern.expiryNotice === null) {
        ctx.tx.update('contractConcerns', concern.id, { expiryNotice: notice });
      }
    }
  }
}

export const expiryNoticesHook: AfterLifecycleHook = {
  id: EXPIRY_NOTICES_HOOK_ID,
  order: 10,
  run: raiseExpiryNotices,
};

registerAfterLifecycle(expiryNoticesHook);
