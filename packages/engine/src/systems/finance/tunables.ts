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

export const financeTunables = defineTunables({});
