/**
 * The rules the release preview and the release command share, so the preview refuses exactly what
 * the command would.
 *
 * Design: docs/design/contracts.md#severance and #scoping.
 */

import type { Reason } from '../../core/api/result';
import type { EmploymentId, PromotionId } from '../../core/ids';
import type { GameWorldView } from '../../model/tables';

/** The refusal codes of `contracts.release` and `contracts.releasePreview`. */
export const RELEASE_REASON_CODES = [
  'unknownContract',
  'notYourWorker',
  'notReleasable',
  'isOwner',
  'severanceChanged',
] as const;
export type ReleaseReasonCode = (typeof RELEASE_REASON_CODES)[number];

/**
 * Why `employmentId` cannot be released by someone running `own`, or `[]`. Rival contracts get
 * only `notYourWorker`, so a refusal never tells the player anything private about them.
 */
export function releaseRefusals(
  read: GameWorldView,
  employmentId: EmploymentId,
  own: readonly PromotionId[],
): Reason[] {
  const employment = read.tables.employments.get(employmentId);
  if (employment === undefined) {
    return [
      {
        code: 'unknownContract',
        message: 'That contract is not in this game any more. Refresh the page and try again.',
      },
    ];
  }
  const subject = { kind: 'employment' as const, id: employment.id };
  if (!own.includes(employment.promotionId)) {
    return [
      {
        code: 'notYourWorker',
        message: `${employment.ringName} does not work for you, so you cannot release them.`,
        subject,
      },
    ];
  }
  const reasons: Reason[] = [];
  if (employment.status !== 'active' && employment.status !== 'signed') {
    reasons.push({
      code: 'notReleasable',
      message: `${employment.ringName}'s contract has already ended.`,
      subject,
    });
  }
  const promotion = read.tables.promotions.get(employment.promotionId);
  if (promotion?.ownerPersonId === employment.personId) {
    reasons.push({
      code: 'isOwner',
      message: `${employment.ringName} owns the promotion, so they cannot be released.`,
      subject,
    });
  }
  return reasons;
}
