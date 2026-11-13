/**
 * The policy queries (ECO1-04):
 *
 * - `finance.policies`: each staff policy's level, its words and what it is expected to cost a
 *   month, with a Why?.
 * - `finance.policyPreview`: one policy at all four levels, each with its monthly cost and Why?,
 *   the change from today and the lines other features registered (`registerPolicyEffect`).
 *
 * Both are behind the books rule (`canSeeBooks`). Monthly estimates: medical is people under
 * contract today × the level's rate; travel and catering add up the promotion's shows in the next
 * 30 days, each priced with the show-cost formula on a card of its usual size, held at home.
 *
 * Design: docs/design/finances.md#policies.
 */

import { z } from 'zod';
import { defineQuery, type QueryDefinition } from '../../../core/api/query';
import { addDays, compareDates, isAfter, isBefore, type GameDate } from '../../../core/date';
import type { PromotionId } from '../../../core/ids';
import { startCalc } from '../../../core/trace/calc';
import type { Traced, TraceNode } from '../../../core/trace/types';
import { occursOn } from '../../../model/recurrence';
import type { EventImportance } from '../../../model/entities/event-definition';
import type { Promotion } from '../../../model/entities/promotion';
import { POLICY_AREAS, type PolicyArea } from '../../../model/entities/promotion';
import { zId } from '../../../model/primitives';
import type { GameWorldView } from '../../../model/tables';
import { EVENT_IMPORTANCE_LABELS } from '../../match/formulas/crowdExpectation';
import type { EngineTunables } from '../../tunables';
import { estimateShowCosts } from '../estimateShowCosts';
import { monthlyMedical } from '../formulas/monthlyMedical';
import { medicalHeadcount, payrollLinesOf } from '../payroll';
import {
  POLICY_AREA_DESCRIPTIONS,
  POLICY_LEVEL_LABELS,
  POLICY_LEVELS,
  type PolicyLevel,
} from '../policies';
import { policyEffectLines, type PolicyEffectLine } from '../policyEffects';
import { showWorkersOf } from '../showWorkers';
import { booksOf } from './books';

/** The days a monthly estimate looks ahead, today included. */
export const POLICY_PREVIEW_DAYS = 30;

/** The note on every travel estimate: shows are assumed to be at home. */
export const AWAY_SHOWS_NOTE = 'Away shows cost more';

/** One policy in `finance.policies`. */
export interface PolicyView {
  area: PolicyArea;
  level: PolicyLevel;
  label: string;
  description: string;
  /** What the policy is expected to cost over the next month at its level, in cents. */
  monthlyEstimate: number;
  monthlyEstimateTrace: TraceNode;
}

/** `finance.policies`: every staff policy of a promotion. */
export interface FinancePolicies {
  policies: PolicyView[];
}

/** One level in `finance.policyPreview`. */
export interface PolicyLevelPreview {
  level: PolicyLevel;
  label: string;
  /** Expected cost over the next month at this level, in cents. */
  monthlyCost: number;
  monthlyCostTrace: TraceNode;
  /** `monthlyCost` less the cost at today's level (negative: cheaper). */
  delta: number;
  /** Lines other features registered for this level, in order. */
  effects: PolicyEffectLine[];
}

/** `finance.policyPreview`: one policy at all four levels. */
export interface FinancePolicyPreview {
  area: PolicyArea;
  current: PolicyLevel;
  levels: PolicyLevelPreview[];
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'finance.policies': { args: { promotionId: PromotionId }; result: FinancePolicies };
    'finance.policyPreview': {
      args: { promotionId: PromotionId; area: PolicyArea };
      result: FinancePolicyPreview;
    };
  }
}

/** A show the promotion is expected to run in the next 30 days. */
interface UpcomingShow {
  importance: EventImportance;
  /** Paid workers expected on it. */
  headcount: number;
}

/** What every travel and catering estimate of one promotion shares. */
interface ShowOutlook {
  shows: UpcomingShow[];
  /** True when the headcount comes from recent shows, false when from the card's size. */
  fromRecentShows: boolean;
}

