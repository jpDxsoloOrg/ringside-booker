/**
 * Trades (TRD-01): one row per trade talk between two promotions, from the first offer to its end.
 *
 * A trade swaps workers (and optionally cash) between exactly two promotions. Each round of the talk
 * is an offer from one side (`rounds`, oldest first); the newest round is the offer on the table.
 * The side whose answer is awaited is `awaitingId`. A computer promotion answers the day after an
 * offer reaches it (the `trades.answer` phase); a player answers with `trades.respond`.
 *
 * The offer names each side's contracts by employment id. On acceptance each moving worker's
 * contract with the old promotion ends and a new one with the same (or adjusted) terms starts with
 * the new promotion; `moves` records both ids, so history and news can follow the person.
 *
 * Closed rows stay for `trades.history.keepDays`, then the phase prunes them.
 *
 * Design: docs/design/trades.md and docs/design/data-model.md, "Trades".
 */

import { z } from 'zod';
import { compareDates } from '../../core/date';
import { zGameDate, zId, zNonNegativeCents, zSigned100 } from '../primitives';
import { defineTable } from '../table-def';

/** The most workers one side of a trade can send. */
export const TRADE_MAX_WORKERS_PER_SIDE = 5;
/** The most rounds a trade row keeps (the talk ends well before this: `trades.maxRounds`). */
export const TRADE_MAX_ROUNDS = 12;
/** The most plain-words lines an answer keeps. */
export const TRADE_MAX_ANSWER_LINES = 16;
/** Contract length a trade can set, in months. */
export const TRADE_MIN_LENGTH_MONTHS = 1;
export const TRADE_MAX_LENGTH_MONTHS = 60;

/**
 * `open`: an offer waits for `awaitingId`'s answer. Every other status is closed for good:
 * `completed` (the workers moved), `refused`, `withdrawn` (by the side that made the last offer),
 * `lapsed` (a player did not answer by `expiresOn`) and `cancelled` (the deal could no longer
 * happen: a worker became champion, a contract ended, the money was gone...).
 */
export const TRADE_STATUSES = [
  'open',
  'completed',
  'refused',
  'withdrawn',
  'lapsed',
  'cancelled',
] as const;
export const TradeStatusSchema = z.enum(TRADE_STATUSES);
export type TradeStatus = z.infer<typeof TradeStatusSchema>;

/** One side of an offer: the contracts it sends and the cash it pays the other side. */
export const TradeSideSchema = z.strictObject({
  promotionId: zId('promotion'),
  employmentIds: z.array(zId('employment')).max(TRADE_MAX_WORKERS_PER_SIDE),
  cash: zNonNegativeCents,
});
export type TradeSide = z.infer<typeof TradeSideSchema>;

/**
 * A change to one moving worker's contract, made as part of the deal: a new main pay (the monthly
 * wage, or the appearance fee of a per-appearance deal) and/or a new length from the trade day.
 * Null keeps that part as it is.
 */
export const TradeAdjustmentSchema = z.strictObject({
  employmentId: zId('employment'),
  pay: zNonNegativeCents.nullable(),
  lengthMonths: z
    .number()
    .int()
    .min(TRADE_MIN_LENGTH_MONTHS)
    .max(TRADE_MAX_LENGTH_MONTHS)
    .nullable(),
});
export type TradeAdjustment = z.infer<typeof TradeAdjustmentSchema>;

/** An offer: what each of the two sides sends, and any contract changes. */
export const TradeOfferSchema = z
  .strictObject({
    /** Exactly two sides, the trade's initiator first. */
    sides: z.array(TradeSideSchema).length(2),
    adjustments: z.array(TradeAdjustmentSchema).max(TRADE_MAX_WORKERS_PER_SIDE * 2),
  })
  .superRefine((offer, context) => {
    const [first, second] = offer.sides;
    if (first === undefined || second === undefined) {
      return;
    }
    if (first.promotionId === second.promotionId) {
      context.addIssue({
        code: 'custom',
        path: ['sides'],
        message: 'A trade needs two promotions',
      });
    }
    const moving = new Set([...first.employmentIds, ...second.employmentIds]);
    if (moving.size !== first.employmentIds.length + second.employmentIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['sides'],
        message: 'A contract can only be in a trade once',
      });
    }
    const adjusted = new Set<string>();
    offer.adjustments.forEach((adjustment, index) => {
      if (!moving.has(adjustment.employmentId) || adjusted.has(adjustment.employmentId)) {
        context.addIssue({
          code: 'custom',
          path: ['adjustments', index, 'employmentId'],
          message: 'One change per worker in the trade',
        });
      }
      adjusted.add(adjustment.employmentId);
    });
  });
export type TradeOffer = z.infer<typeof TradeOfferSchema>;

/** One offer in the talk. */
export const TradeRoundSchema = z.strictObject({
  /** The promotion that made this offer. */
  by: zId('promotion'),
  offer: TradeOfferSchema,
  on: zGameDate,
});
export type TradeRound = z.infer<typeof TradeRoundSchema>;

export const TRADE_ANSWER_KINDS = ['accept', 'refuse', 'counter'] as const;
export const TradeAnswerKindSchema = z.enum(TRADE_ANSWER_KINDS);
export type TradeAnswerKind = z.infer<typeof TradeAnswerKindSchema>;

/** A computer promotion's latest answer, in plain words, with where its Why? is stored. */
export const TradeAnswerSchema = z.strictObject({
  kind: TradeAnswerKindSchema,
  by: zId('promotion'),
  on: zGameDate,
  lines: z.array(z.string().min(1).max(200)).max(TRADE_MAX_ANSWER_LINES),
  /** The `trades.answer` trace id, or null when none was recorded. */
  traceId: z.string().min(1).nullable(),
});
export type TradeAnswer = z.infer<typeof TradeAnswerSchema>;

