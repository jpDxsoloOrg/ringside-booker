/**
 * What the Promotions queries share: who runs a promotion as the viewer sees it, the refusal for
 * an unknown promotion or brand, the roster counts and the champions list.
 *
 * Design: docs/design/rival-desk.md#promotions-queries.
 */

import type { Viewer } from '../../../core/api/controller';
import { refuseQuery } from '../../../core/api/result';
import type { GameDate } from '../../../core/date';
import type { BrandId, CountryId, PromotionId, RegionId, TitleId } from '../../../core/ids';
import type { Controller } from '../../../model/controller';
import type { Brand } from '../../../model/entities/brand';
import type { EmploymentRole } from '../../../model/entities/employment';
import type { Promotion } from '../../../model/entities/promotion';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import type { Traced } from '../../../core/trace';
import { InvalidArgumentError } from '../../../core/errors';
import type { Geography } from '../../world/geography';
import type { PopularityRollup } from '../../world/formulas/popularityRollup';
import { holderNamesOf, openReignOf, unitRoster, unitTitles, type RosterUnit } from '../inputs';

/** Who runs a promotion or brand, as the viewer sees it. */
export type ControlledBy = 'you' | 'computer' | 'otherPlayer';

/** `you` when the viewer is that human, `otherPlayer` for any other human, else `computer`. */
export function controlledByOf(viewer: Viewer, controller: DeepReadonly<Controller>): ControlledBy {
  if (controller.kind === 'computer') {
    return 'computer';
  }
  return viewer.kind === 'controller' &&
    viewer.controller.kind === 'human' &&
    viewer.controller.playerId === controller.playerId
    ? 'you'
    : 'otherPlayer';
}

/** The player's display name for a human controller, else null. */
export function controllerNameOf(
  read: GameWorldView,
  controller: DeepReadonly<Controller>,
): string | null {
  if (controller.kind === 'computer') {
    return null;
  }
  return (
    read.meta.players.find((player) => player.playerId === controller.playerId)?.displayName ?? null
  );
}

export const PROMOTION_NOT_FOUND = 'That promotion does not exist.';
export const BRAND_NOT_FOUND = 'That brand is not part of this promotion.';

/** The promotion, or a `notFound` refusal. */
export function promotionOrRefuse(
  read: GameWorldView,
  promotionId: PromotionId,
): DeepReadonly<Promotion> {
  const promotion = read.tables.promotions.get(promotionId);
  if (promotion === undefined) {
    return refuseQuery({ code: 'notFound', message: PROMOTION_NOT_FOUND, field: 'promotionId' });
  }
  return promotion;
}

/** The promotion's brand, or a `notFound` refusal for a brand of another promotion or none. */
export function brandOrRefuse(
  read: GameWorldView,
  promotionId: PromotionId,
  brandId: BrandId,
): DeepReadonly<Brand> {
  const brand = read.tables.brands.get(brandId);
  if (brand?.promotionId !== promotionId) {
    return refuseQuery({ code: 'notFound', message: BRAND_NOT_FOUND, field: 'brandId' });
  }
  return brand;
}

/** The whole promotion as a roster unit: every brand, the player's own included. */
export function wholePromotion(promotionId: PromotionId): RosterUnit {
  return { promotionId, brandId: null, excludedBrandIds: [] };
}

/** Roles counted as crew: everyone who is neither a wrestler nor a manager. */
export function isCrewRole(role: EmploymentRole): boolean {
  return role !== 'wrestler' && role !== 'manager';
}

export interface RosterCounts {
  /** Active wrestler contracts. */
  rosterCount: number;
  /** Active crew contracts (referees, announcers, producers, presenters, bookers). */
  crewCount: number;
}

/** The unit's wrestler and crew counts on `date`. */
export function rosterCountsOf(
  read: GameWorldView,
  unit: RosterUnit,
  date: GameDate,
): RosterCounts {
  let rosterCount = 0;
  let crewCount = 0;
  for (const employment of unitRoster(read, unit, date)) {
    if (employment.role === 'wrestler') {
      rosterCount += 1;
    } else if (isCrewRole(employment.role)) {
      crewCount += 1;
    }
  }
  return { rosterCount, crewCount };
}

/** One title and who holds it. */
export interface ChampionLine {
  titleId: TitleId;
  titleName: string;
  /** Empty when the title is vacant. */
  holderNames: string[];
  /** The day the current reign began, or null when vacant. */
  wonOn: GameDate | null;
}

/** The unit's titles in use, in ID order, each with its current holders. */
export function championLinesOf(
  read: GameWorldView,
  unit: RosterUnit,
  date: GameDate,
): ChampionLine[] {
  return unitTitles(read, unit).map((title) => {
    const reign = openReignOf(read, title.id);
    return {
      titleId: title.id,
      titleName: title.name,
      holderNames: reign === null ? [] : holderNamesOf(read, reign, unit.promotionId, date),
      wonOn: reign?.wonOn ?? null,
    };
  });
}

/** A place on the map. */
export interface PlaceRef<Id extends string> {
  id: Id;
  name: string;
}

/** The promotion's home region and the country it is in. */
export function homeOf(
  geography: Geography,
  homeRegionId: RegionId,
): { homeRegion: PlaceRef<RegionId>; homeCountry: PlaceRef<CountryId> } {
  const region = geography.region(homeRegionId);
  const country = geography.countryOf(homeRegionId);
  return {
    homeRegion: { id: region.id, name: region.name },
    homeCountry: { id: country.id, name: country.name },
  };
}

/** Name order for lists, then ID so equal names keep a fixed order. */
export function compareByName(
  left: { readonly name: string; readonly id: string },
  right: { readonly name: string; readonly id: string },
): number {
  return (
    left.name.localeCompare(right.name, 'en', { numeric: true }) ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

/**
 * A country's line of a roll-up.
 *
 * @throws InvalidArgumentError when the roll-up was built on another map.
 */
export function countryPopularity(rollup: PopularityRollup, countryId: CountryId): Traced<number> {
  const found = rollup.countries.get(countryId);
  if (found === undefined) {
    throw new InvalidArgumentError(
      'countryPopularity',
      'countryId',
      countryId,
      'a country on the map',
    );
  }
  return found;
}
