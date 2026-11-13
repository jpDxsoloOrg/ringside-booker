/**
 * The production queries (ECO7-02):
 *
 * - `production.overview`: one row per area with its level, what it costs and what it does, plus
 *   the header totals. Levels and the popularity ceiling are public (the ceiling follows from
 *   public levels); a rival's costs, totals and TV deal are hidden.
 * - `production.changePreview`: what `production.setLevel` would do, without writing: the fee,
 *   each number before and after, and every refusal. Own promotions only.
 *
 * Traces are returned inline and never recorded. Design: docs/design/production.md#screens.
 */

import { z } from 'zod';
import { viewerPromotionIds, type Viewer } from '../../core/api/controller';
import { defineQuery, type QueryContext, type QueryDefinition } from '../../core/api/query';
import { refuseQuery, type Reason } from '../../core/api/result';
import type { GameDate } from '../../core/date';
import type { PromotionId } from '../../core/ids';
import { inputOf } from '../../core/trace/helpers';
import type { Traced, TraceNode } from '../../core/trace/types';
import type { EventImportance } from '../../model/entities/event-definition';
import {
  PRODUCTION_AREAS,
  PRODUCTION_LEVEL_MAX,
  PRODUCTION_LEVEL_MIN,
  type Production,
  type Promotion,
  type ProductionArea,
} from '../../model/entities/promotion';
import { zId } from '../../model/primitives';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';
import { AREA_COST_KIND, AREA_LABELS, type AreaCostKind } from './areas';
import { POPULARITY_CEILING_EFFECT_ID } from './builtinEffects';
import { NOT_YOUR_PROMOTION_MESSAGE } from './commands';
import { activeBroadcastDeal } from './deals';
import { checkLevelChange } from './door';
import { listProductionEffects, type ProductionEffectLine } from './effects';
import { areaCost } from './formulas/areaCost';
import { popularityCeiling } from './formulas/popularityCeiling';
import { productionMonthlyCost } from './formulas/productionMonthlyCost';
import { upcomingShowCost } from './formulas/productionShowCost';
import { upcomingShows, type ProductionUpcomingShow } from './upcoming';

/** One area on the production screen. */
export interface ProductionRow {
  area: ProductionArea;
  label: string;
  level: number;
  costKind: AreaCostKind;
  /** What the area costs at its level, in cents: per show (at `costBasis`) or a month. Null for a rival. */
  cost: number | null;
  costTrace: TraceNode | null;
  /** What the cost is for: "per Hardpan Friday (minor)", "a month". Null for a rival. */
  costBasis: string | null;
  /** What the level does, from every registered effect for the area. */
  effects: ProductionEffectLine[];
  /** The lowest level the area may be set to today. */
  minLevel: number;
}

/** `production.overview`: one promotion's production. */
export interface ProductionOverview {
  promotionId: PromotionId;
  promotionName: string;
  /** True when the viewer runs the promotion (or sees everything). */
  mine: boolean;
  rows: ProductionRow[];
  popularityCeiling: { value: number; trace: TraceNode };
  /** How many regions the promotion's popularity sits above the ceiling in. */
  regionsAboveCeiling: number;
  monthlyOverhead: {
    total: number;
    byCategory: { production: number; marketing: number; backOffice: number };
    trace: TraceNode;
  } | null;
  /** The per-show production cost of the coming shows. */
  upcomingShows: { count: number; days: number; total: number; trace: TraceNode } | null;
  /** The importance of the next coming show (regular when there is none); per-show costs use it. */
  typicalImportance: EventImportance | null;
  tvDeal: { networkName: string; endsOn: GameDate | null } | null;
}

/** The fixed rows of the change dialog; effect rows use their effect's id. */
export type ProductionPreviewRowId =
  'areaCost' | 'monthlyOverhead' | 'upcomingShows' | 'popularityCeiling';

/** One number in the change dialog, before and after the change. */
export interface ProductionPreviewRow {
  id: ProductionPreviewRowId | (string & {});
  label: string;
  before: number;
  after: number;
  unit: string;
  /** How the after value is worked out. */
  trace: TraceNode;
}

/** `production.changePreview`: what changing one area would do. */
export interface ProductionChangePreview {
  area: ProductionArea;
  from: number;
  to: number;
  /** The upgrade fee, in cents. */
  fee: number;
  feeTrace: TraceNode;
  /** Every reason `production.setLevel` would refuse; empty when it would apply. */
  reasons: Reason[];
  canApply: boolean;
  rows: ProductionPreviewRow[];
}

export interface ProductionChangePreviewArgs {
  promotionId: PromotionId;
  area: ProductionArea;
  level: number;
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'production.overview': { args: { promotionId: PromotionId }; result: ProductionOverview };
    'production.changePreview': {
      args: ProductionChangePreviewArgs;
      result: ProductionChangePreview;
    };
  }
}

