// Deal verdict (ECO8-03): the named checks, in order, every failing one listed, and every refusal
// code reachable on a built world through `dealValuation`.
// Design: docs/design/broadcast.md#valuation
import { describe, expect, it } from 'vitest';
import { addDays } from '../../../../src/core/date';
import type { RegionId } from '../../../../src/core/ids';
import { findTraceNodes, inputOf } from '../../../../src/core/trace';
import type { DealTimeslot } from '../../../../src/model/entities/deal';
import type { EventImportance } from '../../../../src/model/entities/event-definition';
import type { Promotion } from '../../../../src/model/entities/promotion';
import {
  DEAL_REFUSAL_CODES,
  dealValuation,
  dealVerdict,
  type DealCheckInputs,
  type DealRefusalCode,
  type DealValuation,
} from '../../../../src/systems/broadcast';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import { TEST_START_DATE, type DeepPartial } from '../../../support/builders/build-row';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';
import {
  worldBuilder,
  type BuiltWorld,
  type NetworkPlan,
  type PromotionBuilder,
} from '../../../support/world-builder';

const DEFAULTS = createEngineTunables();

function checkInputs(overrides: Partial<DealCheckInputs> = {}): DealCheckInputs {
  return {
    networkName: 'Test TV',
    kind: 'tv',
    reachTier: 2,
    showName: 'Test Weekly',
    importance: 'regular',
    timeslot: 'evening',
    networkOnAir: true,
    inMarket: true,
    alreadyOnNetwork: false,
    overlapNetworkName: null,
    slotTakenBy: null,
    reach: null,
    camera: 4,
    projected: 50_000,
    ratio: inputOf('Ratio', 1.2, undefined, 'ratio'),
    months: 24,
    cameraCanBeRaised: true,
    ...overrides,
  };
}

