/**
 * One promotion's history row, built from the live world (DAY2-01).
 *
 * Every column is read straight from the world as it stands: cash and prestige from the promotion
 * row, popularity rolled up from its per-region values (D-03, through WRK1's roller), the roster
 * and its morale from the promotion's active contracts, and `extra` from the registered fields.
 * Nothing is rounded and nothing random is drawn. See docs/design/office.md#history.
 */

import { compareDates, type GameDate } from '../../../core/date';
import type { ContinentId, PromotionId } from '../../../core/ids';
import { promotionStatusKey } from '../../../model/entities/employment';
import type { PromotionSnapshot } from '../../../model/entities/promotion-snapshot';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import { createOfficeRoller, headlinePopularityValue, type OfficeRoller } from '../popularity';
import { extractSnapshotFields } from './snapshotFields';

/** The map and its popularity roller, worked out once per run and shared by every promotion. */
export type SnapshotRoller = OfficeRoller;

/** Builds the roller for one snapshot run. Call it once per run, not once per promotion. */
export function createSnapshotRoller(read: GameWorldView): SnapshotRoller {
  return createOfficeRoller(read);
}

/** A promotion snapshot's columns, without its id and granularity. */
export type PromotionSnapshotColumns = Omit<PromotionSnapshot, 'id' | 'granularity'>;

const POPULARITY_MAX = 100;

/** A rolled-up popularity kept inside 0..100 (a weighted mean can drift past 100 by rounding). */
function popularityValue(value: number): number {
  return Math.min(POPULARITY_MAX, Math.max(0, value));
}

/**
 * The snapshot of `promotionId` on `date`.
 *
 * - `cash`, `prestige`: the promotion row.
 * - `popularity.world` and `byContinent`: one `rollValues` call over `regionalPop`; continents at 0
 *   are left out.
 * - `popularity.homeRegionValue`: the stored value in the home region, 0 when none is stored.
 * - `popularity.headline`: the headline popularity (`headlinePopularityValue`), so a row and the
 *   live top bar always use the same `office.popularity.headlineScope`.
 * - `rosterSize`: active contracts that have started by `date`; `averageMorale` is their mean
 *   morale, or null when there are none.
 * - `extra`: every registered field (`registerPromotionSnapshotField`).
 */
export function buildPromotionSnapshot(
  read: GameWorldView,
  promotionId: PromotionId,
  date: GameDate,
  roller: SnapshotRoller,
  tunables: EngineTunables,
): PromotionSnapshotColumns {
  const promotion = read.tables.promotions.require(promotionId);
  const rolled = roller.popularity.rollValues(promotion.regionalPop);
  const byContinent: Record<ContinentId, number> = {};
  for (const continent of roller.geography.continents) {
    const value = popularityValue(rolled.continents[continent.id] ?? 0);
    if (value > 0) {
      byContinent[continent.id] = value;
    }
  }

  const contracts = read.tables.employments
    .lookup('byPromotionStatus', promotionStatusKey(promotionId, 'active'))
    .filter((employment) => compareDates(employment.startsOn, date) <= 0);
  const moraleTotal = contracts.reduce((sum, employment) => sum + employment.morale, 0);

  return {
    promotionId,
    date,
    cash: promotion.cash,
    prestige: promotion.prestige,
    popularity: {
      headline: headlinePopularityValue(read, promotionId, tunables, roller),
      world: popularityValue(rolled.world),
      homeRegionValue: promotion.regionalPop[promotion.homeRegionId] ?? 0,
      byContinent,
    },
    rosterSize: contracts.length,
    averageMorale: contracts.length === 0 ? null : moraleTotal / contracts.length,
    extra: extractSnapshotFields(promotion, read, date),
  };
}
