/**
 * The production ceiling: the highest score a promotion's show can be stored with.
 *
 * `ceilingBase + Σ level × weight` over stage, camera, editing and pyro, kept within 0..100 and
 * never rounded. At the defaults (40, 1.5, 2, 1.5, 1) every area at 10 gives exactly 100.
 *
 * Design: docs/design/card-flow.md#production-ceiling.
 */

import type { PromotionId } from '../../../core/ids';
import { startCalc, type Traced } from '../../../core/trace';
import { tunableNode } from '../../../core/trace/tunable-node';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { formatNumber } from '../../world/people/labels';

export const PRODUCTION_CEILING_DOC_REF = 'docs/design/card-flow.md#production-ceiling';

/** The production areas that set the ceiling, in the order the formula adds them. */
export const CEILING_AREAS = ['stage', 'camera', 'editing', 'pyro'] as const;
export type CeilingArea = (typeof CEILING_AREAS)[number];

/** One level, 0 to 10, for each area that sets the ceiling. */
export type CeilingLevels = Readonly<Record<CeilingArea, number>>;

export interface ProductionCeilingInputs {
  promotionName: string;
  levels: CeilingLevels;
}

/** The lowest and highest ceiling: a show score is always within 0..100. */
export const PRODUCTION_CEILING_MIN = 0;
export const PRODUCTION_CEILING_MAX = 100;

const WEIGHT_KEYS = {
  stage: 'production.ceilingWeight.stage',
  camera: 'production.ceilingWeight.camera',
  editing: 'production.ceilingWeight.editing',
  pyro: 'production.ceilingWeight.pyro',
} as const satisfies Readonly<Record<CeilingArea, NumberTunableKey>>;

const AREA_NAMES: Readonly<Record<CeilingArea, string>> = {
  stage: 'Stage',
  camera: 'Camera',
  editing: 'Editing',
  pyro: 'Pyro',
};

/** The words of the ceiling's trace that other code matches on. */
export const PRODUCTION_CEILING_LABELS = {
  base: 'Base ceiling',
  clamp: 'A show score never goes past 100',
} as const;

/** The ceiling's trace label: "Production ceiling (Altura)". */
function ceilingLabel(promotionName: string): string {
  return `Production ceiling (${promotionName})`;
}

/**
 * The traced ceiling: the base, then one line per area ("Stage (level 8 × 1.5)"), then kept within
 * 0..100. A weight of 0 adds 0.
 */
export function productionCeiling(
  inputs: ProductionCeilingInputs,
  tunables: EngineTunables,
): Traced<number> {
  const base = tunables.get('production.ceilingBase');
  const calc = startCalc(
    ceilingLabel(inputs.promotionName),
    {
      value: base,
      trace: tunableNode(tunables, 'production.ceilingBase', PRODUCTION_CEILING_LABELS.base),
    },
    { unit: 'points', docRef: PRODUCTION_CEILING_DOC_REF },
  );
  for (const area of CEILING_AREAS) {
    const level = inputs.levels[area];
    const weight = calc.tunable(tunables, WEIGHT_KEYS[area], `${AREA_NAMES[area]} weight`);
    calc.add(
      `${AREA_NAMES[area]} (level ${formatNumber(level)} × ${formatNumber(weight)})`,
      level * weight,
    );
  }
  return calc
    .clamp(PRODUCTION_CEILING_MIN, PRODUCTION_CEILING_MAX, PRODUCTION_CEILING_LABELS.clamp)
    .done();
}

/**
 * The same number as {@link productionCeiling} without building a trace, for the paths that run
 * for every show of every promotion (the scheduler, the daily refresh). Same steps in the same
 * order, so the floating-point result is identical.
 */
export function productionCeilingValue(levels: CeilingLevels, tunables: EngineTunables): number {
  let value = tunables.get('production.ceilingBase');
  for (const area of CEILING_AREAS) {
    value += levels[area] * tunables.get(WEIGHT_KEYS[area]);
  }
  return Math.min(PRODUCTION_CEILING_MAX, Math.max(PRODUCTION_CEILING_MIN, value));
}

/** The promotion's stored levels of the areas that set the ceiling. */
export function ceilingLevelsOf(read: GameWorldView, promotionId: PromotionId): CeilingLevels {
  const { production } = read.tables.promotions.require(promotionId);
  return {
    stage: production.stage,
    camera: production.camera,
    editing: production.editing,
    pyro: production.pyro,
  };
}

/** The traced ceiling of a promotion from its stored production levels. */
export function productionCeilingOf(
  read: GameWorldView,
  promotionId: PromotionId,
  tunables: EngineTunables,
): Traced<number> {
  const promotion = read.tables.promotions.require(promotionId);
  return productionCeiling(
    { promotionName: promotion.name, levels: ceilingLevelsOf(read, promotionId) },
    tunables,
  );
}
