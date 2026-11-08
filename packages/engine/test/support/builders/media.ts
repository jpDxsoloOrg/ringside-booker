/**
 * Builders for networks and TV deals.
 *
 * References default to the first row of each kind. Defaults:
 *
 * - network `Test Network 001`: an active regional TV channel (reach tier 1) covering
 *   `reg_0000000001`, launched on `TEST_FOUNDING_DATE`, owned by nobody;
 * - deal: an active one-year prime-time deal between `net_0000000001` and `pro_0000000001` for
 *   every televised show, offered and started on `TEST_START_DATE`, aired live, paying 1,000 a
 *   show plus 5 per thousand viewers.
 */

import { addYears } from '../../../src/core/date';
import { cents } from '../../../src/core/money';
import { DealSchema, type Deal } from '../../../src/model/entities/deal';
import { NetworkSchema, type Network } from '../../../src/model/entities/network';
import { TestIds, testId, type TestIdSequence } from '../ids';
import {
  buildRow,
  placeholderName,
  TEST_FOUNDING_DATE,
  TEST_START_DATE,
  type DeepPartial,
} from './build-row';

export function aNetwork(
  overrides: DeepPartial<Network> = {},
  sequence: TestIdSequence = TestIds,
): Network {
  const defaults: Network = {
    id: overrides.id ?? sequence.id('network'),
    name: overrides.name ?? placeholderName('Network', sequence.nextNumber('network')),
    kind: 'tv',
    reachTier: 1,
    coverage: { continentIds: [], countryIds: [], regionIds: [testId('region')] },
    ownerPromotionId: null,
    status: 'active',
    launchedOn: TEST_FOUNDING_DATE,
    closedOn: null,
    logoRef: null,
  };
  return buildRow(NetworkSchema, 'aNetwork', defaults, overrides);
}

export function aDeal(overrides: DeepPartial<Deal> = {}, sequence: TestIdSequence = TestIds): Deal {
  const startsOn = overrides.startsOn ?? TEST_START_DATE;
  const defaults: Deal = {
    id: overrides.id ?? sequence.id('deal'),
    networkId: testId('network'),
    promotionId: testId('promotion'),
    eventDefinitionId: null,
    status: 'active',
    offeredOn: startsOn,
    startsOn,
    endsOn: addYears(startsOn, 1),
    timeslot: 'primeTime',
    weekday: null,
    live: true,
    terms: { feePerShow: cents(100_000), perThousandViewers: cents(500), costPerShow: cents(0) },
  };
  return buildRow(DealSchema, 'aDeal', defaults, overrides);
}