/** Average paid workers over the promotion's last `finance.preview.recentShows` completed shows. */
function recentHeadcount(
  read: GameWorldView,
  promotionId: PromotionId,
  tunables: EngineTunables,
): number | null {
  const recent = read.tables.eventInstances
    .lookup('byPromotion', promotionId)
    .filter((instance) => instance.status === 'completed')
    .sort((left, right) => compareDates(right.date, left.date))
    .slice(0, tunables.get('finance.preview.recentShows'));
  if (recent.length === 0) {
    return null;
  }
  const total = recent.reduce(
    (sum, instance) =>
      sum +
      showWorkersOf(read, instance, tunables).workers.filter((worker) => worker.excluded === null)
        .length,
    0,
  );
  return Math.round(total / recent.length);
}

/**
 * The promotion's shows from `today` for {@link POLICY_PREVIEW_DAYS} days: its scheduled shows when
 * any are on the calendar in that window, otherwise the dates its active definitions give.
 */
function upcomingShows(
  read: GameWorldView,
  promotionId: PromotionId,
  today: GameDate,
  tunables: EngineTunables,
): ShowOutlook {
  const last = addDays(today, POLICY_PREVIEW_DAYS - 1);
  const inWindow = (date: GameDate): boolean => !isBefore(date, today) && !isAfter(date, last);
  const perSlot = tunables.get('finance.show.offscreenWorkersPerSlot');
  const recent = recentHeadcount(read, promotionId, tunables);
  const headcountFor = (slots: number): number => recent ?? slots * perSlot;

  const scheduled = read.tables.eventInstances
    .lookup('byPromotion', promotionId)
    .filter(
      (instance) =>
        (instance.status === 'scheduled' || instance.status === 'booked') &&
        inWindow(instance.date),
    );
  if (scheduled.length > 0) {
    return {
      shows: scheduled.map((instance) => ({
        importance: instance.importance,
        headcount: headcountFor(instance.format.slots),
      })),
      fromRecentShows: recent !== null,
    };
  }

  const shows: UpcomingShow[] = [];
  const definitions = read.tables.eventDefinitions.lookup('byPromotion', promotionId);
  for (let offset = 0; offset < POLICY_PREVIEW_DAYS; offset += 1) {
    const date = addDays(today, offset);
    for (const definition of definitions) {
      const active =
        !isBefore(date, definition.activeFrom) &&
        (definition.activeUntil === null || !isAfter(date, definition.activeUntil));
      if (active && occursOn(definition.recurrence, date)) {
        shows.push({
          importance: definition.importance,
          headcount: headcountFor(definition.format.slots),
        });
      }
    }
  }
  return { shows, fromRecentShows: recent !== null };
}

