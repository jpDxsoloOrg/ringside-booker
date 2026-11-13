/**
 * The health system's day phases: injuries end on their return date and everyone sheds some fatigue
 * each day (`health.recovery`), damaged body parts heal a little each week up to a cap for their age
 * (`health.conditionRecovery`), and old injury traces become summaries (`health.pruneInjuryDetail`).
 * Design: docs/design/health.md.
 */

import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import {
  CONDITION_RECOVERY_CADENCE,
  morningRanEarly,
  recoverConditions,
  runFatigueMorning,
} from './morning';
import { offscreenInjuriesPhase } from './offscreen';
import { pruneInjuryDetailPhase } from './returns';

export { FATIGUE_RECOVERY_TRACE_KIND, fatigueRecoveryTraceRef } from './morning';

/**
 * Daily: first, injuries whose return date has come are closed, then everyone sheds some fatigue
 * (`runFatigueMorning`). Skipped on a day whose morning already ran because the player ran a show
 * of theirs before the day (`morningRanEarly`, docs/design/health.md#the-players-show-nights).
 */
export const fatigueRecoveryPhase: PhaseDefinition = definePhase({
  id: 'health.recovery',
  group: 'housekeeping',
  order: 10,
  cadence: { kind: 'daily' },
  run: (ctx) => {
    if (morningRanEarly(ctx.read, ctx.date)) {
      return;
    }
    runFatigueMorning(ctx);
  },
});

/**
 * Weekly body-condition recovery, on Mondays (`recoverConditions`). Skipped, like
 * `health.recovery`, on a Monday whose morning already ran before the player's show.
 */
export const conditionRecoveryPhase: PhaseDefinition = definePhase({
  id: 'health.conditionRecovery',
  group: 'housekeeping',
  order: 12,
  cadence: CONDITION_RECOVERY_CADENCE,
  run: (ctx) => {
    if (morningRanEarly(ctx.read, ctx.date)) {
      return;
    }
    recoverConditions(ctx);
  },
});

export const healthPhases: readonly PhaseDefinition[] = [
  fatigueRecoveryPhase,
  offscreenInjuriesPhase,
  conditionRecoveryPhase,
  pruneInjuryDetailPhase,
];
