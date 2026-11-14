/**
 * Title tiers: World, Secondary and Specialty.
 *
 * The tier is a choice made when a title is created, and its only job is to set the starting
 * prestige (`formulas/startingPrestige.ts`). It is not stored on the title: once a title exists
 * only its prestige matters, so a Secondary belt that earns its way up is worth as much as a World
 * title with the same prestige, and saves need no new field.
 *
 * Design: docs/design/titles.md#tiers.
 */

import { z } from 'zod';

export const TITLE_TIERS = ['world', 'secondary', 'specialty'] as const;
export type TitleTier = (typeof TITLE_TIERS)[number];
export const TitleTierSchema = z.enum(TITLE_TIERS);

/** The tier as the player reads it. */
export const TITLE_TIER_LABELS: Readonly<Record<TitleTier, string>> = {
  world: 'World title',
  secondary: 'Secondary title',
  specialty: 'Specialty title',
};