function promotionOf(ctx: QueryContext, promotionId: PromotionId): Promotion {
  const promotion = ctx.read.tables.promotions.get(promotionId);
  if (promotion === undefined) {
    return refuseQuery({
      code: 'notFound',
      message: 'There is no such promotion',
      field: 'promotionId',
    });
  }
  return promotion;
}

/** True when the viewer may see the promotion's costs: it runs it, or sees everything. */
function viewerRuns(read: GameWorldView, viewer: Viewer, promotionId: PromotionId): boolean {
  return viewer.kind === 'omniscient' || viewerPromotionIds(read, viewer).includes(promotionId);
}

/** The coming shows and what per-show costs are priced at. */
interface ShowOutlook {
  shows: ProductionUpcomingShow[];
  days: number;
  importance: EventImportance;
  /** "per Hardpan Friday (minor)", or "per regular show" with nothing coming. */
  basis: string;
}

function showOutlook(
  read: GameWorldView,
  promotionId: PromotionId,
  date: GameDate,
  tunables: EngineTunables,
): ShowOutlook {
  const days = tunables.get('production.forecastDays');
  const shows = upcomingShows(read, promotionId, date, days);
  const next = shows[0];
  if (next === undefined) {
    return { shows, days, importance: 'regular', basis: 'per regular show' };
  }
  return {
    shows,
    days,
    importance: next.importance,
    basis: `per ${next.name} (${next.importance})`,
  };
}

function areaCostAt(
  area: ProductionArea,
  level: number,
  importance: EventImportance,
  tunables: EngineTunables,
): Traced<number> {
  return areaCost(
    { area, level, importance: AREA_COST_KIND[area] === 'perShow' ? importance : null },
    { tunables },
  );
}

function ceilingOf(
  promotion: Promotion,
  levels: Production,
  tunables: EngineTunables,
): Traced<number> {
  return popularityCeiling(
    {
      promotionName: promotion.name,
      marketing: levels.marketing,
      backOffice: levels.backOffice,
    },
    { tunables },
  );
}

export const productionOverviewQuery: QueryDefinition<'production.overview'> = defineQuery(
  'production.overview',
  {
    args: z.strictObject({ promotionId: zId('promotion') }),
    run: (ctx, args): ProductionOverview => {
      const promotion = promotionOf(ctx, args.promotionId);
      const { tunables, date, read } = ctx;
      const mine = viewerRuns(read, ctx.viewer, promotion.id);
      const levels = promotion.production;
      const ceiling = ceilingOf(promotion, levels, tunables);
      const regionsAboveCeiling = Object.values(promotion.regionalPop).filter(
        (popularity) => popularity > ceiling.value,
      ).length;
      const outlook = mine ? showOutlook(read, promotion.id, date, tunables) : null;
      const deal = mine ? activeBroadcastDeal(read, promotion.id, date) : null;
      const minCamera = tunables.get('production.tvDealMinCamera');
      const effects = listProductionEffects().filter((effect) => mine || effect.ownOnly !== true);

      const rows = PRODUCTION_AREAS.map((area): ProductionRow => {
        const level = levels[area];
        const costKind = AREA_COST_KIND[area];
        const cost =
          outlook === null ? null : areaCostAt(area, level, outlook.importance, tunables);
        return {
          area,
          label: AREA_LABELS[area],
          level,
          costKind,
          cost: cost?.value ?? null,
          costTrace: cost?.trace ?? null,
          costBasis: outlook === null ? null : costKind === 'perShow' ? outlook.basis : 'a month',
          effects: effects
            .filter((effect) => effect.areas.includes(area))
            .flatMap((effect) => {
              const line = effect.describe(read, {
                promotionId: promotion.id,
                levels,
                date,
                tunables,
              });
              return line === null ? [] : [line];
            }),
          minLevel:
            area === 'camera' && deal !== null
              ? Math.max(PRODUCTION_LEVEL_MIN, minCamera)
              : PRODUCTION_LEVEL_MIN,
        };
      });

      let monthlyOverhead: ProductionOverview['monthlyOverhead'] = null;
      let coming: ProductionOverview['upcomingShows'] = null;
      if (outlook !== null) {
        const monthly = productionMonthlyCost(
          { promotionName: promotion.name, levels },
          { tunables },
        );
        monthlyOverhead = {
          total: monthly.total.value,
          byCategory: {
            production: monthly.byCategory.production.value,
            marketing: monthly.byCategory.marketing.value,
            backOffice: monthly.byCategory.backOffice.value,
          },
          trace: monthly.total.trace,
        };
        const showCost = upcomingShowCost(
          { promotionName: promotion.name, shows: outlook.shows, levels },
          { tunables },
        );
        coming = {
          count: outlook.shows.length,
          days: outlook.days,
          total: showCost.value,
          trace: showCost.trace,
        };
      }

      return {
        promotionId: promotion.id,
        promotionName: promotion.name,
        mine,
        rows,
        popularityCeiling: { value: ceiling.value, trace: ceiling.trace },
        regionsAboveCeiling,
        monthlyOverhead,
        upcomingShows: coming,
        typicalImportance: outlook?.importance ?? null,
        tvDeal:
          deal === null
            ? null
            : {
                networkName: read.tables.networks.get(deal.networkId)?.name ?? 'a network',
                endsOn: deal.endsOn,
              },
      };
    },
  },
);

