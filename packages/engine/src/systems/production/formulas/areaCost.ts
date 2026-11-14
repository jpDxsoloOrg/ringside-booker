/**
 * Area cost: what one production area costs to run at its level, in whole cents.
 *
 * Design: docs/design/production.md#area-costs. cost = (level ÷ 10) ^ `production.costCurve` × the
 * area's price at level 10 (`production.showCost.<area>` for stage, camera, editing and pyro, paid
 * per show; `production.monthlyCost.<area>` for music, writing, marketing and back office, paid
 * monthly). A per-show area is then × `production.showCostMultiplier.<importance>` for the show's
 * importance. Rounded to the cent. Level 0 costs exactly 0.
 */

import { startCalc } from '../../../core/trace/calc';
import type { Traced } from '../../../core/trace/types';
import type { EventImportance } from '../../../model/entities/event-definition';
import type { ProductionArea } from '../../../model/entities/promotion';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { AREA_COST_KIND, AREA_LABELS } from '../areas';
import { AREA_COSTS_DOC_REF, costCurveAt, moneyText } from './shared';

/** The running-cost price of each area at level 10: per regular show, or per month. */
export const AREA_PRICE_KEYS: Readonly<Record<ProductionArea, NumberTunableKey>> = Object.freeze({
  stage: 'production.showCost.stage',
  camera: 'production.showCost.camera',
  editing: 'production.showCost.editing',
  pyro: 'production.showCost.pyro',
  music: 'production.monthlyCost.music',
  writing: 'production.monthlyCost.writing',
  marketing: 'production.monthlyCost.marketing',
  backOffice: 'production.monthlyCost.backOffice',
});

/** The per-show cost multiplier for each show importance. */
export const SHOW_COST_MULTIPLIER_KEYS: Readonly<Record<EventImportance, NumberTunableKey>> =
  Object.freeze({
    house: 'production.showCostMultiplier.house',
    minor: 'production.showCostMultiplier.minor',
    regular: 'production.showCostMultiplier.regular',
    major: 'production.showCostMultiplier.major',
    flagship: 'production.showCostMultiplier.flagship',
  });

/** Show importance as a production cost line reads it: "Minor show", "House show". */
export const IMPORTANCE_SHOW_LABELS: Readonly<Record<EventImportance, string>> = Object.freeze({
  house: 'House show',
  minor: 'Minor show',
  regular: 'Regular show',
  major: 'Major show',
  flagship: 'Flagship show',
});

/** The branch a monthly area records when it is given a show importance. */
export const MONTHLY_IGNORES_IMPORTANCE = 'Monthly cost: show importance does not apply';

export interface AreaCostInputs {
  area: ProductionArea;
  /** The area's level, a whole number 0..10. */
  level: number;
  /** The show's importance for a per-show area; null for the price of a regular show. */
  importance: EventImportance | null;
}

/** The running cost of one area at one level, in cents (unit `money`, or `money/month`). */
export function areaCost(
  inputs: AreaCostInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { area, level, importance } = inputs;
  const label = AREA_LABELS[area];
  const kind = AREA_COST_KIND[area];
  const calc = startCalc(`${label} at level ${String(level)}`, costCurveAt(area, level, deps), {
    unit: kind === 'monthly' ? 'money/month' : 'money',
    docRef: AREA_COSTS_DOC_REF,
  });
  const price = calc.tunable(deps.tunables, AREA_PRICE_KEYS[area]);
  calc.multiply(
    kind === 'monthly'
      ? `${label} at level 10: ${moneyText(price)} a month`
      : `${label} at level 10: ${moneyText(price)} per regular show`,
    price,
  );
  if (kind === 'monthly') {
    if (importance !== null) {
      calc.branch(MONTHLY_IGNORES_IMPORTANCE, true);
    }
  } else if (importance !== null) {
    const multiplier = calc.tunable(deps.tunables, SHOW_COST_MULTIPLIER_KEYS[importance]);
    calc.multiply(`${IMPORTANCE_SHOW_LABELS[importance]} × ${String(multiplier)}`, multiplier);
  }
  return calc.round('round', 'Rounded to the cent').done();
}
