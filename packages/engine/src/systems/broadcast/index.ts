/**
 * The broadcast system (ECO8): TV, pay-per-view and streaming deals turned into viewers and
 * money.
 *
 * ECO8-01 lays the ground the rest of ECO8 builds on, with nothing visible yet: the `airings`
 * table and the deal lifecycle fields (`model/entities/airing.ts`, `deal.ts`), the one rule for
 * which deal airs which show (`coverage.ts`), the tunables, RNG streams, events and trace kinds.
 * The bundle's phases, queries and commands are filled in by ECO8-03..05.
 *
 * Layout follows the reference system (`systems/health/`). Design: docs/design/broadcast.md.
 */

// The stream and event declarations are types only. Importing them here brings them into every
// program that imports this system, including programs that only see the emitted .d.ts files.
import './events';
import './streams';
import { defineSystem, type SystemBundle } from '../../core/api/system';

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

export const broadcastSystem: SystemBundle = defineSystem({
  id: 'broadcast',
  phases: [],
  subscriptions: [],
  queries: [],
  commands: [],
});
