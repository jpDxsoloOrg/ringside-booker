/**
 * The cash runway (ECO7-06): the `production.cashRunway` query behind the "Cash runway" cards on
 * Finances and Production, and the warning they show when money is running out.
 *
 * It gathers the inputs of the `cashRunway` formula: the wages, medical and production costs priced
 * ahead at today's levels, and everything else from the ledger rows of the last days played. Own
 * books only (the same rule as the Finances screen). Nothing is written or recorded.
 *
 * Design: docs/design/production.md#cash-runway.
 */

import { z } from 'zod';
import { defineQuery, type QueryDefinition } from '../../core/api/query';
import {
  addDays,
  diffDays,
  isAfter,
  isBefore,
  yearMonthOf,
  type GameDate,
  type YearMonth,
} from '../../core/date';
import type { PromotionId } from '../../core/ids';
import type { TraceNode } from '../../core/trace/types';
import type { LedgerCategory } from '../../model/entities/ledger-entry';
import type { Production, Promotion } from '../../model/entities/promotion';
import { zId } from '../../model/primitives';
import type { GameWorldView } from '../../model/tables';
import { MEDICAL_LEVEL_LABELS, monthlyMedical } from '../finance/formulas/monthlyMedical';
import { monthRows } from '../finance/months';
import { medicalHeadcount } from '../finance/payroll';
import { payrollFiguresOf } from '../finance/phases';
import { booksOf } from '../finance/queries/books';
import type { EngineTunables } from '../tunables';
import {
  cashRunway,
  type CashRunway,
  type CashRunwayInputs,
  type CashRunwayStatus,
  type RecentMoney,
} from './formulas/cashRunway';
import { productionMonthlyCost } from './formulas/productionMonthlyCost';
import { upcomingShowCost } from './formulas/productionShowCost';
import { upcomingShows } from './upcoming';

/**
 * Categories the runway prices ahead instead of reading from the ledger (they are charged once a
 * month, so a few weeks of rows would over- or under-count them), and one-off payments, which say
 * nothing about the rate. Upgrade fees are `production` rows, so they are left out with it.
 */
export const RUNWAY_SKIPPED_CATEGORIES: ReadonlySet<LedgerCategory> = new Set<LedgerCategory>([
  'wages',
  'medical',
  'production',
  'marketing',
  'backOffice',
  'signingBonuses',
  'severance',
  'buyout',
]);

/** `production.cashRunway`: how long the cash lasts at this rate. */
export interface CashRunwayView {
  promotionId: PromotionId;
  /** Cash now, in cents. */
  cash: number;
  status: CashRunwayStatus;
  /** Money made (positive) or lost (negative) a month at this rate, in cents. */
  monthlyNet: number;
  monthlyNetTrace: TraceNode;
  /** Months the cash lasts; null unless `status` is `losingMoney` or `runningOut`. */
  monthsLeft: number | null;
  monthsLeftTrace: TraceNode | null;
  /** The fixed spend a month priced ahead: wages, medical, overhead and show production. */
  spend: { wages: number; medical: number; overhead: number; showProduction: number };
  /** `production.runway.warnBelowMonths`: below this many months the screens warn. */
  warnBelowMonths: number;
  /** Days of play still needed before the runway counts show money; 0 once it does. */
  daysUntilForecast: number;
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'production.cashRunway': { args: { promotionId: PromotionId }; result: CashRunwayView };
  }
}

/** The months a window of days touches, oldest first. */
function monthsBetween(from: GameDate, to: GameDate): YearMonth[] {
  const first = yearMonthOf(from);
  const last = yearMonthOf(to);
  return first === last ? [first] : [first, last];
}

/**
 * The promotion's money in the categories the runway does not price ahead, over the last `days`
 * days before `date` (rows dated `date − days` up to the day before `date`).
 */
