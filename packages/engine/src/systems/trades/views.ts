/**
 * What the trade queries and commands hand the UI (TRD-01): plain JSON views of an offer, its
 * workers and how each of them feels, a trade talk, and the live preview of a deal being built.
 *
 * Money is in cents, values are points rounded to one decimal, months to one decimal. Traces are
 * inline (`trace`) where the screen shows a Why? straight away, and as a ref (`traceRef`, read with
 * `trace.get`) for a stored answer.
 *
 * Design: docs/design/trades.md#queries.
 */

import { z } from 'zod';
import type { Reason } from '../../core/api/result';
import type { GameDate } from '../../core/date';
import type { EmploymentId, PersonId, PromotionId, TitleId, TradeId } from '../../core/ids';
import { cents } from '../../core/money';
import type { TraceNode } from '../../core/trace';
import type { TraceRef } from '../../core/trace/store';
import type { ContractKind, EmploymentRole, Push } from '../../model/entities/employment';
import type { Gender } from '../../model/entities/person';
import {
  currentRound,
  sidesOf,
  TRADE_MAX_WORKERS_PER_SIDE,
  TradeAdjustmentSchema,
  type Trade,
  type TradeAdjustment,
  type TradeAnswerKind,
  type TradeOffer,
  type TradeOutcome,
  type TradeStatus,
} from '../../model/entities/trade';
import { zId, zNonNegativeCents } from '../../model/primitives';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { EngineTunables } from '../tunables';
import { rivalAnswer, type TradeLean } from './answer';
import { TRADE_TRACE_KIND } from './lifecycle';
import { wrestlerSay } from './say';
import { pointsText, sideWorkers } from './value';
import { TradeWorkerReader, type TradeWorker } from './workers';

// ---------------------------------------------------------------------------------------------
// Arguments: an offer from the issuing promotion's side

/** What one side sends, as a caller writes it. */
export const TradeSideArgsSchema = z.strictObject({
  employmentIds: z.array(zId('employment')).max(TRADE_MAX_WORKERS_PER_SIDE),
  cash: zNonNegativeCents,
});
export type TradeSideArgs = z.infer<typeof TradeSideArgsSchema>;

/** An offer from your side: what you give, what you get, and any contract changes. */
export interface TradeTermsArgs {
  /** Your promotion. */
  promotionId: PromotionId;
  /** The promotion on the other side. */
  partnerId: PromotionId;
  give: TradeSideArgs;
  get: TradeSideArgs;
  /** At most one per worker in the deal: a new pay and/or a new length in months. */
  adjustments?: TradeAdjustment[] | undefined;
}

export const TradeTermsArgsShape = {
  promotionId: zId('promotion'),
  partnerId: zId('promotion'),
  give: TradeSideArgsSchema,
  get: TradeSideArgsSchema,
  adjustments: z
    .array(TradeAdjustmentSchema)
    .max(TRADE_MAX_WORKERS_PER_SIDE * 2)
    .optional(),
};

/** The offer the arguments describe, sides in the trade's order (initiator first). */
export function offerFromArgs(
  args: Pick<TradeTermsArgs, 'promotionId' | 'partnerId' | 'give' | 'get' | 'adjustments'>,
  initiatorId: PromotionId,
): TradeOffer {
  const yours = {
    promotionId: args.promotionId,
    employmentIds: [...args.give.employmentIds],
    cash: cents(args.give.cash),
  };
  const theirs = {
    promotionId: args.partnerId,
    employmentIds: [...args.get.employmentIds],
    cash: cents(args.get.cash),
  };
  return {
    sides: initiatorId === args.partnerId ? [theirs, yours] : [yours, theirs],
    adjustments: (args.adjustments ?? []).map((adjustment) => ({ ...adjustment })),
  };
}

// ---------------------------------------------------------------------------------------------
// Views

export interface TradeSayView {
  willing: boolean;
  noTradeClause: boolean;
  /** True when their no-trade clause stops the deal. */
  blocks: boolean;
  /** How they feel, in points (0 or more = willing). */
  feeling: number;
  moraleChange: number;
  line: string;
  trace: TraceNode;
}

