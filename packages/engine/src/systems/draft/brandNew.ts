/**
 * "Every promotion starts as a brand-new company: no frills" (DRF-13, owner decision 2026-11-21).
 * Part of `draft.setup`, for every active promotion, after the schedule is down to one weekly show:
 *
 * 1. **Staff policies** (catering, travel, medical) at tier 0.
 * 2. **Staff**: without "Draft staff too", every staff contract but the booker's is removed the way
 *    the free-agent pool removes contracts (no history, no severance), so those people are free
 *    agents to hire after the draft. With it on, the draft already took them.
 * 3. **One brand**: the brand of its weekly show, else its flagship (lowest priority, then id).
 *    Every other brand is retired (`active: false`, kept so history still points at a real row);
 *    contracts, shows, upcoming instances and storylines on a retired brand move to the kept one,
 *    its titles are retired, and the rival desk's profile for it goes.
 * 4. **No carried-over edges**: storylines end, venues held exclusively are released (they become
 *    ordinary venues to rent), parent or partner links are cut, and the month's popularity gains
 *    and the books' monthly history start empty.
 *
 * Identity stays: name, short name, colours, logo, home region, style, owner and booker.
 *
 * Design: docs/design/draft.md#brand-new-companies.
 */

import type { GameDate } from '../../core/date';
import { compareDates, yearMonthOf } from '../../core/date';
import type { BrandId, PromotionId } from '../../core/ids';
import { compareIds } from '../../model/table';
import type { GameTables } from '../../model/tables';
import type { Tx } from '../../model/tx';
import { DRAFT_STAFF_ROLES } from './candidates';
import { isLiveEmployment, removeEmployments } from './worldReset';

/** What the brand-new reset did, for the setup log and tests. */
export interface BrandNewSummary {
  staffRemoved: number;
  brandsRetired: number;
  titlesRetired: number;
  storylinesEnded: number;
  venuesReleased: number;
}

/** The brand a promotion keeps: its weekly show's, else its flagship. Null when it has none. */
function keptBrandOf(tx: Tx<GameTables>, promotionId: PromotionId, date: GameDate): BrandId | null {
  const read = tx.view;
  const brands = read.tables.brands
    .lookup('byPromotion', promotionId)
    .filter((brand) => brand.active)
    .sort((left, right) => left.priority - right.priority || compareIds(left.id, right.id));
  if (brands.length === 0) {
    return null;
  }
  const weekly = read.tables.eventDefinitions
    .lookup('byPromotion', promotionId)
    .find(
      (definition) =>
        definition.brandId !== null &&
        (definition.activeUntil === null || compareDates(definition.activeUntil, date) >= 0),
    );
  const own = brands.find((brand) => brand.id === weekly?.brandId);
  return (own ?? brands[0])?.id ?? null;
}

function oneBrand(
  tx: Tx<GameTables>,
  promotionId: PromotionId,
  date: GameDate,
  summary: BrandNewSummary,
): void {
  const read = tx.view;
  const kept = keptBrandOf(tx, promotionId, date);
  if (kept === null) {
    return;
  }
  const retired = new Set<BrandId>(
    read.tables.brands
      .lookup('byPromotion', promotionId)
      .filter((brand) => brand.active && brand.id !== kept)
      .map((brand) => brand.id),
  );
  if (retired.size === 0) {
    return;
  }
  const moved = (brandId: BrandId | null): boolean => brandId !== null && retired.has(brandId);
  for (const id of retired) {
    tx.update('brands', id, { active: false });
    summary.brandsRetired += 1;
  }
  for (const employment of read.tables.employments.values()) {
    if (employment.promotionId === promotionId && moved(employment.brandId)) {
      tx.update('employments', employment.id, { brandId: kept });
    }
  }
  for (const definition of read.tables.eventDefinitions.lookup('byPromotion', promotionId)) {
    if (moved(definition.brandId)) {
      tx.update('eventDefinitions', definition.id, { brandId: kept });
    }
  }
  for (const instance of read.tables.eventInstances.lookup('byPromotion', promotionId)) {
    if (moved(instance.brandId)) {
      tx.update('eventInstances', instance.id, { brandId: kept });
    }
  }
  for (const storyline of read.tables.storylines.values()) {
    if (storyline.promotionId === promotionId && moved(storyline.brandId)) {
      tx.update('storylines', storyline.id, { brandId: kept });
    }
  }
  for (const title of read.tables.titles.lookup('byPromotion', promotionId)) {
    if (title.status === 'active' && moved(title.brandId)) {
      tx.update('titles', title.id, {
        status: 'retired',
        retiredOn: compareDates(title.introducedOn, date) > 0 ? title.introducedOn : date,
      });
      summary.titlesRetired += 1;
    }
  }
  for (const profile of [...read.tables.aiProfiles.values()]) {
    if (profile.promotionId === promotionId && moved(profile.brandId)) {
      tx.delete('aiProfiles', profile.id);
    }
  }
}

/** Makes every active promotion a brand-new company (see the file comment). */
export function makeBrandNew(
  tx: Tx<GameTables>,
  promotionIds: readonly PromotionId[],
  draftStaff: boolean,
  date: GameDate,
): BrandNewSummary {
  const summary: BrandNewSummary = {
    staffRemoved: 0,
    brandsRetired: 0,
    titlesRetired: 0,
    storylinesEnded: 0,
    venuesReleased: 0,
  };
  const read = tx.view;
  const active = new Set<string>(promotionIds);
  if (!draftStaff) {
    const staffRoles = new Set<string>(DRAFT_STAFF_ROLES);
    const staff = read.tables.employments
      .values()
      .filter(
        (row) => active.has(row.promotionId) && isLiveEmployment(row) && staffRoles.has(row.role),
      );
    summary.staffRemoved = removeEmployments(tx, staff);
  }
  for (const promotionId of promotionIds) {
    tx.update('promotions', promotionId, {
      policies: { catering: 0, travel: 0, medical: 0 },
      parentPromotionId: null,
      popularityGains: { month: yearMonthOf(date), byRegion: {} },
      ledgerMonths: [],
    });
    oneBrand(tx, promotionId, date, summary);
  }
  for (const storyline of [...read.tables.storylines.values()]) {
    if (storyline.status === 'active' && active.has(storyline.promotionId)) {
      tx.update('storylines', storyline.id, { status: 'ended', endedOn: date });
      summary.storylinesEnded += 1;
    }
  }
  for (const venue of [...read.tables.venues.values()]) {
    if (venue.exclusivePromotionId !== null && active.has(venue.exclusivePromotionId)) {
      tx.update('venues', venue.id, { exclusivePromotionId: null });
      summary.venuesReleased += 1;
    }
  }
  return summary;
}
