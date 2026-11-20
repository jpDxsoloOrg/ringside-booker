/**
 * The trades' day phase, `trades.daily` (TRD-01, TRD-03). Daily, in the `contracts` group at order
 * 8: after the contract talks (5) and before the contract lifecycle (10).
 *
 * In order, each list in id order:
 * 1. **Answers**: every open offer waiting for a computer promotion that was made on or before
 *    today is answered (`answerAsComputer`): accepted (the workers move today), countered or
 *    refused, or cancelled when it can no longer happen. Like contract offers, an offer made today
 *    is answered when the day runs, so the player sees it after Next Day.
 * 2. **Lapses**: an offer waiting for a player past `expiresOn` closes as `lapsed` (no stop: it was
 *    theirs to answer).
 * 3. **Rival offers** (TRD-03, `rivalOffers.ts`): rare, on Mondays only.
 * 4. **Pruning**: closed trades older than `trades.history.keepDays` are removed.
 *
 * Design: docs/design/trades.md#day-phase.
 */

import { addDays, compareDates } from '../../core/date';
import type { PhaseContext } from '../../core/pipeline/context';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import { compareIds } from '../../model/table';
import { answerAsComputer, closeTrade, isHuman, TRADE_OUTCOMES } from './lifecycle';
import { makeRivalOffers } from './rivalOffers';

export const TRADES_PHASE_ID = 'trades.daily';

function openTrades(ctx: PhaseContext) {
  return [...ctx.read.tables.trades.lookup('byStatus', 'open')].sort((left, right) =>
    compareIds(left.id, right.id),
  );
}

function answerOffers(ctx: PhaseContext): void {
  for (const listed of openTrades(ctx)) {
    const trade = ctx.read.tables.trades.get(listed.id);
    if (
      trade?.status !== 'open' ||
      trade.awaitingId === null ||
      isHuman(ctx.read, trade.awaitingId) ||
      compareDates(trade.submittedOn, ctx.date) > 0
    ) {
      continue;
    }
    answerAsComputer(ctx, trade);
  }
}

function lapseOffers(ctx: PhaseContext): void {
  for (const trade of openTrades(ctx)) {
    if (trade.expiresOn !== null && compareDates(trade.expiresOn, ctx.date) < 0) {
      closeTrade(ctx, trade, 'lapsed', { ...TRADE_OUTCOMES.lapsed });
    }
  }
}

function pruneClosed(ctx: PhaseContext): void {
  const keep = ctx.tunables.get('trades.history.keepDays');
  for (const status of ['completed', 'refused', 'withdrawn', 'lapsed', 'cancelled'] as const) {
    for (const trade of [...ctx.read.tables.trades.lookup('byStatus', status)]) {
      if (
        trade.closedOn !== null &&
        !trade.stopsSkip &&
        compareDates(addDays(trade.closedOn, keep), ctx.date) < 0
      ) {
        ctx.tx.delete('trades', trade.id);
      }
    }
  }
}

/** The whole phase. */
export function runTradesDay(ctx: PhaseContext): void {
  answerOffers(ctx);
  lapseOffers(ctx);
  makeRivalOffers(ctx);
  pruneClosed(ctx);
}

export const tradesPhase: PhaseDefinition = definePhase({
  id: TRADES_PHASE_ID,
  group: 'contracts',
  order: 8,
  cadence: { kind: 'daily' },
  run: runTradesDay,
});
