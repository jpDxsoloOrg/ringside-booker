/**
 * Monthly production overhead: what music, writing, marketing and back office cost a promotion
 * each month, in whole cents, with the same total split by ledger category.
 *
 * Design: docs/design/production.md#area-costs. The total is the sum of {@link areaCost} over
 * `MONTHLY_AREAS`, one line per area ("Marketing (level 8)"). `byCategory` sums the same lines per
 * ledger category (music and writing → `production`, marketing → `marketing`, back office →
 * `backOffice`), each with its own trace, so the monthly posting writes one entry per category.
 */

import { startCalc } from '../../../core/trace/calc';
import type { Traced } from '../../../core/trace/types';
import type { Production, ProductionArea } from '../../../model/entities/promotion';
import type { EngineTunables } from '../../tunables';
import {
  AREA_LABELS,
  AREA_LEDGER_CATEGORY,
  MONTHLY_AREAS,
  type ProductionLedgerCategory,
} from '../areas';
import { areaCost } from './areaCost';
import { AREA_COSTS_DOC_REF } from './shared';

/** What each production ledger category's part of the overhead is called in its Why?. */
export const PRODUCTION_CATEGORY_LABELS: Readonly<Record<ProductionLedgerCategory, string>> =
  Object.freeze({
    production: 'Production',
    marketing: 'Marketing',
    backOffice: 'Back office',
  });

export interface ProductionMonthlyCostInputs {
  promotionName: string;
  levels: Production;
}

export interface ProductionMonthlyCost {
  /** The whole month's overhead, in cents (unit `money/month`). */
  total: Traced<number>;
  /** The same overhead split by ledger category; each adds up to its share of `total`. */
  byCategory: Record<ProductionLedgerCategory, Traced<number>>;
}

/** The line one area adds: "Marketing (level 8)". */
export function areaLineLabel(area: ProductionArea, level: number): string {
  return `${AREA_LABELS[area]} (level ${String(level)})`;
}

/** A promotion's monthly production overhead, in total and by ledger category. */
export function productionMonthlyCost(
  inputs: ProductionMonthlyCostInputs,
  deps: { tunables: EngineTunables },
): ProductionMonthlyCost {
  const costs = MONTHLY_AREAS.map((area) => ({
    area,
    cost: areaCost({ area, level: inputs.levels[area], importance: null }, deps),
  }));

  const total = startCalc(`${inputs.promotionName} production overhead this month`, 0, {
    unit: 'money/month',
    docRef: AREA_COSTS_DOC_REF,
    startLabel: 'Nothing yet',
  });
  for (const { area, cost } of costs) {
    total.add(areaLineLabel(area, inputs.levels[area]), cost);
  }

  const categoryCost = (category: ProductionLedgerCategory): Traced<number> => {
    const calc = startCalc(
      `${inputs.promotionName} ${PRODUCTION_CATEGORY_LABELS[category].toLowerCase()} overhead this month`,
      0,
      { unit: 'money/month', docRef: AREA_COSTS_DOC_REF, startLabel: 'Nothing yet' },
    );
    for (const { area, cost } of costs) {
      if (AREA_LEDGER_CATEGORY[area] === category) {
        calc.add(areaLineLabel(area, inputs.levels[area]), cost);
      }
    }
    return calc.done();
  };
  const byCategory: Record<ProductionLedgerCategory, Traced<number>> = {
    production: categoryCost('production'),
    marketing: categoryCost('marketing'),
    backOffice: categoryCost('backOffice'),
  };

  return { total: total.done(), byCategory };
}
