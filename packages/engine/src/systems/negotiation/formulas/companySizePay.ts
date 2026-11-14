/**
 * Company size pay (ECO4-09): small companies pay indie wages. A worker's ask, and the default
 * world's shipped contracts, are multiplied by a factor that grows smoothly with the promotion's
 * reach:
 *
 *     factor = sizeFloor + (1 − sizeFloor) × min(1, reach ÷ sizeFullReach)
 *
 * so a promotion nobody has heard of pays `contracts.ask.sizeFloor` of the usual rate and one with
 * a reach of `contracts.ask.sizeFullReach` or more pays the full rate. It reads reach, not the size
 * label, so pay never jumps when a company crosses a size threshold; the label only names the
 * line. A `sizeFullReach` of 0 means every company pays full rates.
 *
 * Design: docs/design/negotiation.md#asking-terms, docs/design/contracts.md#company-size-pay.
 */

import { startCalc } from '../../../core/trace/calc';
import { constantOf } from '../../../core/trace/helpers';
import type { Traced } from '../../../core/trace/types';
import { promotionSize, PROMOTION_SIZE_LABELS } from '../../finance/formulas/promotionSize';
import type { EngineTunables } from '../../tunables';
import { ASKING_TERMS_DOC_REF, wholeText } from './shared';

export const FULL_RATES_LABEL = 'Every company pays full rates';

/** The Why? line's name: "Company size: Local (reach 4)". */
export function companySizePayLabel(reach: number, tunables: EngineTunables): string {
  const size = promotionSize(constantOf('Reach', reach, 'The promotion reach'), {
    tunables,
  }).value;
  return `Company size: ${PROMOTION_SIZE_LABELS[size]} (reach ${wholeText(reach)})`;
}

/** The pay factor for a promotion with this reach (0-100), traced. */
export function companySizePay(reach: number, deps: { tunables: EngineTunables }): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc(companySizePayLabel(reach, tunables), 0, {
    unit: 'multiplier',
    docRef: ASKING_TERMS_DOC_REF,
    startLabel: 'Nothing yet',
  });
  const fullReach = tunables.get('contracts.ask.sizeFullReach');
  const everyoneFull = fullReach <= 0;
  calc.branch(FULL_RATES_LABEL, everyoneFull);
  if (everyoneFull) {
    return calc.add(FULL_RATES_LABEL, 1).done();
  }
  const floor = calc.tunable(tunables, 'contracts.ask.sizeFloor');
  const grown = startCalc('Grown with reach', reach, {
    unit: 'ratio',
    docRef: ASKING_TERMS_DOC_REF,
    startLabel: `Reach ${wholeText(reach)}`,
  });
  grown.divide('Reach for full rates', grown.tunable(tunables, 'contracts.ask.sizeFullReach'));
  grown.min('Full rates at most', 1);
  grown.multiply(
    'Share that grows with reach',
    startCalc('Share that grows with reach', 1, {
      unit: 'ratio',
      docRef: ASKING_TERMS_DOC_REF,
      startLabel: 'All of it',
    })
      .subtract('Indie floor', floor)
      .done(),
  );
  calc.add('Indie floor', floor);
  return calc.add('Grown with reach', grown.done()).done();
}
