/**
 * The rules every trade offer must keep, checked when it is made, when it is answered and once more
 * when it goes through (the world may have moved on in between). Each broken rule is one plain
 * reason with a stable code, so the trade sheet can show it next to the worker it is about.
 *
 * - Two different promotions, neither closed, no draft still open, no show of either one running
 *   live right now.
 * - At least one worker; cash goes one way only, and a player's promotion can only offer the cash
 *   it has.
 * - Each contract is active, has started, belongs to the side sending it, has more than today left,
 *   is not a booker's, is in no other open trade, and its worker does not already work for the
 *   other side.
 * - **Champions are blocked** (`trades.champion`): the title must be vacated or dropped first.
 * - **The wrestler's say**: a worker with a no-trade clause who does not want to go blocks it
 *   (`trades.noTradeClause`).
 *
 * Design: docs/design/trades.md#rules.
 */

import type { Reason } from '../../core/api/result';
import { compareDates, type GameDate } from '../../core/date';
import type { EmploymentId, PromotionId, TradeId } from '../../core/ids';
import { sidesOf, type TradeOffer } from '../../model/entities/trade';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { openDraft } from '../draft/session';
import { moneyText } from '../production/formulas/shared';
import type { EngineTunables } from '../tunables';
import { wrestlerSay } from './say';
import { sideWorkers } from './value';
import { TradeWorkerReader } from './workers';

export const TRADE_REASON_CODES = {
  notAllowed: 'notAllowed',
  unknownPromotion: 'trades.unknownPromotion',
  samePromotion: 'trades.samePromotion',
  notARival: 'trades.notARival',
  promotionClosed: 'trades.promotionClosed',
  draftRunning: 'trades.draftRunning',
  showRunning: 'trades.showRunning',
  empty: 'trades.empty',
  cashBothWays: 'trades.cashBothWays',
  notEnoughCash: 'trades.notEnoughCash',
  notOnRoster: 'trades.notOnRoster',
  contractNotActive: 'trades.contractNotActive',
  contractEnding: 'trades.contractEnding',
  notTradable: 'trades.notTradable',
  champion: 'trades.champion',
  alreadyInTrade: 'trades.alreadyInTrade',
  alreadyThere: 'trades.alreadyThere',
  noTradeClause: 'trades.noTradeClause',
  talkOpen: 'trades.talkOpen',
  unknownTrade: 'trades.unknownTrade',
  notOpen: 'trades.notOpen',
  notYourTurn: 'trades.notYourTurn',
  needsOffer: 'trades.needsOffer',
} as const;

export interface OfferCheckOptions {
  /** The trade this offer belongs to, so its own contracts are not "in another trade". */
  readonly tradeId?: TradeId | null;
  /** Check that each human side has the cash it sends (default true). */
  readonly checkHumanCash?: boolean;
}

function sideField(index: number, field: string): string {
  return `offer.sides[${String(index)}].${field}`;
}

function promotionReasons(
  read: GameWorldView,
  offer: DeepReadonly<TradeOffer>,
  date: GameDate,
): Reason[] {
  const reasons: Reason[] = [];
  const [first, second] = sidesOf(offer);
  if (first.promotionId === second.promotionId) {
    reasons.push({
      code: TRADE_REASON_CODES.samePromotion,
      message: 'A trade needs two different promotions.',
      field: 'offer.sides',
    });
    return reasons;
  }
  offer.sides.forEach((side, index) => {
    const promotion = read.tables.promotions.get(side.promotionId);
    if (promotion === undefined) {
      reasons.push({
        code: TRADE_REASON_CODES.unknownPromotion,
        message: 'That promotion is not in this world.',
        field: sideField(index, 'promotionId'),
      });
    } else if (promotion.status === 'closed') {
      reasons.push({
        code: TRADE_REASON_CODES.promotionClosed,
        message: `${promotion.name} has closed.`,
        field: sideField(index, 'promotionId'),
        subject: { kind: 'promotion', id: promotion.id },
      });
    }
    for (const show of read.tables.eventInstances.lookup('byDate', date)) {
      if (show.promotionId === side.promotionId && show.liveRun !== undefined) {
        reasons.push({
          code: TRADE_REASON_CODES.showRunning,
          message: `${show.name} is running right now: finish the show first.`,
          subject: { kind: 'eventInstance', id: show.id },
        });
      }
    }
  });
  if (openDraft(read) !== null) {
    reasons.push({
      code: TRADE_REASON_CODES.draftRunning,
      message: 'Finish the draft before making trades.',
    });
  }
  return reasons;
}

function cashReasons(
  read: GameWorldView,
  offer: DeepReadonly<TradeOffer>,
  checkHumanCash: boolean,
): Reason[] {
  const reasons: Reason[] = [];
  const [first, second] = sidesOf(offer);
  if (first.cash > 0 && second.cash > 0) {
    reasons.push({
      code: TRADE_REASON_CODES.cashBothWays,
      message: 'Cash can only go one way in a trade.',
      field: 'offer.sides',
    });
  }
  if (first.employmentIds.length + second.employmentIds.length === 0) {
    reasons.push({
      code: TRADE_REASON_CODES.empty,
      message: 'A trade needs at least one worker.',
      field: 'offer.sides',
    });
  }
  if (checkHumanCash) {
    offer.sides.forEach((side, index) => {
      const promotion = read.tables.promotions.get(side.promotionId);
      if (promotion?.controller.kind === 'human' && side.cash > 0 && promotion.cash < side.cash) {
        reasons.push({
          code: TRADE_REASON_CODES.notEnoughCash,
          message: `${promotion.name} has ${moneyText(Math.max(0, promotion.cash))}, not the ${moneyText(side.cash)} the trade sends.`,
          field: sideField(index, 'cash'),
        });
      }
    });
  }
  return reasons;
}

