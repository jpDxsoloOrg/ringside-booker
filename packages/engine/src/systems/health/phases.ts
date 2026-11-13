/**
 * The health system's day phases: everyone sheds some fatigue each day (`health.recovery`), and
 * damaged body parts heal a little each week up to a cap for their age (`health.conditionRecovery`).
 * Design: docs/design/health.md.
 */

import { ageInYears } from '../../core/date';
import type { PersonId } from '../../core/ids';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import type { RngStream } from '../../core/rng/registry';
import type { TraceRef } from '../../core/trace/store';
import { BODY_PARTS, type BodyCondition } from '../../model/entities/person';
import { restFollowsShowsOn, talkedWithoutWrestling } from './appearances';
import { computeConditionCap } from './formulas/conditionCap';
import { computeConditionRecovery } from './formulas/conditionRecovery';
import { computeFatigueRecovery, FATIGUE_MIN } from './formulas/fatigueRecovery';
import { medicalLevelOf } from './medical';
import { RECOVERY_STREAM } from './streams';

/** The trace kind every fatigue recovery result is stored under. */
export const FATIGUE_RECOVERY_TRACE_KIND = 'health.fatigueRecovery';

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
  id: 'health.recovery',
  group: 'housekeeping',
  order: 10,
  cadence: { kind: 'daily' },
  run: (ctx) => {
    // Fetched on first use, so a day with nobody to recover leaves the stream untouched and does
    // not look at yesterday's shows.
    let recoveryStream: RngStream | undefined;
    let talkedOnly: ReadonlySet<PersonId> | undefined;
    const { agingEnabled } = ctx.read.meta.settings;
    for (const person of ctx.read.tables.people.values()) {
      if (person.fatigue <= FATIGUE_MIN) {
        continue;
      }
      recoveryStream ??= ctx.rng(RECOVERY_STREAM);
      talkedOnly ??= talkedWithoutWrestling(ctx.read, restFollowsShowsOn(ctx.date));
      const recovered = computeFatigueRecovery(
        {
          fatigue: person.fatigue,
          stamina: person.attributes.stamina,
          age: ageInYears(person.birthDate, ctx.date),
          traits: person.traits,
          agingEnabled,
          workedPromo: talkedOnly.has(person.id),
        },
        { tunables: ctx.tunables, rng: recoveryStream },
      );
      ctx.tx.update('people', person.id, { fatigue: recovered.value });
      ctx.recordTrace(fatigueRecoveryTraceRef(person.id), ctx.date, recovered);
      if (recovered.value === FATIGUE_MIN) {
        ctx.publish('fatigue.cleared', { personId: person.id });
      }
    }
  },
});

/** People who no longer heal: their bodies are left as they were. */
const NOT_HEALING = new Set(['retired', 'deceased']);

/**
 * Weekly body-condition recovery, on Mondays. For every person still in the business, each body
 * part below the cap for their age heals a little (`computeConditionRecovery`); a person whose
 * parts are all at or above the cap is skipped without reading anything else. Draws no random
 * numbers, stores no traces (the health profile works the Why? out again) and publishes nothing.
 */
export const conditionRecoveryPhase: PhaseDefinition = definePhase({
  id: 'health.conditionRecovery',
  group: 'housekeeping',
  order: 12,
  cadence: { kind: 'weekly', weekday: 'mon' },
  run: (ctx) => {
    const { agingEnabled } = ctx.read.meta.settings;
    const { people, promotions } = ctx.read.tables;
    for (const person of people.values()) {
      if (NOT_HEALING.has(person.status)) {
        continue;
      }
      const age = ageInYears(person.birthDate, ctx.date);
      const cap = computeConditionCap({ age, agingEnabled }, { tunables: ctx.tunables });
      if (BODY_PARTS.every((part) => person.condition[part] >= cap.value)) {
        continue;
      }
      const care = medicalLevelOf(ctx.read, person.id, ctx.date, ctx.tunables);
      const source =
        care.promotionId === null ? null : (promotions.get(care.promotionId)?.name ?? null);
      const healed: BodyCondition = { ...person.condition };
      let changed = false;
      for (const part of BODY_PARTS) {
        const recovered = computeConditionRecovery(
          {
            current: person.condition[part],
            cap,
            partInjured: person.injury?.bodyPart === part,
            traits: person.traits,
            medicalLevel: care.level,
            medicalSource: source,
          },
          { tunables: ctx.tunables },
        );
        if (recovered.value !== person.condition[part]) {
          healed[part] = recovered.value;
          changed = true;
        }
      }
      if (changed) {
        ctx.tx.update('people', person.id, { condition: healed });
      }
    }
  },
});

export const healthPhases: readonly PhaseDefinition[] = [
  fatigueRecoveryPhase,
  conditionRecoveryPhase,
];
