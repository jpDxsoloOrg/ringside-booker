/**
 * A day's morning for the health system: injuries end on their return date, everyone sheds some
 * fatigue, and on Mondays damaged body parts heal a little.
 *
 * The morning normally runs in the day's housekeeping (`health.recovery`, `health.conditionRecovery`),
 * before any show. The player's own show is different: the day stops before it starts, and the
 * player runs the show with `shows.runTonight` before the day's phases. Left alone, that day's
 * housekeeping would then rest the player's workers from the show they wrestled the same night,
 * while a rival's workers wait for the next morning. So when a show runs before its day
 * (`beforeTheDay`), the before-a-show hook `health.morningBeforeShow` runs the morning first, at the
 * same point of the day it would have run, and the day's housekeeping then skips it
 * (`morningRanEarly`). Everyone rests from a show the next morning, whoever ran it.
 *
 * Design: docs/design/health.md#the-players-show-nights.
 */

import { matchesCadence, type Cadence } from '../../core/calendar/cadence';
import { ageInYears, type GameDate } from '../../core/date';
import type { PersonId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import type { RngStream } from '../../core/rng/registry';
import { fastPathsEnabled } from '../../core/fastPaths';
import type { TraceRef } from '../../core/trace/store';
import type { Traced } from '../../core/trace/types';
import { BODY_PARTS, type BodyCondition, type TraitKey } from '../../model/entities/person';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';
import { registerBeforeShowRuns, type BeforeShowRunsHook } from '../shows/beforeRun';
import { restFollowsShowsOn, talkedWithoutWrestling } from './appearances';
import { computeConditionCap } from './formulas/conditionCap';
import {
  computeConditionRecovery,
  conditionRecoveryValue,
  conditionWeeklyGainValue,
} from './formulas/conditionRecovery';
import { computeFatigueRecovery, FATIGUE_MIN } from './formulas/fatigueRecovery';
import { medicalLevelOf, type MedicalLevel } from './medical';
import { worksForAHuman } from './notice';
import { healInjuries } from './returns';
import { RECOVERY_STREAM } from './streams';

/** The trace kind every fatigue recovery result is stored under. */
export const FATIGUE_RECOVERY_TRACE_KIND = 'health.fatigueRecovery';

/** Where a person's latest fatigue recovery trace is stored. */
export function fatigueRecoveryTraceRef(personId: PersonId): TraceRef {
  return { kind: FATIGUE_RECOVERY_TRACE_KIND, id: personId };
}

/** When body condition heals: Mondays. */
export const CONDITION_RECOVERY_CADENCE: Cadence = { kind: 'weekly', weekday: 'mon' };

/** The before-a-show hook that runs the morning before a show the player runs ahead of its day. */
export const MORNING_BEFORE_SHOW_HOOK_ID = 'health.morningBeforeShow';

/**
 * True when `date`'s morning has already run: a show dated `date` has completed before the day's
 * housekeeping, which only a show the player ran ahead of the day (`shows.runTonight`) can do, and
 * that run started with the morning. Read from the world, so it holds across a save and load.
 */
export function morningRanEarly(read: GameWorldView, date: GameDate): boolean {
  return read.tables.eventInstances
    .lookup('byDate', date)
    .some((show) => show.status === 'completed');
}

/**
 * Closes injuries whose return date has come (`healInjuries`, no rolls), then rests everyone's
 * fatigue. Only the player's own workers keep a full Why? for their recovery; everyone else's is
 * stored as a summary from the start, to keep saves small. People are visited in ascending ID
 * order. Someone already at 0 fatigue is skipped and draws nothing, because no roll could change
 * their result; everyone else draws exactly once, so the stream stays aligned however the numbers
 * are tuned.
 */
export function runFatigueMorning(ctx: PhaseContext): void {
  healInjuries(ctx);
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
    // Full Why? only for the player's own workers; everyone else keeps a summary (save size).
    ctx.recordTrace(fatigueRecoveryTraceRef(person.id), ctx.date, recovered, {
      summaryOnly: !worksForAHuman(ctx.read, person.id, ctx.date),
    });
    if (recovered.value === FATIGUE_MIN) {
      ctx.publish('fatigue.cleared', { personId: person.id });
    }
  }
}

