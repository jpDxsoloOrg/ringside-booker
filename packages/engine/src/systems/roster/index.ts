/**
 * The roster system: the player's own people, one row per active contract, with every number
 * already worked out by the workers system's helpers and formulas. The one formula it owns is the
 * push gap (how far a worker sits from the push they expect) and its verdict.
 *
 * Design: docs/design/roster.md.
 */

import { defineSystem, type SystemBundle } from '../../core/api/system';
import { rosterQueries } from './queries';
import { rosterCommands } from './commands';

export { computePushGap, PUSH_GAP_DOC_REF, type PushGapInputs } from './formulas/pushGap';
export {
  computePushVerdict,
  PUSH_VERDICT_DOC_REF,
  PUSH_VERDICTS,
  type PushVerdict,
} from './formulas/pushVerdict';
export {
  PUSH_ORDER_REASON,
  pushIndexOf,
  roleHasPush,
  ROSTER_ROLE_GROUPS,
  rosterRoleGroupOf,
  type RosterRoleGroup,
} from './roleGroups';
export {
  buildRosterRows,
  type RosterDeps,
  type RosterFilter,
  type RosterPushGap,
  type RosterRow,
  type RosterRowAvailability,
} from './rows';
export {
  ROSTER_NO_PROMOTION,
  ROSTER_NOT_YOURS,
  ROSTER_UNKNOWN_PROMOTION,
  rosterQueries,
  rosterRowsQuery,
  rosterViewOf,
  type RosterBrand,
  type RosterPromotion,
  type RosterRowsArgs,
  type RosterView,
} from './queries';
export { rosterTunables } from './tunables';
export {
  applySetPush,
  doorSourceOf,
  DUPLICATE_EMPLOYMENT_MESSAGE,
  rosterCommands,
  SET_PUSH_MAX_ROWS,
  SET_PUSH_REASON_CODES,
  SET_PUSH_REASON_KEY,
  setPushCommand,
  setPushRefusals,
  type RosterSetPushArgs,
  type SetPushDoor,
  type SetPushReasonCode,
} from './commands';

export const rosterSystem: SystemBundle = defineSystem({
  id: 'roster',
  queries: rosterQueries,
  commands: rosterCommands,
});

// roster.summary and roster.explain (WRK2-02).
export { rosterSummaryQuery, type RosterSummaryArgs } from './queries';
export {
  ROSTER_PUSHES,
  ROSTER_SHARED_BRAND_NAME,
  ROSTER_TOP_COUNT,
  summariseRoster,
  type RosterBrandCount,
  type RosterPush,
  type RosterSummary,
} from './summary';
export {
  ROSTER_EXPLAIN_METRICS,
  rosterExplainQuery,
  rosterExplanationOf,
  type RosterExplainArgs,
  type RosterExplainMetric,
  type RosterExplanation,
} from './explain';
export {
  rowExpectedPush,
  rowInputs,
  rowOverall,
  rowPopularity,
  rowPushGap,
  type RosterRowInputs,
} from './rowInputs';
