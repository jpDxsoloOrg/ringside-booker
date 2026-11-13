/**
 * The office system's queries (DAY2-02): `office.fanBase`, a promotion's headline popularity with
 * the full continent → country → region drill-down the Fan base sheet draws with WRK1's
 * `PopularityDrilldown`.
 *
 * Popularity is public, so any viewer may ask about any promotion. The headline comes from the
 * stored trace when there is one (the same entry `sim.status` reads), otherwise it is built on the
 * read; the drill-down is always built on the read, so nothing new is kept in the trace store.
 *
 * DAY2-03 adds `office.dashboard` (the Office's KPI cards with deltas and sparklines, its world
 * clock, and a public world overview for a seat that runs no promotion) and `office.series` (one
 * history column of one promotion; owner-only columns of rivals are refused).
 *
 * Design: docs/design/office.md#headline-popularity and #queries.
 */

import { z } from 'zod';
import { viewerPromotionIds } from '../../core/api/controller';
import { compareDates, type GameDate } from '../../core/date';
import { defineQuery, type QueryContext, type QueryDefinition } from '../../core/api/query';
import { refuseQuery } from '../../core/api/result';
import type { ContinentId, CountryId, PromotionId, RegionId } from '../../core/ids';
import { isFullTrace, type TraceRef } from '../../core/trace/store';
import type { PromotionSnapshotGranularity } from '../../model/entities/promotion-snapshot';
import { zGameDate, zId } from '../../model/primitives';
import {
  popularityRollup,
  popularityRollupView,
  type PopularityRollupView,
} from '../world/formulas/popularityRollup';
import { geographyOf } from '../world/geography';
import { officeClock, type OfficeClock } from './dashboard/clock';
import { buildKpis, type OfficeKpi } from './dashboard/kpis';
import { worldOverview, type WorldOverview } from './dashboard/worldOverview';
import { promotionHistory } from './history/compare';
import { officeMetric } from './history/metrics';
import type { SnapshotFieldUnit } from './history/snapshotFields';
import { headlinePopularityOf } from './popularity';
import { popularityTraceRef } from './traces';
import type { HeadlineScope } from './tunables';

/** The reason code when the viewer runs no promotion and names none. */
export const NO_PROMOTION = 'noPromotion';
/** The reason code for a promotion ID that is not in the world. */
export const UNKNOWN_PROMOTION = 'unknownPromotion';

/** `office.fanBase`: one promotion's headline popularity and where its fans are. */
export interface FanBaseView {
  promotionId: PromotionId;
  name: string;
  headline: {
    /** 0..100, exact; screens round it. */
    value: number;
    /** The Why?'s root label, such as "Altura Wrestling popularity". */
    label: string;
    /** The stored Why? to open with `trace.get`, or null when none is stored yet. */
    traceRef: TraceRef | null;
  };
  /** Which roll-up level the headline is (`office.popularity.headlineScope`). */
  scope: HeadlineScope;
  /** World → continents → countries → regions, each derived level with its trace. */
  rollup: PopularityRollupView;
  /**
   * Where the promotion is based, so the Fan base sheet can open its home continent and name its
   * home country (DAY2-05).
   */
  home: {
    regionId: RegionId;
    countryId: CountryId;
    countryName: string;
    continentId: ContinentId;
  };
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'office.fanBase': { args: { promotionId?: PromotionId }; result: FanBaseView };
    'office.dashboard': { args: Record<string, never>; result: OfficeDashboard };
    'office.series': { args: OfficeSeriesArgs; result: OfficeSeries };
  }
}

export const fanBaseQuery: QueryDefinition<'office.fanBase'> = defineQuery('office.fanBase', {
  args: z.strictObject({ promotionId: zId('promotion').exactOptional() }),
  run: (ctx, args) => {
    const promotionId = args.promotionId ?? viewerPromotionIds(ctx.read, ctx.viewer)[0];
    if (promotionId === undefined) {
      return refuseQuery({
        code: NO_PROMOTION,
        message: "You don't run a promotion, so pick one to look at",
        field: 'promotionId',
      });
    }
    const promotion = ctx.read.tables.promotions.get(promotionId);
    if (promotion === undefined) {
      return refuseQuery({
        code: UNKNOWN_PROMOTION,
        message: 'There is no such promotion',
        field: 'promotionId',
      });
    }
    const ref = popularityTraceRef(promotion.id);
    const stored = ctx.traces.get(ref);
    let headline: FanBaseView['headline'];
    if (stored !== undefined && typeof stored.value === 'number') {
      headline = {
        value: stored.value,
        label: isFullTrace(stored) ? stored.trace.label : stored.label,
        traceRef: ref,
      };
    } else {
      const built = headlinePopularityOf(ctx.read, promotion.id, ctx.tunables, ctx.date);
      headline = { value: built.value, label: built.trace.label, traceRef: null };
    }
    const geography = geographyOf(ctx.read);
    const homeCountry = geography.countryOf(promotion.homeRegionId);
    return {
      promotionId: promotion.id,
      name: promotion.name,
      headline,
      scope: ctx.tunables.get('office.popularity.headlineScope'),
      rollup: popularityRollupView(popularityRollup(promotion.regionalPop, geography), geography),
      home: {
        regionId: promotion.homeRegionId,
        countryId: homeCountry.id,
        countryName: homeCountry.name,
        continentId: geography.continentOf(promotion.homeRegionId).id,
      },
    };
  },
});

