/**
 * World metadata: the facts about a game that are not rows in a table.
 *
 * Dates, the seed, the players taking part, the content packs the world was built from and the
 * settings chosen at new game. The settings are set by WLD-10's new-game command; later systems
 * read them.
 */

import { z } from 'zod';
import { compareDates } from '../core/date';
import { kindOfId } from '../core/ids';
import { zGameDate, zNonNegativeInt } from './primitives';

/** Shortest and longest allowed season, in days (four weeks to two years). */
export const SEASON_LENGTH_DAYS_MIN = 28;
export const SEASON_LENGTH_DAYS_MAX = 730;

export const GENERATION_LEVELS = ['off', 'low', 'medium', 'high'] as const;
export type GenerationLevel = (typeof GENERATION_LEVELS)[number];

/**
 * Settings chosen at new game. WLD-10's new-game command sets every one of them.
 *
 * There is deliberately no field naming "the player's promotion": the engine never assumes a single
 * player (design decision D-07). Who runs a promotion or a brand is the `controller` field on its
 * row.
 */
export const WorldSettingsSchema = z.strictObject({
  /** Whether people age and their skills follow age curves. */
  agingEnabled: z.boolean(),
  /** Sandbox mode: the player may edit the world freely. */
  sandbox: z.boolean(),
  /** How much new content (debuting wrestlers, new promotions) the world generates over time. */
  generationLevel: z.enum(GENERATION_LEVELS),
  /**
   * D-01: true switches off every computer-promotion shortcut. The AIP epic registers the `ai.*`
   * shortcut tunables and honours this flag. It is separate from WLD-10's one-time "equal start"
   * new-game option, which resets cash and popularity.
   */
  levelPlayingField: z.boolean(),
  season: z.strictObject({
    /**
     * D-08: length of each game season in days. Chosen at new game (WLD-10 turns the 1/3/6/12-month
     * presets or a custom number of weeks into days) and changeable between seasons; a change
     * applies from the next season. The season-end phase belongs to the DAY epic.
     */
    lengthDays: z.number().int().min(SEASON_LENGTH_DAYS_MIN).max(SEASON_LENGTH_DAYS_MAX),
  }),
  /**
   * Setup options registered by later epics. Built-in settings stay as named fields above; this
   * holds the extra ones by their registered key.
   */
  extra: z.record(z.string().min(1), z.union([z.boolean(), z.number(), z.string()])),
});

/** Longest allowed player identifier. Human controllers use the same limit. */
export const PLAYER_ID_MAX_LENGTH = 64;

export const PlayerSchema = z.strictObject({
  /** Stable player identifier, referenced by human controllers. */
  playerId: z.string().min(1).max(PLAYER_ID_MAX_LENGTH),
  displayName: z.string().min(1).max(40),
});

export const ContentPackRefSchema = z.strictObject({
  id: z.string().min(1),
  version: z.string().min(1),
});

/** An ID minted for a content-pack record. */
const zMintedId = z.string().refine((value) => kindOfId(value) !== null, {
  message: 'Expected an entity ID',
});

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

export const WorldMetaSchema = z
  .strictObject({
    worldName: z.string().min(1).max(80),
    startDate: zGameDate,
    currentDate: zGameDate,
    /** The game seed every RNG stream is derived from. */
    seed: z.string().min(1).max(64),
    settings: WorldSettingsSchema,
    /** Everyone playing this world. Every human controller's `playerId` must be listed here. */
    players: z
      .array(PlayerSchema)
      .refine((players) => !hasDuplicates(players.map((player) => player.playerId)), {
        message: 'playerId values must be unique',
      }),
    /** The content packs (and their versions) the world was built from. */
    contentPacks: z
      .array(ContentPackRefSchema)
      .refine((packs) => !hasDuplicates(packs.map((pack) => pack.id)), {
        message: 'content pack ids must be unique',
      }),
    /** Pack ID → pack record key → the ID minted for that record. Filled by WLD-02. */
    contentKeys: z.record(z.string().min(1), z.record(z.string().min(1), zMintedId)),
    /** Days the world has advanced since it was created. */
    daysSimulated: zNonNegativeInt,
  })
  .refine((meta) => compareDates(meta.currentDate, meta.startDate) >= 0, {
    message: 'currentDate must not be before startDate',
    path: ['currentDate'],
  });

export type WorldSettings = z.infer<typeof WorldSettingsSchema>;
export type Player = z.infer<typeof PlayerSchema>;
export type ContentPackRef = z.infer<typeof ContentPackRefSchema>;
export type WorldMeta = z.infer<typeof WorldMetaSchema>;
