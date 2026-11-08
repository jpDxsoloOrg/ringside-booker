/**
 * Brands: the shows-and-roster divisions inside a promotion.
 *
 * Every promotion has at least one brand once WLD-10 founds it. A brand can carry its own
 * controller for brand wars (D-06); a null controller means the promotion's controller runs it.
 */

import { z } from 'zod';
import { ControllerSchema, CONTROLLER_PLAYER_REF } from '../controller';
import { zId, zImageRef, zNonNegativeInt } from '../primitives';
import { defineTable } from '../table-def';

export const BrandSchema = z.strictObject({
  id: zId('brand'),
  promotionId: zId('promotion'),
  name: z.string().min(1).max(40),
  logoRef: zImageRef,
  /** Display and booking order inside the promotion; lower = more important (0 = flagship). */
  priority: zNonNegativeInt,
  active: z.boolean(),
  /** Null = run by the promotion's controller. Set per brand for brand wars (D-06). */
  controller: ControllerSchema.nullable(),
});

export type Brand = z.infer<typeof BrandSchema>;

export const brandsTable = defineTable({
  kind: 'brand',
  name: 'brands',
  schema: BrandSchema,
  refs: [{ path: 'promotionId', target: 'promotion', nullable: false }, CONTROLLER_PLAYER_REF],
  indexes: [{ name: 'byPromotion', key: (brand) => brand.promotionId }],
});
