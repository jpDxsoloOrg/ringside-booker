/**
 * Builders for networks and TV deals.
 *
 * References default to the first row of each kind. Defaults:
 *
 * - network `Test Network 001`: an active regional TV channel (reach tier 1) covering
 *   `reg_0000000001`, launched on `TEST_FOUNDING_DATE`, owned by nobody;
 * - deal: an active one-year prime-time deal between `net_0000000001` and `pro_0000000001` for
 *   every televised show, offered and started on `TEST_START_DATE`, aired live, paying 1,000 a
 *   show plus 5 per thousand viewers, not ended, never renegotiated or warned;
 * - airing (ECO8-01): `deal_0000000001` on `net_0000000001` for `pro_0000000001`, aired from a
 *   definition date (no dated show) on `TEST_START_DATE`, a neutral 50 quality, 100,000 viewers
 *   against 100,000 expected, paying 1,500 with no shares or airtime cost and no trace.
 */

import { addYears } from '../../../src/core/date';
import { cents } from '../../../src/core/money';
import { AiringSchema, type Airing } from '../../../src/model/entities/airing';
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
    endedOn: null,
    endedReason: null,
    renegotiatedOn: null,
    warnedOn: null,
  };
  return buildRow(DealSchema, 'aDeal', defaults, overrides);
}

export function anAiring(
  overrides: DeepPartial<Airing> = {},
  sequence: TestIdSequence = TestIds,
): Airing {
  const defaults: Airing = {
    id: overrides.id ?? sequence.id('airing'),
    dealId: testId('deal'),
    networkId: testId('network'),
    promotionId: testId('promotion'),
    eventInstanceId: null,
    eventDefinitionId: null,
    showName: placeholderName('Show', sequence.nextNumber('airing')),
    airDate: TEST_START_DATE,
    status: 'aired',
    missReason: null,
    quality: { score: 50, source: 'neutral' },
    viewers: 100_000,
    expectedViewers: 100_000,
    income: cents(150_000),
    sharesPaid: cents(0),
    cost: cents(0),
    traceRef: null,
  };
  return buildRow(AiringSchema, 'anAiring', defaults, overrides);
}