// ---------------------------------------------------------------------------------------------
// office.dashboard and office.series (DAY2-03). Design: docs/design/office.md#queries.

/** The reason code for a metric key that is neither a built-in column nor a registered field. */
export const UNKNOWN_METRIC = 'unknownMetric';
/** The reason code for a series whose `from` is after its `to`. */
export const BAD_RANGE = 'badRange';
/** The reason code for a series with more than {@link MAX_SERIES_POINTS} points. */
export const RANGE_TOO_LONG = 'rangeTooLong';
/** The reason code for a rival's owner-only column (cash, morale). */
export const HIDDEN = 'hidden';
/** The most points one `office.series` call returns. */
export const MAX_SERIES_POINTS = 1000;

/** `office.dashboard`: the Office's front page. */
export interface OfficeDashboard {
  date: GameDate;
  clock: OfficeClock;
  /** The viewer's first promotion, or null for a seat that runs none. */
  promotion: {
    promotionId: PromotionId;
    name: string;
    shortName: string;
    logoRef: string | null;
    color: string;
  } | null;
  /** The KPI cards of `promotion`; empty when there is none. */
  kpis: OfficeKpi[];
  /** Every promotion's public facts, only for a seat that runs no promotion. */
  worldOverview: WorldOverview | null;
}

/** `office.series` arguments. */
export interface OfficeSeriesArgs {
  subject: { kind: 'promotion'; id: PromotionId };
  /** A built-in column (`cash`, `prestige`, `popularity.headline`, ...) or a registered field key. */
  metric: string;
  from: GameDate;
  to: GameDate;
}

/** `office.series`: one history column of one promotion over a date range. */
export interface OfficeSeries {
  metric: { key: string; label: string; unit: SnapshotFieldUnit };
  /** In date order; rows without the metric are left out. */
  points: { date: GameDate; value: number; granularity: PromotionSnapshotGranularity }[];
}

const noArgs: z.ZodType<Record<string, never>> = z.strictObject({});

export const dashboardQuery: QueryDefinition<'office.dashboard'> = defineQuery('office.dashboard', {
  args: noArgs,
  run: (ctx) => {
    const promotionId = viewerPromotionIds(ctx.read, ctx.viewer)[0];
    const promotion =
      promotionId === undefined ? undefined : ctx.read.tables.promotions.get(promotionId);
    const clock = officeClock(ctx.read, ctx.date);
    if (promotion === undefined) {
      return {
        date: ctx.date,
        clock,
        promotion: null,
        kpis: [],
        worldOverview: worldOverview(ctx.read, ctx.tunables, ctx.date),
      };
    }
    return {
      date: ctx.date,
      clock,
      promotion: {
        promotionId: promotion.id,
        name: promotion.name,
        shortName: promotion.shortName,
        logoRef: promotion.logoRef,
        color: promotion.color,
      },
      kpis: buildKpis(ctx, promotion.id),
      worldOverview: null,
    };
  },
});

/** True when `viewer` may read `promotionId`'s owner-only columns. */
function seesPrivateColumns(
  ctx: Pick<QueryContext, 'read' | 'viewer'>,
  promotionId: PromotionId,
): boolean {
  return (
    ctx.viewer.kind === 'omniscient' ||
    viewerPromotionIds(ctx.read, ctx.viewer).includes(promotionId)
  );
}

export const seriesQuery: QueryDefinition<'office.series'> = defineQuery('office.series', {
  args: z.strictObject({
    subject: z.strictObject({ kind: z.literal('promotion'), id: zId('promotion') }),
    metric: z.string(),
    from: zGameDate,
    to: zGameDate,
  }),
  run: (ctx, args) => {
    const metric = officeMetric(args.metric);
    if (metric === undefined) {
      return refuseQuery({
        code: UNKNOWN_METRIC,
        message: 'The Office keeps no history of that',
        field: 'metric',
      });
    }
    const promotion = ctx.read.tables.promotions.get(args.subject.id);
    if (promotion === undefined) {
      return refuseQuery({
        code: UNKNOWN_PROMOTION,
        message: 'There is no such promotion',
        field: 'subject',
      });
    }
    if (compareDates(args.from, args.to) > 0) {
      return refuseQuery({
        code: BAD_RANGE,
        message: 'The start date is after the end date',
        field: 'from',
      });
    }
    if (metric.visibility === 'owner' && !seesPrivateColumns(ctx, promotion.id)) {
      return refuseQuery({
        code: HIDDEN,
        message: `Only ${promotion.name} knows its own ${metric.privateNoun}`,
        field: 'metric',
      });
    }
    const points: OfficeSeries['points'] = [];
    for (const row of promotionHistory(ctx.read, promotion.id)) {
      if (compareDates(row.date, args.from) < 0 || compareDates(row.date, args.to) > 0) {
        continue;
      }
      const value = metric.fromRow(row);
      if (value !== null) {
        points.push({ date: row.date, value, granularity: row.granularity });
      }
    }
    if (points.length > MAX_SERIES_POINTS) {
      return refuseQuery({
        code: RANGE_TOO_LONG,
        message: `That is more than ${String(MAX_SERIES_POINTS)} records; pick a shorter stretch`,
        field: 'from',
      });
    }
    return { metric: { key: metric.key, label: metric.label, unit: metric.unit }, points };
  },
});

export const officeQueries: readonly QueryDefinition[] = [
  fanBaseQuery,
  dashboardQuery,
  seriesQuery,
];
