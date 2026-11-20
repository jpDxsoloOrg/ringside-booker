/**
 * The trade queries (TRD-01, TRD-03). A player sees only trades their promotions are in; the
 * omniscient viewer sees all.
 *
 * - `trades.preview { promotionId, partnerId, give, get, adjustments?, tradeId? }`: a live read
 *   while an offer is being built (`tradeId` when it is a counter to that open trade): the rules it breaks, how the rival leans (and the counter it would send),
 *   and how each worker feels about the move. Same numbers the answer will use if nothing changes.
 * - `trades.list { promotionId?, status?: open | closed | all, limit? }`: the talks, newest first.
 * - `trades.get { tradeId }`: one talk in full: the offer on the table with each worker's say
 *   (open trades), the history, the rival's last answer with its Why? ref, the moves, and what the
 *   viewer may do now.
 * - `trades.candidates { promotionId, partnerId, search?, limit? }`: the workers of `promotionId`
 *   who could go to `partnerId`, with why the others can't (champion, in another trade, no-trade
 *   clause...), for the trade sheet's pickers.
 *
 * Design: docs/design/trades.md#queries.
 */

import { z } from 'zod';
import { viewerPromotionIds, type Viewer } from '../../core/api/controller';
import { defineQuery, type QueryContext, type QueryDefinition } from '../../core/api/query';
import { refuseQuery, type Reason } from '../../core/api/result';
import { compareDates } from '../../core/date';
import type { EmploymentId, PersonId, PromotionId, TitleId, TradeId } from '../../core/ids';
import {
  promotionStatusKey,
  type ContractKind,
  type EmploymentRole,
  type Push,
} from '../../model/entities/employment';
import type { Gender } from '../../model/entities/person';
import { currentRound, type Trade } from '../../model/entities/trade';
import { zId } from '../../model/primitives';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { contractReasons, offerProblems } from './checks';
import { isHuman } from './lifecycle';
import { wrestlerSay } from './say';
import {
  answerView,
  offerFromArgs,
  offerView,
  rivalView,
  summaryView,
  TradeTermsArgsShape,
  type TradePreviewView,
  type TradeSummaryView,
  type TradeTermsArgs,
  type TradeView,
} from './views';
import { TradeWorkerReader } from './workers';

export const TRADE_LIST_STATUSES = ['open', 'closed', 'all'] as const;
export type TradeListStatus = (typeof TRADE_LIST_STATUSES)[number];
const LIST_LIMIT_MAX = 200;
const CANDIDATES_LIMIT_MAX = 500;

export interface TradeCandidateView {
  employmentId: EmploymentId;
  personId: PersonId;
  name: string;
  role: EmploymentRole;
  push: Push;
  gender: Gender;
  age: number;
  /** Draft value, 0-100, one decimal. */
  value: number;
  contract: {
    kind: ContractKind;
    pay: number;
    endsOn: string | null;
    monthsLeft: number | null;
  };
  titleIds: TitleId[];
  noTradeClause: boolean;
  /** True when nothing stops them being in a trade to `partnerId` today. */
  tradable: boolean;
  /** Why not, when not tradable (champion, in another trade, already there...). */
  reasons: Reason[];
}

export interface TradeCandidatesView {
  rows: TradeCandidateView[];
  total: number;
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'trades.preview': {
      args: TradeTermsArgs & { tradeId?: TradeId | undefined };
      result: TradePreviewView;
    };
    'trades.list': {
      args: {
        promotionId?: PromotionId | undefined;
        status?: TradeListStatus | undefined;
        limit?: number | undefined;
      };
      result: { rows: TradeSummaryView[] };
    };
    'trades.get': { args: { tradeId: TradeId }; result: TradeView };
    'trades.candidates': {
      args: {
        promotionId: PromotionId;
        partnerId: PromotionId;
        search?: string | undefined;
        limit?: number | undefined;
      };
      result: TradeCandidatesView;
    };
  }
}

