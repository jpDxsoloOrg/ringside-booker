/**
 * A computer promotion's answer to a trade offer (TRD-01): accept, refuse or counter, with plain
 * words and a Why?.
 *
 * 1. The deal is valued from the rival's side (`value.ts`). The rival must also be able to pay any
 *    cash it sends: at most `trades.answer.rivalCashShare` of its cash.
 * 2. At least `trades.answer.acceptMargin` points (and the cash affordable): **accept**.
 * 3. Short by no more than `trades.answer.counterRange`: **counter**, asking for a bit more or
 *    offering less, in this order until the gap is closed:
 *    a. pay less of its own cash (down to what it can afford, then down to none);
 *    b. keep one of the workers it was giving up, when it gives up more than one;
 *    c. ask for cash, rounded up to `trades.answer.cashRounding`, when the other side has it;
 *    d. ask for one more worker from the other side's roster: the one whose value covers the gap
 *       with the least to spare (champions, workers in other trades and anyone whose no-trade
 *       clause would stop it are left out).
 *    The counter is valued again and only sent when it clears the margin; otherwise it refuses.
 * 4. Otherwise, or after `trades.maxRounds` offers: **refuse**.
 *
 * Design: docs/design/trades.md#answer and #counter.
 */

import type { GameDate } from '../../core/date';
import type { EmploymentId, PromotionId } from '../../core/ids';
import { cents } from '../../core/money';
import { startDecision, type Traced } from '../../core/trace';
import { promotionStatusKey } from '../../model/entities/employment';
import {
  copyOffer,
  sidesOf,
  type TradeAnswerKind,
  type TradeOffer,
  type TradeSide,
} from '../../model/entities/trade';
import { TRADE_MAX_WORKERS_PER_SIDE } from '../../model/entities/trade';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { moneyText } from '../production/formulas/shared';
import type { EngineTunables } from '../tunables';
import { contractReasons } from './checks';
import { wrestlerSay } from './say';
import { pointsText, sidesFor, valueDeal, workerPoints, type DealValue } from './value';
import { TradeWorkerReader } from './workers';

export const ANSWER_DOC_REF = 'trades.md#answer';

/** How far apart the two sides are, before any counter is built. */
export type TradeLean = 'yes' | 'close' | 'far';

export interface RivalAnswer {
  readonly kind: TradeAnswerKind;
  readonly lean: TradeLean;
  readonly value: DealValue;
  readonly margin: number;
  /** Points the deal falls short of a yes (0 when it clears it). */
  readonly shortfall: number;
  /** The most cash the rival will pay out. */
  readonly cashLimit: number;
  /** The counter-offer, when `kind` is `counter`. */
  readonly counter: TradeOffer | null;
  /** The answer in plain words: the valuation lines, then the verdict. */
  readonly lines: string[];
  readonly decision: Traced<TradeAnswerKind>;
}

function withSide(offer: TradeOffer, promotionId: PromotionId, side: TradeSide): TradeOffer {
  const [first, second] = sidesOf(offer);
  const sides = first.promotionId === promotionId ? [side, second] : [first, side];
  return { ...offer, sides };
}

function roundUp(amount: number, step: number): number {
  return Math.ceil(amount / step) * step;
}

/** The most cash the rival will send in one trade. */
export function rivalCashLimit(
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
): number {
  const cash = read.tables.promotions.get(promotionId)?.cash ?? 0;
  return Math.max(0, Math.floor(cash * tunables.get('trades.answer.rivalCashShare')));
}

/** The other side's workers the rival could ask for, best fit for `gap` points first. */
function askableWorkers(
  read: GameWorldView,
  tunables: EngineTunables,
  date: GameDate,
  offer: TradeOffer,
  rivalId: PromotionId,
  otherId: PromotionId,
): { employmentId: EmploymentId; points: number; name: string }[] {
  const inOffer = new Set(sidesOf(offer).flatMap((side) => side.employmentIds));
  const reader = new TradeWorkerReader(read, tunables, date);
  const found: { employmentId: EmploymentId; points: number; name: string }[] = [];
  const roster = read.tables.employments
    .lookup('byPromotionStatus', promotionStatusKey(otherId, 'active'))
    .filter((row) => row.role === 'wrestler' && !inOffer.has(row.id))
    .sort((left, right) => compareIds(left.id, right.id));
  for (const employment of roster) {
    if (contractReasons(read, employment.id, otherId, rivalId, date, null, '').length > 0) {
      continue;
    }
    const worker = reader.worker(employment.id);
    if (worker === null || wrestlerSay(read, tunables, worker, rivalId).blocks) {
      continue;
    }
    found.push({
      employmentId: employment.id,
      points: workerPoints(worker, { tunables }, false).points.value,
      name: worker.name,
    });
  }
  return found;
}

