/**
 * Upgrade fee: the one-time cost of raising a production area from one level to another, in whole
 * cents.
 *
 * Design: docs/design/production.md#upgrade-fee. Lowering or keeping a level is free. Raising it
 * costs the area's fee for 0 → 10 (`production.upgradeFee.<area>`) × (curve(to) − curve(from)), on
 * the same curve as the running costs. Each end is rounded to the cent before the subtraction, so
 * the fees telescope exactly: 2 → 3 then 3 → 4 costs to the cent what 2 → 4 costs.
 */

import { startCalc } from '../../../core/trace/calc';
import type { Traced } from '../../../core/trace/types';
import type { ProductionArea } from '../../../model/entities/promotion';
import type { EngineTunables } from '../../tunables';
import { AREA_LABELS } from '../areas';
import {
  assertProductionLevel,
  costCurveAt,
  moneyText,
  UPGRADE_FEE_DOC_REF,
  UPGRADE_FEE_KEYS,
} from './shared';

/** The branch every fee records: taken when the level goes down or stays the same. */
export const LOWERING_IS_FREE = 'Lowering a level is free';

export interface UpgradeFeeInputs {
  area: ProductionArea;
  /** The level now, 0..10. */
  from: number;
  /** The level wanted, 0..10. */
  to: number;
}

/** The fee for raising `area` from 0 to `level`, rounded to the cent. */
function feeFromZero(
  area: ProductionArea,
  level: number,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const label = AREA_LABELS[area];
  const calc = startCalc(`${label} fee for 0 → ${String(level)}`, costCurveAt(area, level, deps), {
    unit: 'money',
    docRef: UPGRADE_FEE_DOC_REF,
  });
  const feeAtTen = calc.tunable(deps.tunables, UPGRADE_FEE_KEYS[area]);
  return calc
    .multiply(`${label} fee for 0 → 10: ${moneyText(feeAtTen)}`, feeAtTen)
    .round('round', 'Rounded to the cent')
    .done();
}

/** What raising `area` from `from` to `to` costs once, in cents (unit `money`). */
export function upgradeFee(
  inputs: UpgradeFeeInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { area, from, to } = inputs;
  assertProductionLevel('upgradeFee', 'from', from);
  assertProductionLevel('upgradeFee', 'to', to);
  const title = `${AREA_LABELS[area]} ${String(from)} → ${String(to)}`;
  if (to <= from) {
    return startCalc(title, 0, {
      unit: 'money',
      docRef: UPGRADE_FEE_DOC_REF,
      startLabel: 'No fee',
    })
      .branch(LOWERING_IS_FREE, true)
      .done();
  }
  return startCalc(title, feeFromZero(area, to, deps), {
    unit: 'money',
    docRef: UPGRADE_FEE_DOC_REF,
  })
    .branch(LOWERING_IS_FREE, false)
    .subtract(`Already paid for 0 → ${String(from)}`, feeFromZero(area, from, deps))
    .done();
}
