/**
 * The health system's balance numbers: how fast fatigue fades, how far and how fast body condition
 * heals, and how much the medical policy helps. All in the `Health` category, documented in
 * docs/design/health.md.
 */

import { defineTunables } from '../../core/tunables/define';

export const HEALTH_TUNABLE_CATEGORY = 'Health';

const FATIGUE_DOC = 'health.md#fatigue-recovery';
const CAP_DOC = 'health.md#condition-cap';
const CONDITION_DOC = 'health.md#condition-recovery';
const MEDICAL_DOC = 'health.md#medical-care';

/** A 0..3 multiplier in the Health category. */
function multiplier(defaultValue: number, description: string, docRef: string) {
  return {
    kind: 'number',
    default: defaultValue,
    min: 0,
    max: 3,
    step: 0.05,
    unit: 'multiplier',
    category: HEALTH_TUNABLE_CATEGORY,
    description,
    docRef,
  } as const;
}

export const healthTunables = defineTunables({
  'health.fatigue.recoveryPerDay': {
    kind: 'number',
    default: 4,
    min: 0,
    max: 100,
    step: 0.5,
    unit: 'points/day',
    category: HEALTH_TUNABLE_CATEGORY,
    description: 'Fatigue an average worker sheds each day, before stamina, age and traits',
    docRef: FATIGUE_DOC,
  },
  'health.fatigue.recoveryBonusMax': {
    kind: 'integer',
    default: 1,
    min: 0,
    max: 10,
    unit: 'points/day',
    category: HEALTH_TUNABLE_CATEGORY,
    description: "Largest random extra recovery per day; 0 turns the roll's effect off",
    docRef: FATIGUE_DOC,
  },
  'health.fatigue.staminaWeight': {
    kind: 'number',
    default: 0.4,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'ratio',
    category: HEALTH_TUNABLE_CATEGORY,
    description: 'How much stamina speeds up or slows down recovery; 0 ignores stamina',
    docRef: FATIGUE_DOC,
  },
  'health.fatigue.ageFrom': {
    kind: 'integer',
    default: 33,
    min: 18,
    max: 60,
    unit: 'years',
    category: HEALTH_TUNABLE_CATEGORY,
    description: 'Age from which fatigue fades more slowly',
    docRef: FATIGUE_DOC,
  },
  'health.fatigue.agePenaltyPerYear': {
    kind: 'number',
    default: 0.02,
    min: 0,
    max: 0.2,
    step: 0.005,
    unit: 'ratio',
    category: HEALTH_TUNABLE_CATEGORY,
    description: 'Recovery lost for each year past that age; 0 turns the age effect off',
    docRef: FATIGUE_DOC,
  },
  'health.fatigue.ageFactorMin': {
    kind: 'number',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'multiplier',
    category: HEALTH_TUNABLE_CATEGORY,
    description: 'The least of the daily recovery age can leave',
    docRef: FATIGUE_DOC,
  },
  'health.fatigue.workhorseMultiplier': multiplier(
    1.2,
    'Recovery for a workhorse, as a multiple of everyone else',
    FATIGUE_DOC,
  ),
  'health.fatigue.coasterMultiplier': multiplier(
    0.9,
    'Recovery for a coaster, as a multiple of everyone else',
    FATIGUE_DOC,
  ),
  'health.fatigue.workedPromoRecovery': {
    kind: 'number',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'multiplier',
    category: HEALTH_TUNABLE_CATEGORY,
    description: 'Recovery after a show spent talking (a promo or angle, no match); 1 rests fully',
    docRef: FATIGUE_DOC,
  },
  'health.condition.capAgeFrom': {
    kind: 'integer',
    default: 30,
    min: 18,
    max: 60,
    unit: 'years',
    category: HEALTH_TUNABLE_CATEGORY,
    description: 'Age from which a body can no longer heal all the way back to 100',
    docRef: CAP_DOC,
  },
  'health.condition.capDropPerYear': {
    kind: 'number',
    default: 1.5,
    min: 0,
    max: 10,
    step: 0.1,
    unit: 'points',
    category: HEALTH_TUNABLE_CATEGORY,
    description: 'How far the healing cap falls for each year past that age; 0 keeps it at 100',
    docRef: CAP_DOC,
  },
  'health.condition.capFloor': {
    kind: 'number',
    default: 55,
    min: 0,
    max: 100,
    step: 1,
    unit: 'points',
    category: HEALTH_TUNABLE_CATEGORY,
    description: 'The lowest the healing cap goes, however old the worker',
    docRef: CAP_DOC,
  },
  'health.condition.recoveryPerCheck': {
    kind: 'number',
    default: 0.5,
    min: 0,
    max: 10,
    step: 0.1,
    unit: 'points',
    category: HEALTH_TUNABLE_CATEGORY,
    description:
      'Condition a damaged body part gets back each week, before traits and medical care',
    docRef: CONDITION_DOC,
  },
  'health.condition.durableMultiplier': multiplier(
    1.25,
    'Healing for a durable worker, as a multiple of everyone else',
    CONDITION_DOC,
  ),
  'health.condition.injuryProneMultiplier': multiplier(
    0.75,
    'Healing for an injury-prone worker, as a multiple of everyone else',
    CONDITION_DOC,
  ),
  'health.medical.recoveryMultiplier.level0': multiplier(
    0.8,
    'Healing under medical care level 0 (none)',
    MEDICAL_DOC,
  ),
  'health.medical.recoveryMultiplier.level1': multiplier(
    1,
    'Healing under medical care level 1',
    MEDICAL_DOC,
  ),
  'health.medical.recoveryMultiplier.level2': multiplier(
    1.15,
    'Healing under medical care level 2',
    MEDICAL_DOC,
  ),
  'health.medical.recoveryMultiplier.level3': multiplier(
    1.3,
    'Healing under medical care level 3 (the best)',
    MEDICAL_DOC,
  ),
  'health.medical.freeAgentLevel': {
    kind: 'integer',
    default: 1,
    min: 0,
    max: 3,
    unit: 'count',
    category: HEALTH_TUNABLE_CATEGORY,
    description: 'The medical care level (0 to 3) a worker with no employer gets',
    docRef: MEDICAL_DOC,
  },
});
