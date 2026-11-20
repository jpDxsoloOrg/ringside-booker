/**
 * The queries that read negotiations (ECO5-04), the engine half of the Offers list and the
 * Negotiation Sheet's history.
 *
 * - `contracts.offers { promotionId, status? }`: the promotion's talks, newest first with the open
 *   ones on top.
 * - `contracts.negotiation { negotiationId }`: one of them with the offer, their counter-offer, the
 *   rounds so far and what they ask now (every number with its Why? inline).
 *
 * Both answer only for the viewer's own promotions. Other promotions' talks appear as names in
 * `competingBidders` and nowhere else: never their terms, rounds or amounts (D-07).
 *
 * Design: docs/design/negotiation.md#commands.
 */

import { z } from 'zod';
import { viewerPromotionIds } from '../../core/api/controller';
import { defineQuery, type QueryContext } from '../../core/api/query';
import { INVALID_ARGS, refuseQuery } from '../../core/api/result';
import { compareDates, type GameDate } from '../../core/date';
import type { NegotiationId, PersonId, PromotionId } from '../../core/ids';
import { isFullTrace, type TraceRef } from '../../core/trace/store';
import type { TraceNode } from '../../core/trace/types';
import type { ContractKind } from '../../model/entities/employment';
import {
  isOpenNegotiationStatus,
  type Negotiation,
  type NegotiationKind,
  type NegotiationParty,
  type NegotiationStatus,
  type Reaction,
} from '../../model/entities/negotiation';
import type { ImageRef } from '../../model/primitives';
import { zGameDate, zId } from '../../model/primitives';
import { compareIds } from '../../model/table';
import type { DeepReadonly } from '../../model/world';
import { moneyText } from '../production';
import { askingTermsFor, type AskingTerms } from './asking';
import { competingBidders } from './bidders';
import type { Offer } from './offer';
import { NOT_YOUR_PROMOTION_MESSAGE } from './queries';
import { copyOffer } from './submit';
import { offerAnsweredReason } from './answered';
import { LOST_TO_OTHER_OFFER_OUTCOME } from './close';
import { OUTCOME_MESSAGES } from './outcomeMessages';
import { NEGOTIATION_TRACE_KINDS } from './traceKinds';
import { redactReviewTrace } from './redact';

export { OUTCOME_MESSAGES };

export const NOT_YOUR_TALKS_MESSAGE = 'Those are not your talks';

/** An offer's headline terms. Money in whole cents. */
export interface OfferSummary {
  readonly kind: ContractKind;
  readonly exclusive: boolean;
  readonly monthlyWage: number;
  readonly perAppearanceFee: number;
  readonly signingBonus: number;
  readonly lengthMonths: number;
}

/** Why talks closed, in plain words. */
export interface NegotiationOutcomeView {
  readonly code: string;
  readonly message: string;
  /** The promotion they signed with instead, when that is why. */
  readonly otherPromotionName: string | null;
}

/** One row of `contracts.offers`. */
export interface OfferRow {
  readonly negotiationId: NegotiationId;
  readonly kind: NegotiationKind;
  readonly personId: PersonId;
  readonly ringName: string;
  readonly imageRef: ImageRef;
  readonly status: NegotiationStatus;
  readonly round: number;
  readonly patienceLeft: number;
  readonly startPatience: number;
  readonly offerSummary: OfferSummary;
  readonly counterSummary: OfferSummary | null;
  readonly counterExpiresOn: GameDate | null;
  readonly reviewOn: GameDate | null;
  readonly closedOn: GameDate | null;
  readonly outcome: NegotiationOutcomeView | null;
  readonly cooldownUntil: GameDate | null;
  /** Other promotions talking to the same worker now, by name only. */
  readonly competingBidders: string[];
  readonly reactionTraceRef: TraceRef | null;
  readonly reviewTraceRef: TraceRef | null;
  /**
   * The review decision as you may see it (ECO5-05): other promotions' scores replaced by
   * "Another offer was compared"; null before the review or once only a summary is kept.
   */
  readonly reviewTrace: TraceNode | null;
  /**
   * True while the worker's answer has not been opened yet and stops skips as "Offer answered"
   * (ECO5-10); opening the talks clears it with `contracts.markOffersSeen`.
   */
  readonly answerUnseen: boolean;
}

