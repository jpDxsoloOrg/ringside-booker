/**
 * Promotion history (DAY2-01): one row per promotion per Monday, plus a baseline row on the day a
 * new game starts.
 *
 * This is the only promotion-history table the game keeps (a person's history is WRK4's
 * `personSnapshots`). A row is a plain fact: no trace and no random draw is stored with it; the
 * Office rebuilds the live value's Why? when it is read. The built-in columns are cash, prestige,
 * the popularity roll-ups, roster size and average morale. Other features add single numbers to
 * the sparse `extra` map through `registerPromotionSnapshotField`, with no schema change: a key
 * that is missing from a row was not recorded that week (the field was registered later), while 0
 * is stored as 0.
 *
 * Rows older than `office.history.fullDetailWeeks` weeks are thinned to the last row of each
 * calendar month (`granularity: 'month'`); the baseline row is never thinned. See
 * docs/design/office.md#history.
 */

import { z } from 'zod';
import { zCents, zGameDate, zId, zNonNegativeInt, zSigned100, zStat } from '../primitives';
import { defineTable } from '../table-def';

/**
 * How much of the history one row stands for: a Monday (`week`), the last kept row of an older
 * month (`month`), or the day the game started (`baseline`).
 */
export const PROMOTION_SNAPSHOT_GRANULARITIES = ['week', 'month', 'baseline'] as const;
export const PromotionSnapshotGranularitySchema = z.enum(PROMOTION_SNAPSHOT_GRANULARITIES);
export type PromotionSnapshotGranularity = z.infer<typeof PromotionSnapshotGranularitySchema>;

/**
 * The key of an `extra` column: lower camelCase words joined by dots, for example
 * `morale.trend` or `hype`.
 */
export const SNAPSHOT_FIELD_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/;
export const SnapshotFieldKeySchema = z.string().regex(SNAPSHOT_FIELD_KEY_PATTERN);
export type SnapshotFieldKey = z.infer<typeof SnapshotFieldKeySchema>;

export const PromotionSnapshotPopularitySchema = z.strictObject({
  /** The figure the Office leads with (the home country's roll-up until DAY2-02 defines it). */
  headline: zStat,
  /** The population-weighted world roll-up. */
  world: zStat,
  /** The stored value in the promotion's home region (0 when none is stored). */
  homeRegion: zStat,
  /** Every continent's roll-up. Sparse: a continent at 0 is left out. */
  byContinent: z.record(zId('continent'), zStat.gt(0)),
});

export type PromotionSnapshotPopularity = z.infer<typeof PromotionSnapshotPopularitySchema>;

export const PromotionSnapshotSchema = z.strictObject({
  id: zId('promotionSnapshot'),
  promotionId: zId('promotion'),
  date: zGameDate,
  granularity: PromotionSnapshotGranularitySchema,
  /** Cash at the end of the day, in cents. May be negative. */
  cash: zCents,
  prestige: zStat,
  popularity: PromotionSnapshotPopularitySchema,
  /** People with an active contract that has started. */
  rosterSize: zNonNegativeInt,
  /** The mean morale of those contracts, unrounded; null when nobody is under contract. */
  averageMorale: zSigned100.nullable(),
  /** Registered fields, one number each. An absent key means "not recorded that week". */
  extra: z.record(SnapshotFieldKeySchema, z.number()),
});

export type PromotionSnapshot = z.infer<typeof PromotionSnapshotSchema>;

/** The `byPromotionDate` index key: one promotion on one day. */
export function promotionSnapshotKey(promotionId: string, date: string): string {
  return `${promotionId}|${date}`;
}

export const promotionSnapshotTable = defineTable({
  kind: 'promotionSnapshot',
  name: 'promotionSnapshots',
  schema: PromotionSnapshotSchema,
  refs: [
    { path: 'promotionId', target: 'promotion', nullable: false },
    { path: 'popularity.byContinent{}', target: 'continent', nullable: false },
  ],
  indexes: [
    { name: 'byPromotion', key: (row) => row.promotionId },
    /** Key `<promotionId>|<date>`: at most one row per promotion per day. */
    {
      name: 'byPromotionDate',
      key: (row) => promotionSnapshotKey(row.promotionId, row.date),
      unique: true,
    },
    { name: 'byDate', key: (row) => row.date },
  ],
});
