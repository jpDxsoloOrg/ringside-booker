/**
 * The production ceiling as a show score `cap` modifier (EVT4-02): every show of every promotion,
 * carded or scored off-screen, is held to its promotion's production ceiling. The score keeps the
 * lower of the two; the result's `rawScore` keeps what the card earned.
 *
 * Design: docs/design/card-flow.md#production-ceiling.
 */

import { isJsonObject, type JsonValue } from '../../core/json';
import type { Calc } from '../../core/trace';
import { registerShowScoreModifier, type ShowScoreModifier } from '../shows/showScoreModifiers';
import type { EngineTunables } from '../tunables';
import {
  ceilingLevelsOf,
  productionCeiling,
  productionCeilingValue,
  type CeilingLevels,
  type ProductionCeilingInputs,
} from './formulas/productionCeiling';

export const PRODUCTION_CEILING_MODIFIER_ID = 'cardFlow.productionCeiling';

/** The words of the cap's lines in the show score's Why?. */
export const PRODUCTION_CEILING_STEP_LABELS = {
  min: 'Production ceiling',
  heldBack: 'Production held the score back',
} as const;

function levelOf(extra: Readonly<Record<string, JsonValue>>, area: string): number {
  const level = extra[area];
  if (typeof level !== 'number') {
    throw new TypeError(`Production ceiling: the gathered levels have no ${area} level`);
  }
  return level;
}

/** Reads what `gather` stored back into the formula's inputs. */
function ceilingInputsOf(extra: JsonValue | undefined): ProductionCeilingInputs {
  if (extra === undefined || !isJsonObject(extra) || typeof extra['promotionName'] !== 'string') {
    throw new TypeError('Production ceiling: the show score has no gathered production levels');
  }
  const levels = isJsonObject(extra['levels']) ? extra['levels'] : {};
  return {
    promotionName: extra['promotionName'],
    levels: {
      stage: levelOf(levels, 'stage'),
      camera: levelOf(levels, 'camera'),
      editing: levelOf(levels, 'editing'),
      pyro: levelOf(levels, 'pyro'),
    },
  };
}

/** Adds the ceiling's lines: `min` with the ceiling's own breakdown, then whether it held. */
export function applyProductionCeiling(
  calc: Calc,
  extra: JsonValue | undefined,
  tunables: EngineTunables,
): void {
  const ceiling = productionCeiling(ceilingInputsOf(extra), tunables);
  const before = calc.current;
  calc.min(PRODUCTION_CEILING_STEP_LABELS.min, ceiling);
  calc.branch(PRODUCTION_CEILING_STEP_LABELS.heldBack, before > ceiling.value);
}

function levelsJson(levels: CeilingLevels): JsonValue {
  return { stage: levels.stage, camera: levels.camera, editing: levels.editing, pyro: levels.pyro };
}

export const productionCeilingModifier: ShowScoreModifier = {
  id: PRODUCTION_CEILING_MODIFIER_ID,
  stage: 'cap',
  order: 10,
  gather: (read, show) => {
    const promotion = read.tables.promotions.require(show.promotionId);
    return {
      promotionName: promotion.name,
      levels: levelsJson(ceilingLevelsOf(read, show.promotionId)),
    };
  },
  apply: (calc, _inputs, extra, deps) => {
    applyProductionCeiling(calc, extra, deps.tunables);
  },
  limit: (extra, deps) => productionCeilingValue(ceilingInputsOf(extra).levels, deps.tunables),
};

// Registered once at module load, like the shows system's title applier.
registerShowScoreModifier(productionCeilingModifier);