/** One round of the talks, with a line the sheet can show as it is. */
export interface NegotiationHistoryView {
  readonly round: number;
  readonly date: GameDate;
  readonly by: NegotiationParty;
  readonly offer: Offer;
  readonly reaction: Reaction | null;
  /** "$8,000 a month, $2,000 to sign, 12 months, exclusive". */
  readonly summary: string;
  /** "Countered", "Their counter-offer", "Waiting for their answer". */
  readonly reactionLabel: string;
}

/** `contracts.negotiation`: one of your talks in full. */
export interface NegotiationView extends OfferRow {
  readonly offer: Offer;
  readonly lastCounter: Offer | null;
  readonly history: NegotiationHistoryView[];
  /** What they ask now for the kind on the table, every number with its Why?. */
  readonly ask: AskingTerms;
}

export type OffersStatusFilter = 'open' | 'closed' | 'all';

declare module '../../core/api/maps' {
  interface QueryMap {
    'contracts.offers': {
      args: { promotionId: PromotionId; status?: OffersStatusFilter | undefined };
      result: OfferRow[];
    };
    'contracts.negotiation': {
      args: { negotiationId: NegotiationId };
      result: NegotiationView;
    };
    'contracts.offerUpdatesSince': {
      args: { promotionId: PromotionId; from: GameDate; to: GameDate };
      result: OfferUpdates;
    };
  }
}

const REACTION_LABELS: Readonly<Record<Reaction, string>> = {
  accept: 'Accepted',
  counter: 'Countered',
  reject: 'Turned it down',
  walkAway: 'Walked away',
  refuse: "Wouldn't sign",
};

function summaryOf(offer: DeepReadonly<Offer>): OfferSummary {
  return {
    kind: offer.terms.kind,
    exclusive: offer.terms.exclusive,
    monthlyWage: offer.terms.monthlyWage,
    perAppearanceFee: offer.terms.perAppearanceFee,
    signingBonus: offer.terms.signingBonus,
    lengthMonths: offer.lengthMonths,
  };
}

/** "$8,000 a month, $2,000 to sign, 12 months, exclusive". */
export function offerLine(offer: DeepReadonly<Offer>): string {
  const { terms } = offer;
  const parts = [
    terms.kind === 'perAppearance'
      ? `${moneyText(terms.perAppearanceFee)} an appearance`
      : `${moneyText(terms.monthlyWage)} a month`,
  ];
  if (terms.signingBonus > 0) {
    parts.push(`${moneyText(terms.signingBonus)} to sign`);
  }
  parts.push(`${String(offer.lengthMonths)} ${offer.lengthMonths === 1 ? 'month' : 'months'}`);
  if (terms.exclusive) {
    parts.push('exclusive');
  }
  return parts.join(', ');
}

function reactionLabel(by: NegotiationParty, reaction: Reaction | null): string {
  if (reaction !== null) {
    return REACTION_LABELS[reaction];
  }
  return by === 'worker' ? 'Their counter-offer' : 'Waiting for their answer';
}

function traceRefOf(ctx: QueryContext, kind: string, id: string | null): TraceRef | null {
  if (id === null) {
    return null;
  }
  const ref = { kind, id };
  return ctx.traces.has(ref) ? ref : null;
}

function outcomeOf(
  ctx: QueryContext,
  negotiation: DeepReadonly<Negotiation>,
): NegotiationOutcomeView | null {
  const { outcome } = negotiation;
  if (outcome === null) {
    return null;
  }
  const otherPromotionName =
    outcome.otherPromotionId === null
      ? null
      : (ctx.read.tables.promotions.get(outcome.otherPromotionId)?.name ?? null);
  const base = OUTCOME_MESSAGES[outcome.code] ?? 'Talks closed';
  return {
    code: outcome.code,
    message:
      (outcome.code === 'signedElsewhere' || outcome.code === LOST_TO_OTHER_OFFER_OUTCOME) &&
      otherPromotionName !== null
        ? `Signed with ${otherPromotionName}${outcome.code === LOST_TO_OTHER_OFFER_OUTCOME ? ' instead' : ''}`
        : base,
    otherPromotionName,
  };
}