export interface TradeWorkerView {
  employmentId: EmploymentId;
  personId: PersonId;
  name: string;
  role: EmploymentRole;
  push: Push;
  gender: Gender;
  age: number;
  /** Draft value, 0-100, one decimal. */
  value: number;
  titleIds: TitleId[];
  contract: {
    kind: ContractKind;
    /** The main pay now: monthly wage, or the appearance fee of a per-appearance deal. */
    pay: number;
    /** The main pay after the deal's change (the same when unchanged). */
    payAfter: number;
    endsOn: GameDate | null;
    endsOnAfter: GameDate | null;
    /** Months left after the deal, one decimal; null for open-ended. */
    monthsLeft: number | null;
  };
  adjustment: TradeAdjustment | null;
  /** How they feel about the move; null for a closed trade. */
  say: TradeSayView | null;
}

export interface TradeSideView {
  promotionId: PromotionId;
  name: string;
  shortName: string;
  isYou: boolean;
  /** Cash this side sends, in cents. */
  cash: number;
  workers: TradeWorkerView[];
}

export interface TradeOfferView {
  sides: TradeSideView[];
}

export interface TradeRivalView {
  promotionId: PromotionId;
  name: string;
  /** `yes`: they would accept as it stands; `close`: they would counter; `far`: they would refuse. */
  lean: TradeLean;
  /** The answer they would give today. */
  likely: TradeAnswerKind;
  /** What the deal is worth to them, in points, one decimal. */
  score: number;
  margin: number;
  shortfall: number;
  /** The most cash they will pay out, in cents. */
  cashLimit: number;
  lines: string[];
  trace: TraceNode;
  /** The counter-offer they would send, when `likely` is `counter`. */
  counter: TradeOfferView | null;
}

export interface TradePreviewView {
  /** Every rule the offer breaks today; empty when it may be sent. */
  problems: Reason[];
  offer: TradeOfferView;
  /** The other side's read on the deal; null when a player runs it. */
  rival: TradeRivalView | null;
}

export interface TradeRoundView {
  by: PromotionId;
  byYou: boolean;
  on: GameDate;
  offer: TradeOfferView;
}

export interface TradeAnswerView {
  kind: TradeAnswerKind;
  by: PromotionId;
  on: GameDate;
  lines: string[];
  traceRef: TraceRef | null;
}

export interface TradeMoveView {
  personId: PersonId;
  name: string;
  fromPromotionId: PromotionId;
  toPromotionId: PromotionId;
  fromEmploymentId: EmploymentId;
  toEmploymentId: EmploymentId;
  moraleChange: number;
}

export interface TradeSummaryView {
  tradeId: TradeId;
  status: TradeStatus;
  initiatorId: PromotionId;
  partnerId: PromotionId;
  /** The promotion on the other side from the viewer (the partner for an omniscient viewer). */
  otherId: PromotionId;
  otherName: string;
  /** A rival started this talk (TRD-03). */
  rivalInitiated: boolean;
  awaitingId: PromotionId | null;
  /** The offer waits for your answer. */
  awaitingYou: boolean;
  rounds: number;
  submittedOn: GameDate;
  expiresOn: GameDate | null;
  closedOn: GameDate | null;
  outcome: TradeOutcome | null;
  /** One line: who goes where. */
  headline: string;
  stopsSkip: boolean;
}