export function recentOtherMoney(
  read: GameWorldView,
  promotionId: PromotionId,
  date: GameDate,
  days: number,
): RecentMoney {
  const from = addDays(date, -days);
  const to = addDays(date, -1);
  let net = 0;
  for (const month of monthsBetween(from, to)) {
    for (const row of monthRows(read, promotionId, month)) {
      if (isBefore(row.date, from) || isAfter(row.date, to)) {
        continue;
      }
      if (RUNWAY_SKIPPED_CATEGORIES.has(row.category)) {
        continue;
      }
      net += row.amount;
    }
  }
  return { net, days };
}

/**
 * The inputs of the runway of `promotion` on `date`, with production priced at `levels` (its own by
 * default; the change dialog passes the levels after a change).
 */
export function cashRunwayInputsOf(
  read: GameWorldView,
  promotion: Promotion,
  date: GameDate,
  tunables: EngineTunables,
  levels: Production = promotion.production,
): CashRunwayInputs {
  const payroll = payrollFiguresOf(read, promotion, date, tunables);
  const medicalLevel = promotion.policies.medical;
  const medical = monthlyMedical(
    {
      contracts: medicalHeadcount(payroll.lines),
      level: medicalLevel,
      levelLabel: MEDICAL_LEVEL_LABELS[medicalLevel],
    },
    { tunables },
  );
  const overhead = productionMonthlyCost({ promotionName: promotion.name, levels }, { tunables });
  const forecastDays = tunables.get('production.forecastDays');
  const shows = upcomingShows(read, promotion.id, date, forecastDays);
  const showProduction = upcomingShowCost(
    { promotionName: promotion.name, shows, levels },
    { tunables },
  );
  const played = daysPlayed(read, date);
  const window = Math.min(
    tunables.get('production.runway.lookbackDays'),
    tunables.get('history.keepDetailDays'),
    played,
  );
  const recent =
    played < tunables.get('production.runway.minDaysPlayed') || window < 1
      ? null
      : recentOtherMoney(read, promotion.id, date, window);
  return {
    promotionName: promotion.name,
    cash: promotion.cash,
    payroll: payroll.monthly,
    medical,
    overhead: overhead.total,
    showProduction,
    forecastDays,
    recent,
  };
}

/** How many days have been played since the game started. */
function daysPlayed(read: GameWorldView, date: GameDate): number {
  return Math.max(0, diffDays(read.meta.startDate, date));
}

/** The runway of `promotion` on `date`, with production priced at `levels`. */
export function cashRunwayOf(
  read: GameWorldView,
  promotion: Promotion,
  date: GameDate,
  tunables: EngineTunables,
  levels: Production = promotion.production,
): CashRunway {
  return cashRunway(cashRunwayInputsOf(read, promotion, date, tunables, levels), { tunables });
}

/** A month of `amount` spread over `days` days, to the cent (a month is 365 ÷ 12 days). */
function monthOf(amount: number, days: number): number {
  return Math.round(((amount / days) * 365) / 12);
}

export const cashRunwayQuery: QueryDefinition<'production.cashRunway'> = defineQuery(
  'production.cashRunway',
  {
    args: z.strictObject({ promotionId: zId('promotion') }),
    run: (ctx, args): CashRunwayView => {
      const promotion = booksOf(ctx, args.promotionId);
      const { read, date, tunables } = ctx;
      const inputs = cashRunwayInputsOf(read, promotion, date, tunables);
      const runway = cashRunway(inputs, { tunables });
      return {
        promotionId: promotion.id,
        cash: promotion.cash,
        status: runway.status,
        monthlyNet: runway.monthlyNet.value,
        monthlyNetTrace: runway.monthlyNet.trace,
        monthsLeft: runway.monthsLeft?.value ?? null,
        monthsLeftTrace: runway.monthsLeft?.trace ?? null,
        spend: {
          wages: inputs.payroll.value,
          medical: inputs.medical.value,
          overhead: inputs.overhead.value,
          showProduction: monthOf(inputs.showProduction.value, inputs.forecastDays),
        },
        warnBelowMonths: tunables.get('production.runway.warnBelowMonths'),
        daysUntilForecast: Math.max(
          0,
          tunables.get('production.runway.minDaysPlayed') - daysPlayed(read, date),
        ),
      };
    },
  },
);
