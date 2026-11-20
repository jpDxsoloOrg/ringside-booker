/**
 * A trade talk from offer to close (TRD-01): opening a trade, adding a round, a computer's answer,
 * a player's acceptance, and closing it. Every write to the `trades` table goes through here.
 *
 * Stops: when `trades.stopSkip` is on, a row that changed for a player without their doing (a
 * rival's answer, a rival's own offer, a deal that could no longer happen) is marked `stopsSkip`,
 * which the `trades.answered` / `trades.offerReceived` gates read until `trades.markSeen` (or any
 * answer) clears it. Gates cannot read tunables, hence the flag.
 *
 * Design: docs/design/trades.md#lifecycle.
 */

import { addDays, type GameDate } from '../../core/date';
import type { PromotionId, TradeId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import type { TraceRef } from '../../core/trace/store';
import {
  copyOffer,
  currentRound,
  TRADE_MAX_ANSWER_LINES,
  type Trade,
  type TradeAnswer,
  type TradeMove,
  type TradeOffer,
  type TradeOutcome,
  type TradeStatus,
} from '../../model/entities/trade';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { rivalAnswer } from './answer';
import { offerProblems } from './checks';
import { completeTrade } from './transfer';

export const TRADE_TRACE_KIND = 'trades.answer';

export const TRADE_OUTCOMES = {
  completed: { code: 'trades.completed', message: 'The trade went through' },
  refused: 'trades.refused',
  refusedByYou: { code: 'trades.refusedByYou', message: 'You turned the trade down' },
  withdrawn: { code: 'trades.withdrawn', message: 'The offer was withdrawn' },
  lapsed: { code: 'trades.lapsed', message: 'Nobody answered in time' },
  cancelled: 'trades.cancelled',
} as const;

/** Where a round's answer is explained. */
export function answerTraceRef(tradeId: TradeId, round: number): TraceRef {
  return { kind: TRADE_TRACE_KIND, id: `${tradeId}:${String(round)}` };
}

export function isHuman(read: GameWorldView, promotionId: PromotionId): boolean {
  return read.tables.promotions.get(promotionId)?.controller.kind === 'human';
}

function otherSide(trade: Pick<Trade, 'initiatorId' | 'partnerId'>, id: PromotionId): PromotionId {
  return trade.initiatorId === id ? trade.partnerId : trade.initiatorId;
}

/** The deadline when `awaitingId` is a player, else null. */
function expiryFor(ctx: PhaseContext, awaitingId: PromotionId): GameDate | null {
  return isHuman(ctx.read, awaitingId)
    ? addDays(ctx.date, ctx.tunables.get('trades.counter.expiryDays'))
    : null;
}

function stops(ctx: PhaseContext, trade: Pick<Trade, 'initiatorId' | 'partnerId'>): boolean {
  return (
    ctx.tunables.get('trades.stopSkip') &&
    (isHuman(ctx.read, trade.initiatorId) || isHuman(ctx.read, trade.partnerId))
  );
}

/** Opens a trade with its first offer, from `by` to the other side. */
export function openTrade(
  ctx: PhaseContext,
  input: { by: PromotionId; to: PromotionId; offer: TradeOffer; rivalInitiated: boolean },
): DeepReadonly<Trade> {
  const row = ctx.tx.create('trades', {
    initiatorId: input.by,
    partnerId: input.to,
    status: 'open',
    awaitingId: input.to,
    rounds: [{ by: input.by, offer: copyOffer(input.offer), on: ctx.date }],
    submittedOn: ctx.date,
    expiresOn: expiryFor(ctx, input.to),
    closedOn: null,
    outcome: null,
    answer: null,
    moves: [],
    stopsSkip: input.rivalInitiated && stops(ctx, { initiatorId: input.by, partnerId: input.to }),
  });
  ctx.publish('trade.offered', {
    tradeId: row.id,
    by: input.by,
    to: input.to,
    round: 1,
    rivalInitiated: input.rivalInitiated,
  });
  return row;
}

/** Adds a counter-offer by `by`; the other side answers next. */
export function addRound(
  ctx: PhaseContext,
  trade: DeepReadonly<Trade>,
  by: PromotionId,
  offer: TradeOffer,
  extra: { answer?: TradeAnswer | null; stopsSkip?: boolean } = {},
): DeepReadonly<Trade> {
  const awaitingId = otherSide(trade, by);
  const rounds = [...trade.rounds.map((round) => ({ ...round, offer: copyOffer(round.offer) }))];
  rounds.push({ by, offer: copyOffer(offer), on: ctx.date });
  const row = ctx.tx.update('trades', trade.id, {
    rounds,
    awaitingId,
    submittedOn: ctx.date,
    expiresOn: expiryFor(ctx, awaitingId),
    ...(extra.answer === undefined ? {} : { answer: extra.answer }),
    stopsSkip: extra.stopsSkip ?? false,
  });
  ctx.publish('trade.offered', {
    tradeId: trade.id,
    by,
    to: awaitingId,
    round: rounds.length,
    rivalInitiated: false,
  });
  return row;
}

/** Closes the trade without the workers moving. */
export function closeTrade(
  ctx: PhaseContext,
  trade: DeepReadonly<Trade>,
  status: Exclude<TradeStatus, 'open' | 'completed'>,
  outcome: TradeOutcome,
  extra: { answer?: TradeAnswer | null; stopsSkip?: boolean } = {},
): DeepReadonly<Trade> {
  const row = ctx.tx.update('trades', trade.id, {
    status,
    awaitingId: null,
    expiresOn: null,
    closedOn: ctx.date,
    outcome,
    ...(extra.answer === undefined ? {} : { answer: extra.answer }),
    stopsSkip: extra.stopsSkip ?? false,
  });
  ctx.publish('trade.closed', { tradeId: trade.id, status });
  return row;
}

/** Moves the workers and closes the trade as `completed`. */
export function finishTrade(
  ctx: PhaseContext,
  trade: DeepReadonly<Trade>,
  extra: { answer?: TradeAnswer | null; stopsSkip?: boolean } = {},
): TradeMove[] {
  const moves = completeTrade(ctx, trade);
  ctx.tx.update('trades', trade.id, {
    status: 'completed',
    awaitingId: null,
    expiresOn: null,
    closedOn: ctx.date,
    outcome: { ...TRADE_OUTCOMES.completed },
    moves,
    ...(extra.answer === undefined ? {} : { answer: extra.answer }),
    stopsSkip: extra.stopsSkip ?? false,
  });
  ctx.publish('trade.completed', {
    tradeId: trade.id,
    promotionIds: [trade.initiatorId, trade.partnerId],
    workers: moves.length,
  });
  return moves;
}

/**
 * The computer promotion `awaitingId` answers the offer on the table: the deal is checked again
 * (closing it as `cancelled` with the first reason when it can no longer happen), then accepted,
 * countered or refused. The answer and its Why? are kept on the row.
 */
export function answerAsComputer(ctx: PhaseContext, trade: DeepReadonly<Trade>): void {
  const rivalId = trade.awaitingId;
  if (rivalId === null) {
    return;
  }
  const round = currentRound(trade);
  const stopsSkip = stops(ctx, trade);
  const problems = offerProblems(ctx.read, ctx.tunables, ctx.date, round.offer, {
    tradeId: trade.id,
  });
  const [problem] = problems;
  if (problem !== undefined) {
    closeTrade(
      ctx,
      trade,
      'cancelled',
      { code: problem.code, message: problem.message },
      { stopsSkip },
    );
    return;
  }
  const answered = rivalAnswer(
    ctx.read,
    ctx.tunables,
    ctx.date,
    round.offer,
    rivalId,
    trade.rounds.length,
  );
  const ref = answerTraceRef(trade.id, trade.rounds.length);
  ctx.recordTrace(ref, ctx.date, answered.decision, { summaryOnly: !stopsSkip });
  const answer: TradeAnswer = {
    kind: answered.kind,
    by: rivalId,
    on: ctx.date,
    lines: answered.lines.slice(-TRADE_MAX_ANSWER_LINES).map((line) => line.slice(0, 200)),
    traceId: ref.id,
  };
  ctx.publish('trade.answered', { tradeId: trade.id, by: rivalId, answer: answered.kind });
  switch (answered.kind) {
    case 'accept':
      finishTrade(ctx, trade, { answer, stopsSkip });
      return;
    case 'counter':
      if (answered.counter !== null) {
        addRound(ctx, trade, rivalId, answered.counter, { answer, stopsSkip });
        return;
      }
      break;
    case 'refuse':
      break;
  }
  const name = ctx.read.tables.promotions.get(rivalId)?.name ?? 'They';
  closeTrade(
    ctx,
    trade,
    'refused',
    { code: TRADE_OUTCOMES.refused, message: `${name} turned the trade down` },
    { answer, stopsSkip },
  );
}
