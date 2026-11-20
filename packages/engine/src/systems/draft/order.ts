/**
 * The pick order (DRF-01): who is on the clock at each turn.
 *
 * The draft row keeps round one's order and a turn counter. Turn `t` is round `floor(t / n)`, slot
 * `t % n` of that round's order, `n` promotions:
 *
 * - `snake`: round one's order (seeded random at new game), reversed every other round;
 * - `random`: a new seeded order every round (stream `draft.order`, one detached stream per
 *   round, so the order never depends on how the picks were split across commands);
 * - `bySize`: round one's order (smallest promotion first) every round.
 *
 * A promotion that needs nobody more is skipped. Pure and cheap: no world writes.
 *
 * Design: docs/design/draft.md#pick-order.
 */

import type { PromotionId } from '../../core/ids';
import { detachedStream } from '../../core/rng/registry';
import { shuffle } from '../../core/rng/odds';
import type { Draft } from '../../model/entities/draft';
import type { DeepReadonly } from '../../model/world';

declare module '../../core/rng/streams' {
  interface StreamNames {
    /** The draft's pick orders: round one at new game, and every round of a random order. */
    'draft.order': true;
  }
}

export const DRAFT_ORDER_STREAM = 'draft.order';

/** Round one's order from the promotions, sorted by id: a seeded shuffle. */
export function seededOrder(
  seed: string,
  key: string,
  promotionIds: readonly PromotionId[],
): PromotionId[] {
  return shuffle(detachedStream(seed, DRAFT_ORDER_STREAM, key), promotionIds);
}

/** The order of round `round` (0-based). */
export function roundOrder(
  draft: DeepReadonly<Pick<Draft, 'id' | 'order' | 'settings'>>,
  round: number,
  seed: string,
): readonly PromotionId[] {
  const base = draft.order;
  switch (draft.settings.order) {
    case 'snake':
      return round % 2 === 1 ? [...base].reverse() : base;
    case 'random':
      return round === 0 ? base : seededOrder(seed, `${draft.id}|round-${String(round)}`, base);
    case 'bySize':
      return base;
  }
}

export interface Turn {
  /** The turn counter. */
  readonly turn: number;
  /** 0-based. */
  readonly round: number;
  readonly promotionId: PromotionId;
}

/**
 * The next turn at or after `fromTurn` whose promotion `needs` someone, or null when nobody needs
 * anyone (the draft is complete). Round orders are worked out once per round through `orders`.
 */
export function nextTurn(
  draft: DeepReadonly<Pick<Draft, 'id' | 'order' | 'settings'>>,
  fromTurn: number,
  seed: string,
  needs: (promotionId: PromotionId) => boolean,
  orders = new Map<number, readonly PromotionId[]>(),
): Turn | null {
  const count = draft.order.length;
  if (!draft.order.some((promotionId) => needs(promotionId))) {
    return null;
  }
  for (let turn = fromTurn; ; turn += 1) {
    const round = Math.floor(turn / count);
    let order = orders.get(round);
    if (order === undefined) {
      order = roundOrder(draft, round, seed);
      orders.set(round, order);
    }
    const promotionId = order[turn % count];
    if (promotionId !== undefined && needs(promotionId)) {
      return { turn, round, promotionId };
    }
  }
}
