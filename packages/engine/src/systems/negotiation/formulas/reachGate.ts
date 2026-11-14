/**
 * The reach gate on contract terms (ECO5-01): written and exclusive contracts need a promotion
 * whose name carries far enough. Reach is ECO1's `promotionReach`, read from the world through
 * `reachOf`; the thresholds are `contracts.kind.writtenMinReach` and
 * `contracts.kind.exclusiveMinReach` (0 lets anyone offer them).
 *
 * Design: docs/design/negotiation.md#offer-kinds.
 */

import type { Reason } from '../../../core/api/result';
import type { PromotionId } from '../../../core/ids';
import type { GameWorldView } from '../../../model/tables';
import { reachOf } from '../../finance/reach';
import type { EngineTunables } from '../../tunables';

export const OFFER_KINDS_DOC_REF = 'negotiation.md#offer-kinds';

/** The reason code when a promotion's reach is below a term's threshold. */
export const REACH_TOO_LOW = 'reachTooLow';

type ReachGateKey = 'contracts.kind.writtenMinReach' | 'contracts.kind.exclusiveMinReach';

/**
 * Why this promotion's reach is too low for a term, or an empty list when it is not. `what` names
 * the term for the player, for example "Written contracts". Reach is shown rounded down, so a
 * promotion at 34.6 never reads "need 35; yours is 35".
 */
export function reachShortfall(
  read: GameWorldView,
  promotionId: PromotionId,
  tunables: EngineTunables,
  key: ReachGateKey,
  what: string,
): Reason[] {
  const needed = tunables.get(key);
  if (needed <= 0) {
    return [];
  }
  const reach = reachOf(read, promotionId, tunables).reach.value;
  if (reach >= needed) {
    return [];
  }
  return [
    {
      code: REACH_TOO_LOW,
      message: `${what} need a reach of ${String(needed)}; yours is ${String(Math.floor(reach))}`,
      subject: { kind: 'promotion', id: promotionId },
    },
  ];
}

/** Why this promotion may not offer written contracts, or an empty list. */
export function writtenContractShortfall(
  read: GameWorldView,
  promotionId: PromotionId,
  tunables: EngineTunables,
): Reason[] {
  return reachShortfall(
    read,
    promotionId,
    tunables,
    'contracts.kind.writtenMinReach',
    'Written contracts',
  );
}

/** Why this promotion may not offer exclusive contracts, or an empty list. */
export function exclusiveContractShortfall(
  read: GameWorldView,
  promotionId: PromotionId,
  tunables: EngineTunables,
): Reason[] {
  return reachShortfall(
    read,
    promotionId,
    tunables,
    'contracts.kind.exclusiveMinReach',
    'Exclusive contracts',
  );
}
