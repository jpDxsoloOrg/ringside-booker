/**
 * The finance system's balance numbers, all in the `Finances` category with a docRef into
 * docs/design/finances.md.
 *
 * ECO1-02 (reach and size), ECO1-03 (wages and medical) and ECO1-04 (show costs and importance)
 * each add their own keys here, in separate blocks, so the three can be built in parallel.
 */

import { defineTunables } from '../../core/tunables/define';

/** The tunables editor group every finance key belongs to. */
export const FINANCE_TUNABLE_CATEGORY = 'Finances';

// ---------------------------------------------------------------------------------------------
// ECO1-03: wages and medical. See docs/design/finances.md#payroll and #medical.
// ---------------------------------------------------------------------------------------------

const PAYROLL_DOC = 'finances.md#payroll';
const MEDICAL_DOC = 'finances.md#medical';

/** The most a medical policy level may cost per person each month: $100,000. */
const MEDICAL_PER_CONTRACT_MAX = 10_000_000;

function medicalPerContract(level: number, defaultCents: number) {
  return {
    kind: 'integer',
    default: defaultCents,
    min: 0,
    max: MEDICAL_PER_CONTRACT_MAX,
    unit: 'money/month',
    category: FINANCE_TUNABLE_CATEGORY,
    description: `Medical cost per person under contract each month at policy level ${String(level)}`,
    docRef: MEDICAL_DOC,
  } as const;
}

export const financeTunables = defineTunables({
  // ECO1-03: wages and medical.
  'finance.payOwnerAndBooker': {
    kind: 'boolean',
    default: false,
    unit: 'flag',
    category: FINANCE_TUNABLE_CATEGORY,
    description: "Pay the owner's and booker's contracts a wage too",
    docRef: PAYROLL_DOC,
  },
  'finance.wages.multiplier': {
    kind: 'number',
    default: 1,
    min: 0,
    max: 5,
    step: 0.05,
    unit: 'multiplier',
    category: FINANCE_TUNABLE_CATEGORY,
    description: 'Every monthly wage is multiplied by this (0 = nobody is paid)',
    docRef: PAYROLL_DOC,
  },
  'finance.medical.perContract.level0': medicalPerContract(0, 0),
  'finance.medical.perContract.level1': medicalPerContract(1, 15_000),
  'finance.medical.perContract.level2': medicalPerContract(2, 60_000),
  'finance.medical.perContract.level3': medicalPerContract(3, 150_000),
});
