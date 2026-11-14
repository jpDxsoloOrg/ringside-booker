/**
 * The negotiation commands (ECO5-04). Each one checks the offer with the shared rules
 * (`validate.ts`) and then calls the plain function every controller uses (`submit.ts`), so a
 * command adds nothing but validation and the command log.
 *
 * - `contracts.makeOffer { promotionId, personId, offer }`: open talks with a worker who is open to
 *   offers. Returns the new talks and the preview the offer was weighed with, so the sheet can
 *   confirm without another query (the same numbers as `contracts.offerPreview`, to the cent).
 * - `contracts.offerRenewal { employmentId, offer }`: offer one of your own workers a new deal,
 *   from `contracts.renewal.windowDays` before their contract ends (an open-ended one any time).
 * - `contracts.respondToCounter { negotiationId, response, offer? }`: accept their counter-offer,
 *   send a revised offer or end the talks.
 * - `contracts.withdrawOffer { negotiationId }`: take an open offer back.
 *
 * Commands only record the offer: the worker reacts when the day runs (ECO5-05).
 *
 * Design: docs/design/negotiation.md#commands.
 */

import { z } from 'zod';
import { defineCommand } from '../../core/api/command';
import type { EmploymentId, NegotiationId, PersonId, PromotionId } from '../../core/ids';
import type { NegotiationStatus, Reaction } from '../../model/entities/negotiation';
import { zId } from '../../model/primitives';
import type { OfferEvaluation } from './evaluate';
import { OfferSchema, type Offer } from './offer';
import { OFFER_BANDS, type OfferBand } from './queries';
import {
  answerCounter,
  answerCounterReasons,
  submitOffer,
  withdrawNegotiation,
  withdrawReasons,
  type CounterResponse,
} from './submit';
import { UNKNOWN_CONTRACT_CODE, validateOffer } from './validate';

/** The preview an offer was recorded with: `contracts.offerPreview`'s numbers, without traces. */
export interface OfferPreviewBand {
  /** Contract value of the offer, cents a month. */
  readonly offerValue: number;
  /** Contract value of their ask, cents a month. */
  readonly askValue: number;
  readonly ratio: number;
  readonly reaction: Reaction;
  readonly band: OfferBand;
  readonly label: string;
  readonly patienceLeft: number;
}

export interface OfferMadeResult {
  readonly negotiationId: NegotiationId;
  readonly preview: OfferPreviewBand;
}

export interface CounterAnsweredResult {
  readonly negotiationId: NegotiationId;
  readonly status: NegotiationStatus;
  /** How they are expected to react to the offer now on the table; null once the talks ended. */
  readonly preview: OfferPreviewBand | null;
}

declare module '../../core/api/maps' {
  interface CommandMap {
    'contracts.makeOffer': {
      args: { promotionId: PromotionId; personId: PersonId; offer: Offer };
      result: OfferMadeResult;
    };
    'contracts.offerRenewal': {
      args: { employmentId: EmploymentId; offer: Offer };
      result: OfferMadeResult;
    };
    'contracts.respondToCounter': {
      args: {
        negotiationId: NegotiationId;
        response: CounterResponse;
        offer?: Offer | undefined;
      };
      result: CounterAnsweredResult;
    };
    'contracts.withdrawOffer': {
      args: { negotiationId: NegotiationId };
      result: { negotiationId: NegotiationId };
    };
  }
}

/** The preview's band and numbers for one evaluation. */
export function previewBandOf(evaluation: OfferEvaluation): OfferPreviewBand {
  const { band, label } = OFFER_BANDS[evaluation.reaction.value];
  return {
    offerValue: evaluation.offerValue.value,
    askValue: evaluation.askValue.value,
    ratio: evaluation.ratio,
    reaction: evaluation.reaction.value,
    band,
    label,
    patienceLeft: evaluation.patienceLeft,
  };
}

export const makeOfferCommand = defineCommand('contracts.makeOffer', {
  args: z.strictObject({
    promotionId: zId('promotion'),
    personId: zId('person'),
    offer: OfferSchema,
  }),
  validate: (read, args, issuedBy, env) => validateOffer(read, env.tunables, args, issuedBy),
  apply: (ctx, args, issuedBy): OfferMadeResult => {
    const made = submitOffer(ctx, args, issuedBy);
    return { negotiationId: made.negotiationId, preview: previewBandOf(made.evaluation) };
  },
});

export const offerRenewalCommand = defineCommand('contracts.offerRenewal', {
  args: z.strictObject({ employmentId: zId('employment'), offer: OfferSchema }),
  validate: (read, args, issuedBy, env) => {
    const employment = read.tables.employments.get(args.employmentId);
    if (employment === undefined) {
      return [
        {
          code: UNKNOWN_CONTRACT_CODE,
          message: 'That contract is not in this game any more',
          field: 'employmentId',
        },
      ];
    }
    return validateOffer(
      read,
      env.tunables,
      {
        promotionId: employment.promotionId,
        personId: employment.personId,
        offer: args.offer,
        renewalOf: employment.id,
      },
      issuedBy,
    );
  },
  apply: (ctx, args, issuedBy): OfferMadeResult => {
    const employment = ctx.read.tables.employments.require(args.employmentId);
    const made = submitOffer(
      ctx,
      {
        promotionId: employment.promotionId,
        personId: employment.personId,
        offer: args.offer,
        renewalOf: employment.id,
      },
      issuedBy,
    );
    return { negotiationId: made.negotiationId, preview: previewBandOf(made.evaluation) };
  },
});

export const respondToCounterCommand = defineCommand('contracts.respondToCounter', {
  args: z.strictObject({
    negotiationId: zId('negotiation'),
    response: z.enum(['accept', 'revise', 'end']),
    offer: OfferSchema.optional(),
  }),
  validate: (read, args, issuedBy, env) =>
    answerCounterReasons(
      read,
      env.tunables,
      args,
      read.tables.negotiations.get(args.negotiationId),
      issuedBy,
    ),
  apply: (ctx, args, issuedBy): CounterAnsweredResult => {
    const answered = answerCounter(ctx, args, issuedBy);
    return {
      negotiationId: answered.negotiationId,
      status: answered.status,
      preview: answered.evaluation === null ? null : previewBandOf(answered.evaluation),
    };
  },
});

export const withdrawOfferCommand = defineCommand('contracts.withdrawOffer', {
  args: z.strictObject({ negotiationId: zId('negotiation') }),
  validate: (read, args, issuedBy) =>
    withdrawReasons(read, read.tables.negotiations.get(args.negotiationId), issuedBy),
  apply: (ctx, args, issuedBy) => withdrawNegotiation(ctx, args.negotiationId, issuedBy),
});

export const negotiationCommands = [
  makeOfferCommand,
  offerRenewalCommand,
  respondToCounterCommand,
  withdrawOfferCommand,
] as const;
