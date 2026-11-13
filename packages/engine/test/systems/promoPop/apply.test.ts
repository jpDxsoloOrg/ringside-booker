// Applying a completed show to its promotion's popularity (EVT5-02).
// Design: docs/design/promotion-popularity.md#after-every-show
import { describe, expect, it } from 'vitest';
import { defineSubscription, defineSystem } from '../../../src/core/api/system';
import { yearMonthOf } from '../../../src/core/date';
import { definePhase } from '../../../src/core/pipeline/phase';
import { defaultSystems } from '../../../src/systems';
import type { EventInstanceId, NetworkId } from '../../../src/core/ids';
import {
  countTraceNodes,
  TRACE_MAX_DEPTH,
  TRACE_MAX_NODES,
  traceDepth,
} from '../../../src/core/trace';
import {
  applyShowPopularity,
  dealsInForce,
  promoPopSystem,
  reachInputsFor,
  RIVAL_SHOW_CHANGE_TRACE_KIND,
  SHOW_CHANGE_TRACE_KIND,
  showChangeTraceRef,
} from '../../../src/systems/promoPop';
import { geographyOf } from '../../../src/systems/world/geography';
import type { DeepPartial } from '../../support/builders/build-row';
import { anEventDefinition } from '../../support/builders/creative';
import { aDeal, aNetwork } from '../../support/builders/media';
import { testId } from '../../support/ids';
import { expectSerialisable } from '../../support/trace';
import type { Deal } from '../../../src/model/entities/deal';
import {
  baseWorld,
  completedShow,
  day,
  NORTH_1,
  NORTH_2,
  runShows,
  SOUTH,
  SOUTH_1,
  SOUTH_2,
} from './show-world';

const PROMOTION_A = testId('promotion', 1);
const PROMOTION_B = testId('promotion', 2);
const SHOW_DAY = '2026-01-05';

/** The changes the formulas give on the default tunables, worked by hand. */
// North 1: popularity 20, prestige 20, regular show: expected 20 × 0.6 + 20 × 0.2 = 16. A score of
// 60 is a blowout: 3 × (1 − 0.2)^1.5 = 2.1466, stored as 22.15.
const NORTH_1_AFTER_BLOWOUT = 22.15;
// North 2: no popularity, expected 4; a blowout at neighbour weight 0.5 gives 1.5.
const NORTH_2_AFTER_BLOWOUT = 1.5;

/** One show of A in North 1 on the start date; returns its id through `capture`. */
function oneShow(score: number, extra: DeepPartial<Parameters<typeof completedShow>[1]> = {}) {
  const captured: { id: EventInstanceId | null } = { id: null };
  const builder = baseWorld().with('show', (context) => {
    captured.id = completedShow(context, { ...extra, score, date: SHOW_DAY });
  });
  return { builder, showId: () => captured.id ?? expect.fail('the show was not built') };
}

