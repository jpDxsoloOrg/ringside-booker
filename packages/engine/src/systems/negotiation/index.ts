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
import { negotiationCommands } from './commands';
import { offersQueries } from './offersQueries';
import { negotiationQueries } from './queries';

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

export {
  ALREADY_WRITTEN_CODE,
  ALREADY_WRITTEN_MESSAGE,
  askBasisWith,
  askedKind,
  askedPay,
  askingContext,
  askingTermsFor,
  askingTermsWith,
  popularityOf,
  REFUSES_RENEWAL_CODE,
  REFUSES_RENEWAL_MESSAGE,
  type AllowedKind,
  type AskBasis,
  type AskedPerk,
  type AskingContext,
  type AskingTerms,
  type AskingTermsRequest,
} from './asking';
export {
  EXCLUSIVE_ELSEWHERE_REASON_CODE,
  NEGOTIATION_SITUATIONS,
  negotiationEligibility,
  OPEN_TO_OFFERS,
  UNAVAILABLE_REASON_CODE,
  type NegotiationEligibility,
  type NegotiationSituation,
} from './eligibility';
export { MERCH_NOT_TRACKED, marketValue, type MarketValueInputs } from './formulas/marketValue';
export {
  askingWage,
  CURRENT_DEAL_FLOOR_LABEL,
  HUNDREDS_REASON,
  type AskingWageInputs,
  type AskingWageRenewal,
} from './formulas/askingWage';
export { askingFee, CURRENT_FEE_FLOOR_LABEL, type AskingFeeInputs } from './formulas/askingFee';
export { startPatience, type StartPatienceInputs } from './formulas/startPatience';
export { contractValue, notEnforcedLine, type ContractValueInputs } from './formulas/contractValue';
export {
  FAR_BELOW_REASON,
  MATCHES_COUNTER_REASON,
  OUT_OF_PATIENCE_REASON,
  offerRatio,
  offerReaction,
  type OfferReactionInputs,
} from './formulas/offerReaction';
export {
  counterConcession,
  counterWage,
  meetsYouLabel,
  type CounterDeps,
  type CounterWageInputs,
} from './formulas/counterWage';
export { askedMoney, counterTermsFor, perkOfTerm } from './counter';
export { neverWorkedAs, roleMismatch, WANTS_TO_WRESTLE } from './roles';
export {
  askTermsOf,
  COOLING_OFF_CODE,
  coolingOffUntil,
  enforcedTermsNow,
  evaluateOffer,
  meetsCounter,
  roundPatience,
  type EvaluateOfferRequest,
  type OfferEvaluation,
} from './evaluate';
export {
  askingTermsQuery,
  freeAgentsQuery,
  LIKELY_NOTE,
  OFFER_BANDS,
  offerPreviewQuery,
  PART_OF_THE_WAY_NOTE,
  REJECT_NOTE,
  UNKNOWN_NEGOTIATION_MESSAGE,
  WALK_AWAY_NOTE,
  type OfferBand,
  type OfferPreview,
  NOT_YOUR_CONTRACT_MESSAGE,
  NOT_YOUR_PROMOTION_MESSAGE,
  type AskingTermsView,
  type FreeAgentRow,
  type FreeAgentsSituationFilter,
} from './queries';

export {
  ALREADY_NEGOTIATING_CODE,
  ALREADY_NEGOTIATING_TEXT,
  ALREADY_YOURS_TEXT,
  BAD_BRAND_CODE,
  BAD_KIND_EXTRA_CODE,
  BAD_ROLE_CODE,
  BAD_TERMS_CODE,
  checkOffer,
  COOLDOWN_CODE,
  EXCLUSIVE_NOT_ALLOWED_CODE,
  KIND_NOT_ALLOWED_CODE,
  NOT_RENEWABLE_CODE,
  NOT_YOUR_PROMOTION_CODE,
  NOT_YOUR_PROMOTION_TEXT,
  openNegotiationFor,
  RENEWAL_NOT_OPEN_CODE,
  renewalReasons,
  REFUSES_ROLE_CODE,
  UNAVAILABLE_CODE,
  UNKNOWN_CONTRACT_CODE,
  UNKNOWN_WORKER_CODE,
  validateOffer,
  type OfferCheck,
  type OfferCheckOptions,
  type OfferInput,
} from './validate';
export {
  answerCounter,
  answerCounterReasons,
  cappedHistory,
  copyOffer,
  NOT_COUNTERED_CODE,
  NOT_OPEN_CODE,
  OFFER_REQUIRED_CODE,
  submitOffer,
  TALKS_ENDED_OUTCOME,
  UNKNOWN_NEGOTIATION_CODE,
  WITHDRAWN_OUTCOME,
  withdrawNegotiation,
  withdrawReasons,
  type AnswerCounterArgs,
  type AnswerCounterResult,
  type CounterResponse,
  type SubmitOfferInput,
  type SubmitOfferResult,
} from './submit';
export { competingBidders } from './bidders';
export {
  makeOfferCommand,
  negotiationCommands,
  offerRenewalCommand,
  previewBandOf,
  respondToCounterCommand,
  withdrawOfferCommand,
  type CounterAnsweredResult,
  type OfferMadeResult,
  type OfferPreviewBand,
} from './commands';
export {
  negotiationQuery,
  NOT_YOUR_TALKS_MESSAGE,
  offerLine,
  offersQueries,
  offersQuery,
  OUTCOME_MESSAGES,
  type NegotiationHistoryView,
  type NegotiationOutcomeView,
  type NegotiationView,
  type OfferRow,
  type OffersStatusFilter,
  type OfferSummary,
} from './offersQueries';

export const negotiationSystem: SystemBundle = defineSystem({
  id: 'negotiation',
  phases: [],
  gates: [],
  subscriptions: [],
  queries: [...negotiationQueries, ...offersQueries],
  commands: [...negotiationCommands],
});
