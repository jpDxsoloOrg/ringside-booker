/**
 * Monthly medical: the bill for looking after everyone under contract.
 *
 * Design: docs/design/finances.md#medical. People under contract × the cost per person at the
 * promotion's medical policy level (`finance.medical.perContract.level0..3`). Medical covers every
 * active contract that has started, the owner and the booker included.
 */

import { startCalc } from '../../../core/trace/calc';
import { inputOf } from '../../../core/trace/helpers';
import type { Traced } from '../../../core/trace/types';
import type { EngineTunables, NumberTunableKey } from '../../tunables';

export const MONTHLY_MEDICAL_DOC_REF = 'docs/design/finances.md#medical';

/** A medical policy level, 0 (none) to 3 (best). */
export type MedicalLevel = 0 | 1 | 2 | 3;

/** What the player reads for each policy level. */
export const MEDICAL_LEVEL_LABELS: Readonly<Record<MedicalLevel, string>> = Object.freeze({
  0: 'None',
  1: 'Basic',
  2: 'Good',
  3: 'Premium',
});

const PER_CONTRACT_KEYS: Readonly<Record<MedicalLevel, NumberTunableKey>> = Object.freeze({
  0: 'finance.medical.perContract.level0',
  1: 'finance.medical.perContract.level1',
  2: 'finance.medical.perContract.level2',
  3: 'finance.medical.perContract.level3',
});

export interface MonthlyMedicalInputs {
  /** People under contract: active contracts that have started. */
  contracts: number;
  level: MedicalLevel;
  /** The level's name, such as "Basic". */
  levelLabel: string;
}

/** The month's medical bill, in cents (unit `money/month`). */
export function monthlyMedical(
  inputs: MonthlyMedicalInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const calc = startCalc(
    `Medical (${inputs.levelLabel})`,
    inputOf('People under contract', inputs.contracts, undefined, 'count'),
    { unit: 'money/month', docRef: MONTHLY_MEDICAL_DOC_REF },
  );
  return calc
    .multiply(
      `Cost per person at ${inputs.levelLabel} medical`,
      calc.tunable(deps.tunables, PER_CONTRACT_KEYS[inputs.level]),
    )
    .done();
}
