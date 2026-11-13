/**
 * The rival rule behind off-screen injuries (D-01): computer-run promotions skip in-match injuries
 * while `ai.skipInMatchInjuries` is on, so their wrestlers get hurt off-screen more often instead.
 *
 * The answer comes from AIP1's `aiShortcutOn`, the one place that decides whether a Rival rules
 * shortcut applies (computer controller, level playing field off, the tunable on), so health never
 * looks at controllers itself. Design: docs/design/health.md#off-screen-injuries and
 * docs/design/rival-desk.md#shortcuts.
 */

import type { BrandId, PromotionId } from '../../core/ids';
import type { Traced } from '../../core/trace/types';
import type { GameWorldView } from '../../model/tables';
import { aiShortcutOn, registerAiShortcutConsumer } from '../aip/aiShortcut';
import type { EngineTunables } from '../tunables';

registerAiShortcutConsumer({
  key: 'ai.skipInMatchInjuries',
  featureId: 'WRK6',
  label: 'Off-screen injuries',
});

/**
 * Whether the rival rule "no in-match injuries" applies to a wrestler's employer (or the brand
 * they work for), traced; null for a free agent (`promotionId` null), whom no rival rule covers.
 */
export function offscreenShortcutOf(
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId | null,
  brandId: BrandId | null = null,
): Traced<boolean> | null {
  if (promotionId === null || read.tables.promotions.get(promotionId) === undefined) {
    return null;
  }
  return aiShortcutOn(read, tunables, promotionId, 'ai.skipInMatchInjuries', brandId);
}