function rowOf(ctx: QueryContext, negotiation: DeepReadonly<Negotiation>): OfferRow {
  const person = ctx.read.tables.people.get(negotiation.personId);
  const employment = ctx.read.tables.employments.get(negotiation.employmentId);
  return {
    negotiationId: negotiation.id,
    kind: negotiation.kind,
    personId: negotiation.personId,
    ringName: employment?.ringName ?? person?.defaultRingName ?? 'A worker',
    imageRef: person?.imageRef ?? null,
    status: negotiation.status,
    round: negotiation.round,
    patienceLeft: negotiation.patience,
    startPatience: negotiation.startPatience,
    offerSummary: summaryOf(negotiation.offer),
    counterSummary: negotiation.lastCounter === null ? null : summaryOf(negotiation.lastCounter),
    counterExpiresOn: negotiation.counterExpiresOn,
    reviewOn: negotiation.reviewOn,
    closedOn: negotiation.closedOn,
    outcome: outcomeOf(ctx, negotiation),
    cooldownUntil: negotiation.cooldownUntil,
    competingBidders: competingBidders(ctx.read, negotiation.personId, negotiation.promotionId),
    reactionTraceRef: traceRefOf(
      ctx,
      NEGOTIATION_TRACE_KINDS.reaction,
      negotiation.reactionTraceId,
    ),
    reviewTraceRef: traceRefOf(ctx, NEGOTIATION_TRACE_KINDS.review, negotiation.reviewTraceId),
    reviewTrace: reviewTraceOf(ctx, negotiation),
    answerUnseen: negotiation.answerStopsSkip,
  };
}

/** The review decision, redacted for the viewer, inline (ECO5-05). */
function reviewTraceOf(
  ctx: QueryContext,
  negotiation: DeepReadonly<Negotiation>,
): TraceNode | null {
  if (negotiation.reviewTraceId === null) {
    return null;
  }
  const entry = ctx.traces.get({
    kind: NEGOTIATION_TRACE_KINDS.review,
    id: negotiation.reviewTraceId,
  });
  if (entry === undefined || !isFullTrace(entry)) {
    return null;
  }
  return redactReviewTrace(entry.trace, viewerPromotionIds(ctx.read, ctx.viewer));
}

function matchesFilter(status: NegotiationStatus, filter: OffersStatusFilter): boolean {
  if (filter === 'all') {
    return true;
  }
  return isOpenNegotiationStatus(status) === (filter === 'open');
}

/** Open talks first, then the most recent first. */
function newestFirst(left: DeepReadonly<Negotiation>, right: DeepReadonly<Negotiation>): number {
  const openOrder =
    Number(isOpenNegotiationStatus(right.status)) - Number(isOpenNegotiationStatus(left.status));
  return (
    openOrder ||
    compareDates(right.closedOn ?? right.submittedOn, left.closedOn ?? left.submittedOn) ||
    compareIds(right.id, left.id)
  );
}

export const offersQuery = defineQuery('contracts.offers', {
  args: z.strictObject({
    promotionId: zId('promotion'),
    status: z.enum(['open', 'closed', 'all']).optional(),
  }),
  run: (ctx, args): OfferRow[] => {
    if (!viewerPromotionIds(ctx.read, ctx.viewer).includes(args.promotionId)) {
      refuseQuery({
        code: INVALID_ARGS,
        message: NOT_YOUR_PROMOTION_MESSAGE,
        field: 'promotionId',
      });
    }
    const filter = args.status ?? 'all';
    return ctx.read.tables.negotiations
      .lookup('byPromotion', args.promotionId)
      .filter((negotiation) => matchesFilter(negotiation.status, filter))
      .sort(newestFirst)
      .map((negotiation) => rowOf(ctx, negotiation));
  },
});

export const negotiationQuery = defineQuery('contracts.negotiation', {
  args: z.strictObject({ negotiationId: zId('negotiation') }),
  run: (ctx, args): NegotiationView => {
    const negotiation = ctx.read.tables.negotiations.get(args.negotiationId);
    if (
      negotiation === undefined ||
      !viewerPromotionIds(ctx.read, ctx.viewer).includes(negotiation.promotionId)
    ) {
      refuseQuery({ code: INVALID_ARGS, message: NOT_YOUR_TALKS_MESSAGE, field: 'negotiationId' });
    }
    const contract =
      negotiation.kind === 'renewal'
        ? ctx.read.tables.employments.get(negotiation.employmentId)
        : undefined;
    const renewable = contract?.status === 'signed' || contract?.status === 'active';
    const ask = askingTermsFor(ctx.read, ctx.tunables, {
      personId: negotiation.personId,
      promotionId: negotiation.promotionId,
      date: ctx.date,
      kind: negotiation.offer.terms.kind,
      exclusive: negotiation.offer.terms.exclusive,
      renewalOf: renewable ? negotiation.employmentId : undefined,
      role: negotiation.offer.role,
    });
    return {
      ...rowOf(ctx, negotiation),
      offer: copyOffer(negotiation.offer),
      lastCounter: negotiation.lastCounter === null ? null : copyOffer(negotiation.lastCounter),
      history: negotiation.history.map((entry) => ({
        round: entry.round,
        date: entry.date,
        by: entry.by,
        offer: copyOffer(entry.offer),
        reaction: entry.reaction,
        summary: offerLine(entry.offer),
        reactionLabel: reactionLabel(entry.by, entry.reaction),
      })),
      ask,
    };
  },
});

