/**
 * Making a trade happen (TRD-01): the one place a trade moves workers and money.
 *
 * In order, for an offer both sides agreed to (the caller checked it with `offerProblems`):
 *
 * 1. **Cash** goes through `postMoney`: the payer's `buyout` cost and the receiver's `otherIncome`,
 *    memo "Trade with <promotion>" (the cash seam: no other code touches `promotions.cash`).
 * 2. **Each worker**, in offer order:
 *    a. the wrestler's say is read on the old contract (`say.ts`);
 *    b. their bookings on the old promotion's shows still to come are taken off safely: the
 *       segment is rewritten without them, or removed when it no longer stands up without them;
 *    c. they leave the old promotion's stables (a stable left with fewer than two members
 *       disbands); teams are global and stay as they are;
 *    d. the old contract ends through `endEmployment` (`released`, reason `trades.traded`, no
 *       severance, a quiet release: the trade tells its own story);
 *    e. a new contract with the new promotion starts today with the same terms, card position,
 *       character and morale, or with the deal's new pay and length. Written here directly, like a
 *       draft pick's contract (the door-ownership test lists this file);
 *    f. morale moves through the morale door by the wrestler's say, never for anything else.
 * 3. **News**: one `trade` story per worker (importance from how notable they are), and the trade
 *    row is closed as `completed` with the moves.
 *
 * Titles are never touched: a champion cannot be in a trade at all (`trades.champion`).
 *
 * Design: docs/design/trades.md#completing-a-trade.
 */

import { addMonths, compareDates } from '../../core/date';
import { CardWriteError } from '../../core/errors';
import type { PersonId, PromotionId, SegmentId } from '../../core/ids';
import { cents } from '../../core/money';
import type { PhaseContext } from '../../core/pipeline/context';
import { startCalc } from '../../core/trace';
import type { Employment } from '../../model/entities/employment';
import type { NewsImportance } from '../../model/entities/news';
import {
  currentRound,
  sidesOf,
  type Trade,
  type TradeMove,
  type TradeOffer,
} from '../../model/entities/trade';
import type { DeepReadonly } from '../../model/world';
import { draftFromSegment, type SegmentDraft } from '../booking/draft';
import { removeSegment, writeSegment } from '../booking/writer';
import { contractNewsImportance } from '../contracts/news';
import { endEmployment } from '../contracts/endEmployment';
import { postMoney } from '../finance/post';
import { postNews } from '../news/post';
import { registerNewsTopic } from '../news/topics';
import { moneyText } from '../production/formulas/shared';
import { applyMoraleChange, type DoorSource } from '../workers/doors';
import { wrestlerSay } from './say';
import { sideWorkers } from './value';
import { TradeWorkerReader } from './workers';

export const TRANSFER_DOC_REF = 'trades.md#completing-a-trade';
/** The reason key of a contract ended or a morale change made by a trade. */
export const TRADED_REASON_KEY = 'trades.traded';
/** The news topic of a traded worker: params personId, promotionId (new), fromPromotionId. */
export const TRADE_NEWS_TOPIC = 'trade';

registerNewsTopic(TRADE_NEWS_TOPIC, { params: ['personId', 'promotionId', 'fromPromotionId'] });

const OPEN_SHOW_STATUSES = new Set(['scheduled', 'booked']);

function sourceOf(ctx: PhaseContext, promotionId: PromotionId): DoorSource {
  return ctx.read.tables.promotions.get(promotionId)?.controller.kind === 'human' ? 'player' : 'ai';
}

function nameOf(ctx: PhaseContext, promotionId: PromotionId): string {
  return ctx.read.tables.promotions.get(promotionId)?.name ?? 'a promotion';
}

// ---------------------------------------------------------------------------------------------
// Cash

