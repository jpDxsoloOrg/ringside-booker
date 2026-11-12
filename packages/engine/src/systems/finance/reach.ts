/**
 * A promotion's reach and size, read straight from the world.
 *
 * Nothing is cached or stored: reach is worked out on every read from the promotion's regional
 * popularity, so a popularity change (EVT5) shows up in the next read. It is one roll-up and two
 * small formulas, cheap enough to run per query.
 *
 * Design: docs/design/finances.md#reach-and-size.
 */

import { EntityNotFoundError } from '../../core/errors';
import type { PromotionId } from '../../core/ids';
import type { Traced } from '../../core/trace';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';
import { popularityRollup } from '../world/formulas/popularityRollup';
import { geographyOf } from '../world/geography';
import { promotionReach } from './formulas/promotionReach';
import { promotionSize, type PromotionSize } from './formulas/promotionSize';

/** A promotion's reach (0 to 100, exact) and the size label read off it, both traced. */
export interface PromotionReach {
  readonly reach: Traced<number>;
  readonly size: Traced<PromotionSize>;
}

/**
 * The reach and size of one promotion: its home region, country and continent from the map, its
 * popularity rolled up once through WRK1's roll-up, then the two formulas.
 *
 * @throws EntityNotFoundError when there is no promotion with this ID.
 */
export function reachOf(
  read: GameWorldView,
  promotionId: PromotionId,
  tunables: EngineTunables,
): PromotionReach {
  const promotion = read.tables.promotions.get(promotionId);
  if (promotion === undefined) {
    throw new EntityNotFoundError('promotion', promotionId);
  }
  const geography = geographyOf(read);
  const region = geography.region(promotion.homeRegionId);
  const country = geography.countryOf(region.id);
  const continent = geography.continentOf(region.id);
  const rollup = popularityRollup(promotion.regionalPop, geography);
  const homeCountry = rollup.countries.get(country.id);
  const homeContinent = rollup.continents.get(continent.id);
  if (homeCountry === undefined || homeContinent === undefined) {
    // The roll-up lists every country and continent on the map, so this cannot happen.
    throw new EntityNotFoundError('country', country.id);
  }
  const deps = { tunables };
  const reach = promotionReach(
    {
      homeRegion: rollup.regions.get(region.id) ?? 0,
      homeCountry,
      homeContinent,
      world: rollup.world,
      homeRegionName: region.name,
      homeCountryName: country.name,
      homeContinentName: continent.name,
    },
    deps,
  );
  return { reach, size: promotionSize(reach, deps) };
}