/** One line of the Next Day summary about your talks (ECO5-05). */
export interface OfferUpdate {
  readonly negotiationId: NegotiationId;
  readonly ringName: string;
  /** "Made a counter-offer", "Signed", "Signed with Crown Pro instead", ... */
  readonly outcomeMessage: string;
  /**
   * The whole line in plain words, never an amount (ECO5-10): "Rhea Cortez countered your offer",
   * "Rhea Cortez signed with you", "Kai Moreno turned down your offer: won't take that role". The
   * "Offer answered" stop says the same.
   */
  readonly line: string;
}

/** `contracts.offerUpdatesSince`: what happened to your talks between two days, inclusive. */
export interface OfferUpdates {
  readonly countered: OfferUpdate[];
  readonly signed: OfferUpdate[];
  readonly walkedAway: OfferUpdate[];
  readonly declined: OfferUpdate[];
  readonly lapsed: OfferUpdate[];
}

export const COUNTERED_UPDATE_MESSAGE = 'Made a counter-offer';

function within(date: GameDate | null, from: GameDate, to: GameDate): boolean {
  return date !== null && compareDates(date, from) >= 0 && compareDates(date, to) <= 0;
}

/**
 * The Next Day summary's lines about the promotion's talks, read from the negotiations themselves
 * (closed talks by `closedOn`, counter-offers by the day the worker made them), in id order.
 */
export const offerUpdatesSinceQuery = defineQuery('contracts.offerUpdatesSince', {
  args: z.strictObject({ promotionId: zId('promotion'), from: zGameDate, to: zGameDate }),
  run: (ctx, args): OfferUpdates => {
    if (!viewerPromotionIds(ctx.read, ctx.viewer).includes(args.promotionId)) {
      refuseQuery({
        code: INVALID_ARGS,
        message: NOT_YOUR_PROMOTION_MESSAGE,
        field: 'promotionId',
      });
    }
    const updates: OfferUpdates = {
      countered: [],
      signed: [],
      walkedAway: [],
      declined: [],
      lapsed: [],
    };
    const rows = [...ctx.read.tables.negotiations.lookup('byPromotion', args.promotionId)].sort(
      (left, right) => compareIds(left.id, right.id),
    );
    for (const negotiation of rows) {
      const ringName =
        ctx.read.tables.employments.get(negotiation.employmentId)?.ringName ??
        ctx.read.tables.people.get(negotiation.personId)?.defaultRingName ??
        'A worker';
      const line = (outcomeMessage: string, text: string): OfferUpdate => ({
        negotiationId: negotiation.id,
        ringName,
        outcomeMessage,
        line: text,
      });
      if (
        negotiation.history.some(
          (entry) => entry.by === 'worker' && within(entry.date, args.from, args.to),
        )
      ) {
        updates.countered.push(line(COUNTERED_UPDATE_MESSAGE, `${ringName} countered your offer`));
      }
      if (!within(negotiation.closedOn, args.from, args.to)) {
        continue;
      }
      const message = outcomeOf(ctx, negotiation)?.message ?? 'Talks closed';
      const text = offerAnsweredReason(ctx.read, negotiation);
      switch (negotiation.status) {
        case 'signed':
          updates.signed.push(line(message, text));
          break;
        case 'walkedAway':
          updates.walkedAway.push(line(message, text));
          break;
        case 'declined':
          updates.declined.push(line(message, text));
          break;
        case 'lapsed':
          updates.lapsed.push(line(message, text));
          break;
        case 'withdrawn':
        case 'submitted':
        case 'countered':
        case 'awaitingReview':
          break;
      }
    }
    return updates;
  },
});

export const offersQueries = [offersQuery, negotiationQuery, offerUpdatesSinceQuery];
