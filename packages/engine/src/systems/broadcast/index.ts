/**
 * The broadcast system (ECO8): TV, pay-per-view and streaming deals turned into viewers and
 * money.
 *
 * ECO8-01 lays the ground the rest of ECO8 builds on, with nothing visible yet: the `airings`
 * table and the deal lifecycle fields (`model/entities/airing.ts`, `deal.ts`), the one rule for
 * which deal airs which show (`coverage.ts`), the tunables, RNG streams, events and trace kinds.
 * The bundle's phases, queries and commands are filled in by ECO8-03..05; ECO8-04 settles airings
 * (`settle.ts`, `phases.ts`) and keeps their history lean (`retention.ts`).
 *
 * Layout follows the reference system (`systems/health/`). Design: docs/design/broadcast.md.
 */

// The stream and event declarations are types only. Importing them here brings them into every
// program that imports this system, including programs that only see the emitted .d.ts files.
import './events';
import './streams';
import { defineSystem, type SystemBundle } from '../../core/api/system';
import { broadcastQueries } from './queries/networks';
import { airingQueries } from './queries/airings';
import { settleAiringsPhase, settleOnShowNightSubscription } from './phases';
import { pruneAiringsPhase } from './retention';
import { dealHealthPhase } from './health';
import { dealQueries } from './queries/deals';
import { proposeDealCommand } from './commands/proposeDeal';
import { renegotiateCommand } from './commands/renegotiate';
import { cancelDealCommand } from './commands/cancelDeal';

export {
  AIRING_KIND_LABELS,
  AIRING_KINDS,
  AIRTIME_COST_CATEGORY,
  airingKindOf,
  airingsDueOn,
  BROADCAST_ELIGIBLE_IMPORTANCE,
  dealCoversShow,
  dealInForce,
  dealsAiringShow,
  firstDealInForce,
  hasActiveBroadcastDeal,
  incomeCategoryFor,
  networkOnAir,
  networksCovering,
  promotionMarketRegionIds,
  type AiringKind,
  type BroadcastShow,
  type DueAiring,
} from './coverage';
export { DEAL_RISKS, type DealRisk } from './events';
export { BROADCAST_HEALTH_STREAM, BROADCAST_VIEWERS_STREAM } from './streams';
export {
  AIRING_TRACE_KIND,
  airingTraceRef,
  BROADCAST_TRACE_KINDS,
  DEAL_HEALTH_TRACE_KIND,
  dealHealthTraceRef,
  isHumanControlled,
  RIVAL_AIRING_TRACE_KIND,
} from './traces';
export { BROADCAST_DOC, BROADCAST_TUNABLE_CATEGORY, broadcastTunables } from './tunables';
export {
  AUDIENCE_DOC_REF,
  AUDIENCE_TRACE_COUNTRY_LINES,
  AUDIENCE_TRACE_COVERAGE_NODES,
  AUDIENCE_TRACE_HYPE_NODES,
  audience,
  formatViewers,
  shortViewers,
  NEUTRAL_QUALITY_NOTE,
  NO_HYPE_NOTE,
  PPV_TIMESLOT_NOTE,
  SWING_LABEL,
  TAPED_NOTE,
  type AudienceImportance,
  type AudienceInputs,
  type AudienceQuality,
  type RegionAudienceInput,
} from './formulas/audience';
export {
  NOBODY_KNOWS_YOU_NOTE,
  regionAudience,
  type RegionAudienceInputs,
} from './formulas/regionAudience';
export {
  BENCHMARK_DOC_REF,
  benchmarkLabel,
  networkBenchmark,
  type BenchmarkRegionInput,
  type NetworkBenchmarkInputs,
} from './formulas/networkBenchmark';
export {
  audienceInputsFor,
  benchmarkFor,
  benchmarkInputsFor,
  broadcastHypeFor,
  projectedAudience,
  type AudienceRequest,
  type BenchmarkRequest,
} from './audienceInputs';

