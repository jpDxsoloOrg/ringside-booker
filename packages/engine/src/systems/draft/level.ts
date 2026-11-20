/**
 * The level playing field of a draft start (DRF-01): one shared starting level for money, prestige
 * and popularity, taken as the median of the world's active promotions, and what is left unequal.
 *
 * Home popularity is each promotion's mean popularity over the regions of its home country; every
 * promotion then gets the median of those in every region of its own home country and none
 * elsewhere (the same shape as the Equal start reset).
 *
 * Design: docs/design/draft.md#level-playing-field.
 */

import { cents, type Cents } from '../../core/money';
import type { RegionId } from '../../core/ids';
import type { DraftLevel } from '../../model/entities/draft';
import type { Promotion } from '../../model/entities/promotion';
import type { DeepReadonly } from '../../model/world';
import type { Geography } from '../world/geography';

/** Things that still differ between promotions after the reset, for the settings preview. */
export const NOT_EQUALISED = [
  'Home region and country (who the local fans are)',
  'Production levels and policies',
  'Brands, venues and the size of the shows they keep',
  'Rival rules shortcuts: see the Level playing field setting',
] as const;

/** What the reset makes equal, for the settings preview. */
export const EQUALISED = [
  'Cash',
  'Prestige',
  'Popularity in every region of the home country (none elsewhere)',
  'TV deals: nobody has one',
  'Titles: every title starts vacant',
  'Rosters: everyone is drafted',
] as const;

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** A promotion's mean popularity over the regions of its home country. */
export function homePopularityOf(
  promotion: DeepReadonly<Pick<Promotion, 'homeRegionId' | 'regionalPop'>>,
  geography: Geography,
): number {
  const country = geography.countryOf(promotion.homeRegionId);
  const regions = geography.regionsOf(country.id);
  if (regions.length === 0) {
    return 0;
  }
  let total = 0;
  for (const region of regions) {
    total += promotion.regionalPop[region.id] ?? 0;
  }
  return total / regions.length;
}

/** The median level of these promotions. Rounded: whole cents, whole points. */
export function medianLevel(
  promotions: readonly DeepReadonly<Promotion>[],
  geography: Geography,
): DraftLevel {
  return {
    cash: cents(Math.max(0, Math.round(median(promotions.map((promotion) => promotion.cash))))),
    prestige: Math.round(median(promotions.map((promotion) => promotion.prestige))),
    homePopularity: Math.round(
      median(promotions.map((promotion) => homePopularityOf(promotion, geography))),
    ),
  };
}

/** The `regionalPop` a promotion gets under `level`. */
export function levelledPopularity(
  homeRegionId: RegionId,
  level: DraftLevel,
  geography: Geography,
): Record<RegionId, number> {
  const regionalPop: Record<RegionId, number> = {};
  if (level.homePopularity > 0) {
    for (const region of geography.regionsOf(geography.countryOf(homeRegionId).id)) {
      regionalPop[region.id] = level.homePopularity;
    }
  }
  return regionalPop;
}

/** The fields the level writes on a promotion. */
export function levelledFields(
  promotion: DeepReadonly<Pick<Promotion, 'homeRegionId'>>,
  level: DraftLevel,
  geography: Geography,
): { cash: Cents; prestige: number; regionalPop: Record<RegionId, number> } {
  return {
    cash: level.cash,
    prestige: level.prestige,
    regionalPop: levelledPopularity(promotion.homeRegionId, level, geography),
  };
}
