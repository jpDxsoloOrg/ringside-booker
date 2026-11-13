/**
 * The Office's KPI cards (DAY2-03): each with its live value and Why?, its change since the last
 * comparable history row (with its own Why?) and its sparkline.
 *
 * Built-ins, in order: Cash (ECO1's stored cash Why? when one is recorded), Popularity (DAY2-02's
 * stored headline Why?), Prestige (no Why? until ECO2 moves it), Roster and Average morale (both
 * worked out on the read with an inline Why?). Then every registered history field with `kpi` set,
 * by `kpi.order`, its extract re-run live so a traced field shows its current Why?.
 *
 * Inline traces are used for numbers computed on the read (deltas, roster, morale); stored refs
 * only where a system already records one. This keeps the trace store small and every Why? current.
 *
 * Design: docs/design/office.md#kpis-and-deltas.
 */

import { currentCashTraceRef } from '../../../core/api/builtins';
import type { QueryContext } from '../../../core/api/query';
import { compareDates, type GameDate } from '../../../core/date';
import type { PromotionId } from '../../../core/ids';
import type { TraceRef } from '../../../core/trace/store';
import type { Traced, TraceNode } from '../../../core/trace/types';
import {
  promotionStatusKey,
  type Employment,
  type EmploymentRole,
} from '../../../model/entities/employment';
import type { PromotionSnapshot } from '../../../model/entities/promotion-snapshot';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { geographyOf } from '../../world/geography';
import { averageMorale } from '../formulas/averageMorale';
import { kpiDelta } from '../formulas/kpiDelta';
import { rosterSize } from '../formulas/rosterSize';
import { previousSnapshot, trendSeries, type TrendSeries } from '../history/compare';
import { fieldMetric, officeMetric, type OfficeMetric } from '../history/metrics';
import { promotionSnapshotFields, type SnapshotFieldUnit } from '../history/snapshotFields';
import { headlinePopularityOf } from '../popularity';
import { popularityTraceRef } from '../traces';

/** A KPI's change since the compared history row. */
export interface OfficeKpiDelta {
  /** `value − previousValue`, unrounded. */
  value: number;
  trace: TraceNode;
  previousDate: GameDate;
  previousValue: number;
}

/** One KPI card. */
export interface OfficeKpi {
  /** The history column or registered field key, such as `cash` or `popularity.headline`. */
  key: string;
  label: string;
  unit: SnapshotFieldUnit;
  /** Today's value, unrounded (cash in cents); null when there is nothing to show ("–"). */
  value: number | null;
  /** The Why? worked out on the read, or null when it is stored (`traceRef`) or there is none. */
  trace: TraceNode | null;
  /** The stored Why? to open with `trace.get`, or null. */
  traceRef: TraceRef | null;
  /** Whether a rise is good news. */
  goodWhen: 'up' | 'down';
  /** The change since the last comparable row, or null when there is none yet (never a fake 0). */
  delta: OfficeKpiDelta | null;
  /** The sparkline, ending with today's value. */
  trend: TrendSeries;
  /** A short line under the card, or null. */
  footer: string | null;
}

/** What the KPI builders read. */
export type KpiContext = Pick<QueryContext, 'read' | 'tunables' | 'traces' | 'date'>;

/** The live value of one card before the delta and trend are added. */
interface LiveKpi {
  readonly metric: OfficeMetric;
  readonly value: number | null;
  /** The value with its Why?, nested into the delta's Why? (small traces only). */
  readonly traced: Traced<number> | null;
  readonly trace: TraceNode | null;
  readonly traceRef: TraceRef | null;
  readonly goodWhen: 'up' | 'down';
  readonly footer: string | null;
}

/** Active contracts of `promotionId` that have started by `date` (the snapshot's rule). */
export function startedContracts(
  read: GameWorldView,
  promotionId: PromotionId,
  date: GameDate,
): readonly DeepReadonly<Employment>[] {
  return read.tables.employments
    .lookup('byPromotionStatus', promotionStatusKey(promotionId, 'active'))
    .filter((employment) => compareDates(employment.startsOn, date) <= 0);
}

