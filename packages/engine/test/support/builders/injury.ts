/**
 * Builder for injury rows (WRK6-03).
 *
 * Default row: person `per_0000000001` hurt their arms off screen (`injury.test-arm`, a moderate
 * injury from `TEST_INJURY_CATALOG`) on `TEST_START_DATE`, out for 14 days and still injured,
 * cannot work angles, lost 2 condition points, and their promotion noticed on the day.
 */

import { addDays } from '../../../src/core/date';
import { parseContentKey } from '../../../src/core/content-key';
import { InjuryRecordSchema, type InjuryRecord } from '../../../src/model/entities/injury';
import { TestIds, testId, type TestIdSequence } from '../ids';
import { buildRow, TEST_START_DATE, type DeepPartial } from './build-row';

/** How long the default injury keeps someone out. */
export const TEST_INJURY_DAYS = 14;

export function anInjury(
  overrides: DeepPartial<InjuryRecord> = {},
  sequence: TestIdSequence = TestIds,
): InjuryRecord {
  const since = overrides.since ?? TEST_START_DATE;
  const defaults: InjuryRecord = {
    id: overrides.id ?? sequence.id('injury'),
    personId: testId('person'),
    kindKey: parseContentKey('injury.test-arm'),
    bodyPart: 'arms',
    severity: 'moderate',
    since,
    expectedReturn: addDays(since, TEST_INJURY_DAYS),
    returnedOn: null,
    source: 'world',
    segmentId: null,
    canWorkAngles: false,
    conditionLoss: 2,
    noticedOn: since,
  };
  return buildRow(InjuryRecordSchema, 'anInjury', defaults, overrides);
}
