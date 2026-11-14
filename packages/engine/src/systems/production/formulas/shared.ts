/**
 * Pieces every production formula shares: the level check, the cost curve and the money labels.
 *
 * Design: docs/design/production.md#area-costs. The curve is (level ÷ 10) ^ `production.costCurve`:
 * 0 at level 0, 1 at level 10, a straight line when the curve is 1 and cheap low levels above it.
 */

import { InvalidArgumentError } from '../../../core/errors';
import { startCalc } from '../../../core/trace/calc';
import { constantOf, inputOf } from '../../../core/trace/helpers';
import type { Traced } from '../../../core/trace/types';
import {
  PRODUCTION_LEVEL_MAX,
  PRODUCTION_LEVEL_MIN,
  type ProductionArea,
} from '../../../model/entities/promotion';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { AREA_LABELS } from '../areas';

export const AREA_COSTS_DOC_REF = 'docs/design/production.md#area-costs';
export const PER_SHOW_COSTS_DOC_REF = 'docs/design/production.md#per-show-costs';
export const UPGRADE_FEE_DOC_REF = 'docs/design/production.md#upgrade-fee';
export const POPULARITY_CEILING_DOC_REF = 'docs/design/production.md#popularity-ceiling';
export const POPULARITY_DRAG_DOC_REF = 'docs/design/production.md#popularity-drag';

/** Throws unless `level` is a whole production level, 0 to 10. */
export function assertProductionLevel(functionName: string, argument: string, level: number): void {
  if (!Number.isInteger(level) || level < PRODUCTION_LEVEL_MIN || level > PRODUCTION_LEVEL_MAX) {
    throw new InvalidArgumentError(
      functionName,
      argument,
      level,
      `a whole number from ${String(PRODUCTION_LEVEL_MIN)} to ${String(PRODUCTION_LEVEL_MAX)}`,
    );
  }
}

/** A number as the Why? prints it: up to three decimals, no trailing zeros ("0.064", "0.4"). */
export function shortNumberText(value: number): string {
  return String(Number(value.toFixed(3)));
}

const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g;

/** Whole cents as dollars with thousands separators: "$150,000", "$4,800.50", "-$12". */
export function moneyText(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(Math.round(cents));
  const dollars = Math.floor(absolute / 100);
  const rest = absolute % 100;
  const grouped = String(dollars).replace(THOUSANDS, ',');
  return `${sign}$${grouped}${rest === 0 ? '' : `.${String(rest).padStart(2, '0')}`}`;
}

/** The upgrade-fee key for each area: the fee for raising it from 0 all the way to 10. */
export const UPGRADE_FEE_KEYS: Readonly<Record<ProductionArea, NumberTunableKey>> = Object.freeze({
  stage: 'production.upgradeFee.stage',
  camera: 'production.upgradeFee.camera',
  editing: 'production.upgradeFee.editing',
  pyro: 'production.upgradeFee.pyro',
  music: 'production.upgradeFee.music',
  writing: 'production.upgradeFee.writing',
  marketing: 'production.upgradeFee.marketing',
  backOffice: 'production.upgradeFee.backOffice',
});

/**
 * The cost curve at `level`: (level ÷ 10) ^ `production.costCurve`. Titled
 * "Curve at 4: 0.064" and traced as "Camera level 4 of 10", "Top level", "Cost curve" (the Why?
 * reads it as "0.4 raised to the power 3 = 0.064").
 */
export function costCurveAt(
  area: ProductionArea,
  level: number,
  deps: { tunables: EngineTunables },
): Traced<number> {
  assertProductionLevel('costCurveAt', 'level', level);
  // Only for the title: the steps below do the real arithmetic, and the replay checks them.
  const preview = (level / PRODUCTION_LEVEL_MAX) ** deps.tunables.get('production.costCurve');
  const calc = startCalc(
    `Curve at ${String(level)}: ${shortNumberText(preview)}`,
    inputOf(`${AREA_LABELS[area]} level ${String(level)} of 10`, level),
    { unit: 'ratio', docRef: AREA_COSTS_DOC_REF },
  );
  calc.divide(
    'Top level',
    constantOf('Top level', PRODUCTION_LEVEL_MAX, 'production levels run 0 to 10'),
  );
  const curve = calc.tunable(deps.tunables, 'production.costCurve');
  return calc.power('Cost curve', curve).done();
}
