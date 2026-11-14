/**
 * The negotiation system (ECO5): workers and promotions agree contracts through offers,
 * counter-offers and a short review, instead of contracts only coming from the new-game generator.
 *
 * ECO5-01 lays the ground the rest of ECO5 builds on, with nothing visible yet: the offer shape
 * every controller submits (`offer.ts`, D-07), the `negotiations` table
 * (`model/entities/negotiation.ts`), the pacing tunables (`tunables.ts`), the RNG streams
 * (`streams.ts`), the events (`events.ts`), the trace kinds (`traceKinds.ts`) and the registries
 * later features plug into (`registries.ts`, with the built-ins in `builtins.ts`). The bundle has
 * its own id so ECO4's `contracts` files are not edited; names keep the `contracts.` area
 * (`contracts.makeOffer`, `contracts.reviewOffers`, `contracts.renewal.*`).
 *
 * Layout follows the reference system (`systems/health/`). Design: docs/design/negotiation.md.
 */

// The stream and event declarations are types only. Importing them here brings them into every
// program that imports this system, including programs that only see the emitted .d.ts files.
import './events';
import './streams';
// Registers the built-in offer kinds and enforced terms.
import './builtins';
import { defineSystem, type SystemBundle } from '../../core/api/system';

export {
  OFFER_EXTRA_MAX_KEYS,
  OFFER_MAX_LENGTH_MONTHS,
  OFFER_MIN_LENGTH_MONTHS,
  OfferBrandSchema,
  OfferExtraSchema,
  OfferSchema,
  type Offer,
  type OfferBrand,
  type OfferExtra,
} from './offer';
export { NEGOTIATION_DOC, negotiationTunables } from './tunables';
export { COUNTER_STREAM, REVIEW_STREAM } from './streams';
export {
  askTraceRef,
  counterTraceRef,
  NEGOTIATION_TRACE_KINDS,
  reactionTraceRef,
  reviewTraceId,
  reviewTraceRef,
  roundTraceId,
  signingBonusTraceRef,
  type NegotiationTraceKind,
} from './traceKinds';
export {
  clearAskModifiersForTests,
  clearEnforcedTermsForTests,
  clearOfferKindsForTests,
  clearPatienceModifiersForTests,
  ENFORCEABLE_TERMS,
  isTermEnforced,
  listAskModifiers,
  listEnforcedTerms,
  listOfferKinds,
  listPatienceModifiers,
  offerKind,
  registerAskModifier,
  registerEnforcedTerm,
  registerOfferKind,
  registerPatienceModifier,
  type EnforceableTerm,
  type EnforcedTermSpec,
  type NegotiationModifier,
  type OfferKindSpec,
} from './registries';
export { PER_APPEARANCE_OFFER_KIND_ORDER, WRITTEN_OFFER_KIND_ORDER } from './builtins';
export {
  exclusiveContractShortfall,
  OFFER_KINDS_DOC_REF,
  REACH_TOO_LOW,
  reachShortfall,
  writtenContractShortfall,
} from './formulas/reachGate';

export const negotiationSystem: SystemBundle = defineSystem({
  id: 'negotiation',
  phases: [],
  gates: [],
  subscriptions: [],
  queries: [],
  commands: [],
});