interface CounterStep {
  readonly offer: TradeOffer;
  readonly line: string;
}

/**
 * Builds the counter-offer for a deal `gap` points short of a yes (see the module comment), or
 * null when no counter closes the gap.
 */
function buildCounter(
  read: GameWorldView,
  tunables: EngineTunables,
  date: GameDate,
  offer: DeepReadonly<TradeOffer>,
  rivalId: PromotionId,
  value: DealValue,
  cashLimit: number,
): CounterStep[] | null {
  const margin = tunables.get('trades.answer.acceptMargin');
  const cashPerPoint = value.cashPerPoint;
  const rounding = tunables.get('trades.answer.cashRounding');
  const steps: CounterStep[] = [];
  let current = copyOffer(offer);
  let gap = margin - value.score.value;
  const { own, other } = sidesFor(current, rivalId);
  let ownSide: TradeSide = { ...own, employmentIds: [...own.employmentIds] };
  let otherSide: TradeSide = { ...other, employmentIds: [...other.employmentIds] };
  const otherName = read.tables.promotions.get(otherSide.promotionId)?.name ?? 'you';

  // (a) Pay less cash: down to what it can afford, and as far as the gap needs.
  if (ownSide.cash > 0 && Number.isFinite(cashPerPoint)) {
    const needed = gap > 0 ? roundUp(gap * cashPerPoint, rounding) : 0;
    const cash = Math.max(0, Math.min(cashLimit, ownSide.cash - needed));
    if (cash !== ownSide.cash) {
      gap -= (ownSide.cash - cash) / cashPerPoint;
      ownSide = { ...ownSide, cash: cents(cash) };
      current = withSide(current, rivalId, ownSide);
      steps.push({
        offer: current,
        line:
          cash === 0
            ? 'They won’t pay any cash'
            : `They’ll pay ${moneyText(cash)} instead of ${moneyText(own.cash)}`,
      });
    }
  }
  // (b) Keep one of its own workers, when it gives up more than one.
  if (gap > 0 && ownSide.employmentIds.length > 1) {
    const keep = value.outgoing
      .filter((reading) => ownSide.employmentIds.includes(reading.worker.employmentId))
      .map((reading) => ({
        id: reading.worker.employmentId,
        points: reading.points.value,
        name: reading.worker.name,
      }))
      .sort((left, right) => left.points - right.points || compareIds(left.id, right.id))
      .find((candidate) => candidate.points >= gap);
    if (keep !== undefined) {
      ownSide = {
        ...ownSide,
        employmentIds: ownSide.employmentIds.filter((id) => id !== keep.id),
      };
      current = {
        ...withSide(current, rivalId, ownSide),
        adjustments: current.adjustments.filter(
          (adjustment) => adjustment.employmentId !== keep.id,
        ),
      };
      gap -= keep.points;
      steps.push({ offer: current, line: `They want to keep ${keep.name}` });
    }
  }
  // (c) Ask for cash, when the other side has it (and the rival is not paying any).
  if (gap > 0 && ownSide.cash === 0 && Number.isFinite(cashPerPoint)) {
    const ask = roundUp(gap * cashPerPoint, rounding);
    const otherCash = read.tables.promotions.get(otherSide.promotionId)?.cash ?? 0;
    if (otherSide.cash + ask <= otherCash) {
      otherSide = { ...otherSide, cash: cents(otherSide.cash + ask) };
      current = withSide(current, otherSide.promotionId, otherSide);
      gap -= ask / cashPerPoint;
      steps.push({
        offer: current,
        line:
          otherSide.cash === ask
            ? `They want ${moneyText(ask)} from ${otherName} as well`
            : `They want ${moneyText(otherSide.cash)} from ${otherName} instead`,
      });
    }
  }
  // (d) Ask for one more worker.
  if (gap > 0 && otherSide.employmentIds.length < TRADE_MAX_WORKERS_PER_SIDE) {
    const candidates = askableWorkers(
      read,
      tunables,
      date,
      current,
      rivalId,
      otherSide.promotionId,
    );
    const fits = candidates
      .filter((candidate) => candidate.points >= gap)
      .sort(
        (left, right) =>
          left.points - right.points || compareIds(left.employmentId, right.employmentId),
      );
    const pick = fits[0];
    if (pick !== undefined) {
      otherSide = { ...otherSide, employmentIds: [...otherSide.employmentIds, pick.employmentId] };
      current = withSide(current, otherSide.promotionId, otherSide);
      gap -= pick.points;
      steps.push({ offer: current, line: `They want ${pick.name} as well` });
    }
  }
  return steps.length === 0 ? null : steps;
}

