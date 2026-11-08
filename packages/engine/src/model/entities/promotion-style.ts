/**
 * Promotion styles: the kind of wrestling a promotion is known for.
 *
 * Kept in its own module so data that only needs the style list (world data, venues, networks)
 * can import it without pulling in the whole promotion schema.
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
