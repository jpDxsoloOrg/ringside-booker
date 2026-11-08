/**
 * Titles: the championships a promotion defends.
 *
 * A title row holds what the belt is (who may hold it, how many holders, its prestige) and nothing
 * about who holds it now. The lineage is data in `titleReigns`; the current champion is the open
 * reign, found with `titleReigns.lookupOne('openByTitle', titleId)`. Storing a "current champion"
 * here as well would give two answers that can drift apart.
 *
 * Design notes: docs/design/data-model.md, "Titles, events, storylines and seasons".
 */

import { z } from 'zod';
import { compareDates } from '../../core/date';
import { defineTable } from '../table-def';
import { zGameDate, zId, zImageRef, zStat } from '../primitives';
import { isPresentIff, zName } from './entity-refinements';

export const TITLE_STATUSES = ['active', 'retired'] as const;
export type TitleStatus = (typeof TITLE_STATUSES)[number];

export const DIVISION_GENDERS = ['open', 'male', 'female'] as const;
export type DivisionGender = (typeof DIVISION_GENDERS)[number];

/** How many people hold the title at once: 1 for singles, 2 for tag, 3 for trios. */
export const TITLE_HOLDER_COUNTS = [1, 2, 3] as const;
export type TitleHolderCount = (typeof TITLE_HOLDER_COUNTS)[number];

/** A colour as `#rrggbb`, used for the placeholder belt art until real images arrive. */
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Who may hold a title. Weight limits are in kilograms; null means no limit on that side. */
export const TitleDivisionSchema = z
  .strictObject({
    gender: z.enum(DIVISION_GENDERS),
    minWeightKg: z.number().positive().nullable(),
    maxWeightKg: z.number().positive().nullable(),
  })
  .refine(
    (division) =>
      division.minWeightKg === null ||
      division.maxWeightKg === null ||
      division.minWeightKg <= division.maxWeightKg,
    { message: 'minWeightKg must not be above maxWeightKg', path: ['maxWeightKg'] },
  );

export const TitleSchema = z
  .strictObject({
    id: zId('title'),
    promotionId: zId('promotion'),
    /** The brand the title belongs to, or null for a promotion-wide title. */
    brandId: zId('brand').nullable(),
    name: zName(60),
    holderCount: z.literal(TITLE_HOLDER_COUNTS),
    division: TitleDivisionSchema,
    /** How much the title is worth to win and defend. 0-100. */
    prestige: zStat,
    status: z.enum(TITLE_STATUSES),
    introducedOn: zGameDate,
    /** Set exactly when the title is retired. */
    retiredOn: zGameDate.nullable(),
    imageRef: zImageRef,
    color: z.string().regex(HEX_COLOR_PATTERN, 'Expected a colour such as #c9a227'),
  })
  .refine((title) => isPresentIff(title.retiredOn, title.status === 'retired'), {
    message: 'retiredOn is set exactly when status is retired',
    path: ['retiredOn'],
  })
  .refine(
    (title) => title.retiredOn === null || compareDates(title.retiredOn, title.introducedOn) >= 0,
    { message: 'retiredOn must not be before introducedOn', path: ['retiredOn'] },
  );

export type TitleDivision = z.infer<typeof TitleDivisionSchema>;
export type Title = z.infer<typeof TitleSchema>;

export const titlesTable = defineTable({
  kind: 'title',
  name: 'titles',
  schema: TitleSchema,
  refs: [
    { path: 'promotionId', target: 'promotion', nullable: false },
    { path: 'brandId', target: 'brand', nullable: true },
  ],
  indexes: [{ name: 'byPromotion', key: (title) => title.promotionId }],
});
