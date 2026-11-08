/**
 * Promotion styles: the kind of wrestling a promotion books and an audience prefers.
 *
 * Kept in its own file so the geography schemas (a country's or region's preferred style) and the
 * promotion schema share one list without depending on each other.
 */

import { z } from 'zod';

export const PROMOTION_STYLES = [
  'mainstream',
  'traditional',
  'technical',
  'hardHitting',
  'hardcore',
  'highFlying',
  'entertainment',
] as const;

export const PromotionStyleSchema = z.enum(PROMOTION_STYLES);

export type PromotionStyle = z.infer<typeof PromotionStyleSchema>;
