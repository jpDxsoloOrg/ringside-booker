/**
 * The condition system: daily fatigue recovery.
 *
 * This is the reference system. It is deliberately tiny and touches every part of the core once:
 * tunables (`tunables.ts`), a named RNG stream (`streams.ts`), a pure traced formula
 * (`formulas/fatigueRecovery.ts`), a daily phase writing through its transaction (`phases.ts`), a
 * domain event (`events.ts`), a stored trace, and a query that returns a "Why?"-ready view
 * (`queries.ts`). New systems copy its layout. See docs/design/calculation-traces.md#worked-example.
 *
 * The fatigue model itself is a placeholder until the workers epic replaces it.
 */

// The stream and event declarations are types only. Importing them here brings them into every
// program that imports this system, including programs that only see the emitted .d.ts files.
import './events';
import './streams';
import { defineSystem, type SystemBundle } from '../../core/api/system';
import { conditionPhases } from './phases';
import { conditionQueries } from './queries';

export { computeFatigueRecovery, type FatigueRecoveryInputs } from './formulas/fatigueRecovery';
export { FATIGUE_RECOVERY_TRACE_KIND, fatigueRecoveryTraceRef } from './phases';
export type { FatigueView } from './queries';

export const conditionSystem: SystemBundle = defineSystem({
  id: 'condition',
  phases: conditionPhases,
  queries: conditionQueries,
});
