/**
 * The trade commands (TRD-01, TRD-03). Every one is issued for a promotion the caller runs.
 *
 * - `trades.propose { promotionId, partnerId, give, get, adjustments? }`: sends a first offer to a
 *   computer promotion; it answers when the next day runs. One open trade per pair of promotions.
 * - `trades.respond { tradeId, answer: accept | refuse | counter, give?, get?, adjustments? }`:
 *   answers an offer waiting for you (a rival's counter-offer, or a rival's own trade offer).
 *   `accept` makes the trade at once; `counter` sends your own offer back (give/get from your
 *   side), answered when the next day runs; `refuse` ends the talk.
 * - `trades.withdraw { tradeId }`: takes back your offer before it is answered.
 * - `trades.markSeen { tradeIds }`: clears the trade stops for trades the player has seen.
 *
 * Design: docs/design/trades.md#commands.
 */

import { z } from 'zod';
import { defineCommand } from '../../core/api/command';
import { controlsPromotion, type Controller } from '../../core/api/controller';
import type { Reason } from '../../core/api/result';
import type { GameDate } from '../../core/date';
import type { PromotionId, TradeId } from '../../core/ids';
import {
  currentRound,
  TRADE_MAX_ROUNDS,
  TradeAnswerKindSchema,
  TradeAdjustmentSchema,
  TRADE_MAX_WORKERS_PER_SIDE,
  type Trade,
  type TradeAdjustment,
  type TradeAnswerKind,
  type TradeMove,
  type TradeStatus,
} from '../../model/entities/trade';
import { zId } from '../../model/primitives';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { EngineTunables } from '../tunables';
import { offerProblems, TRADE_REASON_CODES } from './checks';
import { addRound, closeTrade, finishTrade, isHuman, openTrade, TRADE_OUTCOMES } from './lifecycle';
import {
  offerFromArgs,
  TradeSideArgsSchema,
  TradeTermsArgsShape,
  type TradeSideArgs,
  type TradeTermsArgs,
} from './views';

export const MARK_TRADES_SEEN_MAX = 200;

export interface TradeProposedResult {
  tradeId: TradeId;
  /** The day the rival answers (when that day runs). */
  answerOn: GameDate;
}

export interface TradeRespondArgs {
  tradeId: TradeId;
  answer: TradeAnswerKind;
  /** For `counter`: what you give and get (from your side). */
  give?: TradeSideArgs | undefined;
  get?: TradeSideArgs | undefined;
  adjustments?: TradeAdjustment[] | undefined;
}

export interface TradeRespondResult {
  tradeId: TradeId;
  status: TradeStatus;
  /** The workers who moved, when you accepted. */
  moves: TradeMove[];
}

declare module '../../core/api/maps' {
  interface CommandMap {
    'trades.propose': { args: TradeTermsArgs; result: TradeProposedResult };
    'trades.respond': { args: TradeRespondArgs; result: TradeRespondResult };
    'trades.withdraw': {
      args: { tradeId: TradeId };
      result: { tradeId: TradeId; status: TradeStatus };
    };
    'trades.markSeen': { args: { tradeIds: TradeId[] }; result: { cleared: number } };
  }
}

function notYours(promotionId: PromotionId): Reason {
  return {
    code: TRADE_REASON_CODES.notAllowed,
    message: 'You can only trade for a promotion you run.',
    field: 'promotionId',
    subject: { kind: 'promotion', id: promotionId },
  };
}

/** The rules about who trades with whom, before the offer itself is checked. */
function partnerReasons(
  read: GameWorldView,
  args: Pick<TradeTermsArgs, 'promotionId' | 'partnerId'>,
  issuedBy: Controller,
): Reason[] {
  if (!controlsPromotion(read, args.promotionId, issuedBy)) {
    return [notYours(args.promotionId)];
  }
  const partner = read.tables.promotions.get(args.partnerId);
  if (partner === undefined) {
    return [
      {
        code: TRADE_REASON_CODES.unknownPromotion,
        message: 'That promotion is not in this world.',
        field: 'partnerId',
      },
    ];
  }
  if (partner.id === args.promotionId) {
    return [
      {
        code: TRADE_REASON_CODES.samePromotion,
        message: 'Pick another promotion to trade with.',
        field: 'partnerId',
      },
    ];
  }
  if (partner.controller.kind !== 'computer') {
    return [
      {
        code: TRADE_REASON_CODES.notARival,
        message: 'Trades are with computer-run promotions for now.',
        field: 'partnerId',
        subject: { kind: 'promotion', id: partner.id },
      },
    ];
  }
  return [];
}

