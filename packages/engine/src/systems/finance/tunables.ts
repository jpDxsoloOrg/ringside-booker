/**
 * The finance system's balance numbers, all in the `Finances` category with a docRef into
 * docs/design/finances.md.
 *
 * Empty on purpose for now: ECO1-02 (reach and size), ECO1-03 (wages and medical) and ECO1-04
 * (show costs and importance) each append their own keys here, in separate blocks, so the three can
 * be built in parallel.
 */

import { defineTunables } from '../../core/tunables/define';

/** The tunables editor group every finance key belongs to. */
export const FINANCE_TUNABLE_CATEGORY = 'Finances';

const REACH_DOC = 'finances.md#reach-and-size';

/** How much one level of a promotion's popularity counts towards its reach (ECO1-02). */
function reachWeight(defaultValue: number, level: string) {
  return {
    kind: 'number',
    default: defaultValue,
    min: 0,
    max: 10,
    step: 0.1,
    unit: 'ratio',
    category: FINANCE_TUNABLE_CATEGORY,
    description: `How much popularity in the ${level} counts towards reach; 0 = this level does not count`,
    docRef: REACH_DOC,
  } as const;
}

/** The reach at which a company starts to count as one size (ECO1-02). */
function sizeThreshold(defaultValue: number, size: string) {
  return {
    kind: 'number',
    default: defaultValue,
    min: 0,
    max: 100,
    step: 0.5,
    unit: 'points',
    category: FINANCE_TUNABLE_CATEGORY,
    description: `Reach at which a company counts as ${size}`,
    docRef: REACH_DOC,
  } as const;
}

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
  // Reach and size (ECO1-02).
  'finance.reach.weight.homeRegion': reachWeight(1, 'home region'),
  'finance.reach.weight.homeCountry': reachWeight(3, 'home country'),
  'finance.reach.weight.homeContinent': reachWeight(2, 'home continent'),
  'finance.reach.weight.world': reachWeight(2, 'whole world'),
  'finance.size.regionalAt': sizeThreshold(6, 'Regional'),
  'finance.size.nationalAt': sizeThreshold(25, 'National'),
  'finance.size.continentalAt': sizeThreshold(45, 'Continental'),
  'finance.size.globalAt': sizeThreshold(70, 'Global'),
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