/** The promotions whose trades the viewer may see; null = every one (omniscient). */
function visibleTo(read: GameWorldView, viewer: Viewer): PromotionId[] | null {
  return viewer.kind === 'omniscient' ? null : viewerPromotionIds(read, viewer);
}

function canSee(trade: DeepReadonly<Trade>, visible: PromotionId[] | null): boolean {
  return (
    visible === null || visible.includes(trade.initiatorId) || visible.includes(trade.partnerId)
  );
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export const tradePreviewQuery: QueryDefinition<'trades.preview'> = defineQuery('trades.preview', {
  args: z.strictObject({ ...TradeTermsArgsShape, tradeId: zId('trade').optional() }),
  run: (ctx: QueryContext, args): TradePreviewView => {
    const { read, tunables, date } = ctx;
    const visible = visibleTo(read, ctx.viewer);
    const you = visible ?? [args.promotionId];
    const offer = offerFromArgs(args, args.promotionId);
    const partner = read.tables.promotions.get(args.partnerId);
    // A counter to an open trade (TRD-02): its own workers are not "in another trade", and the
    // rival reads it as the next round.
    const talk = args.tradeId === undefined ? undefined : read.tables.trades.get(args.tradeId);
    const trade = talk !== undefined && canSee(talk, visible) ? talk : undefined;
    const problems = offerProblems(read, tunables, date, offer, { tradeId: trade?.id ?? null });
    const valid =
      partner !== undefined &&
      read.tables.promotions.get(args.promotionId) !== undefined &&
      partner.id !== args.promotionId;
    return {
      problems,
      offer: valid ? offerView(read, tunables, date, offer, you, true) : { sides: [] },
      rival:
        valid && partner.controller.kind === 'computer'
          ? rivalView(read, tunables, date, offer, partner.id, (trade?.rounds.length ?? 0) + 1, you)
          : null,
    };
  },
});

export const tradeListQuery: QueryDefinition<'trades.list'> = defineQuery('trades.list', {
  args: z.strictObject({
    promotionId: zId('promotion').optional(),
    status: z.enum(TRADE_LIST_STATUSES).optional(),
    limit: z.number().int().min(1).max(LIST_LIMIT_MAX).optional(),
  }),
  run: (ctx, args) => {
    const { read } = ctx;
    const visible = visibleTo(read, ctx.viewer);
    const you = visible ?? [];
    const status = args.status ?? 'all';
    const rows = read.tables.trades
      .values()
      .filter(
        (trade) =>
          canSee(trade, visible) &&
          (args.promotionId === undefined ||
            trade.initiatorId === args.promotionId ||
            trade.partnerId === args.promotionId) &&
          (status === 'all' || (status === 'open') === (trade.status === 'open')),
      )
      .sort(
        (left, right) =>
          compareDates(right.closedOn ?? right.submittedOn, left.closedOn ?? left.submittedOn) ||
          compareIds(right.id, left.id),
      )
      .slice(0, args.limit ?? 50)
      .map((trade) => summaryView(read, trade, you));
    return { rows };
  },
});

export const tradeGetQuery: QueryDefinition<'trades.get'> = defineQuery('trades.get', {
  args: z.strictObject({ tradeId: zId('trade') }),
  run: (ctx, args): TradeView => {
    const { read, tunables, date } = ctx;
    const visible = visibleTo(read, ctx.viewer);
    const trade = read.tables.trades.get(args.tradeId);
    if (trade === undefined || !canSee(trade, visible)) {
      return refuseQuery({ code: 'notFound', message: 'That trade is gone.', field: 'tradeId' });
    }
    const you = visible ?? [];
    const open = trade.status === 'open';
    const offer = currentRound(trade).offer;
    const problems = open ? offerProblems(read, tunables, date, offer, { tradeId: trade.id }) : [];
    const awaitingYou = open && trade.awaitingId !== null && you.includes(trade.awaitingId);
    const lastByYou = you.includes(currentRound(trade).by);
    const nameOf = (personId: PersonId): string =>
      read.tables.people.get(personId)?.defaultRingName ?? personId;
    return {
      ...summaryView(read, trade, you),
      offer: offerView(read, tunables, date, offer, you, open),
      history: trade.rounds.map((round) => ({
        by: round.by,
        byYou: you.includes(round.by),
        on: round.on,
        offer: offerView(read, tunables, date, round.offer, you, false),
      })),
      answer: answerView(trade),
      moves: trade.moves.map((move) => ({
        personId: move.personId,
        name: read.tables.employments.get(move.toEmploymentId)?.ringName ?? nameOf(move.personId),
        fromPromotionId: move.fromPromotionId,
        toPromotionId: move.toPromotionId,
        fromEmploymentId: move.fromEmploymentId,
        toEmploymentId: move.toEmploymentId,
        moraleChange: move.moraleChange,
      })),
      problems,
      canAccept: awaitingYou && problems.length === 0,
      canRefuse: awaitingYou,
      canCounter: awaitingYou,
      canWithdraw: open && !awaitingYou && lastByYou,
    };
  },
});

export const tradeCandidatesQuery: QueryDefinition<'trades.candidates'> = defineQuery(
  'trades.candidates',
  {
    args: z.strictObject({
      promotionId: zId('promotion'),
      partnerId: zId('promotion'),
      search: z.string().max(60).optional(),
      limit: z.number().int().min(1).max(CANDIDATES_LIMIT_MAX).optional(),
    }),
    run: (ctx, args): TradeCandidatesView => {
      const { read, tunables, date } = ctx;
      const reader = new TradeWorkerReader(read, tunables, date);
      const needle = args.search?.trim().toLowerCase() ?? '';
      const roster = read.tables.employments
        .lookup('byPromotionStatus', promotionStatusKey(args.promotionId, 'active'))
        .filter(
          (row) =>
            row.role !== 'booker' &&
            compareDates(row.startsOn, date) <= 0 &&
            (needle === '' || row.ringName.toLowerCase().includes(needle)),
        )
        .sort((left, right) => compareIds(left.id, right.id));
      const rows: TradeCandidateView[] = [];
      for (const employment of roster) {
        const worker = reader.worker(employment.id);
        if (worker === null) {
          continue;
        }
        const reasons = contractReasons(
          read,
          employment.id,
          args.promotionId,
          args.partnerId,
          date,
          null,
          'employmentId',
        );
        const say = wrestlerSay(read, tunables, worker, args.partnerId);
        rows.push({
          employmentId: worker.employmentId,
          personId: worker.personId,
          name: worker.name,
          role: worker.role,
          push: worker.push,
          gender: worker.gender,
          age: worker.age,
          value: round1(worker.value),
          contract: {
            kind: employment.terms.kind,
            pay: worker.pay,
            endsOn: employment.endsOn,
            monthsLeft: worker.monthsLeft === null ? null : round1(worker.monthsLeft),
          },
          titleIds: [...worker.titleIds],
          noTradeClause: say.noTradeClause,
          tradable: reasons.length === 0,
          reasons,
        });
      }
      rows.sort(
        (left, right) =>
          right.value - left.value || compareIds(left.employmentId, right.employmentId),
      );
      return { rows: rows.slice(0, args.limit ?? 100), total: rows.length };
    },
  },
);

export const tradeQueries = [
  tradePreviewQuery,
  tradeListQuery,
  tradeGetQuery,
  tradeCandidatesQuery,
];

/** True when any human runs one side (the trades a player cares about). */
export function involvesHuman(read: GameWorldView, trade: DeepReadonly<Trade>): boolean {
  return isHuman(read, trade.initiatorId) || isHuman(read, trade.partnerId);
}
