/**
 * The promotion popularity system's query: `popularity.showChange`, what one show did to its
 * promotion's popularity, region by region and country by country, ready for the results page
 * (EVT5-03) and its Why? panels.
 *
 * Promotion popularity is public, so every viewer gets the same answer, rival shows included.
 * Nothing private (money, morale) is in it. Design:
 * docs/design/promotion-popularity.md#after-every-show.
 */

import { z } from 'zod';
import { defineQuery, type QueryContext, type QueryDefinition } from '../../core/api/query';
import { refuseQuery } from '../../core/api/result';
import { compareDates, type GameDate } from '../../core/date';
import {
  parseId,
  type CountryId,
  type EventInstanceId,
  type PromotionId,
  type RegionId,
} from '../../core/ids';
import type { TraceNode } from '../../core/trace';
import type { TraceRef } from '../../core/trace/store';
import type { EventInstance } from '../../model/entities/event-instance';
import type {
  PopularityReachSource,
  PopularityShowChange,
  PopularityShowRegion,
} from '../../model/entities/popularity-show-change';
import { zId } from '../../model/primitives';
import { compareIds } from '../../model/table';
import type { DeepReadonly } from '../../model/world';
import { geographyOf } from '../world/geography';
import { reachLabel, type ReachRoute } from './formulas/labels';
import { showChangeOf } from './helpers';
import { lastPruneCutoff } from './phases';
import { showChangeTraceRef } from './traces';

/** What the player reads when a show id is unknown. */
export const SHOW_CHANGE_NOT_FOUND_MESSAGE = "That show doesn't exist.";

/**
 * Where a show's popularity change stands: `applied` (the record is there), `notCompleted` (the
 * show has not run), `pruned` (its record was cleared as too old) or `notApplied` (it ran, but no
 * change was stored, for example because its promotion was not active).
 */
export const SHOW_CHANGE_STATUSES = ['applied', 'notCompleted', 'pruned', 'notApplied'] as const;
export type ShowChangeStatus = (typeof SHOW_CHANGE_STATUSES)[number];

/** One region the show reached. */
export interface ShowChangeRegionView {
  regionId: RegionId;
  name: string;
  source: PopularityReachSource;
  /** "Show region", "Neighbour of Texas", "TV: National Signal Network". */
  sourceLabel: string;
  /** How much of the show the region saw, 0..1. */
  weight: number;
  /** The score fans there expected. */
  expectation: number;
  before: number;
  after: number;
  change: number;
  /** True when the monthly gain cap made the gain smaller. */
  capped: boolean;
  /** The region's full Why? trace, or null when it is no longer kept. */
  traceRef: TraceRef | null;
}

/** One country with at least one reached region. */
export interface ShowChangeCountryView {
  countryId: CountryId;
  name: string;
  /** The population-weighted change over the whole country (untouched regions count 0). */
  change: number;
  trace: TraceNode;
  regions: ShowChangeRegionView[];
}

export interface ShowChangeSummaryView {
  regionsGained: number;
  regionsLost: number;
  regionsUnchanged: number;
  regionsCapped: number;
  world: { before: number; after: number; change: number; trace: TraceNode };
}

/** `popularity.showChange`: one show's popularity change. */
export interface ShowPopularityChangeView {
  eventInstanceId: EventInstanceId;
  promotionId: PromotionId;
  promotionName: string;
  showName: string;
  date: GameDate;
  /** The show's score, or null when it has not run. */
  score: number | null;
  status: ShowChangeStatus;
  /** Null unless `status` is `applied`. */
  summary: ShowChangeSummaryView | null;
  /** Empty unless `status` is `applied`. Largest change first. */
  countries: ShowChangeCountryView[];
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'popularity.showChange': {
      args: { eventInstanceId: EventInstanceId };
      result: ShowPopularityChangeView;
    };
  }
}

const AGGREGATE_OPTIONS = { valueLabel: 'Popularity change', unit: 'points' } as const;

function statusWithoutRecord(
  ctx: QueryContext,
  instance: DeepReadonly<EventInstance>,
): ShowChangeStatus {
  if (instance.status !== 'completed') {
    return 'notCompleted';
  }
  return compareDates(instance.date, lastPruneCutoff(ctx.date, ctx.tunables)) < 0
    ? 'pruned'
    : 'notApplied';
}

function routeOf(
  ctx: QueryContext,
  region: DeepReadonly<PopularityShowRegion>,
  showRegionName: string,
): ReachRoute {
  if (region.source === 'show') {
    return { source: 'show' };
  }
  if (region.source === 'neighbour' || region.networkId === null) {
    return { source: 'neighbour', showRegionName };
  }
  const network = ctx.read.tables.networks.get(region.networkId);
  return {
    source: 'tv',
    networkId: region.networkId,
    networkName: network?.name ?? region.networkId,
  };
}

