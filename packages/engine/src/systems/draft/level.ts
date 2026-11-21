/**
 * The level playing field of a draft start (DRF-01): one shared starting level for money, prestige
 * and popularity, taken as the median of the world's active promotions, and what is left unequal.
 *
 * Home popularity is each promotion's mean popularity over the regions of its home country; every
 * promotion then gets the median of those in every region of its own home country and none
 * elsewhere (the same shape as the Equal start reset). Every production area starts at the lowest
 * level (DRF-09), so the shared cash is not eaten by production the old world paid for; the player
 * raises levels in Production and rivals through the rival production budget.
 *
 * Design: docs/design/draft.md#level-playing-field.
 */

import { cents, type Cents } from '../../core/money';
import type { RegionId } from '../../core/ids';
import type { DraftLevel } from '../../model/entities/draft';
import {
  PRODUCTION_LEVEL_MIN,
  type Production,
  type Promotion,
} from '../../model/entities/promotion';
import type { DeepReadonly } from '../../model/world';
import type { Geography } from '../world/geography';

/** Things that still differ between promotions after the reset, for the settings preview. */
export const NOT_EQUALISED = [
  'Home region and country (who the local fans are)',
  'Staff policies (catering, travel, medical)',
  'Brands, venues and the size of the shows they keep',
  'Rival rules shortcuts: see the Level playing field setting',
] as const;

/** What the reset makes equal, for the settings preview. */
export const EQUALISED = [
  'Cash',
  'Prestige',
  'Popularity in every region of the home country (none elsewhere)',
  'TV deals: nobody has one',
  'Production: every area starts at the lowest level',
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
): {
  cash: Cents;
  prestige: number;
  regionalPop: Record<RegionId, number>;
  production: Production;
} {
  return {
    cash: level.cash,
    prestige: level.prestige,
    regionalPop: levelledPopularity(promotion.homeRegionId, level, geography),
    production: lowestProduction(),
  };
}

/** Every production area at the lowest level: where a draft start begins (DRF-09). */
export function lowestProduction(): Production {
  const level = PRODUCTION_LEVEL_MIN;
  return {
    stage: level,
    camera: level,
    editing: level,
    pyro: level,
    music: level,
    writing: level,
    marketing: level,
    backOffice: level,
  };
}
