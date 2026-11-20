/**
 * Trades (TRD epic): trade workers with other promotions, negotiated like contracts.
 *
 * - TRD-01 (the engine): an offer of your workers (and cash) for theirs, with one optional contract
 *   change per worker; the rival's answer (accept, refuse or counter) from the draft value, its
 *   roster needs, contract cost and length, and whether it gives up a top star; the wrestler's say
 *   (a derived no-trade clause, morale on the move); the move itself (contracts, cash through the
 *   ledger, stables, future bookings, news). Champions are blocked.
 * - TRD-03 (engine part): rare rival trade offers to players, answered with `trades.respond`.
 *
 * The bundle adds the `trades.daily` phase, the `trades.answered` and `trades.offerReceived` stops,
 * the commands `trades.propose`, `trades.respond`, `trades.withdraw`, `trades.markSeen` and the
 * queries `trades.preview`, `trades.list`, `trades.get`, `trades.candidates`. The table is
 * `trades` (`model/entities/trade.ts`); tunables come in through `systems/tunables.ts`.
 *
 * Design: docs/design/trades.md.
 */

import './events';
import { defineSystem, type SystemBundle } from '../../core/api/system';
import { tradeCommands } from './commands';
import { tradeAnsweredGate, tradeOfferGate } from './gates';
import { tradesPhase } from './phase';
import { tradeQueries } from './queries';

export { rivalAnswer, rivalCashLimit, type RivalAnswer, type TradeLean } from './answer';
export { offerProblems, TRADE_REASON_CODES, type OfferCheckOptions } from './checks';
export {
  MARK_TRADES_SEEN_MAX,
  openTradeBetween,
  tradeCommands,
  type TradeProposedResult,
  type TradeRespondArgs,
  type TradeRespondResult,
} from './commands';
export { RIVAL_OFFER_STREAM } from './events';
export {
  stoppingTrades,
  TRADE_ANSWERED_GATE_ID,
  TRADE_OFFER_GATE_ID,
  TRADES_ACTION_HINT,
  tradeAnsweredGate,
  tradeOfferGate,
  tradeStopReason,
} from './gates';
export { answerTraceRef, TRADE_OUTCOMES, TRADE_TRACE_KIND } from './lifecycle';
export { TRADES_PHASE_ID, tradesPhase } from './phase';
export {
  TRADE_LIST_STATUSES,
  tradeQueries,
  type TradeCandidatesView,
  type TradeCandidateView,
  type TradeListStatus,
} from './queries';
export { makeRivalOffers, rivalProposal } from './rivalOffers';
export { hasNoTradeClause, wrestlerSay, type WrestlerSay } from './say';
export {
  completeTrade,
  leaveStables,
  removeFromFutureBookings,
  TRADE_NEWS_TOPIC,
  TRADED_REASON_KEY,
} from './transfer';
export { tradeTunables } from './tunables';
export { valueDeal, workerPoints, type DealValue, type WorkerReading } from './value';
export {
  offerFromArgs,
  type TradeAnswerView,
  type TradeMoveView,
  type TradeOfferView,
  type TradePreviewView,
  type TradeRivalView,
  type TradeRoundView,
  type TradeSayView,
  type TradeSideArgs,
  type TradeSideView,
  type TradeSummaryView,
  type TradeTermsArgs,
  type TradeView,
  type TradeWorkerView,
} from './views';
export { TradeWorkerReader, type TradeWorker } from './workers';

export const tradesSystem: SystemBundle = defineSystem({
  id: 'trades',
  phases: [tradesPhase],
  gates: [tradeAnsweredGate, tradeOfferGate],
  queries: tradeQueries,
  commands: tradeCommands,
});