describe('applyShowPopularity: reach', () => {
  it('moves an untelevised show only in its region and the neighbour, with one door call and one event', async () => {
    const { builder, showId } = oneShow(60);
    const run = await runShows(builder);

    expect(run.promotion(PROMOTION_A).regionalPop).toEqual({
      [NORTH_1]: NORTH_1_AFTER_BLOWOUT,
      [NORTH_2]: NORTH_2_AFTER_BLOWOUT,
    });
    expect(run.events.map((event) => event.type)).toEqual([
      'popularity.changed',
      'showPopularity.changed',
    ]);
    expect(run.events[0]?.payload).toMatchObject({
      subjectKind: 'promotion',
      subjectId: PROMOTION_A,
      regionsChanged: 2,
      source: 'system',
      reasonKey: 'show.result',
    });
    const record = run.tables.popularityShowChanges[0];
    expect(run.tables.popularityShowChanges).toHaveLength(1);
    expect(record).toMatchObject({
      eventInstanceId: showId(),
      promotionId: PROMOTION_A,
      date: day(SHOW_DAY),
      score: 60,
      regions: {
        [NORTH_1]: {
          source: 'show',
          networkId: null,
          weight: 1,
          expectation: 16,
          before: 20,
          after: NORTH_1_AFTER_BLOWOUT,
          capped: false,
        },
        [NORTH_2]: {
          source: 'neighbour',
          networkId: null,
          weight: 0.5,
          expectation: 4,
          before: 0,
          after: NORTH_2_AFTER_BLOWOUT,
          capped: false,
        },
      },
    });
    expect(Object.keys(record?.regions ?? {})).toHaveLength(2);
    const payload = run.events[1]?.payload;
    expectSerialisable(payload);
    expect(payload).toEqual({
      eventInstanceId: showId(),
      promotionId: PROMOTION_A,
      worldBefore: record?.worldBefore,
      worldAfter: record?.worldAfter,
      regionsGained: 2,
      regionsLost: 0,
      regionsCapped: 0,
    });
    expect(record?.worldAfter).toBeGreaterThan(record?.worldBefore ?? Infinity);
    expect(run.promotion(PROMOTION_A).popularityGains).toEqual({
      month: '2026-01',
      byRegion: { [NORTH_1]: 2.15, [NORTH_2]: 1.5 },
    });
  });

  it('reaches the regions of a TV deal in force at the network tier weight', async () => {
    let networkId = null as NetworkId | null;
    const builder = baseWorld().with('televised show', (context) => {
      const promotionId = context.ids.promotions.A ?? expect.fail('no promotion');
      const definition = context.insert(
        'eventDefinitions',
        anEventDefinition({ promotionId, televised: true }, context.sequence),
      );
      const network = context.insert(
        'networks',
        aNetwork(
          {
            name: 'Southern Signal',
            reachTier: 2,
            coverage: { continentIds: [], countryIds: [SOUTH], regionIds: [] },
          },
          context.sequence,
        ),
      );
      networkId = network.id;
      context.insert(
        'deals',
        aDeal(
          { networkId: network.id, promotionId, eventDefinitionId: definition.id },
          context.sequence,
        ),
      );
      completedShow(context, { score: 60, date: SHOW_DAY, eventDefinitionId: definition.id });
    });
    const run = await runShows(builder);

    // South: nobody knows A, expected 4, a blowout at tier 2's weight 0.3 gives 0.9.
    expect(run.promotion(PROMOTION_A).regionalPop).toEqual({
      [NORTH_1]: NORTH_1_AFTER_BLOWOUT,
      [NORTH_2]: NORTH_2_AFTER_BLOWOUT,
      [SOUTH_1]: 0.9,
      [SOUTH_2]: 0.9,
    });
    const regions = run.tables.popularityShowChanges[0]?.regions ?? {};
    expect(regions[SOUTH_1]).toMatchObject({ source: 'tv', networkId, weight: 0.3 });
    expect(regions[SOUTH_2]).toMatchObject({ source: 'tv', networkId, weight: 0.3 });
  });
});

