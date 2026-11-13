/**
 * `roster.summary`: the counts the roster screen's tabs and brand selector show, and the top of the
 * roster by popularity, worked out from one pass of the same rows `roster.rows` returns, so the
 * counts can never disagree with the rows.
 *
 * Design: docs/design/roster.md#roster-summary.
 */

import type { BrandId } from '../../core/ids';
import { PUSH_LEVELS, type Push } from '../../model/entities/employment';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { AvailabilityStatus } from '../workers/helpers/availability';
import type { RosterView } from './queries';
import type { RosterRoleGroup } from './roleGroups';
import type { RosterRow } from './rows';

/** The size of the Office roster panel: a display size, not a balance number, so not a tunable. */
export const ROSTER_TOP_COUNT = 5;

/** The name of the entry for contracts on no brand. */
export const ROSTER_SHARED_BRAND_NAME = 'Shared';

/** The card positions a wrestler can hold (`none` is crew's). */
export type RosterPush = Exclude<Push, 'none'>;
export const ROSTER_PUSHES: readonly RosterPush[] = PUSH_LEVELS.filter(
  (push): push is RosterPush => push !== 'none',
);

/** One brand's size on the roster; `brandId: null` is the contracts on no brand. */
export interface RosterBrandCount {
  brandId: BrandId | null;
  name: string;
  /** The brand's priority (0 = flagship); null for the shared entry. */
  priority: number | null;
  total: number;
  wrestlers: number;
}

/** `roster.summary`: counts over the roster, or why it cannot be shown. */
export interface RosterSummary {
  promotion: RosterView['promotion'];
  /** The same reason `roster.rows` gives; null when the roster could be read. */
  unavailableReason: string | null;
  /** Rows counted (after the brand filter). */
  total: number;
  /** Every group, 0 when empty. Follows the brand filter. */
  byGroup: Record<RosterRoleGroup, number>;
  /** Every brand's size over the whole roster, whatever the brand filter. */
  byBrand: RosterBrandCount[];
  /** Every card position, 0 when empty. Follows the brand filter. */
  byPush: Record<RosterPush, number>;
  /** Rows whose status is not `available`. Follows the brand filter. */
  unavailable: number;
  unavailableByStatus: Partial<Record<AvailabilityStatus, number>>;
  /** Rows whose push verdict is `expectsMore`. Follows the brand filter. */
  expectsMore: number;
  /**
   * Up to {@link ROSTER_TOP_COUNT} wrestlers, most popular among the promotion's fans first, then
   * by overall, then by employment ID. Follows the brand filter.
   */
  topByPopularity: RosterRow[];
}

function emptyByGroup(): Record<RosterRoleGroup, number> {
  return {
    wrestlers: 0,
    managers: 0,
    announcers: 0,
    referees: 0,
    producers: 0,
    others: 0,
  };
}

function emptyByPush(): Record<RosterPush, number> {
  return { mainEvent: 0, upperCard: 0, midCard: 0, lowerCard: 0, enhancement: 0 };
}

function passesBrand(row: RosterRow, brandId: BrandId | 'shared' | undefined): boolean {
  if (brandId === undefined) {
    return true;
  }
  return brandId === 'shared' ? row.brandId === null : row.brandId === brandId;
}

function compareTop(left: RosterRow, right: RosterRow): number {
  return (
    right.popularity - left.popularity ||
    right.overall.value - left.overall.value ||
    compareIds(left.employmentId, right.employmentId)
  );
}

/**
 * Every brand's size over `rows`: the promotion's active brands by priority (empty ones included),
 * then any inactive brand a row still points at, then "Shared" when a row is on no brand.
 */
function brandCounts(
  read: GameWorldView,
  promotion: NonNullable<RosterView['promotion']>,
  rows: readonly RosterRow[],
): RosterBrandCount[] {
  const counts = new Map<BrandId | null, RosterBrandCount>();
  for (const brand of promotion.brands) {
    counts.set(brand.brandId, {
      brandId: brand.brandId,
      name: brand.name,
      priority: brand.priority,
      total: 0,
      wrestlers: 0,
    });
  }
  const inactive: RosterBrandCount[] = [];
  let shared: RosterBrandCount | null = null;
  for (const row of rows) {
    let entry = counts.get(row.brandId);
    if (entry === undefined) {
      if (row.brandId === null) {
        shared = {
          brandId: null,
          name: ROSTER_SHARED_BRAND_NAME,
          priority: null,
          total: 0,
          wrestlers: 0,
        };
        entry = shared;
      } else {
        const brand = read.tables.brands.get(row.brandId);
        entry = {
          brandId: row.brandId,
          name: brand?.name ?? row.brandName ?? row.brandId,
          priority: brand?.priority ?? null,
          total: 0,
          wrestlers: 0,
        };
        inactive.push(entry);
      }
      counts.set(row.brandId, entry);
    }
    entry.total += 1;
    if (row.group === 'wrestlers') {
      entry.wrestlers += 1;
    }
  }
  inactive.sort(
    (left, right) =>
      (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER) ||
      compareIds(left.brandId ?? '', right.brandId ?? ''),
  );
  const active = promotion.brands.flatMap((brand) => {
    const entry = counts.get(brand.brandId);
    return entry === undefined ? [] : [entry];
  });
  return [...active, ...inactive, ...(shared === null ? [] : [shared])];
}

/**
 * The summary of `view`, an unfiltered `roster.rows` answer. With `brandId`, every count but
 * `byBrand` covers only that brand's rows (or the shared ones), so a screen's tab counts follow its
 * brand selector while the selector still shows every brand's size.
 */
export function summariseRoster(
  read: GameWorldView,
  view: RosterView,
  brandId?: BrandId | 'shared',
): RosterSummary {
  const byGroup = emptyByGroup();
  const byPush = emptyByPush();
  const unavailableByStatus: Partial<Record<AvailabilityStatus, number>> = {};
  let unavailable = 0;
  let expectsMore = 0;
  const rows = view.rows.filter((row) => passesBrand(row, brandId));
  for (const row of rows) {
    byGroup[row.group] += 1;
    if (row.push !== 'none') {
      byPush[row.push] += 1;
    }
    const status = row.availability.status;
    if (status !== 'available') {
      unavailable += 1;
      unavailableByStatus[status] = (unavailableByStatus[status] ?? 0) + 1;
    }
    if (row.pushGap?.verdict === 'expectsMore') {
      expectsMore += 1;
    }
  }
  return {
    promotion: view.promotion,
    unavailableReason: view.unavailableReason,
    total: rows.length,
    byGroup,
    byBrand: view.promotion === null ? [] : brandCounts(read, view.promotion, view.rows),
    byPush,
    unavailable,
    unavailableByStatus,
    expectsMore,
    topByPopularity: rows
      .filter((row) => row.group === 'wrestlers')
      .sort(compareTop)
      .slice(0, ROSTER_TOP_COUNT),
  };
}
