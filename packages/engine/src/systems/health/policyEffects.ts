/**
 * What the medical policy does for health, in the Finances policy preview (WRK6-07 with ECO1):
 * each level says how long injuries keep workers out and how fast body condition heals each week,
 * from `health.medical.injuryMultiplier.levelN` and `health.medical.recoveryMultiplier.levelN`.
 * The policy's cost is ECO1's; these lines carry none.
 *
 * Design: docs/design/health.md#medical-care.
 */

import { startCalc } from '../../core/trace/calc';
import { registerPolicyEffect, type PolicyEffect, type PolicyEffectLine } from '../finance';
import type { PolicyLevel } from '../finance/policies';
import type { EngineTunables } from '../tunables';
import { tunableStart } from './formulas/shared';

export const MEDICAL_POLICY_EFFECT_ID = 'health.medicalCare';

const MEDICAL_DOC_REF = 'health.md#medical-care';

const INJURY_KEYS = {
  0: 'health.medical.injuryMultiplier.level0',
  1: 'health.medical.injuryMultiplier.level1',
  2: 'health.medical.injuryMultiplier.level2',
  3: 'health.medical.injuryMultiplier.level3',
} as const;

const HEALING_KEYS = {
  0: 'health.medical.recoveryMultiplier.level0',
  1: 'health.medical.recoveryMultiplier.level1',
  2: 'health.medical.recoveryMultiplier.level2',
  3: 'health.medical.recoveryMultiplier.level3',
} as const;

/** "0.8", "1.15": at most two decimals, no trailing zeros. */
function times(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Better than usual below 1 for time out, above 1 for healing. */
function toneOf(value: number, betterBelowOne: boolean): PolicyEffectLine['tone'] {
  if (value === 1) {
    return 'neutral';
  }
  return value < 1 === betterBelowOne ? 'positive' : 'negative';
}

/** The two health lines for one medical level. */
export function medicalPolicyLines(
  level: PolicyLevel,
  tunables: EngineTunables,
): PolicyEffectLine[] {
  const injury = startCalc(
    'Injury time out',
    tunableStart(tunables, INJURY_KEYS[level], `Medical care level ${String(level)}`),
    { unit: 'multiplier', docRef: MEDICAL_DOC_REF },
  ).done();
  const healing = startCalc(
    'Weekly body condition healing',
    tunableStart(tunables, HEALING_KEYS[level], `Medical care level ${String(level)}`),
    { unit: 'multiplier', docRef: MEDICAL_DOC_REF },
  ).done();
  return [
    {
      text:
        injury.value === 1
          ? 'Injuries heal in the usual time'
          : `Injuries heal in ×${times(injury.value)} of the time`,
      tone: toneOf(injury.value, true),
      trace: injury.trace,
    },
    {
      text:
        healing.value === 1
          ? 'Body condition recovers at the usual rate each week'
          : `Body condition recovers ×${times(healing.value)} per week`,
      tone: toneOf(healing.value, false),
      trace: healing.trace,
    },
  ];
}

export const medicalPolicyEffect: PolicyEffect = {
  id: MEDICAL_POLICY_EFFECT_ID,
  area: 'medical',
  order: 10,
  lines: (_read, _promotionId, level, tunables) => medicalPolicyLines(level, tunables),
};

registerPolicyEffect(medicalPolicyEffect);