describe('dealsInForce and reachInputsFor', () => {
  /** Which definition the deal is for: the show's, another one, or every televised show. */
  type DealTarget = 'show' | 'other' | 'all';
  type DealCase = [string, DealTarget, DeepPartial<Deal>, boolean, number];
  const cases: DealCase[] = [
    ['an active deal for the show', 'show', {}, true, 1],
    ['an expired deal', 'show', { status: 'expired' }, true, 0],
    ['a cancelled deal', 'show', { status: 'cancelled' }, true, 0],
    ['a deal that has not started', 'show', { startsOn: day('2026-02-01') }, true, 0],
    [
      'a deal that ended on the show day',
      'show',
      { startsOn: day('2025-01-05'), endsOn: day(SHOW_DAY) },
      true,
      0,
    ],
    ['a deal for another show', 'other', {}, true, 0],
    ['a promotion-wide deal, televised show', 'all', {}, true, 1],
    ['a promotion-wide deal, untelevised show', 'all', {}, false, 0],
  ];

  it.each(cases)('%s', (_label, target, dealOverrides, televised, expected) => {
    let showId = null as EventInstanceId | null;
    const { world } = baseWorld()
      .with('deal', (context) => {
        const promotionId = context.ids.promotions.A ?? expect.fail('no promotion');
        const definition = context.insert(
          'eventDefinitions',
          anEventDefinition({ promotionId, televised }, context.sequence),
        );
        const other = context.insert(
          'eventDefinitions',
          anEventDefinition({ promotionId }, context.sequence),
        );
        const network = context.insert(
          'networks',
          aNetwork(
            { reachTier: 4, coverage: { continentIds: [], countryIds: [SOUTH], regionIds: [] } },
            context.sequence,
          ),
        );
        const startsOn = dealOverrides.startsOn ?? day('2026-01-01');
        const eventDefinitionId =
          target === 'show' ? definition.id : target === 'other' ? other.id : null;
        context.insert(
          'deals',
          aDeal(
            {
              ...dealOverrides,
              networkId: network.id,
              promotionId,
              eventDefinitionId,
              offeredOn: startsOn,
              startsOn,
            },
            context.sequence,
          ),
        );
        showId = completedShow(context, {
          score: 60,
          date: SHOW_DAY,
          eventDefinitionId: definition.id,
        });
      })
      .build();
    const show = world.tables.eventInstances.require(showId ?? expect.fail('no show'));
    expect(dealsInForce(world, show)).toHaveLength(expected);
    const inputs = reachInputsFor(world, show, geographyOf(world));
    expect(inputs.showRegion).toEqual({ id: NORTH_1, name: 'Test Region North 1' });
    expect(inputs.neighbours.map((region) => region.id)).toEqual([NORTH_2]);
    expect(inputs.deals.flatMap((deal) => deal.regions.map((region) => region.id))).toEqual(
      expected === 1 ? [SOUTH_1, SOUTH_2] : [],
    );
  });

  it('carries a taped show by the deals in force on its air date', () => {
    let showId = null as EventInstanceId | null;
    const { world } = baseWorld()
      .with('taped show', (context) => {
        const promotionId = context.ids.promotions.A ?? expect.fail('no promotion');
        const definition = context.insert(
          'eventDefinitions',
          anEventDefinition({ promotionId }, context.sequence),
        );
        const network = context.insert('networks', aNetwork({}, context.sequence));
        context.insert(
          'deals',
          aDeal(
            {
              networkId: network.id,
              promotionId,
              eventDefinitionId: definition.id,
              offeredOn: day('2026-01-10'),
              startsOn: day('2026-01-10'),
            },
            context.sequence,
          ),
        );
        showId = completedShow(context, {
          score: 60,
          date: SHOW_DAY,
          airDate: day('2026-01-12'),
          eventDefinitionId: definition.id,
        });
      })
      .build();
    const show = world.tables.eventInstances.require(showId ?? expect.fail('no show'));
    expect(dealsInForce(world, show)).toHaveLength(1);
  });

  it('carries a one-off show with no definition on no deal', () => {
    let showId = null as EventInstanceId | null;
    const { world } = baseWorld()
      .with('one-off', (context) => {
        const promotionId = context.ids.promotions.A ?? expect.fail('no promotion');
        const network = context.insert('networks', aNetwork({}, context.sequence));
        context.insert(
          'deals',
          aDeal({ networkId: network.id, promotionId, eventDefinitionId: null }, context.sequence),
        );
        showId = completedShow(context, { score: 60, date: SHOW_DAY });
      })
      .build();
    const show = world.tables.eventInstances.require(showId ?? expect.fail('no show'));
    expect(dealsInForce(world, show)).toEqual([]);
  });
});

