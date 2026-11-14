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

export const broadcastSystem: SystemBundle = defineSystem({
  id: 'broadcast',
  phases: [],
  subscriptions: [],
  queries: [],
  commands: [],
});
