/**
 * Rival desk profiles (AIP1-01): one row per unit the computer runs.
 *
 * A unit is a computer-run promotion, or a brand with its own computer controller inside a
 * promotion the computer does not run (see `systems/aip/units.ts`). The row keeps what the rival
 * desk remembers between turns: its stored taste (null until AIP2 fills it), its featured workers
 * (null until AIP3 fills it) and the day of its last turn. The schema is complete for those later
 * features, so they need no save change.
 *
 * The taste axes live here, with the stored shape, so the model does not import from a system;
 * `systems/aip/taste.ts` re-exports them with their screen labels. See
 * docs/design/rival-desk.md#profiles.
 */

import { z } from 'zod';
import type { BrandId, EmploymentId, PromotionId } from '../../core/ids';
import type { IntegrityIssue } from '../integrity';
import { zGameDate, zId, zStat } from '../primitives';
import { defineTable } from '../table-def';
import { tableOf } from '../world';
import { brandsTable } from './brand';
import { employmentsTable } from './employment';

/** The eight ways a rival's taste can lean, each 0-100. */
export const TASTE_AXES = [
  'wrestlingFocus',
  'entertainmentFocus',
  'athleticFocus',
  'starFocus',
  'talkShare',
  'titleFocus',
  'youthFocus',
  'riskAppetite',
] as const;

export type TasteAxis = (typeof TASTE_AXES)[number];

export const TasteSchema = z.strictObject({
  wrestlingFocus: zStat,
  entertainmentFocus: zStat,
  athleticFocus: zStat,
  starFocus: zStat,
  talkShare: zStat,
  titleFocus: zStat,
  youthFocus: zStat,
  riskAppetite: zStat,
} satisfies Record<TasteAxis, typeof zStat>);

export type Taste = z.infer<typeof TasteSchema>;

/** One featured worker: an employment, not a person, so a person working two places is featured at one. */
export const FeaturedSlotSchema = z.strictObject({
  employmentId: zId('employment'),
  since: zGameDate,
});

export type FeaturedSlot = z.infer<typeof FeaturedSlotSchema>;

/** The unit's ace and up to two prospects (first, then second), as AIP3-03 fills them. */
export const FeaturedSchema = z.strictObject({
  ace: FeaturedSlotSchema.nullable(),
  prospects: z.array(FeaturedSlotSchema).max(2),
  nextReviewOn: zGameDate,
  lastReviewedOn: zGameDate,
});

export type Featured = z.infer<typeof FeaturedSchema>;

export const AiProfileSchema = z.strictObject({
  id: zId('aiProfile'),
  promotionId: zId('promotion'),
  /** Null for a whole promotion; set for a computer-run brand inside a human promotion. */
  brandId: zId('brand').nullable(),
  /** Null until the rival desk works out its taste (AIP2). */
  taste: TasteSchema.nullable(),
  /** Null until the rival desk first picks its featured workers (AIP3). */
  featured: FeaturedSchema.nullable(),
  createdOn: zGameDate,
  /** The day of the unit's last turn; null before its first. */
  lastTurnOn: zGameDate.nullable(),
});

export type AiProfile = z.infer<typeof AiProfileSchema>;

/** The key of a unit, and of its profile in the `byUnit` index: `<promotionId>|<brandId ?? '-'>`. */
export function aiUnitKey(promotionId: PromotionId, brandId: BrandId | null): string {
  return `${promotionId}|${brandId ?? '-'}`;
}

function featuredEmploymentIds(profile: AiProfile): { path: string; employmentId: EmploymentId }[] {
  if (profile.featured === null) {
    return [];
  }
  const slots: { path: string; employmentId: EmploymentId }[] = [];
  if (profile.featured.ace !== null) {
    slots.push({
      path: 'featured.ace.employmentId',
      employmentId: profile.featured.ace.employmentId,
    });
  }
  profile.featured.prospects.forEach((prospect, index) => {
    slots.push({
      path: `featured.prospects[${String(index)}].employmentId`,
      employmentId: prospect.employmentId,
    });
  });
  return slots;
}

export const aiProfilesTable = defineTable({
  kind: 'aiProfile',
  name: 'aiProfiles',
  schema: AiProfileSchema,
  refs: [
    { path: 'promotionId', target: 'promotion', nullable: false },
    { path: 'brandId', target: 'brand', nullable: true },
    { path: 'featured.ace.employmentId', target: 'employment', nullable: false },
    { path: 'featured.prospects[].employmentId', target: 'employment', nullable: false },
  ],
  indexes: [
    { name: 'byPromotion', key: (profile) => profile.promotionId },
    /** Key `aiUnitKey(promotionId, brandId)`: one profile per unit. */
    {
      name: 'byUnit',
      key: (profile) => aiUnitKey(profile.promotionId, profile.brandId),
      unique: true,
    },
  ],
  invariants: [
    {
      name: 'brandBelongsToPromotion',
      check(view): IntegrityIssue[] {
        const brands = tableOf(view, brandsTable);
        const issues: IntegrityIssue[] = [];
        for (const profile of tableOf(view, aiProfilesTable).values()) {
          if (profile.brandId === null) {
            continue;
          }
          const brand = brands.get(profile.brandId);
          if (brand !== undefined && brand.promotionId !== profile.promotionId) {
            issues.push({
              code: 'aiProfiles.brandOfOtherPromotion',
              table: 'aiProfiles',
              id: profile.id,
              path: 'brandId',
              message: `Profile ${profile.id} names brand ${profile.brandId} of another promotion`,
            });
          }
        }
        return issues;
      },
    },
    {
      name: 'featuredEmploymentsBelongToUnit',
      check(view): IntegrityIssue[] {
        const employments = tableOf(view, employmentsTable);
        const issues: IntegrityIssue[] = [];
        for (const profile of tableOf(view, aiProfilesTable).values()) {
          for (const slot of featuredEmploymentIds(profile)) {
            const employment = employments.get(slot.employmentId);
            if (employment === undefined) {
              continue;
            }
            const inUnit =
              employment.promotionId === profile.promotionId &&
              (profile.brandId === null || employment.brandId === profile.brandId);
            if (!inUnit) {
              issues.push({
                code: 'aiProfiles.featuredOutsideUnit',
                table: 'aiProfiles',
                id: profile.id,
                path: slot.path,
                message: `Profile ${profile.id} features employment ${slot.employmentId}, which is not in its unit`,
              });
            }
          }
        }
        return issues;
      },
    },
  ],
});
