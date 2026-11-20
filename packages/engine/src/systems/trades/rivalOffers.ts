/**
 * Rival trade offers (TRD-03, engine part): now and then a computer promotion offers a player a
 * trade of its own. Rare on purpose, so they never spam the player:
 *
 * - only on Mondays, and only `trades.rivalOffer.graceDays` after the game started;
 * - at most one rival offer per player promotion every `trades.rivalOffer.minDaysBetween` days,
 *   and never while one is still open;
 * - then with `trades.rivalOffer.weeklyChance` (stream `trades.rival-offer`).
 *
 * The offer: up to `trades.rivalOffer.rivalsTried` computer promotions are looked at, in a seeded
 * random order. The first whose most pressing wrestler need (card level, division, faces/heels)
 * one of the player's tradable wrestlers fills makes an offer for the best such wrestler: a
 * wrestler of its own of about the same value (never a top star), or cash alone, chosen so the
 * deal clears its own `trades.answer.acceptMargin`; a share (`trades.rivalOffer.cashShare`) of
 * what it has to spare is added as cash. The player answers with `trades.respond` before
 * `trades.counter.expiryDays` run out.
 *
 * Rivals don't trade with each other yet (a follow-up).
 *
 * Design: docs/design/trades.md#rival-offers.
 */

import { diffDays, weekday } from '../../core/date';
import type { EmploymentId, PromotionId } from '../../core/ids';
import { cents } from '../../core/money';
import type { PhaseContext } from '../../core/pipeline/context';
import { chance, intBetween } from '../../core/rng/odds';
import type { RngStream } from '../../core/rng/registry';
import { promotionStatusKey } from '../../model/entities/employment';
import type { Promotion } from '../../model/entities/promotion';
import { compareIds } from '../../model/table';
import type { TradeOffer } from '../../model/entities/trade';
import type { DeepReadonly } from '../../model/world';
import { rosterNeeds, type Need } from '../aip/formulas/needs';
import { needsInputsFor } from '../aip/inputs';
import { unitOf } from '../aip/units';
import { openDraft } from '../draft/session';
import { rivalCashLimit } from './answer';
import { contractReasons } from './checks';
import { RIVAL_OFFER_STREAM } from './events';
import { openTrade } from './lifecycle';
import { wrestlerSay } from './say';
import { isTopStar, valueDeal, workerPoints } from './value';
import { TradeWorkerReader, type TradeWorker } from './workers';

/** Engine weekday 0 is a Monday. */
const OFFER_WEEKDAY = 0;
/** How many of the rival's own wrestlers it tries to swap before offering cash alone. */
const SWAPS_TRIED = 5;

function fillsNeed(need: Need, worker: TradeWorker): boolean {
  if (need.key.startsWith('depth.')) {
    return worker.push === need.key.slice('depth.'.length);
  }
  if (need.key.startsWith('gender.')) {
    return worker.gender === need.key.slice('gender.'.length);
  }
  if (need.key === 'alignment') {
    return need.summary.key === 'aip.need.alignment.heels'
      ? worker.alignment === 'heel'
      : worker.alignment === 'face';
  }
  return false;
}

/** The wrestlers of `fromId` who could go to `toId` today, with what they are worth to `toId`. */
function tradableWrestlers(
  ctx: PhaseContext,
  reader: TradeWorkerReader,
  fromId: PromotionId,
  toId: PromotionId,
): { worker: TradeWorker; points: number }[] {
  const found: { worker: TradeWorker; points: number }[] = [];
  const roster = ctx.read.tables.employments
    .lookup('byPromotionStatus', promotionStatusKey(fromId, 'active'))
    .filter((row) => row.role === 'wrestler')
    .sort((left, right) => compareIds(left.id, right.id));
  for (const employment of roster) {
    if (contractReasons(ctx.read, employment.id, fromId, toId, ctx.date, null, '').length > 0) {
      continue;
    }
    const worker = reader.worker(employment.id);
    if (worker === null || wrestlerSay(ctx.read, ctx.tunables, worker, toId).blocks) {
      continue;
    }
    found.push({ worker, points: workerPoints(worker, ctx, false).points.value });
  }
  return found;
}

function offerOf(
  rivalId: PromotionId,
  humanId: PromotionId,
  give: EmploymentId[],
  get: EmploymentId,
  cash: number,
): TradeOffer {
  return {
    sides: [
      {
        promotionId: rivalId,
        employmentIds: give,
        cash: cents(cash),
      },
      {
        promotionId: humanId,
        employmentIds: [get],
        cash: cents(0),
      },
    ],
    adjustments: [],
  };
}

/** Cash the rival adds out of `spare` points, rounded down, within what it will pay. */
function sweetener(ctx: PhaseContext, rivalId: PromotionId, spare: number): number {
  const rounding = ctx.tunables.get('trades.answer.cashRounding');
  const raw =
    spare *
    ctx.tunables.get('trades.value.cashPerPoint') *
    ctx.tunables.get('trades.rivalOffer.cashShare');
  const cash = Math.floor(raw / rounding) * rounding;
  return Math.max(0, Math.min(cash, rivalCashLimit(ctx.read, ctx.tunables, rivalId)));
}