/** An open trade between the two promotions, if any. */
export function openTradeBetween(
  read: GameWorldView,
  left: PromotionId,
  right: PromotionId,
): DeepReadonly<Trade> | null {
  return (
    read.tables.trades
      .lookup('byPromotion', left)
      .filter(
        (trade) =>
          trade.status === 'open' && (trade.initiatorId === right || trade.partnerId === right),
      )
      .sort((left, right) => compareIds(left.id, right.id))[0] ?? null
  );
}

function proposeReasons(
  read: GameWorldView,
  tunables: EngineTunables,
  args: TradeTermsArgs,
  issuedBy: Controller,
): Reason[] {
  const partner = partnerReasons(read, args, issuedBy);
  if (partner.length > 0) {
    return partner;
  }
  const open = openTradeBetween(read, args.promotionId, args.partnerId);
  if (open !== null) {
    return [
      {
        code: TRADE_REASON_CODES.talkOpen,
        message: 'You already have a trade open with them: answer or withdraw it first.',
        subject: { kind: 'trade', id: open.id },
      },
    ];
  }
  return offerProblems(
    read,
    tunables,
    read.meta.currentDate,
    offerFromArgs(args, args.promotionId),
  );
}

export const proposeTradeCommand = defineCommand('trades.propose', {
  args: z.strictObject(TradeTermsArgsShape),
  validate: (read, args, issuedBy, env) => proposeReasons(read, env.tunables, args, issuedBy),
  apply: (ctx, args): TradeProposedResult => {
    const trade = openTrade(ctx, {
      by: args.promotionId,
      to: args.partnerId,
      offer: offerFromArgs(args, args.promotionId),
      rivalInitiated: false,
    });
    return { tradeId: trade.id, answerOn: ctx.date };
  },
});

/** The open trade waiting for the caller, or the reasons it is not. */
function waitingForYou(
  read: GameWorldView,
  tradeId: TradeId,
  issuedBy: Controller,
): { trade: DeepReadonly<Trade> | null; reasons: Reason[] } {
  const trade = read.tables.trades.get(tradeId);
  if (trade === undefined) {
    return {
      trade: null,
      reasons: [
        { code: TRADE_REASON_CODES.unknownTrade, message: 'That trade is gone.', field: 'tradeId' },
      ],
    };
  }
  if (trade.status !== 'open' || trade.awaitingId === null) {
    return {
      trade,
      reasons: [
        { code: TRADE_REASON_CODES.notOpen, message: 'That trade is over.', field: 'tradeId' },
      ],
    };
  }
  if (!controlsPromotion(read, trade.awaitingId, issuedBy)) {
    const yours = [trade.initiatorId, trade.partnerId].some((id) =>
      controlsPromotion(read, id, issuedBy),
    );
    return {
      trade,
      reasons: [
        yours
          ? {
              code: TRADE_REASON_CODES.notYourTurn,
              message: 'They have not answered yet.',
              field: 'tradeId',
            }
          : notYours(trade.initiatorId),
      ],
    };
  }
  return { trade, reasons: [] };
}

function counterArgs(trade: DeepReadonly<Trade>, args: TradeRespondArgs): TradeTermsArgs | null {
  if (args.give === undefined || args.get === undefined || trade.awaitingId === null) {
    return null;
  }
  const you = trade.awaitingId;
  return {
    promotionId: you,
    partnerId: you === trade.initiatorId ? trade.partnerId : trade.initiatorId,
    give: args.give,
    get: args.get,
    adjustments: args.adjustments,
  };
}

function respondReasons(
  read: GameWorldView,
  tunables: EngineTunables,
  args: TradeRespondArgs,
  issuedBy: Controller,
): Reason[] {
  const { trade, reasons } = waitingForYou(read, args.tradeId, issuedBy);
  if (trade === null || reasons.length > 0) {
    return reasons;
  }
  const date = read.meta.currentDate;
  switch (args.answer) {
    case 'refuse':
      return [];
    case 'accept':
      return offerProblems(read, tunables, date, currentRound(trade).offer, { tradeId: trade.id });
    case 'counter': {
      const terms = counterArgs(trade, args);
      if (terms === null) {
        return [
          {
            code: TRADE_REASON_CODES.needsOffer,
            message: 'A counter-offer needs what you give and what you get.',
            field: 'give',
          },
        ];
      }
      if (trade.rounds.length >= TRADE_MAX_ROUNDS) {
        return [
          {
            code: TRADE_REASON_CODES.notOpen,
            message: 'This trade has gone back and forth too long: accept or refuse it.',
          },
        ];
      }
      return offerProblems(read, tunables, date, offerFromArgs(terms, trade.initiatorId), {
        tradeId: trade.id,
      });
    }
  }
}

