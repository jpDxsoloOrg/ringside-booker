/**
 * Popularity ceiling: how popular a promotion can stay in any region, given how much it spends on
 * marketing and back office.
 *
 * Design: docs/design/production.md#popularity-ceiling. ceiling = `production.popularityCeiling.base`
 * + marketing level × `perMarketingLevel` + back office level × `perBackOfficeLevel`, kept within
 * 0..100. Not rounded.
 */

import { startCalc } from '../../../core/trace/calc';
import type { Traced } from '../../../core/trace/types';
import type { EngineTunables } from '../../tunables';
import { assertProductionLevel, POPULARITY_CEILING_DOC_REF } from './shared';

export interface PopularityCeilingInputs {
  promotionName: string;
  /** Marketing level, 0..10. */
  marketing: number;
  /** Back office level, 0..10. */
  backOffice: number;
}

/** The highest popularity the promotion can hold in a region (unit `points`, 0..100). */
export function popularityCeiling(
  inputs: PopularityCeilingInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  assertProductionLevel('popularityCeiling', 'marketing', inputs.marketing);
  assertProductionLevel('popularityCeiling', 'backOffice', inputs.backOffice);
  const base = deps.tunables.get('production.popularityCeiling.base');
  const calc = startCalc(`${inputs.promotionName} popularity ceiling`, base, {
    unit: 'points',
    docRef: POPULARITY_CEILING_DOC_REF,
    startLabel: 'Base ceiling',
  });
  const perMarketing = calc.tunable(
    deps.tunables,
    'production.popularityCeiling.perMarketingLevel',
  );
  calc.add(
    `Marketing (level ${String(inputs.marketing)} × ${String(perMarketing)})`,
    inputs.marketing * perMarketing,
  );
  const perBackOffice = calc.tunable(
    deps.tunables,
    'production.popularityCeiling.perBackOfficeLevel',
  );
  calc.add(
    `Back office (level ${String(inputs.backOffice)} × ${String(perBackOffice)})`,
    inputs.backOffice * perBackOffice,
  );
  return calc.clamp(0, 100, 'Popularity runs 0 to 100').done();
}
