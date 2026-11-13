/**
 * Rival desk profiles: finding and creating the one `aiProfiles` row of a unit.
 *
 * `ensureProfile` is self-healing: the new-game step (`setup.ts`) gives every computer unit its
 * row, and the turn runner (AIP1-03) calls it again on every turn, so a promotion founded later
 * and a save made before the rival desk existed get a profile on their first turn. See
 * docs/design/rival-desk.md#profiles.
 */

import type { GameDate } from '../../core/date';
import type { BrandId, PromotionId } from '../../core/ids';
import { aiUnitKey, type AiProfile } from '../../model/entities/ai-profile';
import type { GameTables, GameWorldView } from '../../model/tables';
import type { Tx } from '../../model/tx';
import type { DeepReadonly } from '../../model/world';
import type { AiUnit } from './units';

/** The unit's profile, or null when it has none yet. Read-only, for queries. */
export function profileOf(
  read: GameWorldView,
  promotionId: PromotionId,
  brandId: BrandId | null,
): DeepReadonly<AiProfile> | null {
  return read.tables.aiProfiles.lookupOne('byUnit', aiUnitKey(promotionId, brandId)) ?? null;
}

/**
 * The unit's profile, created on `date` with no taste, no featured workers and no turn yet when
 * the unit has none. Calling it again returns the same row.
 */
export function ensureProfile(
  tx: Tx<GameTables>,
  read: GameWorldView,
  unit: Pick<AiUnit, 'promotionId' | 'brandId'>,
  date: GameDate,
): DeepReadonly<AiProfile> {
  const existing = profileOf(read, unit.promotionId, unit.brandId);
  if (existing !== null) {
    return existing;
  }
  return tx.create('aiProfiles', {
    promotionId: unit.promotionId,
    brandId: unit.brandId,
    taste: null,
    featured: null,
    createdOn: date,
    lastTurnOn: null,
  });
}