export {
  dealTerms,
  NO_BENCHMARK_NOTE,
  PPV_NO_FEE_NOTE,
  STREAMING_NO_PER_THOUSAND_NOTE,
  VALUATION_DOC_REF,
  type DealTermsInputs,
  type DealTermsResult,
} from './formulas/dealTerms';
export {
  DEAL_REFUSAL_CODES,
  dealVerdict,
  type DealCheckInputs,
  type DealRefusal,
  type DealRefusalCode,
  type DealVerdict,
  type DealVerdictValue,
} from './formulas/dealVerdict';
export {
  AIRTIME_LOSS_NOTE,
  ALL_MAJOR_SHOWS,
  ALL_TELEVISED_SHOWS,
  coveredPopulation,
  dealIsLive,
  dealShowName,
  dealValuation,
  definitionWeekday,
  HOUSE_SHOW_NOTE,
  promotionWideImportance,
  promotionWideShowName,
  valuationContext,
  type DealValuation,
  type DealValuationRequest,
  type DealValuationTerms,
  type ValuationContext,
} from './valuation';
export {
  BEST_OFFER_MAX_VALUATIONS,
  broadcastQueries,
  coverageLabel,
  NOT_YOUR_PROMOTION,
  NOT_YOUR_SHOW,
  UNKNOWN_DEAL,
  UNKNOWN_NETWORK,
  UNKNOWN_PROMOTION,
  UNKNOWN_SHOW,
  type BroadcastValuationArgs,
  type NetworkBestOffer,
  type NetworkCarriedDeal,
  type NetworkRow,
  publicDealRow,
  type PublicDealRow,
} from './queries/networks';

export {
  AIRED_WITHOUT_RESULT_MEMO,
  AIRED_WITHOUT_RESULT_NOTE,
  AIRING_LOSS_NOTE,
  airingOutcomeOf,
  alreadySettled,
  MISSED_AIRING_NOTES,
  NO_BROADCAST_SHARES_NOTE,
  NO_CARD_SHARES_NOTE,
  SETTLEMENT_DOC_REF,
  settleAiring,
  type AiringOutcome,
} from './settle';
export {
  SETTLE_AIRINGS_PHASE_ID,
  SETTLE_ON_SHOW_NIGHT_SUBSCRIPTION_ID,
  settleAiringsPhase,
  settleOnShowNightSubscription,
} from './phases';
export {
  newestAiringsPerDeal,
  PRUNE_AIRINGS_PHASE_ID,
  pruneAiringsPhase,
  rollUpAirings,
} from './retention';
export {
  airingQueries,
  airingRowOf,
  BROADCAST_INCOME_CATEGORIES,
  INCOME_SUMMARY_MAX_DAYS,
  UNKNOWN_SHOW_AIRING,
  type AiringRow,
  type BroadcastIncomeSummary,
  type ShowAiringView,
} from './queries/airings';

export {
  DEAL_HEALTH_PHASE_ID,
  NETWORK_PATIENCE_LABEL,
  airingsNewestFirst,
  applyRenegotiation,
  dealHealthOf,
  dealHealthPhase,
  endDeal,
  revalueDeal,
  upcomingMissedAirings,
} from './health';
export {
  dealHealth,
  HEALTH_DOC_REF,
  healthDayText,
  type DealHealth,
  type DealHealthAiring,
  type DealHealthCause,
  type DealHealthInputs,
} from './formulas/dealHealth';
export { EXIT_FEE_DOC_REF, exitFee, type ExitFeeInputs } from './formulas/exitFee';
export { proposeDealCommand, type ProposeDealArgs } from './commands/proposeDeal';
export { renegotiateCommand, type RenegotiateArgs } from './commands/renegotiate';
export { cancelDealCommand, exitFeeFor, exitFeeMemo } from './commands/cancelDeal';
export { DEAL_NOT_ACTIVE, NOT_YOUR_PROMOTION_DEAL_MESSAGE } from './commands/shared';
export {
  cancelPreviewQuery,
  dealQueries,
  dealQuery,
  dealsQuery,
  type CancelPreview,
  type DealDetail,
  type DealRecentAiring,
  type DealRow,
  type DealView,
} from './queries/deals';
export { HEALTH_MAX_WINDOW } from './tunables';

export const broadcastSystem: SystemBundle = defineSystem({
  id: 'broadcast',
  phases: [settleAiringsPhase, dealHealthPhase, pruneAiringsPhase],
  subscriptions: [settleOnShowNightSubscription],
  queries: [...broadcastQueries, ...airingQueries, ...dealQueries],
  commands: [proposeDealCommand, renegotiateCommand, cancelDealCommand],
});