export const respondToTradeCommand = defineCommand('trades.respond', {
  args: z.strictObject({
    tradeId: zId('trade'),
    answer: TradeAnswerKindSchema,
    give: TradeSideArgsSchema.optional(),
    get: TradeSideArgsSchema.optional(),
    adjustments: z
      .array(TradeAdjustmentSchema)
      .max(TRADE_MAX_WORKERS_PER_SIDE * 2)
      .optional(),
  }),
  validate: (read, args, issuedBy, env) => respondReasons(read, env.tunables, args, issuedBy),
  apply: (ctx, args): TradeRespondResult => {
    const trade = ctx.read.tables.trades.require(args.tradeId);
    switch (args.answer) {
      case 'accept': {
        const moves = finishTrade(ctx, trade);
        return { tradeId: trade.id, status: 'completed', moves };
      }
      case 'refuse':
        closeTrade(ctx, trade, 'refused', { ...TRADE_OUTCOMES.refusedByYou });
        return { tradeId: trade.id, status: 'refused', moves: [] };
      case 'counter': {
        const terms = counterArgs(trade, args);
        if (terms === null || trade.awaitingId === null) {
          throw new Error('trades.respond: a counter-offer without terms passed validation');
        }
        addRound(ctx, trade, trade.awaitingId, offerFromArgs(terms, trade.initiatorId));
        return { tradeId: trade.id, status: 'open', moves: [] };
      }
    }
  },
});

export const withdrawTradeCommand = defineCommand('trades.withdraw', {
  args: z.strictObject({ tradeId: zId('trade') }),
  validate: (read, args, issuedBy) => {
    const trade = read.tables.trades.get(args.tradeId);
    if (trade === undefined) {
      return [
        { code: TRADE_REASON_CODES.unknownTrade, message: 'That trade is gone.', field: 'tradeId' },
      ];
    }
    if (trade.status !== 'open' || trade.awaitingId === null) {
      return [
        { code: TRADE_REASON_CODES.notOpen, message: 'That trade is over.', field: 'tradeId' },
      ];
    }
    const last = currentRound(trade);
    if (!controlsPromotion(read, last.by, issuedBy)) {
      return [
        {
          code: TRADE_REASON_CODES.notYourTurn,
          message: 'Only the side that made the offer can withdraw it.',
          field: 'tradeId',
        },
      ];
    }
    return [];
  },
  apply: (ctx, args) => {
    const trade = ctx.read.tables.trades.require(args.tradeId);
    closeTrade(ctx, trade, 'withdrawn', { ...TRADE_OUTCOMES.withdrawn });
    return { tradeId: trade.id, status: 'withdrawn' as const };
  },
});

export const markTradesSeenCommand = defineCommand('trades.markSeen', {
  args: z.strictObject({ tradeIds: z.array(zId('trade')).max(MARK_TRADES_SEEN_MAX) }),
  // Trades that are gone or not yours are passed over, so opening a screen can always clear it.
  validate: () => [],
  apply: (ctx, args, issuedBy) => {
    let cleared = 0;
    for (const tradeId of [...new Set(args.tradeIds)].sort(compareIds)) {
      const trade = ctx.read.tables.trades.get(tradeId);
      if (
        trade === undefined ||
        !trade.stopsSkip ||
        ![trade.initiatorId, trade.partnerId].some(
          (id) => isHuman(ctx.read, id) && controlsPromotion(ctx.read, id, issuedBy),
        )
      ) {
        continue;
      }
      ctx.tx.update('trades', trade.id, { stopsSkip: false });
      cleared += 1;
    }
    return { cleared };
  },
});

export const tradeCommands = [
  proposeTradeCommand,
  respondToTradeCommand,
  withdrawTradeCommand,
  markTradesSeenCommand,
];
