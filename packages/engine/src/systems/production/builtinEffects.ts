/**
 * ECO7's own production effects (ECO7-02), registered when the production system is imported:
 *
 * - `production.popularityCeiling` (marketing, back office): how popular the promotion can stay.
 * - `production.tvCameraMinimum` (camera): the camera floor while a broadcast deal runs. Shown to
 *   the promotion's own management only, because whether a rival has a deal is ECO8's to show.
 *
 * Design: docs/design/production.md#effects.
 */

import { AREA_LABELS } from './areas';
import { activeBroadcastDeal } from './deals';
import { registerProductionEffect } from './effects';
import { popularityCeiling } from './formulas/popularityCeiling';
import { shortNumberText } from './formulas/shared';

export const POPULARITY_CEILING_EFFECT_ID = 'production.popularityCeiling';
export const TV_CAMERA_MINIMUM_EFFECT_ID = 'production.tvCameraMinimum';

export const unregisterPopularityCeilingEffect = registerProductionEffect({
  id: POPULARITY_CEILING_EFFECT_ID,
  order: 10,
  areas: ['marketing', 'backOffice'],
  describe: (read, { promotionId, levels, tunables }) => {
    const promotion = read.tables.promotions.get(promotionId);
    if (promotion === undefined) {
      return null;
    }
    const ceiling = popularityCeiling(
      {
        promotionName: promotion.name,
        marketing: levels.marketing,
        backOffice: levels.backOffice,
      },
      { tunables },
    );
    return {
      id: POPULARITY_CEILING_EFFECT_ID,
      label: 'Popularity ceiling',
      value: ceiling.value,
      unit: 'points',
      text: `Popularity above ${shortNumberText(ceiling.value)} slowly falls back`,
      trace: ceiling.trace,
    };
  },
});

export const unregisterTvCameraMinimumEffect = registerProductionEffect({
  id: TV_CAMERA_MINIMUM_EFFECT_ID,
  order: 20,
  areas: ['camera'],
  ownOnly: true,
  describe: (read, { promotionId, date, tunables }) => {
    const deal = activeBroadcastDeal(read, promotionId, date);
    if (deal === null) {
      return null;
    }
    const network = read.tables.networks.get(deal.networkId)?.name ?? 'a network';
    const minimum = tunables.get('production.tvDealMinCamera');
    return {
      id: TV_CAMERA_MINIMUM_EFFECT_ID,
      label: `${AREA_LABELS.camera} minimum`,
      value: minimum,
      unit: 'level',
      text: `TV deal with ${network}: camera stays at ${String(minimum)} or higher`,
      trace: null,
    };
  },
});
