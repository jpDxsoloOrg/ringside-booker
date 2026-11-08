/**
 * What the new-game wizard sends: `newGameInputSchema`.
 *
 * The schema checks shapes only. Rules that need the loaded world (a promotion key that exists, a
 * short name nobody uses, a known home region, a start date on or after the pack's) and rules with
 * their own reason codes (setting values, custom season weeks, tunable overrides) are checked by
 * `createNewGame` after parsing, so every refusal comes back as a `Reason` with a field the wizard
 * can point at.
 *
 * See docs/design/new-game.md#input.
 */

import { z } from 'zod';
import { zWeekday } from '../../core/date';
import { zGameDate } from '../../model/primitives';
import { HEX_COLOR_PATTERN, SHORT_NAME_PATTERN } from '../../model/entities/promotion';
import { PromotionStyleSchema } from '../../model/entities/promotion-style';
import { PLAYER_ID_MAX_LENGTH } from '../../model/world-meta';
import { SEASON_PRESET_KEYS } from './season';

/** The sizes a founded promotion can start at. */
export const FOUNDING_SIZES = ['small', 'medium', 'large'] as const;
export type FoundingSize = (typeof FOUNDING_SIZES)[number];

export const SEED_MAX_LENGTH = 64;
export const PLAYER_NAME_MAX_LENGTH = 40;
export const SAVE_NAME_MAX_LENGTH = 60;
export const FOUNDED_NAME_MIN_LENGTH = 3;
export const FOUNDED_NAME_MAX_LENGTH = 48;

const seasonLengthSchema = z.union([
  z.strictObject({ preset: z.enum(SEASON_PRESET_KEYS) }),
  // The range (4-104 whole weeks) is checked after parsing so its reason names the field.
  z.strictObject({ customWeeks: z.number() }),
]);

const existingPromotionSchema = z.strictObject({
  mode: z.literal('existing'),
  /** The pack key of the promotion to take over. */
  promotionKey: z.string().min(1),
});

const foundPromotionSchema = z.strictObject({
  mode: z.literal('found'),
  name: z.string().trim().min(FOUNDED_NAME_MIN_LENGTH).max(FOUNDED_NAME_MAX_LENGTH),
  /** Upper-cased on parse, then 2-8 letters or digits. */
  shortName: z
    .string()
    .trim()
    .toUpperCase()
    .regex(SHORT_NAME_PATTERN, 'Expected 2-8 letters or digits'),
  /** The pack key of the home region. */
  homeRegionKey: z.string().min(1),
  style: PromotionStyleSchema,
  size: z.enum(FOUNDING_SIZES),
  color: z.string().regex(HEX_COLOR_PATTERN, 'Expected a hex colour such as #1a2b3c'),
  /** A vacant singles title and a weekly show. */
  starterKit: z.boolean(),
  /** The weekday of the starter kit's weekly show (0 = Monday). */
  weeklyShowDay: zWeekday,
});

export const newGameInputSchema = z.strictObject({
  /** The world pack to start from; its dependencies are loaded with it. */
  rootPackId: z.string().min(1),
  seed: z.string().min(1).max(SEED_MAX_LENGTH),
  /** Defaults to the world pack's start date; may not be before it. */
  startDate: zGameDate.optional(),
  /** The human controller's player ID (the wizard passes the local player's). */
  playerId: z.string().min(1).max(PLAYER_ID_MAX_LENGTH),
  playerName: z.string().trim().min(1).max(PLAYER_NAME_MAX_LENGTH),
  /** Becomes the world's name. */
  saveName: z.string().trim().min(1).max(SAVE_NAME_MAX_LENGTH),
  seasonLength: seasonLengthSchema,
  player: z.discriminatedUnion('mode', [existingPromotionSchema, foundPromotionSchema]),
  /** Setting key to value; left-out settings take their default. */
  settings: z.record(z.string(), z.union([z.boolean(), z.string()])),
  /** Tunable key to value, checked against each tunable's range. */
  tunableOverrides: z.record(z.string(), z.number()).optional(),
});

export type NewGameInput = z.output<typeof newGameInputSchema>;
export type ExistingPromotionChoice = z.output<typeof existingPromotionSchema>;
export type FoundPromotionChoice = z.output<typeof foundPromotionSchema>;
export type PlayerChoice = NewGameInput['player'];
