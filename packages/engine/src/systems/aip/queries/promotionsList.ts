/**
 * `promotions.list`: the World > Promotions table, one row per promotion (every status), sorted by
 * name.
 *
 * Everything on a row is public except the money: `cash` is exact for a promotion the viewer runs
 * (and in a sandbox game, or for the all-seeing viewer) and hidden for anyone else's. The home
 * country popularity carries its Why? inline. Company size comes with ECO1; until then the row
 * simply has no `size` field. Design: docs/design/rival-desk.md#promotions-queries.
 */

import { z } from 'zod';
import type { NoArgs } from '../../../core/api/builtins';
import { defineQuery, type QueryDefinition } from '../../../core/api/query';
import type { CountryId, PromotionId, RegionId } from '../../../core/ids';
import type { TraceNode } from '../../../core/trace';
import type { Promotion, PromotionStatus } from '../../../model/entities/promotion';
import type { PromotionStyle } from '../../../model/entities/promotion-style';
import { geographyOf } from '../../world/geography';
import { popularityRollup } from '../../world/formulas/popularityRollup';
import { redactForViewer, visibilityOf, type Redacted } from '../visibility';
import {
  championLinesOf,
  compareByName,
  controlledByOf,
  controllerNameOf,
  countryPopularity,
  homeOf,
  rosterCountsOf,
  wholePromotion,
  type ControlledBy,
  type PlaceRef,
} from './shared';

/** A promotion's titles in use and their holders, for the list's champions column. */
export interface PromotionChampion {
  titleId: string;
  titleName: string;
  /** Empty when the title is vacant. */
  holderNames: string[];
}

/** One row of the Promotions table. */
export interface PromotionListRow {
  promotionId: PromotionId;
  name: string;
  shortName: string;
  logoRef: Promotion['logoRef'];
  color: string;
  style: PromotionStyle;
  status: PromotionStatus;
  homeRegion: PlaceRef<RegionId>;
  homeCountry: PlaceRef<CountryId>;
  popularity: {
    /** Popularity in the home country, with its Why?. */
    home: { value: number; trace: TraceNode };
    /** The world mean. */
    world: number;
  };
  prestige: number;
  /** Active wrestler contracts. */
  rosterCount: number;
  /** Active crew contracts. */
  crewCount: number;
  /** Active brands. */
  brandCount: number;
  champions: PromotionChampion[];
  controlledBy: ControlledBy;
  /** The player's name for a human-run promotion, else null. */
  controllerName: string | null;
  /** Exact for your own promotion (or sandbox, or all-seeing), hidden for anyone else's. */
  cash: Redacted;
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'promotions.list': { args: NoArgs; result: PromotionListRow[] };
  }
}

const noArgs: z.ZodType<NoArgs> = z.strictObject({});

export const promotionsListQuery: QueryDefinition<'promotions.list'> = defineQuery(
  'promotions.list',
  {
    args: noArgs,
    run: (ctx) => {
      const { read, viewer, date } = ctx;
      const geography = geographyOf(read);
      return [...read.tables.promotions.values()]
        .sort(compareByName)
        .map((promotion): PromotionListRow => {
          const home = homeOf(geography, promotion.homeRegionId);
          const rollup = popularityRollup(promotion.regionalPop, geography);
          const homePopularity = countryPopularity(rollup, home.homeCountry.id);
          const unit = wholePromotion(promotion.id);
          return {
            promotionId: promotion.id,
            name: promotion.name,
            shortName: promotion.shortName,
            logoRef: promotion.logoRef,
            color: promotion.color,
            style: promotion.style,
            status: promotion.status,
            ...home,
            popularity: {
              home: { value: homePopularity.value, trace: homePopularity.trace },
              world: rollup.world.value,
            },
            prestige: promotion.prestige,
            ...rosterCountsOf(read, unit, date),
            brandCount: read.tables.brands
              .lookup('byPromotion', promotion.id)
              .filter((brand) => brand.active).length,
            champions: championLinesOf(read, unit, date).map((line) => ({
              titleId: line.titleId,
              titleName: line.titleName,
              holderNames: line.holderNames,
            })),
            controlledBy: controlledByOf(viewer, promotion.controller),
            controllerName: controllerNameOf(read, promotion.controller),
            cash: redactForViewer(visibilityOf(read, viewer, promotion.id), promotion.cash, []),
          };
        });
    },
  },
);
