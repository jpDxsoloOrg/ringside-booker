/**
 * Who holds a title now. The champion is never stored on the title: it is the open reign (the one
 * with `lostOn === null`, found through the unique `openByTitle` index). These helpers are the one
 * "who is champion" answer every system asks.
 *
 * Design: docs/design/titles.md#holders.
 */

import type { PersonId, PromotionId, TitleId } from '../../../core/ids';
import type { TitleReign } from '../../../model/entities/title-reign';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';

/** The title's current reign, or null when it is vacant. */
export function currentReign(read: GameWorldView, titleId: TitleId): TitleReign | null {
  return read.tables.titleReigns.lookupOne('openByTitle', titleId) ?? null;
}

/** The current champions, in the reign's order; `[]` when the title is vacant. */
export function currentHolders(read: GameWorldView, titleId: TitleId): PersonId[] {
  return [...(currentReign(read, titleId)?.holderIds ?? [])];
}

/**
 * The titles `personId` holds today (open reigns only), in ID order. With `promotionId`, only
 * that promotion's titles.
 */
export function titlesHeldBy(
  read: GameWorldView,
  personId: PersonId,
  promotionId?: PromotionId,
): TitleId[] {
  const held = new Set<TitleId>();
  for (const reign of read.tables.titleReigns.lookup('byHolder', personId)) {
    if (reign.lostOn !== null) {
      continue;
    }
    if (
      promotionId !== undefined &&
      read.tables.titles.get(reign.titleId)?.promotionId !== promotionId
    ) {
      continue;
    }
    held.add(reign.titleId);
  }
  return [...held].sort(compareIds);
}

/**
 * How a reign is named in the lineage: the team's name when the champions held it as a team that
 * still exists, otherwise the ring names they used when they won ("Kai Storm & Rex Vale"), so a
 * later rename does not rewrite history.
 */
export function reignLabel(
  read: GameWorldView,
  reign: Pick<DeepReadonly<TitleReign>, 'teamId' | 'holderNamesAtTime'>,
): string {
  if (reign.teamId !== null) {
    const team = read.tables.teams.get(reign.teamId);
    if (team !== undefined) {
      return team.name;
    }
  }
  return reign.holderNamesAtTime.join(' & ');
}