/** The trade `rivalId` would offer `humanId` today, or null when it has nothing worth offering. */
export function rivalProposal(
  ctx: PhaseContext,
  rivalId: PromotionId,
  humanId: PromotionId,
): TradeOffer | null {
  const { read, tunables, date } = ctx;
  const needs = rosterNeeds(needsInputsFor(read, tunables, unitOf(read, rivalId), date), {
    tunables,
  }).filter((need) => need.kind === 'depth' || need.kind === 'gender' || need.kind === 'alignment');
  if (needs.length === 0) {
    return null;
  }
  const reader = new TradeWorkerReader(read, tunables, date);
  const theirs = tradableWrestlers(ctx, reader, humanId, rivalId);
  let target: { worker: TradeWorker; points: number } | undefined;
  for (const need of needs) {
    target = theirs
      .filter((candidate) => fillsNeed(need, candidate.worker))
      .sort(
        (left, right) =>
          right.points - left.points ||
          compareIds(left.worker.employmentId, right.worker.employmentId),
      )[0];
    if (target !== undefined) {
      break;
    }
  }
  if (target === undefined) {
    return null;
  }
  const margin = tunables.get('trades.answer.acceptMargin');
  const wanted = target;
  const own = tradableWrestlers(ctx, reader, rivalId, humanId)
    .filter((candidate) => !isTopStar(candidate.worker, tunables))
    .sort(
      (left, right) =>
        Math.abs(left.points - wanted.points) - Math.abs(right.points - wanted.points) ||
        compareIds(left.worker.employmentId, right.worker.employmentId),
    )
    .slice(0, SWAPS_TRIED);
  for (const candidate of own) {
    const swap = offerOf(
      rivalId,
      humanId,
      [candidate.worker.employmentId],
      wanted.worker.employmentId,
      0,
    );
    const value = valueDeal(read, tunables, date, swap, rivalId);
    if (value.score.value >= margin) {
      const cash = sweetener(ctx, rivalId, value.score.value - margin);
      return offerOf(
        rivalId,
        humanId,
        [candidate.worker.employmentId],
        wanted.worker.employmentId,
        cash,
      );
    }
  }
  const alone = offerOf(rivalId, humanId, [], wanted.worker.employmentId, 0);
  const value = valueDeal(read, tunables, date, alone, rivalId);
  if (value.score.value < margin) {
    return null;
  }
  const rounding = tunables.get('trades.answer.cashRounding');
  const cash = Math.min(
    Math.floor(
      ((value.score.value - margin) * tunables.get('trades.value.cashPerPoint')) / rounding,
    ) * rounding,
    rivalCashLimit(read, tunables, rivalId),
  );
  return cash >= rounding ? offerOf(rivalId, humanId, [], wanted.worker.employmentId, cash) : null;
}

/** Up to `count` of `items` in a seeded random order (a partial shuffle). */
function sample<T>(stream: RngStream, items: readonly T[], count: number): T[] {
  const pool = [...items];
  const picked: T[] = [];
  while (picked.length < count && pool.length > 0) {
    const index = intBetween(stream, 0, pool.length - 1);
    const [item] = pool.splice(index, 1);
    if (item !== undefined) {
      picked.push(item);
    }
  }
  return picked;
}

/** True when a rival offered `humanId` a trade within the cooldown, or one is still open. */
function recentlyOffered(ctx: PhaseContext, humanId: PromotionId): boolean {
  const gap = ctx.tunables.get('trades.rivalOffer.minDaysBetween');
  return ctx.read.tables.trades.lookup('byPromotion', humanId).some((trade) => {
    if (trade.partnerId !== humanId) {
      return false;
    }
    const first = trade.rounds[0];
    return trade.status === 'open' || (first !== undefined && diffDays(first.on, ctx.date) < gap);
  });
}

/** The weekly roll for every player promotion (see the module comment). */
export function makeRivalOffers(ctx: PhaseContext): void {
  const { read, tunables } = ctx;
  const weeklyChance = tunables.get('trades.rivalOffer.weeklyChance');
  if (
    weeklyChance <= 0 ||
    weekday(ctx.date) !== OFFER_WEEKDAY ||
    diffDays(read.meta.startDate, ctx.date) < tunables.get('trades.rivalOffer.graceDays') ||
    openDraft(read) !== null
  ) {
    return;
  }
  const promotions = read.tables.promotions
    .values()
    .filter((promotion) => promotion.status === 'active')
    .sort((left, right) => compareIds(left.id, right.id));
  const humans = promotions.filter((promotion) => promotion.controller.kind === 'human');
  const rivals: DeepReadonly<Promotion>[] = promotions.filter(
    (promotion) => promotion.controller.kind === 'computer',
  );
  if (rivals.length === 0) {
    return;
  }
  for (const human of humans) {
    if (recentlyOffered(ctx, human.id)) {
      continue;
    }
    const stream = ctx.rng(RIVAL_OFFER_STREAM);
    if (!chance(stream, weeklyChance)) {
      continue;
    }
    for (const rival of sample(stream, rivals, tunables.get('trades.rivalOffer.rivalsTried'))) {
      const offer = rivalProposal(ctx, rival.id, human.id);
      if (offer !== null) {
        openTrade(ctx, { by: rival.id, to: human.id, offer, rivalInitiated: true });
        break;
      }
    }
  }
}
