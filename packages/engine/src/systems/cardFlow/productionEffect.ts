/**
 * The show-quality ceiling as a production effect (ECO7-04): the line the Production screen shows
 * on the stage, camera, editing and pyro rows, and the before → after row the change dialog
 * shows when one of them moves. It goes through ECO7's effect seam (`registerProductionEffect`),
 * so the production screen never reads card-flow rules itself.
 *
 * Levels are public, so the line is too: a rival's production screen shows it as well.
 *
 * Design: docs/design/card-flow.md#production-ceiling, docs/design/production.md#effects.
 */

import { registerProductionEffect } from '../production/effects';
import { formatNumber } from '../world/people/labels';
import { CEILING_AREAS, productionCeiling } from './formulas/productionCeiling';

export const SHOW_CEILING_EFFECT_ID = 'cardFlow.showCeiling';

/** The line's label, also the change dialog's row label. */
export const SHOW_CEILING_EFFECT_LABEL = 'Show quality ceiling';

/** "Shows can score up to 59 (90 earns an extra main-card slot)". */
export function showCeilingText(ceiling: number, threshold: number): string {
  const reach = `Shows can score up to ${formatNumber(ceiling)}`;
  return ceiling >= threshold
    ? `${reach}, enough for an extra main-card slot`
    : `${reach} (${formatNumber(threshold)} earns an extra main-card slot)`;
}

export const unregisterShowCeilingEffect = registerProductionEffect({
  id: SHOW_CEILING_EFFECT_ID,
  // Before ECO7's TV camera minimum (20), so the ceiling reads first on the camera row.
  order: 10,
  areas: CEILING_AREAS,
  describe: (read, { promotionId, levels, tunables }) => {
    const promotion = read.tables.promotions.get(promotionId);
    if (promotion === undefined) {
      return null;
    }
    const ceiling = productionCeiling({ promotionName: promotion.name, levels }, tunables);
    return {
      id: SHOW_CEILING_EFFECT_ID,
      label: SHOW_CEILING_EFFECT_LABEL,
      value: ceiling.value,
      unit: 'points',
      text: showCeilingText(ceiling.value, tunables.get('production.bonusSlotThreshold')),
      trace: ceiling.trace,
    };
  },
});