describe('applyShowPopularity: the change', () => {
  it('lowers popularity after a weak show', async () => {
    // Popularity 60, prestige 50: expected 46. A score of 20 falls short by 26, a full 2.5 loss.
    const { builder } = oneShow(20);
    const run = await runShows(
      builder.with('popular', (context) => {
        const promotionId = context.ids.promotions.A ?? expect.fail('no promotion');
        context.tx.update('promotions', promotionId, {
          prestige: 50,
          regionalPop: { [NORTH_1]: 60 },
        });
      }),
      { overrides: { 'promoPop.neighbourReach': 0 } },
    );
    expect(run.promotion(PROMOTION_A).regionalPop[NORTH_1]).toBe(57.5);
    expect(run.events[1]?.payload).toMatchObject({ regionsGained: 0, regionsLost: 1 });
    expect(run.promotion(PROMOTION_A).popularityGains.byRegion).toEqual({});
  });

  it('writes nothing for a region inside the dead zone but lists it in the record', async () => {
    // North 1 expected 16 and the show scored 17: inside the dead zone. North 2 expected 4.
    const { builder } = oneShow(17);
    const run = await runShows(builder);
    const pop = run.promotion(PROMOTION_A).regionalPop;
    expect(pop[NORTH_1]).toBe(20);
    expect(pop[NORTH_2]).toBe(0.68);
    expect(run.tables.popularityShowChanges[0]?.regions[NORTH_1]).toMatchObject({
      before: 20,
      after: 20,
      capped: false,
    });
    expect(run.events[1]?.payload).toMatchObject({ regionsGained: 1, regionsLost: 0 });
  });

  it('records no door call and still a show event when nothing moves anywhere', async () => {
    const { builder } = oneShow(17);
    const run = await runShows(builder, { overrides: { 'promoPop.neighbourReach': 0 } });
    expect(run.promotion(PROMOTION_A).regionalPop).toEqual({ [NORTH_1]: 20 });
    expect(run.events.map((event) => event.type)).toEqual(['showPopularity.changed']);
    expect(run.tables.popularityShowChanges).toHaveLength(1);
  });

  it('removes a region driven to 0 from regionalPop', async () => {
    const { builder } = oneShow(0, { importance: 'flagship' });
    const run = await runShows(
      builder.with('small', (context) => {
        const promotionId = context.ids.promotions.A ?? expect.fail('no promotion');
        // Prestige 100 sets fans expecting about 21, so a score of 0 is a heavy loss.
        context.tx.update('promotions', promotionId, {
          prestige: 100,
          regionalPop: { [NORTH_1]: 1 },
        });
      }),
      { overrides: { 'promoPop.lossFullFrom': 0 } },
    );
    expect(run.promotion(PROMOTION_A).regionalPop).toEqual({});
    expect(run.tables.popularityShowChanges[0]?.regions[NORTH_1]).toMatchObject({
      before: 1,
      after: 0,
    });
  });
});

describe('applyShowPopularity: the monthly cap', () => {
  it('stops gains at the cap within a month and gains again the next month', async () => {
    const shows: EventInstanceId[] = [];
    const builder = baseWorld().with('shows', (context) => {
      for (const date of ['2026-01-06', '2026-01-13', '2026-01-20', '2026-02-03']) {
        shows.push(completedShow(context, { score: 100, date }));
      }
    });
    const run = await runShows(builder, { days: 31, overrides: { 'promoPop.neighbourReach': 0 } });
    // Record ids are minted at random, so put them in show order.
    const records = [...run.tables.popularityShowChanges].sort((left, right) =>
      left.date.localeCompare(right.date),
    );
    const north = records.map((record) => record.regions[NORTH_1]);
    // 20 → 22.15 (2.15 gained), then only 0.85 left of the 3-point cap, then nothing.
    expect(north.map((region) => region?.after)).toEqual([22.15, 23, 23, expect.any(Number)]);
    expect(north.map((region) => region?.capped)).toEqual([false, true, true, false]);
    expect(north[3]?.after).toBeGreaterThan(23);
    const gains = run.promotion(PROMOTION_A).popularityGains;
    expect(gains.month).toBe('2026-02');
    expect(Object.keys(gains.byRegion)).toEqual([NORTH_1]);
    expect(gains.byRegion[NORTH_1]).toBeCloseTo((north[3]?.after ?? 0) - 23, 9);
    expect(records.map((record) => record.eventInstanceId)).toEqual(shows);
  });

  it('never caps a loss', async () => {
    const builder = baseWorld().with('shows', (context) => {
      const promotionId = context.ids.promotions.A ?? expect.fail('no promotion');
      context.tx.update('promotions', promotionId, {
        regionalPop: { [NORTH_1]: 60 },
        prestige: 50,
        popularityGains: { month: yearMonthOf(day(SHOW_DAY)), byRegion: { [NORTH_1]: 3 } },
      });
      completedShow(context, { score: 0, date: SHOW_DAY });
    });
    const run = await runShows(builder, { overrides: { 'promoPop.neighbourReach': 0 } });
    expect(run.promotion(PROMOTION_A).regionalPop[NORTH_1]).toBe(57.5);
    expect(run.tables.popularityShowChanges[0]?.regions[NORTH_1]?.capped).toBe(false);
  });
});