/** Shows grouped by importance and headcount, in importance order then headcount. */
function groupShows(shows: readonly UpcomingShow[]): { show: UpcomingShow; count: number }[] {
  const groups = new Map<string, { show: UpcomingShow; count: number }>();
  for (const show of shows) {
    const key = `${show.importance}|${String(show.headcount)}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { show, count: 1 });
    } else {
      group.count += 1;
    }
  }
  const order = Object.keys(EVENT_IMPORTANCE_LABELS);
  return [...groups.values()].sort(
    (left, right) =>
      order.indexOf(left.show.importance) - order.indexOf(right.show.importance) ||
      left.show.headcount - right.show.headcount,
  );
}

/** The next month's travel or catering at `level`: Σ over the upcoming shows of one show's cost. */
function showPolicyEstimate(
  read: GameWorldView,
  promotion: Promotion,
  area: 'travel' | 'catering',
  level: PolicyLevel,
  outlook: ShowOutlook,
  tunables: EngineTunables,
): Traced<number> {
  const areaLabel = area === 'travel' ? 'Travel' : 'Catering';
  const groups = groupShows(outlook.shows);
  const calc = startCalc(
    `${areaLabel} in the next ${String(POLICY_PREVIEW_DAYS)} days (${POLICY_LEVEL_LABELS[level]})`,
    0,
    {
      unit: 'money',
      docRef: 'docs/design/finances.md#policies',
      startLabel:
        groups.length === 0
          ? `No shows in the next ${String(POLICY_PREVIEW_DAYS)} days`
          : `Shows in the next ${String(POLICY_PREVIEW_DAYS)} days`,
    },
  );
  for (const { show, count } of groups) {
    const costs = estimateShowCosts(
      read,
      promotion.id,
      { importance: show.importance, regionId: promotion.homeRegionId, headcount: show.headcount },
      tunables,
      area === 'travel' ? { travelLevel: level } : { cateringLevel: level },
    );
    const perShow = area === 'travel' ? costs.travel : costs.catering;
    const showsLabel = `${EVENT_IMPORTANCE_LABELS[show.importance]} show`;
    const label =
      area === 'travel'
        ? `${String(count)} × ${showsLabel}, ${String(show.headcount)} workers`
        : `${String(count)} × ${showsLabel}`;
    calc.add(label, startCalc(label, perShow, { unit: 'money' }).multiply('Shows', count).done());
  }
  if (groups.length > 0 && area === 'travel') {
    calc.note(
      outlook.fromRecentShows
        ? 'Workers per show: the average of recent shows'
        : 'Workers per show: no shows yet, so the size of the card',
    );
    calc.note(`Every show assumed at home. ${AWAY_SHOWS_NOTE}`);
  }
  return calc.done();
}

/** The monthly cost of the promotion's `area` policy at `level`. */
function policyEstimate(
  read: GameWorldView,
  promotion: Promotion,
  area: PolicyArea,
  level: PolicyLevel,
  today: GameDate,
  outlook: ShowOutlook,
  tunables: EngineTunables,
): Traced<number> {
  if (area === 'medical') {
    const lines = payrollLinesOf(read, promotion, today, tunables);
    return monthlyMedical(
      { contracts: medicalHeadcount(lines), level, levelLabel: POLICY_LEVEL_LABELS[level] },
      { tunables },
    );
  }
  return showPolicyEstimate(read, promotion, area, level, outlook, tunables);
}

export const financePoliciesQuery: QueryDefinition<'finance.policies'> = defineQuery(
  'finance.policies',
  {
    args: z.strictObject({ promotionId: zId('promotion') }),
    run: (ctx, args) => {
      const promotion = booksOf(ctx, args.promotionId);
      const outlook = upcomingShows(ctx.read, promotion.id, ctx.date, ctx.tunables);
      return {
        policies: POLICY_AREAS.map((area): PolicyView => {
          const level = promotion.policies[area];
          const estimate = policyEstimate(
            ctx.read,
            promotion,
            area,
            level,
            ctx.date,
            outlook,
            ctx.tunables,
          );
          return {
            area,
            level,
            label: POLICY_LEVEL_LABELS[level],
            description: POLICY_AREA_DESCRIPTIONS[area],
            monthlyEstimate: estimate.value,
            monthlyEstimateTrace: estimate.trace,
          };
        }),
      };
    },
  },
);

export const financePolicyPreviewQuery: QueryDefinition<'finance.policyPreview'> = defineQuery(
  'finance.policyPreview',
  {
    args: z.strictObject({ promotionId: zId('promotion'), area: z.enum(POLICY_AREAS) }),
    run: (ctx, args) => {
      const promotion = booksOf(ctx, args.promotionId);
      const { area } = args;
      const current = promotion.policies[area];
      const outlook = upcomingShows(ctx.read, promotion.id, ctx.date, ctx.tunables);
      const costs = POLICY_LEVELS.map((level) =>
        policyEstimate(ctx.read, promotion, area, level, ctx.date, outlook, ctx.tunables),
      );
      const currentCost = costs[current]?.value ?? 0;
      return {
        area,
        current,
        levels: POLICY_LEVELS.map((level): PolicyLevelPreview => {
          const cost = costs[level];
          if (cost === undefined) {
            throw new Error(`finance.policyPreview: no estimate for level ${String(level)}`);
          }
          return {
            level,
            label: POLICY_LEVEL_LABELS[level],
            monthlyCost: cost.value,
            monthlyCostTrace: cost.trace,
            delta: cost.value - currentCost,
            effects: policyEffectLines(ctx.read, promotion.id, area, level, ctx.tunables),
          };
        }),
      };
    },
  },
);

export const financePolicyQueries = [financePoliciesQuery, financePolicyPreviewQuery] as const;
