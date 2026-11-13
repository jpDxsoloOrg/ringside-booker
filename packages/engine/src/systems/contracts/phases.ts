/**
 * The contracts system's day phase, `contracts.lifecycle`, and its show-night twin.
 *
 * The phase runs daily in the `contracts` group (400): after housekeeping and the rivals' turns,
 * before `shows` (500) and `money` (800), so a contract that ends today is not on today's show and
 * is not paid today, and one that starts today is both. When the player runs a show of theirs
 * before the day's phases (`shows.runTonight`), the before-show hook `contracts.beforeShow` runs
 * the lifecycle first so the same holds; the phase then finds nothing left to do.
 *
 * Design: docs/design/contracts.md#lifecycle.
 */

import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import { registerBeforeShowRuns, type BeforeShowRunsHook } from '../shows/beforeRun';
import { runContractLifecycle } from './lifecycle';

export const CONTRACT_LIFECYCLE_PHASE_ID = 'contracts.lifecycle';
export const CONTRACTS_BEFORE_SHOW_HOOK_ID = 'contracts.beforeShow';

export const contractLifecyclePhase: PhaseDefinition = definePhase({
  id: CONTRACT_LIFECYCLE_PHASE_ID,
  group: 'contracts',
  order: 10,
  cadence: { kind: 'daily' },
  run: runContractLifecycle,
});

/**
 * Runs the day's lifecycle before a show the player runs ahead of the day. After the health
 * system's morning (order 0), before the venue pick.
 */
export const contractsBeforeShowHook: BeforeShowRunsHook = {
  id: CONTRACTS_BEFORE_SHOW_HOOK_ID,
  order: 5,
  run: (ctx, { beforeTheDay }) => {
    if (beforeTheDay) {
      runContractLifecycle(ctx);
    }
  },
};

registerBeforeShowRuns(contractsBeforeShowHook);

export const contractsPhases: readonly PhaseDefinition[] = [contractLifecyclePhase];
