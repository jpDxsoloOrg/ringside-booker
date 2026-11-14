/**
 * `titles.list`: every title as cards, grouped the way the player thinks about them. Our own
 * promotion by brand (then a "Promotion-wide" group), the rest of the world by promotion.
 *
 * Design: docs/design/titles.md#queries.
 */

import { viewerPromotionIds } from '../../core/api/controller';
import type { BrandId, PromotionId } from '../../core/ids';
import type { Brand } from '../../model/entities/brand';
import type { Title, TitleStatus } from '../../model/entities/title';
import { compareIds } from '../../model/table';
import type { DeepReadonly } from '../../model/world';
import { buildTitleCardRow, compareNames, type TitleCardRow, type TitleRowContext } from './rows';

export const TITLE_LIST_SCOPES = ['own', 'world'] as const;
export type TitleListScope = (typeof TITLE_LIST_SCOPES)[number];

export const TITLE_LIST_STATUSES = ['active', 'retired', 'all'] as const;
export type TitleListStatus = (typeof TITLE_LIST_STATUSES)[number];

export interface TitleListArgs {
  scope: TitleListScope;
  status: TitleListStatus;
}

/** The name of the group for an own promotion's titles that belong to no brand. */
export const PROMOTION_WIDE_GROUP_NAME = 'Promotion-wide';

/** One group of cards: a brand (own scope) or a whole promotion (world scope). */
export interface TitleGroup {
  /** Stable key: `brand:<id>`, `promotionWide:<promotionId>` or `promotion:<id>`. */
  key: string;
  promotionId: PromotionId;
  promotionName: string;
  /** Null for a promotion-wide group and for every world group. */
  brandId: BrandId | null;
  /** The brand's name, "Promotion-wide", or null for a world group. */
  brandName: string | null;
  /** The brand's logo for a brand group, otherwise the promotion's. */
  logoRef: string | null;
  titles: TitleCardRow[];
}

export interface TitleListResult {
  groups: TitleGroup[];
  /** Titles in the scope by status, before the status filter, for the tabs. */
  counts: Record<TitleStatus, number>;
}

function compareCards(left: TitleCardRow, right: TitleCardRow): number {
  return (
    right.prestige - left.prestige ||
    compareNames(left.name, right.name) ||
    compareIds(left.titleId, right.titleId)
  );
}

function matchesStatus(title: DeepReadonly<Title>, status: TitleListStatus): boolean {
  return status === 'all' || title.status === status;
}

function brandsOf(ctx: TitleRowContext, promotionId: PromotionId): DeepReadonly<Brand>[] {
  return [...ctx.read.tables.brands.lookup('byPromotion', promotionId)].sort(
    (left, right) => left.priority - right.priority || compareIds(left.id, right.id),
  );
}

/** One group per brand in priority order, then the promotion-wide group; empty groups left out. */
function ownGroups(
  ctx: TitleRowContext,
  promotionId: PromotionId,
  titles: readonly DeepReadonly<Title>[],
): TitleGroup[] {
  const promotion = ctx.read.tables.promotions.get(promotionId);
  const promotionName = promotion?.name ?? promotionId;
  const groups: TitleGroup[] = [];
  const add = (group: Omit<TitleGroup, 'titles'>, members: DeepReadonly<Title>[]): void => {
    if (members.length > 0) {
      const titleRows = members.map((title) => buildTitleCardRow(ctx, title)).sort(compareCards);
      groups.push({ ...group, titles: titleRows });
    }
  };
  for (const brand of brandsOf(ctx, promotionId)) {
    add(
      {
        key: `brand:${brand.id}`,
        promotionId,
        promotionName,
        brandId: brand.id,
        brandName: brand.name,
        logoRef: brand.logoRef,
      },
      titles.filter((title) => title.brandId === brand.id),
    );
  }
  add(
    {
      key: `promotionWide:${promotionId}`,
      promotionId,
      promotionName,
      brandId: null,
      brandName: PROMOTION_WIDE_GROUP_NAME,
      logoRef: promotion?.logoRef ?? null,
    },
    titles.filter((title) => title.brandId === null),
  );
  return groups;
}

/** One group for a whole promotion: titles by brand priority, then prestige, name and id. */
function worldGroup(
  ctx: TitleRowContext,
  promotionId: PromotionId,
  titles: readonly DeepReadonly<Title>[],
): TitleGroup | null {
  if (titles.length === 0) {
    return null;
  }
  const promotion = ctx.read.tables.promotions.get(promotionId);
  const brandRank = new Map<BrandId, number>(
    brandsOf(ctx, promotionId).map((brand, index) => [brand.id, index]),
  );
  const rankOf = (row: TitleCardRow): number =>
    row.brandId === null ? brandRank.size : (brandRank.get(row.brandId) ?? brandRank.size);
  const titleRows = titles
    .map((title) => buildTitleCardRow(ctx, title))
    .sort((left, right) => rankOf(left) - rankOf(right) || compareCards(left, right));
  return {
    key: `promotion:${promotionId}`,
    promotionId,
    promotionName: promotion?.name ?? promotionId,
    brandId: null,
    brandName: null,
    logoRef: promotion?.logoRef ?? null,
    titles: titleRows,
  };
}

/** `titles.list` for this viewer. */
export function titleListOf(ctx: TitleRowContext, args: TitleListArgs): TitleListResult {
  const { read } = ctx;
  const ownIds = new Set(viewerPromotionIds(read, ctx.viewer));
  const inScope = (promotionId: PromotionId): boolean =>
    args.scope === 'own' ? ownIds.has(promotionId) : !ownIds.has(promotionId);

  const scopeTitles = read.tables.titles.values().filter((title) => inScope(title.promotionId));
  const counts: Record<TitleStatus, number> = { active: 0, retired: 0 };
  for (const title of scopeTitles) {
    counts[title.status] += 1;
  }
  const byPromotion = new Map<PromotionId, DeepReadonly<Title>[]>();
  for (const title of scopeTitles) {
    if (matchesStatus(title, args.status)) {
      const list = byPromotion.get(title.promotionId) ?? [];
      list.push(title);
      byPromotion.set(title.promotionId, list);
    }
  }

  if (args.scope === 'own') {
    const groups = [...ownIds]
      .sort(compareIds)
      .flatMap((promotionId) => ownGroups(ctx, promotionId, byPromotion.get(promotionId) ?? []));
    return { groups, counts };
  }

  const promotions = read.tables.promotions
    .values()
    .filter((promotion) => byPromotion.has(promotion.id))
    .sort(
      (left, right) =>
        right.prestige - left.prestige ||
        compareNames(left.name, right.name) ||
        compareIds(left.id, right.id),
    );
  const groups = promotions.flatMap((promotion) => {
    const group = worldGroup(ctx, promotion.id, byPromotion.get(promotion.id) ?? []);
    return group === null ? [] : [group];
  });
  return { groups, counts };
}
