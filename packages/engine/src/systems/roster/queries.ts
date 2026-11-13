/**
 * The roster system's queries.
 *
 * `roster.rows` is the viewer's own roster: every active contract with one of the promotions they
 * run. A controller can only read its own promotions here (rivals' workers are under World >
 * Workers, without morale); the all-seeing viewer may read any. Queries can only return data, so a
 * refusal is data too: `promotion: null`, no rows and a reason written for the player.
 *
 * Design: docs/design/roster.md#viewer-scoping.
 */

import { z } from 'zod';
import { viewerPromotionIds } from '../../core/api/controller';
import { defineQuery, type QueryContext, type QueryDefinition } from '../../core/api/query';
import type { BrandId, PromotionId } from '../../core/ids';
import { compareIds } from '../../model/table';
import { zId } from '../../model/primitives';
import { ROSTER_ROLE_GROUPS, type RosterRoleGroup } from './roleGroups';
import { buildRosterRows, type RosterRow } from './rows';

export interface RosterRowsArgs {
  /** Left out: the first promotion the viewer runs. */
  promotionId?: PromotionId | undefined;
  /** A brand's rows, or `'shared'` for the rows on no brand. */
  brandId?: BrandId | 'shared' | undefined;
  group?: RosterRoleGroup | undefined;
}

export interface RosterBrand {
  brandId: BrandId;
  name: string;
  /** Lower = more important (0 = flagship). */
  priority: number;
}

export interface RosterPromotion {
  promotionId: PromotionId;
  name: string;
  /** The promotion's active brands, flagship first. */
  brands: RosterBrand[];
}

/** `roster.rows`: the roster, or why it cannot be shown. */
export interface RosterView {
  promotion: RosterPromotion | null;
  /** Why there are no rows, written for the player; null when the roster could be read. */
  unavailableReason: string | null;
  rows: RosterRow[];
}

export const ROSTER_NOT_YOURS =
  "You can only open your own roster here. Other promotions' workers are under World > Workers.";
export const ROSTER_NO_PROMOTION = "You don't run a promotion yet.";
export const ROSTER_UNKNOWN_PROMOTION = 'That promotion does not exist.';

declare module '../../core/api/maps' {
  interface QueryMap {
    'roster.rows': { args: RosterRowsArgs; result: RosterView };
  }
}

const zRosterRowsArgs = z.strictObject({
  promotionId: zId('promotion').optional(),
  brandId: z.union([zId('brand'), z.literal('shared')]).optional(),
  group: z.enum(ROSTER_ROLE_GROUPS).optional(),
});

function unavailable(reason: string): RosterView {
  return { promotion: null, unavailableReason: reason, rows: [] };
}

/** The roster `ctx.viewer` asked for, or the reason they cannot see it. */
export function rosterViewOf(ctx: QueryContext, args: RosterRowsArgs): RosterView {
  const { read, viewer } = ctx;
  const own = viewerPromotionIds(read, viewer);
  const promotionId = args.promotionId ?? own[0];
  if (promotionId === undefined) {
    return unavailable(ROSTER_NO_PROMOTION);
  }
  if (viewer.kind !== 'omniscient' && !own.includes(promotionId)) {
    return unavailable(ROSTER_NOT_YOURS);
  }
  const promotion = read.tables.promotions.get(promotionId);
  if (promotion === undefined) {
    return unavailable(ROSTER_UNKNOWN_PROMOTION);
  }
  const brands = read.tables.brands
    .lookup('byPromotion', promotionId)
    .filter((brand) => brand.active)
    .sort((left, right) => left.priority - right.priority || compareIds(left.id, right.id))
    .map((brand) => ({ brandId: brand.id, name: brand.name, priority: brand.priority }));
  return {
    promotion: { promotionId, name: promotion.name, brands },
    unavailableReason: null,
    rows: buildRosterRows(
      read,
      promotionId,
      ctx.date,
      { tunables: ctx.tunables, traces: ctx.traces },
      { brandId: args.brandId, group: args.group },
    ),
  };
}

export const rosterRowsQuery: QueryDefinition<'roster.rows'> = defineQuery('roster.rows', {
  args: zRosterRowsArgs,
  run: rosterViewOf,
});

export const rosterQueries: readonly QueryDefinition[] = [rosterRowsQuery];