function compareRegions(left: ShowChangeRegionView, right: ShowChangeRegionView): number {
  if (left.source === 'show' || right.source === 'show') {
    return left.source === right.source ? 0 : left.source === 'show' ? -1 : 1;
  }
  return (
    Math.abs(right.change) - Math.abs(left.change) ||
    left.name.localeCompare(right.name, 'en') ||
    compareIds(left.regionId, right.regionId)
  );
}

function compareCountries(left: ShowChangeCountryView, right: ShowChangeCountryView): number {
  return (
    Math.abs(right.change) - Math.abs(left.change) ||
    left.name.localeCompare(right.name, 'en') ||
    compareIds(left.countryId, right.countryId)
  );
}

function appliedView(
  ctx: QueryContext,
  instance: DeepReadonly<EventInstance>,
  record: DeepReadonly<PopularityShowChange>,
): Pick<ShowPopularityChangeView, 'summary' | 'countries'> {
  const geography = geographyOf(ctx.read);
  const humanShow = ctx.read.tables.promotions.get(record.promotionId)?.controller.kind === 'human';
  const showRegionName = geography.region(instance.regionId).name;
  const changes = new Map<RegionId, number>();
  const byCountry = new Map<CountryId, ShowChangeRegionView[]>();
  let regionsGained = 0;
  let regionsLost = 0;
  let regionsCapped = 0;

  for (const [regionKey, region] of Object.entries(record.regions)) {
    const regionRow = geography.region(parseId('region', regionKey));
    const change = region.after - region.before;
    changes.set(regionRow.id, change);
    if (change > 0) {
      regionsGained += 1;
    } else if (change < 0) {
      regionsLost += 1;
    }
    if (region.capped) {
      regionsCapped += 1;
    }
    const ref = showChangeTraceRef(record.eventInstanceId, regionRow.id, humanShow);
    const view: ShowChangeRegionView = {
      regionId: regionRow.id,
      name: regionRow.name,
      source: region.source,
      sourceLabel: reachLabel(routeOf(ctx, region, showRegionName)),
      weight: region.weight,
      expectation: region.expectation,
      before: region.before,
      after: region.after,
      change,
      capped: region.capped,
      traceRef: ctx.traces.has(ref) ? ref : null,
    };
    const list = byCountry.get(regionRow.countryId);
    if (list === undefined) {
      byCountry.set(regionRow.countryId, [view]);
    } else {
      list.push(view);
    }
  }

  const countryChanges = geography.aggregateByCountry(changes, AGGREGATE_OPTIONS);
  const countries: ShowChangeCountryView[] = [];
  for (const [countryId, regions] of byCountry) {
    const aggregate = countryChanges.get(countryId);
    if (aggregate === undefined) {
      continue;
    }
    countries.push({
      countryId,
      name: geography.country(countryId).name,
      change: aggregate.value,
      trace: aggregate.trace,
      regions: regions.sort(compareRegions),
    });
  }
  countries.sort(compareCountries);

  const world = geography.aggregateWorld(changes, AGGREGATE_OPTIONS);
  const regionCount = Object.keys(record.regions).length;
  return {
    summary: {
      regionsGained,
      regionsLost,
      regionsUnchanged: regionCount - regionsGained - regionsLost,
      regionsCapped,
      world: {
        before: record.worldBefore,
        after: record.worldAfter,
        change: world.value,
        trace: world.trace,
      },
    },
    countries,
  };
}

export const showChangeQuery: QueryDefinition<'popularity.showChange'> = defineQuery(
  'popularity.showChange',
  {
    args: z.strictObject({ eventInstanceId: zId('eventInstance') }),
    run: (ctx, args) => {
      const instance = ctx.read.tables.eventInstances.get(args.eventInstanceId);
      if (instance === undefined) {
        return refuseQuery({ code: 'notFound', message: SHOW_CHANGE_NOT_FOUND_MESSAGE });
      }
      const record = showChangeOf(ctx.read, instance.id);
      const base = {
        eventInstanceId: instance.id,
        promotionId: instance.promotionId,
        promotionName:
          ctx.read.tables.promotions.get(instance.promotionId)?.name ?? instance.promotionId,
        showName: instance.name,
        date: instance.date,
        score: instance.result?.score ?? null,
      };
      if (record === undefined) {
        return {
          ...base,
          status: statusWithoutRecord(ctx, instance),
          summary: null,
          countries: [],
        };
      }
      return { ...base, status: 'applied', ...appliedView(ctx, instance, record) };
    },
  },
);

export const promoPopQueries: readonly QueryDefinition[] = [showChangeQuery];