/** How a closed trade ended, for the player: a stable code and one plain line. */
export const TradeOutcomeSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1).max(200),
});
export type TradeOutcome = z.infer<typeof TradeOutcomeSchema>;

/** One worker who moved in a completed trade. */
export const TradeMoveSchema = z.strictObject({
  personId: zId('person'),
  fromPromotionId: zId('promotion'),
  toPromotionId: zId('promotion'),
  fromEmploymentId: zId('employment'),
  toEmploymentId: zId('employment'),
  /** The morale change the move gave them (the wrestler's say). */
  moraleChange: zSigned100,
});
export type TradeMove = z.infer<typeof TradeMoveSchema>;

export const TradeSchema = z
  .strictObject({
    id: zId('trade'),
    /** The promotion that made the first offer. */
    initiatorId: zId('promotion'),
    /** The other promotion. */
    partnerId: zId('promotion'),
    status: TradeStatusSchema,
    /** Whose answer the open offer waits for; null once closed. */
    awaitingId: zId('promotion').nullable(),
    rounds: z.array(TradeRoundSchema).min(1).max(TRADE_MAX_ROUNDS),
    /** The day the newest offer was made. */
    submittedOn: zGameDate,
    /** The last day a player may answer an open offer; null when a computer answers. */
    expiresOn: zGameDate.nullable(),
    closedOn: zGameDate.nullable(),
    outcome: TradeOutcomeSchema.nullable(),
    answer: TradeAnswerSchema.nullable(),
    moves: z.array(TradeMoveSchema),
    /** Stops a player's skip until they have seen the news (`trades.markSeen` clears it). */
    stopsSkip: z.boolean(),
  })
  .superRefine((trade, context) => {
    const issue = (path: string[], message: string): void => {
      context.addIssue({ code: 'custom', path, message });
    };
    const open = trade.status === 'open';
    if (open !== (trade.awaitingId !== null)) {
      issue(['awaitingId'], 'An open trade waits for one side; a closed one for nobody');
    }
    if (open !== (trade.closedOn === null)) {
      issue(['closedOn'], 'closedOn is set exactly when the trade is closed');
    }
    if (trade.initiatorId === trade.partnerId) {
      issue(['partnerId'], 'A trade needs two promotions');
    }
    if (trade.status !== 'completed' && trade.moves.length > 0) {
      issue(['moves'], 'Only a completed trade has moves');
    }
    if (trade.closedOn !== null && compareDates(trade.closedOn, trade.submittedOn) < 0) {
      issue(['closedOn'], 'closedOn must not be before submittedOn');
    }
  });
export type Trade = z.infer<typeof TradeSchema>;

/** The two sides of an offer, the initiator's first. */
export function sidesOf<S>(offer: { readonly sides: readonly S[] }): readonly [S, S] {
  const [first, second] = offer.sides;
  if (first === undefined || second === undefined) {
    throw new Error('A trade offer always has two sides');
  }
  return [first, second];
}

/** A mutable copy of an offer read from the world. */
export function copyOffer(offer: {
  readonly sides: readonly {
    readonly promotionId: TradeSide['promotionId'];
    readonly employmentIds: readonly TradeSide['employmentIds'][number][];
    readonly cash: TradeSide['cash'];
  }[];
  readonly adjustments: readonly Readonly<TradeAdjustment>[];
}): TradeOffer {
  return {
    sides: offer.sides.map((side) => ({ ...side, employmentIds: [...side.employmentIds] })),
    adjustments: offer.adjustments.map((adjustment) => ({ ...adjustment })),
  };
}

/** The newest round: the offer on the table (or the last one, once closed). */
export function currentRound<R>(trade: { readonly rounds: readonly R[] }): R {
  const round = trade.rounds[trade.rounds.length - 1];
  if (round === undefined) {
    throw new Error('A trade always has at least one round');
  }
  return round;
}

export const tradesTable = defineTable({
  kind: 'trade',
  name: 'trades',
  schema: TradeSchema,
  refs: [
    { path: 'initiatorId', target: 'promotion', nullable: false },
    { path: 'partnerId', target: 'promotion', nullable: false },
    { path: 'awaitingId', target: 'promotion', nullable: true },
    { path: 'rounds[].by', target: 'promotion', nullable: false },
    { path: 'rounds[].offer.sides[].promotionId', target: 'promotion', nullable: false },
    { path: 'rounds[].offer.sides[].employmentIds[]', target: 'employment', nullable: false },
    { path: 'rounds[].offer.adjustments[].employmentId', target: 'employment', nullable: false },
    { path: 'answer.by', target: 'promotion', nullable: false },
    { path: 'moves[].personId', target: 'person', nullable: false },
    { path: 'moves[].fromPromotionId', target: 'promotion', nullable: false },
    { path: 'moves[].toPromotionId', target: 'promotion', nullable: false },
    { path: 'moves[].fromEmploymentId', target: 'employment', nullable: false },
    { path: 'moves[].toEmploymentId', target: 'employment', nullable: false },
  ],
  indexes: [
    { name: 'byStatus', key: (row) => row.status },
    /** The rows that stop a player's skip: the gates read only these. */
    { name: 'stopping', key: (row) => (row.stopsSkip ? 'stops' : null) },
    { name: 'byPromotion', key: (row) => [row.initiatorId, row.partnerId] },
    {
      // The contracts in an open offer: a contract can be in one open trade at a time.
      name: 'openByEmployment',
      key: (row) => {
        if (row.status !== 'open') {
          return null;
        }
        const [first, second] = sidesOf(currentRound(row).offer);
        return [...first.employmentIds, ...second.employmentIds];
      },
    },
  ],
});
