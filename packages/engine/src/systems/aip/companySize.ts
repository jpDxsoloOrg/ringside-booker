/**
 * Company size on the Promotions screens (AIP1-07): ECO1's public size band, read through one
 * small source so `promotions.list` carries `size` only while ECO1 supplies it.
 *
 * ECO1 is on main, so this module registers ECO1's `reachOf` as the source on import. The size is
 * public (it is built from popularity, which everyone sees) and never carries cash. A test that
 * removes the source sees `size: null` on every row, as a game without ECO1 would.
 *
 * Design: docs/design/rival-desk.md#promotions-queries, docs/design/finances.md#reach-and-size.
 */

import type { PromotionId } from '../../core/ids';
import type { GameWorldView } from '../../model/tables';
import { PROMOTION_SIZE_LABELS } from '../finance/formulas/promotionSize';
import { reachOf } from '../finance/reach';
import type { EngineTunables } from '../tunables';

/** A promotion's size as the Promotions table shows it. */
export interface CompanySize {
  /** "Local" to "Global". */
  label: string;
  /** 0 to 100, exact; screens round it. */
  reach: number;
}

/** Answers a promotion's size. */
export type CompanySizeSource = (
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
) => CompanySize;

/** ECO1's size: the band label read off reach. */
export const eco1CompanySize: CompanySizeSource = (read, tunables, promotionId) => {
  const { reach, size } = reachOf(read, promotionId, tunables);
  return { label: PROMOTION_SIZE_LABELS[size.value], reach: reach.value };
};

let source: CompanySizeSource | null = null;

/**
 * Sets the size source. Returns a function that puts the previous one back (for tests).
 */
export function setCompanySizeSource(next: CompanySizeSource | null): () => void {
  const previous = source;
  source = next;
  return () => {
    source = previous;
  };
}

/** The promotion's size, or null when no feature supplies one. */
export function companySizeOf(
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
): CompanySize | null {
  return source === null ? null : source(read, tunables, promotionId);
}

setCompanySizeSource(eco1CompanySize);