/** The reasons one contract cannot move from `fromId` to `toId` today. */
export function contractReasons(
  read: GameWorldView,
  employmentId: EmploymentId,
  fromId: PromotionId,
  toId: PromotionId,
  date: GameDate,
  tradeId: TradeId | null,
  field: string,
): Reason[] {
  const employment = read.tables.employments.get(employmentId);
  const subject = { kind: 'employment' as const, id: employmentId };
  if (employment?.promotionId !== fromId) {
    const promotion = read.tables.promotions.get(fromId);
    return [
      {
        code: TRADE_REASON_CODES.notOnRoster,
        message: `That contract is not with ${promotion?.name ?? 'that promotion'}.`,
        field,
        subject,
      },
    ];
  }
  const name = employment.ringName;
  if (employment.status !== 'active' || compareDates(employment.startsOn, date) > 0) {
    return [
      {
        code: TRADE_REASON_CODES.contractNotActive,
        message: `${name} is not under a running contract.`,
        field,
        subject,
      },
    ];
  }
  const reasons: Reason[] = [];
  if (employment.endsOn !== null && compareDates(employment.endsOn, date) <= 0) {
    reasons.push({
      code: TRADE_REASON_CODES.contractEnding,
      message: `${name}'s contract ends today.`,
      field,
      subject,
    });
  }
  if (employment.role === 'booker') {
    reasons.push({
      code: TRADE_REASON_CODES.notTradable,
      message: `${name} is the booker and can't be traded.`,
      field,
      subject,
    });
  }
  for (const reign of read.tables.titleReigns.lookup('byHolder', employment.personId)) {
    if (reign.lostOn !== null) {
      continue;
    }
    const title = read.tables.titles.get(reign.titleId);
    reasons.push({
      code: TRADE_REASON_CODES.champion,
      message: `${name} holds the ${title?.name ?? 'title'}: vacate it or have them drop it before trading them.`,
      field,
      subject: { kind: 'title', id: reign.titleId },
    });
  }
  for (const other of read.tables.trades.lookup('openByEmployment', employment.id)) {
    if (other.id !== tradeId) {
      reasons.push({
        code: TRADE_REASON_CODES.alreadyInTrade,
        message: `${name} is already in another trade offer.`,
        field,
        subject: { kind: 'trade', id: other.id },
      });
    }
  }
  const there = read.tables.employments
    .lookup('byPerson', employment.personId)
    .some(
      (row) => row.promotionId === toId && (row.status === 'active' || row.status === 'signed'),
    );
  if (there) {
    const promotion = read.tables.promotions.get(toId);
    reasons.push({
      code: TRADE_REASON_CODES.alreadyThere,
      message: `${name} already has a contract with ${promotion?.name ?? 'them'}.`,
      field,
      subject,
    });
  }
  return reasons;
}

/** The no-trade clauses that stop the deal (the wrestler's say), as reasons. */
export function clauseReasons(
  read: GameWorldView,
  tunables: EngineTunables,
  date: GameDate,
  offer: DeepReadonly<TradeOffer>,
): Reason[] {
  const reader = new TradeWorkerReader(read, tunables, date);
  const reasons: Reason[] = [];
  offer.sides.forEach((side, index) => {
    const to = sidesOf(offer)[index === 0 ? 1 : 0].promotionId;
    for (const worker of sideWorkers(reader, offer, side.employmentIds)) {
      const say = wrestlerSay(read, tunables, worker, to);
      if (say.blocks) {
        reasons.push({
          code: TRADE_REASON_CODES.noTradeClause,
          message: `${worker.name} has a no-trade clause and doesn't want to go.`,
          field: sideField(index, 'employmentIds'),
          subject: { kind: 'employment', id: worker.employmentId },
        });
      }
    }
  });
  return reasons;
}

/**
 * Every rule the offer breaks today, in a stable order (promotions, cash, then each contract in
 * offer order, then the no-trade clauses). Empty = the deal may go ahead.
 */
export function offerProblems(
  read: GameWorldView,
  tunables: EngineTunables,
  date: GameDate,
  offer: DeepReadonly<TradeOffer>,
  options: OfferCheckOptions = {},
): Reason[] {
  const promotions = promotionReasons(read, offer, date);
  if (promotions.some((reason) => reason.code === TRADE_REASON_CODES.samePromotion)) {
    return promotions;
  }
  const reasons = [...promotions, ...cashReasons(read, offer, options.checkHumanCash ?? true)];
  const tradeId = options.tradeId ?? null;
  offer.sides.forEach((side, index) => {
    const to = sidesOf(offer)[index === 0 ? 1 : 0].promotionId;
    side.employmentIds.forEach((employmentId, position) => {
      reasons.push(
        ...contractReasons(
          read,
          employmentId,
          side.promotionId,
          to,
          date,
          tradeId,
          `${sideField(index, 'employmentIds')}[${String(position)}]`,
        ),
      );
    });
  });
  if (reasons.length === 0) {
    reasons.push(...clauseReasons(read, tunables, date, offer));
  }
  return reasons;
}