describe('applyShowPopularity: once per show', () => {
  it('applies a show announced twice only once', async () => {
    const { builder } = oneShow(60);
    const run = await runShows(builder, { times: 2 });
    expect(run.tables.popularityShowChanges).toHaveLength(1);
    expect(run.promotion(PROMOTION_A).regionalPop[NORTH_1]).toBe(NORTH_1_AFTER_BLOWOUT);
    expect(run.events.map((event) => event.type)).toEqual([
      'popularity.changed',
      'showPopularity.changed',
    ]);
  });

  it.each([
    ['a show that is not completed', 'scheduled', 'the show is scheduled, not completed'],
    ['a show of a dormant promotion', 'dormant', 'its promotion is not active'],
  ] as const)('skips %s, says why and writes nothing', async (_label, setup, reason) => {
    let showId = null as EventInstanceId | null;
    const builder = baseWorld().with('show', (context) => {
      showId = completedShow(context, { score: 60, date: SHOW_DAY });
      if (setup === 'scheduled') {
        context.tx.update('eventInstances', showId, { status: 'scheduled', result: null });
      } else {
        context.tx.update('promotions', PROMOTION_A, { status: 'dormant' });
      }
    });
    const results: unknown[] = [];
    const direct = defineSystem({
      id: 'directApply',
      phases: [
        definePhase({
          id: 'directApply.run',
          group: 'settlement',
          order: 0,
          cadence: { kind: 'daily' },
          run: (ctx) => {
            results.push(applyShowPopularity(ctx, showId ?? expect.fail('no show')));
          },
        }),
      ],
    });
    const run = await runShows(builder, { systems: [direct] });
    expect(results).toEqual([{ applied: false, reason }]);
    expect(run.tables.popularityShowChanges).toEqual([]);
    expect(run.events).toEqual([]);
    expect(run.promotion(PROMOTION_A).regionalPop).toEqual({ [NORTH_1]: 20 });
  });
});

describe('applyShowPopularity: rival shows', () => {
  it('moves a computer promotion by the same amount as a human one, under the rival trace kind', async () => {
    const shows: EventInstanceId[] = [];
    const builder = baseWorld()
      .withPromotion({
        prestige: 20,
        regionalPop: { [NORTH_1]: 20 },
        controller: { kind: 'computer' },
      })
      .with('shows', (context) => {
        shows.push(completedShow(context, { score: 60, date: SHOW_DAY }, 'A'));
        shows.push(completedShow(context, { score: 60, date: SHOW_DAY }, 'B'));
      });
    const run = await runShows(builder);
    expect(run.promotion(PROMOTION_B).regionalPop).toEqual(run.promotion(PROMOTION_A).regionalPop);
    const [humanShow, rivalShow] = shows;
    if (humanShow === undefined || rivalShow === undefined) {
      expect.fail('two shows expected');
    }
    expect(run.trace(showChangeTraceRef(humanShow, NORTH_1, true))).not.toBeNull();
    expect(run.trace(showChangeTraceRef(rivalShow, NORTH_1, false))).not.toBeNull();
    expect(run.trace({ kind: SHOW_CHANGE_TRACE_KIND, id: `${rivalShow}/${NORTH_1}` })).toBeNull();
    expect(
      run.trace({ kind: RIVAL_SHOW_CHANGE_TRACE_KIND, id: `${humanShow}/${NORTH_1}` }),
    ).toBeNull();
  });
});

