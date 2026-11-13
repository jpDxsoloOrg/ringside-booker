/**
 * The health system: daily fatigue recovery and weekly, age-capped body-condition recovery.
 *
 * This is the reference system. It touches every part of the core once: tunables
 * (`tunables.ts`), a named RNG stream (`streams.ts`), pure traced formulas (`formulas/`), a daily
 * and a weekly phase writing through their transaction (`phases.ts`), a domain event
 * (`events.ts`), a stored trace, and a query that returns a "Why?"-ready view (`queries.ts`). New
 * systems copy its layout. See docs/design/health.md and
 * docs/design/calculation-traces.md#worked-example.
 *
 * WRK6 builds on it: injuries (WRK6-03), injury risk (WRK6-04) and the health profile (WRK6-05).
 */

// The stream and event declarations are types only. Importing them here brings them into every
// program that imports this system, including programs that only see the emitted .d.ts files.
import './events';
import './streams';
import { defineSystem, type SystemBundle } from '../../core/api/system';
import { healthPhases } from './phases';
import { healthQueries } from './queries';

export {
  computeFatigueRecovery,
  FATIGUE_MAX,
  FATIGUE_MIN,
  type FatigueRecoveryInputs,
} from './formulas/fatigueRecovery';
export {
  computeConditionCap,
  CONDITION_MAX,
  CONDITION_MIN,
  type ConditionCapInputs,
} from './formulas/conditionCap';
export {
  AT_CAP_BRANCH,
  computeConditionRecovery,
  INJURED_PART_BRANCH,
  medicalCareLabel,
  type ConditionRecoveryInputs,
} from './formulas/conditionRecovery';
export { medicalLevelOf, type MedicalCare, type MedicalLevel } from './medical';
export { restFollowsShowsOn, talkedWithoutWrestling } from './appearances';
export {
  conditionRecoveryPhase,
  FATIGUE_RECOVERY_TRACE_KIND,
  fatigueRecoveryPhase,
  fatigueRecoveryTraceRef,
} from './phases';
export { RECOVERY_STREAM } from './streams';
export { HEALTH_TUNABLE_CATEGORY, healthTunables } from './tunables';
export type { FatigueView } from './queries';

export const healthSystem: SystemBundle = defineSystem({
  id: 'health',
  phases: healthPhases,
  queries: healthQueries,
});