describe('dealVerdict', () => {
  it('accepts when every check passes, with one rule per check in order', () => {
    const verdict = dealVerdict(checkInputs(), { tunables: DEFAULTS });
    expect(verdict.value).toBe('accept');
    expect(verdict.refusals).toEqual([]);
    const rules = findTraceNodes(verdict.trace, 'branch');
    expect(rules).toHaveLength(DEAL_REFUSAL_CODES.length);
    expect(rules.every((rule) => rule.taken)).toBe(true);
    expectSerialisable(verdict);
  });

  it('accepts a ratio exactly at minBenchmarkRatio and refuses just below it', () => {
    const at = dealVerdict(checkInputs({ ratio: inputOf('Ratio', 0.85) }), { tunables: DEFAULTS });
    expect(at.value).toBe('accept');
    const below = dealVerdict(checkInputs({ ratio: inputOf('Ratio', 0.8499) }), {
      tunables: DEFAULTS,
    });
    expect(below.value).toBe('refuse');
    expect(below.refusals).toEqual([
      {
        code: 'audienceTooSmall',
        message: 'Your audience would be about 85% of what Test TV needs (85%)',
      },
    ]);
  });

  it('says "less than 1%" for a tiny audience', () => {
    const tiny = dealVerdict(checkInputs({ ratio: inputOf('Ratio', 0.004) }), {
      tunables: DEFAULTS,
    });
    expect(tiny.refusals[0]?.message).toBe(
      'Your audience would be less than 1% of what Test TV needs (85%)',
    );
  });

  it('lists every failing check in order, and refuses with the first', () => {
    const verdict = dealVerdict(
      checkInputs({
        importance: 'house',
        camera: 1,
        projected: 10,
        ratio: inputOf('Ratio', 0.01),
        months: 3,
      }),
      { tunables: DEFAULTS },
    );
    expect(verdict.value).toBe('refuse');
    expect(verdict.refusals.map((refusal) => refusal.code)).toEqual([
      'houseShow',
      'cameraTooLow',
      'belowFloor',
      'audienceTooSmall',
      'badLength',
    ]);
    expect(verdict.refusals.map((refusal) => refusal.message)).toEqual([
      "House shows aren't televised",
      'Test TV needs camera level 2; yours is 1. Raise your camera level (Production)',
      'Fewer than 1,000 viewers is too small for TV',
      'Your audience would be about 1% of what Test TV needs (85%)',
      'A deal runs 6 to 48 months; 3 months is outside that',
    ]);
    if (verdict.trace.kind !== 'decision') throw new Error('not a decision');
    expect(verdict.trace.reason).toBe("House shows aren't televised");
    const failed = findTraceNodes(verdict.trace, 'branch').filter((rule) => !rule.taken);
    expect(failed).toHaveLength(5);
  });

  it('leaves the Production hint out when the camera cannot be raised in game', () => {
    const verdict = dealVerdict(checkInputs({ camera: 0, cameraCanBeRaised: false }), {
      tunables: DEFAULTS,
    });
    expect(verdict.refusals[0]?.message).toBe('Test TV needs camera level 2; yours is 0');
  });

  it('asks for the reach only in prime time on TV and streaming', () => {
    const reach = inputOf('Reach', 9.4, undefined, 'points');
    const prime = dealVerdict(checkInputs({ timeslot: 'primeTime', reach }), {
      tunables: DEFAULTS,
    });
    expect(prime.refusals).toEqual([
      { code: 'timeslotNotAllowed', message: 'Prime time needs a reach of 25.0; yours is 9.4' },
    ]);
    const ppv = dealVerdict(
      checkInputs({ kind: 'ppv', importance: 'major', timeslot: 'primeTime', reach: null }),
      { tunables: DEFAULTS },
    );
    expect(ppv.value).toBe('accept');
  });

  it('uses the floor for the network kind, in buys for pay-per-view', () => {
    const ppv = dealVerdict(checkInputs({ kind: 'ppv', importance: 'major', projected: 299 }), {
      tunables: DEFAULTS,
    });
    expect(ppv.refusals).toEqual([
      { code: 'belowFloor', message: 'Fewer than 300 buys is too small for pay-per-view' },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Every refusal code on a built world

const REGION_IDS: readonly RegionId[] = worldBuilder()
  .withGeography('mini')
  .build()
  .world.tables.regions.ids();

function regionAt(index: number): RegionId {
  const id = REGION_IDS[index];
  if (id === undefined) throw new Error(`no region ${String(index)}`);
  return id;
}

/** Popularity 60 in every region of the mini map. */
const POPULAR_EVERYWHERE: Record<string, number> = Object.fromEntries(
  REGION_IDS.map((id) => [id, 60]),
);

interface Scenario {
  readonly networks?: readonly NetworkPlan[];
  readonly promotion?: DeepPartial<Promotion>;
  readonly deals?: (promotion: PromotionBuilder) => unknown;
  /** A rival promotion's deals on the networks. */
  readonly rivalDeals?: (promotion: PromotionBuilder) => unknown;
}

const LOCAL_TV: NetworkPlan = { name: 'Local TV', kind: 'tv', reachTier: 0 };

/**
 * Promotion A (popular everywhere, camera 4) with a regular Monday show, a major Sunday show and a
 * house show; one local TV channel covering the whole map unless the scenario names networks.
 */
function scenarioWorld(scenario: Scenario = {}): BuiltWorld {
  let builder = worldBuilder().withGeography('mini');
  for (const network of scenario.networks ?? [LOCAL_TV]) {
    builder = builder.withNetwork(network);
  }
  builder = builder.withPromotion(
    {
      regionalPop: POPULAR_EVERYWHERE,
      production: { camera: 4, marketing: 4 },
      ...scenario.promotion,
    },
    (promotion) => {
      promotion
        .withWeeklyShow({ name: 'Test Weekly', weekdays: [0] })
        .withWeeklyShow({ name: 'Test Big Show', weekdays: [6] }, { importance: 'major' })
        .withWeeklyShow(
          { name: 'Test House Show', weekdays: [1] },
          { importance: 'house', televised: false },
        );
      scenario.deals?.(promotion);
    },
  );
  if (scenario.rivalDeals !== undefined) {
    const rivalDeals = scenario.rivalDeals;
    builder = builder.withPromotion({ regionalPop: POPULAR_EVERYWHERE }, (promotion) => {
      promotion.withWeeklyShow({ name: 'Rival Monday', weekdays: [0] });
      rivalDeals(promotion);
    });
  }
  return builder.build();
}

interface ValueOptions {
  readonly show?: string | null;
  readonly network?: number;
  readonly timeslot?: DealTimeslot;
  readonly months?: number;
  readonly tunables?: EngineTunables;
}

function value(built: BuiltWorld, options: ValueOptions = {}): DealValuation {
  const { world, ids } = built;
  const promotionId = ids.promotions.A;
  const networkId = ids.networks[options.network ?? 0];
  if (promotionId === undefined || networkId === undefined) throw new Error('setup');
  const showName = options.show === undefined ? 'Test Weekly' : options.show;
  const definition =
    showName === null
      ? null
      : world.tables.eventDefinitions.values().find((row) => row.name === showName);
  if (definition === undefined) throw new Error(`no show ${String(showName)}`);
  const valuation = dealValuation(world, options.tunables ?? DEFAULTS, {
    promotionId,
    networkId,
    eventDefinitionId: definition?.id ?? null,
    timeslot: options.timeslot ?? 'evening',
    live: false,
    months: options.months ?? 24,
  });
  for (const amount of [
    valuation.projectedViewers,
    valuation.benchmark,
    valuation.ratio,
    valuation.terms.feePerShow,
    valuation.terms.perThousandViewers,
    valuation.terms.costPerShow,
    valuation.incomePerAiring,
  ]) {
    expectTraceReplays(amount);
  }
  expectSerialisable(valuation);
  return valuation;
}

function codes(valuation: DealValuation): DealRefusalCode[] {
  return valuation.refusals.map((refusal) => refusal.code);
}

const scenarios: Record<DealRefusalCode, () => DealValuation> = {
  networkClosed: () =>
    value(
      scenarioWorld({
        networks: [
          {
            ...LOCAL_TV,
            overrides: { status: 'closed', closedOn: addDays(TEST_START_DATE, -1) },
          },
        ],
      }),
    ),
  outsideMarket: () =>
    value(
      scenarioWorld({
        networks: [{ ...LOCAL_TV, coverage: { regionIds: [regionAt(3)] } }],
        promotion: { homeRegionId: regionAt(0), regionalPop: { [regionAt(0)]: 60 } },
      }),
    ),
  houseShow: () => value(scenarioWorld(), { show: 'Test House Show' }),
  notPpvShow: () =>
    value(scenarioWorld({ networks: [{ name: 'Test PPV', kind: 'ppv', reachTier: 0 }] })),
  alreadyOnNetwork: () =>
    value(
      scenarioWorld({
        deals: (promotion) => promotion.withDeal({ network: 0, show: 'Test Weekly' }),
      }),
    ),
  coverageOverlap: () =>
    value(
      scenarioWorld({
        networks: [LOCAL_TV, { name: 'Other TV', kind: 'tv', reachTier: 0 }],
        deals: (promotion) => promotion.withDeal({ network: 1, show: 'Test Weekly' }),
      }),
    ),
  slotTaken: () =>
    value(
      scenarioWorld({
        rivalDeals: (promotion) =>
          promotion.withDeal({
            network: 0,
            show: 'Rival Monday',
            timeslot: 'evening',
            weekday: 0,
          }),
      }),
    ),
  timeslotNotAllowed: () =>
    value(scenarioWorld(), {
      timeslot: 'primeTime',
      tunables: createEngineTunables({ 'broadcast.deal.primeTimeMinReach': 100 }),
    }),
  cameraTooLow: () =>
    value(
      scenarioWorld({
        networks: [{ ...LOCAL_TV, reachTier: 2 }],
        promotion: { production: { camera: 1 } },
      }),
    ),
  belowFloor: () =>
    value(scenarioWorld(), {
      tunables: createEngineTunables({ 'broadcast.deal.minViewers.tv': 1_000_000 }),
    }),
  audienceTooSmall: () =>
    value(
      scenarioWorld({
        networks: [{ name: 'Big TV', kind: 'tv', reachTier: 4 }],
        promotion: { regionalPop: Object.fromEntries(REGION_IDS.map((id) => [id, 20])) },
      }),
      {
        tunables: createEngineTunables({ 'broadcast.deal.cameraPerTier': 0 }),
      },
    ),
  badLength: () => value(scenarioWorld(), { months: 60 }),
};

describe('dealValuation reaches every refusal code', () => {
  it('accepts the base scenario', () => {
    const valuation = value(scenarioWorld());
    expect(valuation.verdict).toBe('accept');
    expect(valuation.refusals).toEqual([]);
  });

  it.each(DEAL_REFUSAL_CODES.map((code) => [code] as const))('refuses with %s', (code) => {
    const valuation = scenarios[code]();
    expect(valuation.verdict).toBe('refuse');
    expect(codes(valuation)).toContain(code);
  });

  it('values a house show at nobody watching without throwing', () => {
    const valuation = value(scenarioWorld(), { show: 'Test House Show' });
    expect(valuation.projectedViewers.value).toBe(0);
    expect(valuation.benchmark.value).toBe(0);
    expect(valuation.importance satisfies EventImportance).toBe('house');
  });

  it('values a promotion-wide pay-per-view deal as a major show', () => {
    const valuation = value(
      scenarioWorld({ networks: [{ name: 'Test PPV', kind: 'ppv', reachTier: 0 }] }),
      { show: null },
    );
    expect(valuation.importance).toBe('major');
    expect(valuation.weekday).toBeNull();
    expect(valuation.terms.feePerShow.value).toBe(0);
  });
});
