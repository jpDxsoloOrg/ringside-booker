/**
 * Builder for aftermath rows (MTCH3-03).
 *
 * Default row: person `per_0000000001` won segment `seg_0000000001` on show `evi_0000000001` of
 * `pro_0000000001`, held in `reg_0000000001` on `TEST_START_DATE`. Popularity went from 40 to 41 in
 * that region; there is no momentum (no contract). The trace ids are the ones the applier would
 * record for that segment and person.
 */

import type { Aftermath } from '../../../src/model/entities/aftermath';
import { AftermathSchema } from '../../../src/model/entities/aftermath';
import { TestIds, testId, type TestIdSequence } from '../ids';
import { buildRow, TEST_START_DATE, type DeepPartial } from './build-row';

export function anAftermath(
  overrides: DeepPartial<Aftermath> = {},
  sequence: TestIdSequence = TestIds,
): Aftermath {
  const segmentId = overrides.segmentId ?? testId('segment');
  const personId = overrides.personId ?? testId('person');
  const regionId = overrides.showRegionId ?? testId('region');
  const defaults: Aftermath = {
    id: overrides.id ?? sequence.id('aftermath'),
    segmentId,
    eventInstanceId: testId('eventInstance'),
    promotionId: testId('promotion'),
    personId,
    date: TEST_START_DATE,
    outcome: 'win',
    showRegionId: regionId,
    popularity: { delta: 1, byRegion: { [regionId]: { before: 40, after: 41 } } },
    momentum: null,
    traceIds: {
      popularity: `match.popularityGain:${segmentId}/${personId}`,
      momentum: null,
    },
  };
  return buildRow(AftermathSchema, 'anAftermath', defaults, overrides);
}