function verdictLine(kind: TradeAnswerKind, name: string): string {
  switch (kind) {
    case 'accept':
      return `${name} likes the deal: they accept`;
    case 'counter':
      return `${name} wants a bit more: they sent a counter-offer`;
    case 'refuse':
      return `${name} is not interested: they refuse`;
  }
}

/**
 * The rival's answer to `offer`. `round` is the number of the offer being answered (1 for the
 * first); past `trades.maxRounds` the rival only accepts or refuses.
 */
export function rivalAnswer(
  read: GameWorldView,
  tunables: EngineTunables,
  date: GameDate,
  offer: DeepReadonly<TradeOffer>,
  rivalId: PromotionId,
  round: number,
): RivalAnswer {
  const name = read.tables.promotions.get(rivalId)?.name ?? 'They';
  const value = valueDeal(read, tunables, date, offer, rivalId);
  const margin = tunables.get('trades.answer.acceptMargin');
  const range = tunables.get('trades.answer.counterRange');
  const cashLimit = rivalCashLimit(read, tunables, rivalId);
  const affordable = value.cashOut <= cashLimit;
  const shortfall = Math.max(0, margin - value.score.value);
  const lean: TradeLean =
    value.starForCash !== null
      ? 'far'
      : shortfall === 0 && affordable
        ? 'yes'
        : shortfall <= range
          ? 'close'
          : 'far';
  const decision = startDecision<TradeAnswerKind>(`${name}'s answer`, { docRef: ANSWER_DOC_REF });
  decision.include('What the deal is worth to them', value.score);
  decision.rule(
    `Worth at least ${pointsText(margin)} points (it is ${pointsText(value.score.value)})`,
    shortfall === 0,
  );
  if (value.cashOut > 0) {
    decision.rule(
      `Cash they send (${moneyText(value.cashOut)}) within what they will pay (${moneyText(cashLimit)})`,
      affordable,
    );
  }
  if (value.outgoing.some((reading) => reading.star)) {
    decision.rule('Not giving up a top star mostly for cash', value.starForCash === null);
  }
  const lines = [...value.lines];
  let kind: TradeAnswerKind;
  let counter: TradeOffer | null = null;
  let because: string;
  if (lean === 'yes') {
    kind = 'accept';
    because = 'The deal is worth enough to them';
  } else if (lean === 'close' && round < tunables.get('trades.maxRounds')) {
    const steps = buildCounter(read, tunables, date, offer, rivalId, value, cashLimit);
    const last = steps?.[steps.length - 1];
    const check = last === undefined ? null : valueDeal(read, tunables, date, last.offer, rivalId);
    if (
      steps !== null &&
      last !== undefined &&
      check !== null &&
      check.score.value >= margin &&
      check.cashOut <= cashLimit &&
      check.starForCash === null
    ) {
      kind = 'counter';
      counter = last.offer;
      for (const step of steps) {
        lines.push(step.line);
      }
      decision.include('Their counter-offer is worth', check.score);
      because = `${pointsText(shortfall)} points short: they asked for a bit more`;
    } else {
      kind = 'refuse';
      because = `${pointsText(shortfall)} points short and nothing more they could ask for`;
    }
  } else if (lean === 'close') {
    kind = 'refuse';
    because = 'Close, but they have talked enough';
    lines.push('They have talked enough: no more counter-offers');
  } else if (value.starForCash !== null) {
    kind = 'refuse';
    because = "They won't sell their top star for money";
  } else {
    kind = 'refuse';
    because = `${pointsText(shortfall)} points short: too far apart to counter`;
  }
  lines.push(verdictLine(kind, name));
  return {
    kind,
    lean,
    value,
    margin,
    shortfall,
    cashLimit,
    counter,
    lines,
    decision: decision.choose(kind, because),
  };
}
