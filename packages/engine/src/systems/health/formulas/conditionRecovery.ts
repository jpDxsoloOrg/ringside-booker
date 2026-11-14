/**
 * Condition recovery: how much a damaged body part heals in a week.
 *
 * Design: docs/design/health.md#condition-recovery. No randomness: the weekly phase stores no trace,
 * because anything that wants the Why? can work it out again from the same inputs.
 */

import { startCalc } from '../../../core/trace/calc';
import { withoutNegativeZero } from '../../../core/trace/helpers';
import type { Traced } from '../../../core/trace/types';
import type { TraitKey } from '../../../model/entities/person';
import type { EngineTunables } from '../../tunables';
import type { MedicalLevel } from '../medical';
import { HEALTH_DOC, tunableStart } from './shared';

export interface ConditionRecoveryInputs {
  /** The part's condition before this week's healing, 0 to 100. */
  current: number;
  /** The most the part can heal back to at the person's age (`computeConditionCap`). */
  cap: Traced<number>;
  /** True when the person's current injury is to this part: it does not heal until they return. */
  partInjured: boolean;
  traits: readonly TraitKey[];
  /** The medical care the person gets (`medicalLevelOf`). */
  medicalLevel: MedicalLevel;
  /** The name of the promotion giving that care, or null for someone with no employer. */
  medicalSource: string | null;
}

export const CONDITION_RECOVERY_DOC_REF = `${HEALTH_DOC}#condition-recovery`;

export const INJURED_PART_BRANCH = 'Injured part: no recovery while it heals';
export const AT_CAP_BRANCH = 'Already at or above the cap for their age';

const MEDICAL_KEYS = {
  0: 'health.medical.recoveryMultiplier.level0',
  1: 'health.medical.recoveryMultiplier.level1',
  2: 'health.medical.recoveryMultiplier.level2',
  3: 'health.medical.recoveryMultiplier.level3',
} as const;

/** "Medical care: Apex Wrestling (level 2)" or "No employer: standard care". */
export function medicalCareLabel(level: MedicalLevel, source: string | null): string {
  return source === null
    ? 'No employer: standard care'
    : `Medical care: ${source} (level ${String(level)})`;
}

/** `recoveryPerCheck × trait × medical`. */
function weeklyGain(
  inputs: Pick<ConditionRecoveryInputs, 'traits' | 'medicalLevel' | 'medicalSource'>,
  tunables: EngineTunables,
): Traced<number> {
  const calc = startCalc(
    'Healing this week',
    tunableStart(tunables, 'health.condition.recoveryPerCheck', 'Weekly healing'),
    { unit: 'points' },
  );
  if (inputs.traits.includes('durable')) {
    calc
      .branch('Durable', true)
      .multiply('Durable', calc.tunable(tunables, 'health.condition.durableMultiplier', 'Durable'));
  } else if (inputs.traits.includes('injuryProne')) {
    calc
      .branch('Injury prone', true)
      .multiply(
        'Injury prone',
        calc.tunable(tunables, 'health.condition.injuryProneMultiplier', 'Injury prone'),
      );
  }
  const medicalLabel = medicalCareLabel(inputs.medicalLevel, inputs.medicalSource);
  return calc
    .multiply(medicalLabel, calc.tunable(tunables, MEDICAL_KEYS[inputs.medicalLevel], medicalLabel))
    .done();
}

/**
 * A body part's condition after a week of healing. An injured part and a part already at or above
 * the cap stay where they are (healing never lowers condition: decline with age is WRK4's). Any
 * other part gains `health.condition.recoveryPerCheck`, scaled by the durable or injury-prone
 * trait and the medical care multiplier, and stops at the cap.
 */
export function computeConditionRecovery(
  inputs: ConditionRecoveryInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const calc = startCalc('Condition after a week of healing', inputs.current, {
    unit: 'points',
    docRef: CONDITION_RECOVERY_DOC_REF,
    startLabel: 'Condition before healing',
  });
  if (inputs.partInjured) {
    return calc.branch(INJURED_PART_BRANCH, true).done();
  }
  if (inputs.current >= inputs.cap.value) {
    return calc.branch(AT_CAP_BRANCH, true).done();
  }
  return calc
    .add('Healing this week', weeklyGain(inputs, deps.tunables))
    .min('Healing cap for their age', inputs.cap)
    .done();
}

/**
 * Fast path (POL4-10): this week's healing for a part, the `weeklyGain` step of
 * {@link computeConditionRecovery} as a number. It does not depend on the part, so a caller that
 * stores no trace works it out once per kind of person and care instead of once per body part.
 */
export function conditionWeeklyGainValue(
  inputs: Pick<ConditionRecoveryInputs, 'traits' | 'medicalLevel' | 'medicalSource'>,
  deps: { tunables: EngineTunables },
): number {
  return weeklyGain(inputs, deps.tunables).value;
}

/**
 * Fast path (POL4-10): {@link computeConditionRecovery}'s value with no trace, given this week's
 * healing from {@link conditionWeeklyGainValue}. The same steps in the same order: an injured part
 * or one at or above the cap stays put; any other part gains the healing and stops at the cap.
 * `conditionRecovery.test.ts` holds it to the traced value.
 */
export function conditionRecoveryValue(
  inputs: { readonly current: number; readonly cap: number; readonly partInjured: boolean },
  weeklyGainValue: number,
): number {
  const current = withoutNegativeZero(inputs.current);
  if (inputs.partInjured || inputs.current >= inputs.cap) {
    return current;
  }
  const healed = withoutNegativeZero(current + withoutNegativeZero(weeklyGainValue));
  return withoutNegativeZero(Math.min(healed, withoutNegativeZero(inputs.cap)));
}
