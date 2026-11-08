/**
 * The condition system's day phase: everyone sheds some fatigue each day.
 */

import type { PersonId } from '../../core/ids';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import type { RngStream } from '../../core/rng/registry';
import type { TraceRef } from '../../core/trace/store';
import { computeFatigueRecovery, FATIGUE_MIN } from './formulas/fatigueRecovery';
import { RECOVERY_STREAM } from './streams';

/** The trace kind every fatigue recovery result is stored under. */
export const FATIGUE_RECOVERY_TRACE_KIND = 'condition.fatigueRecovery';

/** Where a person's latest fatigue recovery trace is stored. */
export function fatigueRecoveryTraceRef(personId: PersonId): TraceRef {
  return { kind: FATIGUE_RECOVERY_TRACE_KIND, id: personId };
}

/**
 * Daily fatigue recovery. People are visited in ascending ID order. Someone already at 0 fatigue is
 * skipped and draws nothing, because no roll could change their result; everyone else draws
 * exactly once, so the stream stays aligned however the numbers are tuned.
 */
export const fatigueRecoveryPhase: PhaseDefinition = definePhase({
  id: 'condition.fatigueRecovery',
  group: 'housekeeping',
  order: 10,
  cadence: { kind: 'daily' },
  run: (ctx) => {
    // Fetched on first use, so a day with nobody to recover leaves the stream untouched.
    let recoveryStream: RngStream | undefined;
    for (const person of ctx.read.tables.people.values()) {
      if (person.fatigue <= FATIGUE_MIN) {
        continue;
      }
      recoveryStream ??= ctx.rng(RECOVERY_STREAM);
      const recovered = computeFatigueRecovery(
        { fatigue: person.fatigue },
        { tunables: ctx.tunables, rng: recoveryStream },
      );
      ctx.tx.update('people', person.id, { fatigue: recovered.value });
      ctx.recordTrace(fatigueRecoveryTraceRef(person.id), ctx.date, recovered);
      if (recovered.value === FATIGUE_MIN) {
        ctx.publish('condition.fatigueCleared', { personId: person.id });
      }
    }
  },
});

export const conditionPhases: readonly PhaseDefinition[] = [fatigueRecoveryPhase];
