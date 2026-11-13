/**
 * The contracts system's commands (ECO4-02).
 *
 * - `contracts.release { employmentId, expectedSeverance }` lets one of the player's workers go,
 *   paying the severance the preview showed (`contracts.releasePreview`). If the amount changed
 *   since the preview (the day moved on), it is refused with `severanceChanged` so the screen can
 *   ask again. An active contract becomes `released`; a signed deal that has not started becomes
 *   `withdrawn`.
 * - `contracts.acknowledgeExpiries { employmentIds | 'all' }` marks the player's "expiring soon"
 *   notices as seen, so the `contracts.expiringSoon` gate lets the day move again.
 *
 * Only a human who runs the contract's promotion may issue them. Rivals' releases go through
 * `releaseEmployment` directly (ECO9). Design: docs/design/contracts.md#severance and
 * #expiring-soon.
 */

import { z } from 'zod';
import { defineCommand } from '../../core/api/command';
import { controllerViewer, viewerPromotionIds, type Controller } from '../../core/api/controller';
import type { Reason } from '../../core/api/result';
import type { EmploymentId, PromotionId } from '../../core/ids';
import type { TraceRef } from '../../core/trace/store';
import { UNSEEN_EXPIRY_KEY } from '../../model/entities/contract-concern';
import { zId } from '../../model/primitives';
import type { GameWorldView } from '../../model/tables';
import { moneyText } from '../production';
import { RELEASE_REASON_KEY, releaseEmployment, releaseSeverance } from './release';
import { releaseRefusals } from './rules';

export interface ReleaseResult {
  /** The severance paid, in whole cents. */
  severance: number;
  /** The promotion's cash after paying it, in cents. */
  cashAfter: number;
  /** The severance ledger row's Why?, or null when nothing was paid. */
  ledgerTraceRef: TraceRef | null;
}

declare module '../../core/api/maps' {
  interface CommandMap {
    'contracts.release': {
      args: { employmentId: EmploymentId; expectedSeverance: number };
      result: ReleaseResult;
    };
    'contracts.acknowledgeExpiries': {
      args: { employmentIds: EmploymentId[] | 'all' };
      result: null;
    };
  }
}

/** The most notices one call may mark as seen by id. */
export const ACKNOWLEDGE_MAX_EXPIRIES = 200;

/** The promotions `issuedBy` runs as a human. */
export function issuerPromotionIds(read: GameWorldView, issuedBy: Controller): PromotionId[] {
  return viewerPromotionIds(read, controllerViewer(issuedBy));
}

export const releaseCommand = defineCommand('contracts.release', {
  args: z.strictObject({
    employmentId: zId('employment'),
    expectedSeverance: z.number().int().min(0),
  }),
  validate: (read, args, issuedBy, env) => {
    const refusals = releaseRefusals(read, args.employmentId, issuerPromotionIds(read, issuedBy));
    if (refusals.length > 0) {
      return refusals;
    }
    const fresh = releaseSeverance(
      { read, date: read.meta.currentDate, tunables: env.tunables },
      args.employmentId,
    );
    if (fresh.value !== args.expectedSeverance) {
      return [
        {
          code: 'severanceChanged',
          message: `The amount changed to ${moneyText(fresh.value)}; check it again.`,
          field: 'expectedSeverance',
          subject: { kind: 'employment', id: args.employmentId },
        },
      ];
    }
    return [];
  },
  apply: (ctx, args) => {
    const employment = ctx.read.tables.employments.require(args.employmentId);
    const released = releaseEmployment(ctx, {
      employmentId: args.employmentId,
      source: 'player',
      reasonKey: RELEASE_REASON_KEY,
    });
    const promotion = ctx.read.tables.promotions.require(employment.promotionId);
    return {
      severance: released.severance,
      cashAfter: promotion.cash,
      ledgerTraceRef: released.ledgerTraceRef,
    };
  },
});

export const acknowledgeExpiriesCommand = defineCommand('contracts.acknowledgeExpiries', {
  args: z.strictObject({
    employmentIds: z.union([
      z.literal('all'),
      z.array(zId('employment')).min(1).max(ACKNOWLEDGE_MAX_EXPIRIES),
    ]),
  }),
  validate: (read, args, issuedBy) => {
    const own = issuerPromotionIds(read, issuedBy);
    if (own.length === 0) {
      return [{ code: 'notYourWorker', message: 'You do not run a promotion in this game.' }];
    }
    if (args.employmentIds === 'all') {
      return [];
    }
    const reasons: Reason[] = [];
    for (const id of args.employmentIds) {
      const employment = read.tables.employments.get(id);
      if (employment === undefined) {
        reasons.push({
          code: 'unknownContract',
          message: 'That contract is not in this game any more. Refresh the page and try again.',
        });
      } else if (!own.includes(employment.promotionId)) {
        reasons.push({
          code: 'notYourWorker',
          message: `${employment.ringName} does not work for you, so this notice is not yours to mark as seen.`,
          subject: { kind: 'employment', id },
        });
      }
    }
    return reasons;
  },
  apply: (ctx, args, issuedBy) => {
    const own = new Set(issuerPromotionIds(ctx.read, issuedBy));
    const wanted = args.employmentIds === 'all' ? null : new Set(args.employmentIds);
    for (const concern of ctx.read.tables.contractConcerns.lookup(
      'unseenExpiry',
      UNSEEN_EXPIRY_KEY,
    )) {
      if (!own.has(concern.promotionId) || concern.expiryNotice === null) {
        continue;
      }
      if (wanted !== null && !wanted.has(concern.employmentId)) {
        continue;
      }
      ctx.tx.update('contractConcerns', concern.id, {
        expiryNotice: { raisedOn: concern.expiryNotice.raisedOn, seenOn: ctx.date },
      });
    }
    return null;
  },
});

export const contractsCommands = [releaseCommand, acknowledgeExpiriesCommand] as const;
