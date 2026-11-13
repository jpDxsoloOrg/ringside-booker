/**
 * Builder for per-show popularity records (EVT5-02).
 *
 * Default record: show `evi_0000000001` of `pro_0000000001` on `TEST_START_DATE`, scoring 60, that
 * reached only its own region `reg_0000000001` and raised popularity there from 20 to 21. Give
 * `regions` to replace the reached regions whole (they are not merged with the default one).
 */

import {
  PopularityShowChangeSchema,
  type PopularityShowChange,
} from '../../../src/model/entities/popularity-show-change';
import { TestIds, testId, type TestIdSequence } from '../ids';
import { buildRow, TEST_START_DATE, type DeepPartial } from './build-row';

export function aPopularityShowChange(
  overrides: DeepPartial<PopularityShowChange> = {},
  sequence: TestIdSequence = TestIds,
): PopularityShowChange {
  const defaults: PopularityShowChange = {
    id: overrides.id ?? sequence.id('popularityShowChange'),
    eventInstanceId: testId('eventInstance'),
    promotionId: testId('promotion'),
    date: TEST_START_DATE,
    score: 60,
    worldBefore: 5,
    worldAfter: 5.2,
    regions:
      overrides.regions === undefined
        ? {
            [testId('region')]: {
              source: 'show',
              networkId: null,
              weight: 1,
              expectation: 50,
              before: 20,
              after: 21,
              capped: false,
            },
          }
        : {},
  };
  return buildRow(PopularityShowChangeSchema, 'aPopularityShowChange', defaults, overrides);
}