function moveCash(ctx: PhaseContext, offer: DeepReadonly<TradeOffer>): void {
  offer.sides.forEach((side, index) => {
    if (side.cash <= 0) {
      return;
    }
    const to = sidesOf(offer)[index === 0 ? 1 : 0].promotionId;
    const paid = startCalc('Trade cash paid', 0, {
      unit: 'money',
      docRef: TRANSFER_DOC_REF,
      startLabel: 'Nothing paid yet',
    })
      .subtract(`Cash sent to ${nameOf(ctx, to)} in a trade`, side.cash)
      .done();
    postMoney(ctx, {
      promotionId: side.promotionId,
      category: 'buyout',
      amount: cents(paid.value),
      memo: `Trade with ${nameOf(ctx, to)}`,
      trace: paid,
    });
    const received = startCalc('Trade cash received', 0, {
      unit: 'money',
      docRef: TRANSFER_DOC_REF,
      startLabel: 'Nothing received yet',
    })
      .add(`Cash from ${nameOf(ctx, side.promotionId)} in a trade`, side.cash)
      .done();
    postMoney(ctx, {
      promotionId: to,
      category: 'otherIncome',
      amount: cents(received.value),
      memo: `Trade with ${nameOf(ctx, side.promotionId)}`,
      trace: received,
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Bookings

function involves(draft: SegmentDraft, personId: PersonId): boolean {
  if (draft.participants.some((participant) => participant.personId === personId)) {
    return true;
  }
  const { crew } = draft;
  if (crew.refereeId === personId || crew.producerId === personId) {
    return true;
  }
  return crew.announcerIds.includes(personId);
}

function without(draft: SegmentDraft, personId: PersonId): SegmentDraft {
  const crew = {
    refereeId: draft.crew.refereeId === personId ? null : draft.crew.refereeId,
    producerId: draft.crew.producerId === personId ? null : draft.crew.producerId,
    announcerIds: draft.crew.announcerIds.filter((id) => id !== personId),
  };
  const participants = draft.participants.filter(
    (participant) => participant.personId !== personId && participant.forPersonId !== personId,
  );
  if (draft.kind === 'match') {
    return { ...draft, crew, participants };
  }
  const beats = draft.angle.beats
    ?.map((beat) => ({ ...beat, personIds: beat.personIds.filter((id) => id !== personId) }))
    .filter((beat) => beat.personIds.length > 0);
  return {
    ...draft,
    crew,
    participants,
    angle: { ...draft.angle, ...(beats === undefined ? {} : { beats }) },
  };
}

/**
 * Takes the person off every show of `promotionId` still to come: each segment they are in (as a
 * competitor, a speaker, a manager or crew) is rewritten without them, or removed when the card
 * writer will not take it without them. Returns how many segments were changed or removed.
 */
export function removeFromFutureBookings(
  ctx: PhaseContext,
  personId: PersonId,
  promotionId: PromotionId,
): { rewritten: number; removed: number } {
  let rewritten = 0;
  let removed = 0;
  const shows = ctx.read.tables.eventInstances
    .lookup('byPromotion', promotionId)
    .filter(
      (show) =>
        OPEN_SHOW_STATUSES.has(show.status) &&
        show.liveRun === undefined &&
        compareDates(show.date, ctx.date) >= 0,
    )
    .sort((left, right) => compareDates(left.date, right.date) || (left.id < right.id ? -1 : 1));
  for (const show of shows) {
    const segmentIds: SegmentId[] = ctx.read.tables.segments
      .lookup('byEventInstance', show.id)
      .map((segment) => segment.id)
      .sort();
    for (const segmentId of segmentIds) {
      const segment = ctx.read.tables.segments.get(segmentId);
      if (segment === undefined) {
        continue;
      }
      const draft = draftFromSegment(ctx.read, segmentId);
      if (!involves(draft, personId)) {
        continue;
      }
      try {
        writeSegment(ctx.tx, {
          eventInstanceId: show.id,
          preShow: segment.preShow,
          slot: segment.slot,
          segmentId,
          draft: without(draft, personId),
        });
        rewritten += 1;
      } catch (error) {
        if (!(error instanceof CardWriteError)) {
          throw error;
        }
        removeSegment(ctx.tx, segmentId);
        removed += 1;
      }
    }
  }
  return { rewritten, removed };
}

// ---------------------------------------------------------------------------------------------
// Stables

/** Takes the person out of the promotion's active stables; one left with too few disbands. */
export function leaveStables(
  ctx: PhaseContext,
  personId: PersonId,
  promotionId: PromotionId,
): void {
  const stables = ctx.read.tables.stables
    .lookup('byMember', personId)
    .filter((stable) => stable.promotionId === promotionId && stable.status === 'active')
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  for (const stable of stables) {
    const members = stable.memberIds.filter((id) => id !== personId);
    if (members.length < 2) {
      ctx.tx.update('stables', stable.id, { status: 'disbanded', disbandedOn: ctx.date });
      continue;
    }
    ctx.tx.update('stables', stable.id, {
      memberIds: members,
      leaderId: stable.leaderId === personId ? null : stable.leaderId,
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Contracts

/** The new contract with the receiving promotion: the old one's terms, or as the deal changed. */
function newContract(
  ctx: PhaseContext,
  old: DeepReadonly<Employment>,
  toPromotionId: PromotionId,
  offer: DeepReadonly<TradeOffer>,
): Employment {
  const adjustment = offer.adjustments.find((candidate) => candidate.employmentId === old.id);
  const perAppearance = old.terms.kind === 'perAppearance';
  const pay = adjustment?.pay ?? null;
  const terms = {
    ...old.terms,
    shares: { ...old.terms.shares },
    perks: { ...old.terms.perks },
    signingBonus: cents(0),
    ...(pay === null
      ? {}
      : perAppearance
        ? { perAppearanceFee: cents(pay) }
        : { monthlyWage: cents(pay) }),
  };
  const lengthMonths = adjustment?.lengthMonths ?? null;
  const endsOn = lengthMonths === null ? old.endsOn : addMonths(ctx.date, lengthMonths);
  return ctx.tx.create('employments', {
    personId: old.personId,
    promotionId: toPromotionId,
    brandId: null,
    managerPersonId: null,
    status: 'active',
    offeredOn: ctx.date,
    startsOn: ctx.date,
    endsOn,
    endedOn: null,
    role: old.role,
    ringName: old.ringName,
    gimmickKey: old.gimmickKey,
    alignment: old.alignment,
    push: old.push,
    terms,
    morale: old.morale,
    momentum: old.momentum,
    appearancesThisYear: old.appearancesThisYear,
    lastAppearanceOn: old.lastAppearanceOn,
    leave: old.leave === null ? null : { ...old.leave },
    // A draft pick's prepaid season (DRF-10) stays with the promotion that paid it: the new
    // contract is paid as usual.
    prepaidUntil: null,
  });
}

function postTradeStory(ctx: PhaseContext, move: TradeMove, importance: NewsImportance): void {
  postNews(ctx, {
    kind: 'signing',
    topic: TRADE_NEWS_TOPIC,
    params: {
      personId: move.personId,
      promotionId: move.toPromotionId,
      fromPromotionId: move.fromPromotionId,
    },
    refs: {
      personIds: [move.personId],
      promotionIds: [move.toPromotionId, move.fromPromotionId],
      employmentId: move.toEmploymentId,
    },
    importance,
    dedupeKey: `${TRADE_NEWS_TOPIC}:${move.toEmploymentId}`,
  });
}

/**
 * Moves every worker and the cash of `offer`, and closes the trade as `completed`. The caller
 * checked the offer; anything that still fails here throws and rolls the step back.
 */
export function completeTrade(ctx: PhaseContext, trade: DeepReadonly<Trade>): TradeMove[] {
  const offer = currentRound(trade).offer;
  const reader = new TradeWorkerReader(ctx.read, ctx.tunables, ctx.date);
  // Read every worker (and their say) before anything moves.
  const plans = offer.sides.flatMap((side, index) => {
    const to = sidesOf(offer)[index === 0 ? 1 : 0].promotionId;
    return sideWorkers(reader, offer, side.employmentIds).map((worker) => ({
      worker,
      to,
      say: wrestlerSay(ctx.read, ctx.tunables, worker, to),
      importance: contractNewsImportance(ctx.read, worker.employmentId) ?? 0,
    }));
  });
  moveCash(ctx, offer);
  const moves: TradeMove[] = [];
  for (const plan of plans) {
    const { worker, to, say } = plan;
    const from = worker.promotionId;
    removeFromFutureBookings(ctx, worker.personId, from);
    leaveStables(ctx, worker.personId, from);
    endEmployment(ctx, {
      employmentId: worker.employmentId,
      to: 'released',
      reasonKey: TRADED_REASON_KEY,
      source: sourceOf(ctx, from),
      severance: null,
      quiet: true,
    });
    const created = newContract(ctx, worker.employment, to, offer);
    let moraleChange = 0;
    if (say.moraleChange !== 0) {
      const result = applyMoraleChange(ctx, {
        employmentId: created.id,
        delta: startCalc('Morale from the trade', 0, {
          unit: 'points',
          startLabel: 'No change yet',
        })
          .add(say.willing ? 'Happy with the move' : 'Moved against their wishes', say.moraleChange)
          .done(),
        source: sourceOf(ctx, to),
        reason: {
          key: TRADED_REASON_KEY,
          label: say.willing
            ? `Happy to be traded to ${nameOf(ctx, to)}`
            : `Traded to ${nameOf(ctx, to)} against their wishes`,
        },
      });
      moraleChange = result.after - result.before;
    }
    const move: TradeMove = {
      personId: worker.personId,
      fromPromotionId: from,
      toPromotionId: to,
      fromEmploymentId: worker.employmentId,
      toEmploymentId: created.id,
      moraleChange,
    };
    moves.push(move);
    postTradeStory(ctx, move, plan.importance);
    ctx.log(
      `${worker.name} traded from ${nameOf(ctx, from)} to ${nameOf(ctx, to)}${
        offer.sides.some((side) => side.cash > 0)
          ? ` (cash ${moneyText(Math.max(...offer.sides.map((side) => side.cash)))})`
          : ''
      }`,
    );
  }
  return moves;
}
