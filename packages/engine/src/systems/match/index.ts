/**
 * The match system: everything about a single segment on a card.
 *
 * So far: the slot derivations of D-10 (`slots.ts`: role, duration class and weight from a slot's
 * position, never stored), the match tunables (`tunables.ts`) and two queries (`queries.ts`):
 * `match.catalog` and `match.slotRoles`. The in-ring formulas (`formulas/`): worker performance,
 * side aggregation and work rate. The runtime catalogs it reads live in
 * `model/catalogs.ts`. No phase yet. Design: docs/design/match-rating.md.
 */

import { defineSystem, type SystemBundle } from '../../core/api/system';
import { matchQueries } from './queries';

export {
  DURATION_CLASSES,
  DURATION_CLASS_LABELS,
  SLOT_ROLES,
  SLOT_ROLE_LABELS,
  SLOTS_DOC_REF,
  durationClassOf,
  slotRoleOf,
  slotWeightOf,
  type DurationClass,
  type DurationClassInputs,
  type SlotDeps,
  type SlotPosition,
  type SlotRole,
  type SlotWeightInputs,
} from './slots';
export {
  SLOT_ROLES_MAX_PRE_SHOW_SLOTS,
  SLOT_ROLES_MAX_SLOTS,
  SLOT_ROLES_MIN_SLOTS,
  type AngleTypeOption,
  type CountRange,
  type MatchCatalog,
  type MatchTypeOption,
  type MethodOption,
  type SlotRoleRow,
  type SlotRolesArgs,
} from './queries';
export { matchTunables } from './tunables';
export { MATCH_RATING_STREAM } from './streams';
export {
  ALL_WEIGHTS_ZERO_NOTE,
  NON_WRESTLER_LABEL,
  PERFORMANCE_AXES,
  PERFORMANCE_AXIS_LABELS,
  PERFORMANCE_MAX,
  PERFORMANCE_MIN,
  SUITS_MATCH_TYPE_LABEL,
  WORKER_PERFORMANCE_DOC_REF,
  WORKING_HURT_LABEL,
  workerPerformance,
  type PerformanceAttributeKey,
  type PerformanceAxis,
  type TalkWeights,
  type WorkerPerformanceInputs,
} from './formulas/workerPerformance';
export {
  SIDES_DOC_REF,
  aggregateWeights,
  rankLabel,
  rankMembers,
  sideAggregate,
  type SideAggregateInputs,
  type SideAggregateMember,
  type SideDecayKey,
} from './formulas/sideAggregate';
export {
  ACROSS_SIDES_LABEL,
  NO_VARIANCE_NOTE,
  VARIANCE_LABEL,
  WORK_RATE_DOC_REF,
  matchLeaderOf,
  sideLabel,
  workRate,
  type MatchLeader,
  type WorkRateInputs,
  type WorkRateSide,
  type WorkRateWorker,
} from './formulas/workRate';

export const matchSystem: SystemBundle = defineSystem({
  id: 'match',
  queries: matchQueries,
});
