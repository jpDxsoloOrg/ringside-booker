/**
 * Milestone source `promotions` (DAY1-02): an active promotion's founding anniversary, the first
 * one and then every `news.milestones.promotionYearStep` years. Design: docs/design/news.md#milestones.
 */

import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import { registerNewsTopic } from '../topics';
import { anniversariesIn } from './dates';
import { type MilestoneCandidate, type MilestoneSource, type MilestoneWindow } from './registry';

export const PROMOTION_ANNIVERSARY_TOPIC = 'promotion-anniversary';

/** From this many years a promotion anniversary is front-page news. */
export const PROMOTION_MAJOR_YEARS = 25;

registerNewsTopic(PROMOTION_ANNIVERSARY_TOPIC, { params: ['promotionId', 'years', 'onDate'] });

function collectPromotions(
  read: GameWorldView,
  window: MilestoneWindow,
  deps: { readonly tunables: EngineTunables },
): MilestoneCandidate[] {
  const step = deps.tunables.get('news.milestones.promotionYearStep');
  const candidates: MilestoneCandidate[] = [];
  for (const promotion of read.tables.promotions.lookup('byStatus', 'active')) {
    for (const { years, onDate } of anniversariesIn(promotion.foundedOn, window)) {
      if (years !== 1 && years % step !== 0) {
        continue;
      }
      candidates.push({
        onDate,
        topic: PROMOTION_ANNIVERSARY_TOPIC,
        kind: 'business',
        importance: years >= PROMOTION_MAJOR_YEARS ? 3 : 2,
        params: { promotionId: promotion.id, years },
        bodyParams: {},
        refs: { promotionIds: [promotion.id] },
        dedupeKey: `promotion-anniversary:${promotion.id}:${String(years)}`,
      });
    }
  }
  return candidates;
}

export const promotionsSource: MilestoneSource = { id: 'promotions', collect: collectPromotions };