export interface TradeView extends TradeSummaryView {
  offer: TradeOfferView;
  history: TradeRoundView[];
  answer: TradeAnswerView | null;
  moves: TradeMoveView[];
  /** For an open trade: the rules the offer on the table breaks today. */
  problems: Reason[];
  canAccept: boolean;
  canRefuse: boolean;
  canCounter: boolean;
  canWithdraw: boolean;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function workerView(
  read: GameWorldView,
  tunables: EngineTunables,
  worker: TradeWorker,
  toPromotionId: PromotionId,
  adjustment: TradeAdjustment | null,
  withSay: boolean,
): TradeWorkerView {
  let say: TradeSayView | null = null;
  if (withSay) {
    const said = wrestlerSay(read, tunables, worker, toPromotionId);
    say = {
      willing: said.willing,
      noTradeClause: said.noTradeClause,
      blocks: said.blocks,
      feeling: round1(said.feeling.value),
      moraleChange: said.moraleChange,
      line: said.line,
      trace: said.feeling.trace,
    };
  }
  return {
    employmentId: worker.employmentId,
    personId: worker.personId,
    name: worker.name,
    role: worker.role,
    push: worker.push,
    gender: worker.gender,
    age: worker.age,
    value: round1(worker.value),
    titleIds: [...worker.titleIds],
    contract: {
      kind: worker.employment.terms.kind,
      pay: worker.pay,
      payAfter: worker.payAfter,
      endsOn: worker.employment.endsOn,
      endsOnAfter: worker.endsOn,
      monthsLeft: worker.monthsLeft === null ? null : round1(worker.monthsLeft),
    },
    adjustment,
    say,
  };
}

/** The offer as the screen shows it; `withSay` adds each worker's feelings (open offers only). */
export function offerView(
  read: GameWorldView,
  tunables: EngineTunables,
  date: GameDate,
  offer: DeepReadonly<TradeOffer>,
  you: readonly PromotionId[],
  withSay: boolean,
): TradeOfferView {
  const reader = new TradeWorkerReader(read, tunables, date);
  return {
    sides: offer.sides.map((side, index) => {
      const to = sidesOf(offer)[index === 0 ? 1 : 0].promotionId;
      const promotion = read.tables.promotions.get(side.promotionId);
      return {
        promotionId: side.promotionId,
        name: promotion?.name ?? side.promotionId,
        shortName: promotion?.shortName ?? '',
        isYou: you.includes(side.promotionId),
        cash: side.cash,
        workers: sideWorkers(reader, offer, side.employmentIds).map((worker) => {
          const adjustment =
            offer.adjustments.find((candidate) => candidate.employmentId === worker.employmentId) ??
            null;
          return workerView(
            read,
            tunables,
            worker,
            to,
            adjustment === null ? null : { ...adjustment },
            withSay,
          );
        }),
      };
    }),
  };
}

/** The rival's read on an offer: lean, likely answer, lines and Why?. */
export function rivalView(
  read: GameWorldView,
  tunables: EngineTunables,
  date: GameDate,
  offer: DeepReadonly<TradeOffer>,
  rivalId: PromotionId,
  round: number,
  you: readonly PromotionId[],
): TradeRivalView {
  const answer = rivalAnswer(read, tunables, date, offer, rivalId, round);
  return {
    promotionId: rivalId,
    name: read.tables.promotions.get(rivalId)?.name ?? rivalId,
    lean: answer.lean,
    likely: answer.kind,
    score: round1(answer.value.score.value),
    margin: answer.margin,
    shortfall: round1(answer.shortfall),
    cashLimit: answer.cashLimit,
    lines: answer.lines,
    trace: answer.decision.trace,
    counter:
      answer.counter === null ? null : offerView(read, tunables, date, answer.counter, you, false),
  };
}

function headlineOf(read: GameWorldView, offer: DeepReadonly<TradeOffer>): string {
  const names = offer.sides.map((side) => {
    const workers = side.employmentIds.map(
      (id) => read.tables.employments.get(id)?.ringName ?? 'a worker',
    );
    const parts = [...workers];
    if (side.cash > 0) {
      parts.push('cash');
    }
    return parts.length === 0 ? 'nothing' : parts.join(', ');
  });
  return `${names[0] ?? 'nothing'} for ${names[1] ?? 'nothing'}`;
}

/** The trade as one row of a list. */
export function summaryView(
  read: GameWorldView,
  trade: DeepReadonly<Trade>,
  you: readonly PromotionId[],
): TradeSummaryView {
  const otherId = you.includes(trade.initiatorId) ? trade.partnerId : trade.initiatorId;
  const initiator = read.tables.promotions.get(trade.initiatorId);
  return {
    tradeId: trade.id,
    status: trade.status,
    initiatorId: trade.initiatorId,
    partnerId: trade.partnerId,
    otherId,
    otherName: read.tables.promotions.get(otherId)?.name ?? otherId,
    rivalInitiated: initiator?.controller.kind === 'computer',
    awaitingId: trade.awaitingId,
    awaitingYou: trade.awaitingId !== null && you.includes(trade.awaitingId),
    rounds: trade.rounds.length,
    submittedOn: trade.submittedOn,
    expiresOn: trade.expiresOn,
    closedOn: trade.closedOn,
    outcome: trade.outcome === null ? null : { ...trade.outcome },
    headline: headlineOf(read, currentRound(trade).offer),
    stopsSkip: trade.stopsSkip,
  };
}

/** Plain-words points for the UI, re-exported so the screens round the same way. */
export { pointsText };

/** Where a stored answer's Why? is, from the row. */
export function answerView(trade: DeepReadonly<Trade>): TradeAnswerView | null {
  if (trade.answer === null) {
    return null;
  }
  const { answer } = trade;
  return {
    kind: answer.kind,
    by: answer.by,
    on: answer.on,
    lines: [...answer.lines],
    traceRef: answer.traceId === null ? null : { kind: TRADE_TRACE_KIND, id: answer.traceId },
  };
}
