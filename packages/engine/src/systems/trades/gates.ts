/**
 * The trades' day stops (TRD-01, TRD-03). Both read only the `stopping` index (rows marked
 * `stopsSkip`, see `lifecycle.ts`), and both send the player to the trades screen (`trades`):
 *
 * - `trades.answered`: a rival answered your offer (accepted, turned down) or the deal fell
 *   through: "Crown Pro accepted your trade".
 * - `trades.offerReceived`: an offer waits for your answer: a rival's own trade offer ("Crown Pro
 *   offered you a trade") or its counter-offer to yours.
 *
 * Seeing the trade (`trades.markSeen`) or answering it clears the stop; the offer itself stays open
 * until `expiresOn`. Until the Inbox (U10) exists, these stops are how the player hears of rival
 * offers.
 *
 * Design: docs/design/trades.md#stops.
 */

import { compareDates } from '../../core/date';
import type { GateHit, GateSpec } from '../../core/pipeline/gates';
import type { Trade } from '../../model/entities/trade';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';

export const TRADE_ANSWERED_GATE_ID = 'trades.answered';
export const TRADE_OFFER_GATE_ID = 'trades.offerReceived';
/** The route hint both stops carry: the trades screen, opened on the trade. */
export const TRADES_ACTION_HINT = 'trades';

function humanSide(read: GameWorldView, trade: DeepReadonly<Trade>): boolean {
  return [trade.initiatorId, trade.partnerId].some(
    (id) => read.tables.promotions.get(id)?.controller.kind === 'human',
  );
}

/** The rows that stop a skip, oldest change first. */
export function stoppingTrades(read: GameWorldView): DeepReadonly<Trade>[] {
  return read.tables.trades
    .lookup('stopping', 'stops')
    .filter((trade) => humanSide(read, trade))
    .sort(
      (left, right) =>
        compareDates(left.closedOn ?? left.submittedOn, right.closedOn ?? right.submittedOn) ||
        compareIds(left.id, right.id),
    );
}

/** The promotion on the other side from the player. */
export function rivalOf(read: GameWorldView, trade: DeepReadonly<Trade>): string {
  const initiator = read.tables.promotions.get(trade.initiatorId);
  const partner = read.tables.promotions.get(trade.partnerId);
  const rival = initiator?.controller.kind === 'human' ? partner : initiator;
  return rival?.name ?? 'A rival';
}

/** The stop's reason for one trade, in plain words and without an amount. */
export function tradeStopReason(read: GameWorldView, trade: DeepReadonly<Trade>): string {
  const rival = rivalOf(read, trade);
  switch (trade.status) {
    case 'open':
      return trade.rounds.length === 1
        ? `${rival} offered you a trade`
        : `${rival} sent a counter-offer for your trade`;
    case 'completed':
      return `${rival} accepted your trade`;
    case 'refused':
      return `${rival} turned down your trade`;
    case 'cancelled':
      return `Your trade with ${rival} fell through: ${trade.outcome?.message ?? 'it can no longer happen'}`;
    case 'lapsed':
    case 'withdrawn':
      return `Your trade with ${rival} is over`;
  }
}

function gateFor(id: string, label: string, open: boolean): GateSpec {
  return {
    id,
    label,
    check: (view): GateHit | null => {
      const first = stoppingTrades(view).find((trade) => (trade.status === 'open') === open);
      if (first === undefined) {
        return null;
      }
      return {
        gateId: id,
        reason: tradeStopReason(view, first),
        subject: { kind: 'trade', id: first.id },
        actionHint: TRADES_ACTION_HINT,
      };
    },
  };
}

export const tradeAnsweredGate: GateSpec = gateFor(TRADE_ANSWERED_GATE_ID, 'Trade answered', false);
export const tradeOfferGate: GateSpec = gateFor(TRADE_OFFER_GATE_ID, 'Trade offer waiting', true);
