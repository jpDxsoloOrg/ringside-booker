/**
 * A promotion's headline popularity read from the world (DAY2-02): the traced figure behind the
 * top bar and the Office, the fast untraced figure for snapshots and list rows, and the recorder
 * that keeps the stored Why? current.
 *
 * Use these when you want "a promotion's popularity" as one number (AIP1, DAY4, BRW). Both read
 * `office.popularity.headlineScope`, so they always agree with the top bar. For how far a company's
 * name carries (its size), use ECO1's `reachOf` instead.
 *
 * Design: docs/design/office.md#headline-popularity.
 */

import type { GameDate } from '../../core/date';
import { EntityNotFoundError } from '../../core/errors';
import type { PromotionId } from '../../core/ids';
import type { StepContext } from '../../core/pipeline/context';
import type { Traced } from '../../core/trace';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';
import {
  createPopularityRoller,
  popularityRollupPart,
  type PopularityRoller,
} from '../world/formulas/popularityRollup';
import { geographyOf, type Geography } from '../world/geography';
import { headlinePopularity, POPULARITY_MAX, POPULARITY_MIN } from './formulas/headlinePopularity';
import { popularityTraceSectionLines } from './popularityTraceSections';
import { popularityTraceRef } from './traces';

/** The map and its popularity roller, worked out once and shared by every promotion of a run. */
export interface OfficeRoller {
  readonly geography: Geography;
  readonly popularity: PopularityRoller;
}

/** Builds the roller for one run over many promotions. Call it once per run, not per promotion. */
export function createOfficeRoller(read: GameWorldView): OfficeRoller {
  const geography = geographyOf(read);
  return { geography, popularity: createPopularityRoller(geography) };
}

function requirePromotion(read: GameWorldView, promotionId: PromotionId) {
  const promotion = read.tables.promotions.get(promotionId);
  if (promotion === undefined) {
    throw new EntityNotFoundError('promotion', promotionId);
  }
  return promotion;
}

/**
 * The traced headline popularity of `promotionId` on `date` (today by default): one WRK1 roll-up,
 * the chosen level as the main line, the worldwide and home-region notes, then the lines of every
 * registered trace section.
 *
 * @throws EntityNotFoundError when there is no promotion with this ID.
 */
export function headlinePopularityOf(
  read: GameWorldView,
  promotionId: PromotionId,
  tunables: EngineTunables,
  date: GameDate = read.meta.currentDate,
): Traced<number> {
  const promotion = requirePromotion(read, promotionId);
  const geography = geographyOf(read);
  const region = geography.region(promotion.homeRegionId);
  const country = geography.countryOf(region.id);
  const continent = geography.continentOf(region.id);
  const rollup = popularityRollupPart(promotion.regionalPop, geography, {
    countryId: country.id,
    continentId: continent.id,
  });
  return headlinePopularity(
    {
      promotionName: promotion.name,
      homeRegion: { id: region.id, name: region.name, value: rollup.regions.get(region.id) ?? 0 },
      homeCountry: { id: country.id, name: country.name, rollup: rollup.country },
      homeContinent: { id: continent.id, name: continent.name, rollup: rollup.continent },
      world: rollup.world,
      sectionLines: popularityTraceSectionLines(read, promotionId, date),
    },
    { tunables },
  );
}

/**
 * The same figure as {@link headlinePopularityOf} with no trace, from the roller's precomputed
 * population shares: what snapshots and list rows use. Equal to the traced value within 1e-9.
 *
 * @throws EntityNotFoundError when there is no promotion with this ID.
 */
export function headlinePopularityValue(
  read: GameWorldView,
  promotionId: PromotionId,
  tunables: EngineTunables,
  roller: OfficeRoller,
): number {
  const promotion = requirePromotion(read, promotionId);
  const scope = tunables.get('office.popularity.headlineScope');
  let value: number;
  if (scope === 'homeRegion') {
    value = promotion.regionalPop[promotion.homeRegionId] ?? 0;
  } else {
    const rolled = roller.popularity.rollValues(promotion.regionalPop);
    if (scope === 'world') {
      value = rolled.world;
    } else if (scope === 'homeCountry') {
      value = rolled.countries[roller.geography.countryOf(promotion.homeRegionId).id] ?? 0;
    } else {
      value = rolled.continents[roller.geography.continentOf(promotion.homeRegionId).id] ?? 0;
    }
  }
  return Math.min(POPULARITY_MAX, Math.max(POPULARITY_MIN, value));
}

/** Records (replacing) the headline popularity Why? of `promotionId` for today. */
export function recordHeadlinePopularity(
  ctx: Pick<StepContext, 'read' | 'date' | 'tunables' | 'recordTrace'>,
  promotionId: PromotionId,
): void {
  ctx.recordTrace(
    popularityTraceRef(promotionId),
    ctx.date,
    headlinePopularityOf(ctx.read, promotionId, ctx.tunables, ctx.date),
  );
}

/** Records the headline popularity Why? of every active promotion, in id order. Returns how many. */
export function recordAllHeadlinePopularity(
  ctx: Pick<StepContext, 'read' | 'date' | 'tunables' | 'recordTrace'>,
): number {
  let recorded = 0;
  for (const promotion of ctx.read.tables.promotions.values()) {
    if (promotion.status !== 'active') {
      continue;
    }
    recordHeadlinePopularity(ctx, promotion.id);
    recorded += 1;
  }
  return recorded;
}