describe('applyShowPopularity: traces', () => {
  it('records one trace per reached region with reach and expectation nested, within the limits', async () => {
    const { builder, showId } = oneShow(60);
    const run = await runShows(builder);
    for (const regionId of [NORTH_1, NORTH_2]) {
      const stored = run.trace(showChangeTraceRef(showId(), regionId, true));
      if (stored === null) {
        expect.fail(`no trace for ${regionId}`);
      }
      expectSerialisable(stored);
      const labels = JSON.stringify(stored.trace);
      expect(labels).toContain('Reach in');
      expect(labels).toContain('Expected because of prestige');
      expect(countTraceNodes(stored.trace)).toBeLessThan(TRACE_MAX_NODES);
      // The deepest line (a tunable inside the expectation, inside the margin) sits exactly on the
      // limit, so nothing is cut.
      expect(traceDepth(stored.trace)).toBeLessThanOrEqual(TRACE_MAX_DEPTH);
      expect(labels).not.toContain('not shown');
    }
    expect(run.trace(showChangeTraceRef(showId(), SOUTH_1, true))).toBeNull();
  });
});

describe('applyShowPopularity: nothing else changes', () => {
  it('leaves morale, momentum, prestige, cash and people alone', async () => {
    const builder = baseWorld({}, (promotion) => promotion.withRoster(2)).with(
      'show',
      (context) => {
        completedShow(context, { score: 60, date: SHOW_DAY });
      },
    );
    const before = builder.build().world;
    const run = await runShows(builder);
    const promotionBefore = before.tables.promotions.require(PROMOTION_A);
    const promotionAfter = run.promotion(PROMOTION_A);
    expect(promotionAfter.regionalPop).not.toEqual(promotionBefore.regionalPop);
    expect(promotionAfter.prestige).toBe(promotionBefore.prestige);
    expect(promotionAfter.cash).toBe(promotionBefore.cash);
    expect(run.tables.employments).toHaveLength(2);
    expect(run.tables.employments).toEqual([...before.tables.employments.values()]);
    expect(run.tables.people).toEqual([...before.tables.people.values()]);
    expect(run.tables.ledgerEntries).toEqual([]);
  });
});

describe('applyShowPopularity: rollback', () => {
  it('rolls back popularity, the gain tally and the record together when the reaction fails', async () => {
    const { builder } = oneShow(60);
    const failing = defineSystem({
      id: 'failingPromoPop',
      subscriptions: [
        defineSubscription({
          id: 'failingPromoPop.apply',
          type: 'show.completed',
          handler: (event, ctx) => {
            applyShowPopularity(ctx, event.payload.eventInstanceId);
            throw new Error('forced failure after applying');
          },
        }),
      ],
    });
    const run = await runShows(builder, { systems: [failing] });
    expect(run.promotion(PROMOTION_A).regionalPop).toEqual({ [NORTH_1]: 20 });
    expect(run.promotion(PROMOTION_A).popularityGains.byRegion).toEqual({});
    expect(run.tables.popularityShowChanges).toEqual([]);
    expect(run.events).toEqual([]);
    expect(run.engine.exportState().failureLog.entries).toMatchObject([
      { stepId: 'reaction:failingPromoPop.apply' },
    ]);
  });

  it('reacts to show.completed in the default systems', () => {
    expect(defaultSystems).toContain(promoPopSystem);
    expect(
      promoPopSystem.subscriptions.map((subscription) => [subscription.id, subscription.type]),
    ).toEqual([['promoPop.applyAfterShow', 'show.completed']]);
  });
});
