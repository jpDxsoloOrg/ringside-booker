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
});
