/**
 * The condition cap: how high a body part can heal back to at a given age.
 *
 * Design: docs/design/health.md#condition-cap. A young body heals all the way to 100; from
 * `health.condition.capAgeFrom` the cap falls a little each year, never below
 * `health.condition.capFloor`. No randomness.
 */

import { startCalc } from '../../../core/trace/calc';
import type { Traced } from '../../../core/trace/types';
import type { EngineTunables } from '../../tunables';
import { AGING_OFF, HEALTH_DOC } from './shared';

export interface ConditionCapInputs {
  /** Age in whole years on the day. */
  age: number;
  /** The world's aging setting (`meta.settings.agingEnabled`); off, the cap stays at 100. */
  agingEnabled: boolean;
}

/** The ends of the condition scale. Fixed by the Person schema (`condition` parts are 0–100). */
export const CONDITION_MIN = 0;
export const CONDITION_MAX = 100;

export const CONDITION_CAP_DOC_REF = `${HEALTH_DOC}#condition-cap`;

/**
 * `100 − max(0, age − capAgeFrom) × capDropPerYear`, at least `capFloor`, kept within 0..100.
 * With aging off the cap is 100 whatever the age.
 */
export function computeConditionCap(
  inputs: ConditionCapInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const calc = startCalc('Healing cap for their age', CONDITION_MAX, {
    unit: 'points',
    docRef: CONDITION_CAP_DOC_REF,
    startLabel: 'A healthy body',
  });
  if (!inputs.agingEnabled) {
    return calc.branch(AGING_OFF, true).done();
  }
  const years = startCalc('Years past the age the cap falls from', inputs.age, {
    unit: 'years',
    startLabel: 'Age',
  });
  years
    .subtract(
      'Cap falls from',
      years.tunable(deps.tunables, 'health.condition.capAgeFrom', 'Cap falls from'),
    )
    .max('Not below 0', 0);
  const drop = startCalc('Cap lost to age', years.done(), { unit: 'points' });
  drop.multiply(
    'Lost per year',
    drop.tunable(deps.tunables, 'health.condition.capDropPerYear', 'Lost per year'),
  );
  return calc
    .subtract('Age', drop.done())
    .max('Lowest cap', calc.tunable(deps.tunables, 'health.condition.capFloor', 'Lowest cap'))
    .clamp(CONDITION_MIN, CONDITION_MAX)
    .done();
}
