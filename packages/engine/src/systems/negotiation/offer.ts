/**
 * The offer model (ECO5-01): the one shape every controller submits when it offers a worker a
 * contract or answers a counter-offer (D-07: the player, a rival in ECO6, a second human in MP6).
 *
 * The terms are ECO4's `ContractTermsSchema`, reused rather than copied, so a term is declared in
 * one place only; the role and card position reuse `EmploymentRoleSchema` and `PushSchema`. What
 * an offer adds is what only exists before a deal is signed: when it starts, how long it runs and
 * which brand the worker joins.
 *
 * Extension points, append-only:
 * - BRW8 adds `{ kind: 'auto' }` to `brand` (the brand-split picks the brand on signing).
 * - ECO11 and ECO12 put their contract kind's own fields in `extra` (at most 8 keys), checked by
 *   the offer kind's `extraSchema` (`registries.ts`).
 *
 * The negotiations table stores offers (`model/entities/negotiation.ts`), so this module stays
 * free of system imports: zod, the model primitives and the employment schemas only.
 *
 * Design: docs/design/negotiation.md#the-offer.
 */

import { z } from 'zod';
import { zGameDate, zId } from '../../model/primitives';
import {
  ContractTermsSchema,
  EmploymentRoleSchema,
  PushSchema,
} from '../../model/entities/employment';

/** The shortest and longest contract an offer can describe, in months (a tunable caps it lower). */
export const OFFER_MIN_LENGTH_MONTHS = 1;
export const OFFER_MAX_LENGTH_MONTHS = 120;

/** The most keys an offer's `extra` may carry. */
export const OFFER_EXTRA_MAX_KEYS = 8;

/** Which brand the worker joins: a named brand, or shared across every brand of the promotion. */
export const OfferBrandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('brand'), brandId: zId('brand') }),
  z.strictObject({ kind: z.literal('shared') }),
]);

/** A kind's own fields: small strings and numbers only, keyed by the kind's field names. */
export const OfferExtraSchema = z
  .record(z.string(), z.union([z.string(), z.number()]))
  .refine((extra) => Object.keys(extra).length <= OFFER_EXTRA_MAX_KEYS, {
    message: `An offer carries at most ${String(OFFER_EXTRA_MAX_KEYS)} extra fields`,
  });

export const OfferSchema = z.strictObject({
  /** The contract terms, exactly as the signed employment will hold them. */
  terms: ContractTermsSchema,
  /** The first day under contract; null = as soon as possible. */
  startsOn: zGameDate.nullable(),
  lengthMonths: z.number().int().min(OFFER_MIN_LENGTH_MONTHS).max(OFFER_MAX_LENGTH_MONTHS),
  brand: OfferBrandSchema,
  role: EmploymentRoleSchema,
  push: PushSchema,
  /** Fields of a contract kind added by a later feature (ECO11, ECO12). Empty for the built-ins. */
  extra: OfferExtraSchema,
});

export type Offer = z.infer<typeof OfferSchema>;
export type OfferBrand = z.infer<typeof OfferBrandSchema>;
export type OfferExtra = z.infer<typeof OfferExtraSchema>;