/** People who no longer heal: their bodies are left as they were. */
const NOT_HEALING = new Set(['retired', 'deceased']);

/**
 * Weekly body-condition recovery. For every person still in the business, each body part below the
 * cap for their age heals a little (`computeConditionRecovery`); a person whose parts are all at or
 * above the cap is skipped without reading anything else. Draws no random numbers, stores no traces
 * (the health profile works the Why? out again) and publishes nothing.
 *
 * Fast path (POL4-10): since nothing is stored, the cap is worked out once per age and the healing
 * once per kind of person and care, and each part's result is the plain number
 * (`conditionRecoveryValue`), the same as the traced value.
 */
export function recoverConditions(ctx: PhaseContext): void {
  const { agingEnabled } = ctx.read.meta.settings;
  const { people, promotions } = ctx.read.tables;
  const fast = fastPathsEnabled();
  const capByAge = new Map<number, Traced<number>>();
  const gainByKind = new Map<string, number>();
  for (const person of people.values()) {
    if (NOT_HEALING.has(person.status)) {
      continue;
    }
    const age = ageInYears(person.birthDate, ctx.date);
    let cap = fast ? capByAge.get(age) : undefined;
    if (cap === undefined) {
      cap = computeConditionCap({ age, agingEnabled }, { tunables: ctx.tunables });
      capByAge.set(age, cap);
    }
    const capValue = cap.value;
    if (BODY_PARTS.every((part) => person.condition[part] >= capValue)) {
      continue;
    }
    const care = medicalLevelOf(ctx.read, person.id, ctx.date, ctx.tunables);
    const source =
      care.promotionId === null ? null : (promotions.get(care.promotionId)?.name ?? null);
    const healed: BodyCondition = { ...person.condition };
    let changed = false;
    let gain: number | undefined;
    for (const part of BODY_PARTS) {
      const partInjured = person.injury?.bodyPart === part;
      let recovered: number;
      if (fast) {
        gain ??= weeklyGainFor(gainByKind, person.traits, care.level, source, ctx.tunables);
        recovered = conditionRecoveryValue(
          { current: person.condition[part], cap: capValue, partInjured },
          gain,
        );
      } else {
        recovered = computeConditionRecovery(
          {
            current: person.condition[part],
            cap,
            partInjured,
            traits: person.traits,
            medicalLevel: care.level,
            medicalSource: source,
          },
          { tunables: ctx.tunables },
        ).value;
      }
      if (recovered !== person.condition[part]) {
        healed[part] = recovered;
        changed = true;
      }
    }
    if (changed) {
      ctx.tx.update('people', person.id, { condition: healed });
    }
  }
}

/**
 * This week's healing for one kind of person and care, worked out once a run: it reads only the
 * durable and injury-prone traits and the medical level (the care's name is a label).
 */
function weeklyGainFor(
  cache: Map<string, number>,
  traits: readonly TraitKey[],
  medicalLevel: MedicalLevel,
  medicalSource: string | null,
  tunables: EngineTunables,
): number {
  const traitKind = traits.includes('durable')
    ? 'durable'
    : traits.includes('injuryProne')
      ? 'injuryProne'
      : 'plain';
  const key = `${traitKind}:${String(medicalLevel)}`;
  let gain = cache.get(key);
  if (gain === undefined) {
    gain = conditionWeeklyGainValue({ traits, medicalLevel, medicalSource }, { tunables });
    cache.set(key, gain);
  }
  return gain;
}

/**
 * Before a show that runs ahead of its day (the player pressed Run the show): the day's morning,
 * unless an earlier show of the day already ran it. Shows run inside the day (every rival show)
 * come after the day's housekeeping, which ran the morning already.
 */
export const morningBeforeShowHook: BeforeShowRunsHook = {
  id: MORNING_BEFORE_SHOW_HOOK_ID,
  order: 0,
  run: (ctx, { beforeTheDay }) => {
    if (!beforeTheDay || morningRanEarly(ctx.read, ctx.date)) {
      return;
    }
    runFatigueMorning(ctx);
    if (matchesCadence(ctx.date, CONDITION_RECOVERY_CADENCE)) {
      recoverConditions(ctx);
    }
  },
};

registerBeforeShowRuns(morningBeforeShowHook);