function row(
  id: ProductionPreviewRow['id'],
  label: string,
  before: Traced<number>,
  after: Traced<number>,
  unit: string,
): ProductionPreviewRow {
  return { id, label, before: before.value, after: after.value, unit, trace: after.trace };
}

function isProductionLevel(level: number): boolean {
  return level >= PRODUCTION_LEVEL_MIN && level <= PRODUCTION_LEVEL_MAX;
}

export const productionChangePreviewQuery: QueryDefinition<'production.changePreview'> =
  defineQuery('production.changePreview', {
    args: z.strictObject({
      promotionId: zId('promotion'),
      area: z.enum(PRODUCTION_AREAS),
      level: z.number().int(),
    }),
    run: (ctx, args): ProductionChangePreview => {
      const promotion = promotionOf(ctx, args.promotionId);
      const { tunables, date, read } = ctx;
      if (!viewerRuns(read, ctx.viewer, promotion.id)) {
        return refuseQuery({
          code: 'production.notYourPromotion',
          message: NOT_YOUR_PROMOTION_MESSAGE,
          subject: { kind: 'promotion', id: promotion.id },
        });
      }
      const { area, level } = args;
      const check = checkLevelChange(read, args, tunables, date);
      const preview: ProductionChangePreview = {
        area,
        from: check.from,
        to: level,
        fee: check.fee.value,
        feeTrace: check.fee.trace,
        reasons: check.reasons,
        canApply: check.reasons.length === 0,
        rows: [],
      };
      if (!isProductionLevel(level)) {
        return preview;
      }

      const before = promotion.production;
      const after: Production = { ...before, [area]: level };
      const label = AREA_LABELS[area];
      const outlook = showOutlook(read, promotion.id, date, tunables);
      const rows: ProductionPreviewRow[] = [];
      if (AREA_COST_KIND[area] === 'perShow') {
        rows.push(
          row(
            'areaCost',
            `${label} ${outlook.basis}`,
            areaCostAt(area, check.from, outlook.importance, tunables),
            areaCostAt(area, level, outlook.importance, tunables),
            'money',
          ),
          row(
            'upcomingShows',
            `Production on the shows in the next ${String(outlook.days)} days`,
            upcomingShowCost(
              { promotionName: promotion.name, shows: outlook.shows, levels: before },
              { tunables },
            ),
            upcomingShowCost(
              { promotionName: promotion.name, shows: outlook.shows, levels: after },
              { tunables },
            ),
            'money',
          ),
        );
      } else {
        rows.push(
          row(
            'areaCost',
            `${label} a month`,
            areaCostAt(area, check.from, outlook.importance, tunables),
            areaCostAt(area, level, outlook.importance, tunables),
            'money/month',
          ),
          row(
            'monthlyOverhead',
            'Monthly overhead',
            productionMonthlyCost({ promotionName: promotion.name, levels: before }, { tunables })
              .total,
            productionMonthlyCost({ promotionName: promotion.name, levels: after }, { tunables })
              .total,
            'money/month',
          ),
        );
      }
      if (area === 'marketing' || area === 'backOffice') {
        rows.push(
          row(
            'popularityCeiling',
            'Popularity ceiling',
            ceilingOf(promotion, before, tunables),
            ceilingOf(promotion, after, tunables),
            'points',
          ),
        );
      }

      // Other features' lines. The built-in popularity-ceiling effect is the fixed row above.
      for (const effect of listProductionEffects(area)) {
        if (effect.id === POPULARITY_CEILING_EFFECT_ID) {
          continue;
        }
        const input = { promotionId: promotion.id, date, tunables };
        const was = effect.describe(read, { ...input, levels: before });
        const will = effect.describe(read, { ...input, levels: after });
        if (was === null || will === null || was.value === null || will.value === null) {
          continue;
        }
        rows.push({
          id: effect.id,
          label: will.label,
          before: was.value,
          after: will.value,
          unit: will.unit ?? '',
          trace: will.trace ?? inputOf(will.label, will.value).trace,
        });
      }
      return { ...preview, rows };
    },
  });

export const productionQueries = [productionOverviewQuery, productionChangePreviewQuery] as const;