function requireMetric(key: string): OfficeMetric {
  const metric = officeMetric(key);
  if (metric === undefined) {
    throw new Error(`Unknown office metric ${key}`);
  }
  return metric;
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

function cashKpi(ctx: KpiContext, promotionId: PromotionId): LiveKpi {
  const promotion = ctx.read.tables.promotions.require(promotionId);
  return {
    metric: requireMetric('cash'),
    value: promotion.cash,
    traced: null,
    trace: null,
    traceRef: currentCashTraceRef(ctx.traces, promotion),
    goodWhen: 'up',
    footer: null,
  };
}

/** "In Testland", "Worldwide": where the headline popularity is measured. */
function popularityFooter(ctx: KpiContext, promotionId: PromotionId): string {
  const promotion = ctx.read.tables.promotions.require(promotionId);
  const geography = geographyOf(ctx.read);
  switch (ctx.tunables.get('office.popularity.headlineScope')) {
    case 'homeRegion':
      return `In ${geography.region(promotion.homeRegionId).name}`;
    case 'homeCountry':
      return `In ${geography.countryOf(promotion.homeRegionId).name}`;
    case 'homeContinent':
      return `In ${geography.continentOf(promotion.homeRegionId).name}`;
    case 'world':
      return 'Worldwide';
  }
}

function popularityKpi(ctx: KpiContext, promotionId: PromotionId): LiveKpi {
  const ref = popularityTraceRef(promotionId);
  const stored = ctx.traces.get(ref);
  const footer = popularityFooter(ctx, promotionId);
  const metric = requireMetric('popularity.headline');
  if (stored !== undefined && typeof stored.value === 'number') {
    // The same entry `sim.status` reads, so the card and the top bar always agree.
    return {
      metric,
      value: stored.value,
      traced: null,
      trace: null,
      traceRef: ref,
      goodWhen: 'up',
      footer,
    };
  }
  const built = headlinePopularityOf(ctx.read, promotionId, ctx.tunables, ctx.date);
  return {
    metric,
    value: built.value,
    traced: null,
    trace: built.trace,
    traceRef: null,
    goodWhen: 'up',
    footer,
  };
}

function prestigeKpi(ctx: KpiContext, promotionId: PromotionId): LiveKpi {
  return {
    metric: requireMetric('prestige'),
    value: ctx.read.tables.promotions.require(promotionId).prestige,
    traced: null,
    trace: null,
    traceRef: null,
    goodWhen: 'up',
    footer: null,
  };
}

function rosterKpi(contracts: readonly DeepReadonly<Employment>[]): LiveKpi {
  const byRole: Record<EmploymentRole, number> = {
    wrestler: 0,
    manager: 0,
    presenter: 0,
    announcer: 0,
    referee: 0,
    producer: 0,
    booker: 0,
  };
  for (const contract of contracts) {
    byRole[contract.role] += 1;
  }
  const result = rosterSize({ byRole });
  const crew = contracts.length - byRole.wrestler;
  return {
    metric: requireMetric('rosterSize'),
    value: result.value,
    traced: result,
    trace: result.trace,
    traceRef: null,
    goodWhen: 'up',
    footer: `${plural(byRole.wrestler, 'wrestler', 'wrestlers')} · ${String(crew)} crew`,
  };
}

function moraleKpi(ctx: KpiContext, contracts: readonly DeepReadonly<Employment>[]): LiveKpi {
  const result = averageMorale(
    {
      contracts: contracts.map((contract) => ({
        name: contract.ringName,
        role: contract.role,
        morale: contract.morale,
      })),
    },
    { tunables: ctx.tunables },
  );
  const empty = contracts.length === 0;
  return {
    metric: requireMetric('averageMorale'),
    value: empty ? null : result.value,
    traced: empty ? null : result,
    trace: result.trace,
    traceRef: null,
    goodWhen: 'up',
    footer: null,
  };
}

/** Every registered field with `kpi` set, by `kpi.order` then key, extracted live. */
function fieldKpis(ctx: KpiContext, promotionId: PromotionId): LiveKpi[] {
  const promotion = ctx.read.tables.promotions.require(promotionId);
  const fields = promotionSnapshotFields()
    .filter((field) => field.kpi !== undefined)
    .sort((left, right) => (left.kpi?.order ?? 0) - (right.kpi?.order ?? 0));
  return fields.map((field) => {
    const extracted = field.extract(promotion, ctx.read, ctx.date);
    const traced = extracted === null || typeof extracted === 'number' ? null : extracted;
    const value =
      extracted === null ? null : typeof extracted === 'number' ? extracted : extracted.value;
    return {
      metric: fieldMetric(field),
      value: value !== null && Number.isFinite(value) ? value : null,
      traced,
      trace: traced?.trace ?? null,
      traceRef: null,
      goodWhen: field.kpi?.goodWhen ?? 'up',
      footer: field.kpi?.footer ?? null,
    };
  });
}

/** Adds the delta against `previous` and the sparkline to a live card. */
function finishKpi(
  ctx: KpiContext,
  promotionId: PromotionId,
  live: LiveKpi,
  previous: PromotionSnapshot | null,
): OfficeKpi {
  const previousValue = previous === null ? null : live.metric.fromRow(previous);
  let delta: OfficeKpiDelta | null = null;
  if (previous !== null && previousValue !== null && live.value !== null) {
    const result = kpiDelta(
      {
        label: live.metric.label,
        unit: live.metric.unit,
        current: live.traced ?? live.value,
        previous: { value: previousValue, date: previous.date, granularity: previous.granularity },
        today: ctx.date,
      },
      { tunables: ctx.tunables },
    );
    delta = {
      value: result.value,
      trace: result.trace,
      previousDate: previous.date,
      previousValue,
    };
  }
  return {
    key: live.metric.key,
    label: live.metric.label,
    unit: live.metric.unit,
    value: live.value,
    trace: live.trace,
    traceRef: live.traceRef,
    goodWhen: live.goodWhen,
    delta,
    trend: trendSeries(
      ctx.read,
      promotionId,
      live.metric.key,
      ctx.date,
      ctx.tunables.get('office.trend.weeks'),
      live.value,
    ),
    footer: live.footer,
  };
}

/**
 * The KPI cards of `promotionId`: the five built-ins, then every registered KPI field. Owner-only
 * fields are included: the dashboard only builds cards for the viewer's own promotion.
 */
export function buildKpis(ctx: KpiContext, promotionId: PromotionId): OfficeKpi[] {
  const contracts = startedContracts(ctx.read, promotionId, ctx.date);
  const previous = previousSnapshot(
    ctx.read,
    promotionId,
    ctx.date,
    ctx.tunables.get('office.delta.lookbackDays'),
  );
  const live = [
    cashKpi(ctx, promotionId),
    popularityKpi(ctx, promotionId),
    prestigeKpi(ctx, promotionId),
    rosterKpi(contracts),
    moraleKpi(ctx, contracts),
    ...fieldKpis(ctx, promotionId),
  ];
  return live.map((card) => finishKpi(ctx, promotionId, card, previous));
}
