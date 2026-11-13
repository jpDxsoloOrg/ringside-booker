/**
 * The world overview the Office shows a seat that runs no promotion (DAY2-03): every active
 * promotion's public facts, the free agents and the totals. Public facts only: no cash and no
 * morale of anyone.
 *
 * Design: docs/design/office.md#queries.
 */

import type { GameDate } from '../../../core/date';
import type { PromotionId } from '../../../core/ids';
import type { EngineTunables } from '../../tunables';
import type { PromotionStatus } from '../../../model/entities/promotion';
import type { GameWorldView } from '../../../model/tables';
import { createOfficeRoller, headlinePopularityValue } from '../popularity';
import { startedContracts } from './kpis';

/** One promotion's public facts. */
export interface WorldOverviewPromotion {
  promotionId: PromotionId;
  name: string;
  shortName: string;
  logoRef: string | null;
  color: string;
  homeCountryName: string;
  /** The headline popularity (`headlinePopularityValue`), 0..100, unrounded. */
  headline: number;
  prestige: number;
  /** People under an active contract that has started. */
  rosterSize: number;
  status: PromotionStatus;
}

/** `office.dashboard`'s overview for a seat with no promotion. */
export interface WorldOverview {
  /** Active promotions, most popular first, then by prestige, then by id. */
  promotions: WorldOverviewPromotion[];
  /** Active people who wrestle and have no active contract anywhere. */
  freeAgents: number;
  totals: {
    promotions: number;
    /** People wrestling under an active, started contract with an active promotion. */
    wrestlersUnderContract: number;
  };
}

function byHeadlineThenPrestige(
  left: WorldOverviewPromotion,
  right: WorldOverviewPromotion,
): number {
  if (left.headline !== right.headline) {
    return right.headline - left.headline;
  }
  if (left.prestige !== right.prestige) {
    return right.prestige - left.prestige;
  }
  return left.promotionId < right.promotionId ? -1 : left.promotionId > right.promotionId ? 1 : 0;
}

/** The overview on `date`. */
export function worldOverview(
  read: GameWorldView,
  tunables: EngineTunables,
  date: GameDate,
): WorldOverview {
  const roller = createOfficeRoller(read);
  const wrestlersUnderContract = new Set<string>();
  const promotions: WorldOverviewPromotion[] = [];
  for (const promotion of read.tables.promotions.values()) {
    if (promotion.status !== 'active') {
      continue;
    }
    const contracts = startedContracts(read, promotion.id, date);
    for (const contract of contracts) {
      if (contract.role === 'wrestler') {
        wrestlersUnderContract.add(contract.personId);
      }
    }
    promotions.push({
      promotionId: promotion.id,
      name: promotion.name,
      shortName: promotion.shortName,
      logoRef: promotion.logoRef,
      color: promotion.color,
      homeCountryName: roller.geography.countryOf(promotion.homeRegionId).name,
      headline: headlinePopularityValue(read, promotion.id, tunables, roller),
      prestige: promotion.prestige,
      rosterSize: contracts.length,
      status: promotion.status,
    });
  }
  promotions.sort(byHeadlineThenPrestige);

  let freeAgents = 0;
  for (const person of read.tables.people.lookup('byRole', 'wrestler')) {
    if (person.status !== 'active') {
      continue;
    }
    const employed = read.tables.employments
      .lookup('byPerson', person.id)
      .some((employment) => employment.status === 'active');
    if (!employed) {
      freeAgents += 1;
    }
  }

  return {
    promotions,
    freeAgents,
    totals: { promotions: promotions.length, wrestlersUnderContract: wrestlersUnderContract.size },
  };
}
