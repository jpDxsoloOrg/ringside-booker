// `popularity.showChange`, the monthly prune and the partner helpers (EVT5-02).
// Design: docs/design/promotion-popularity.md#after-every-show
import { describe, expect, it } from 'vitest';
import { yearMonthOf } from '../../../src/core/date';
import type { EventInstanceId } from '../../../src/core/ids';
import {
  monthlyGainsOf,
  popularityBeforeShow,
  recentShowChanges,
  type ShowPopularityChangeView,
} from '../../../src/systems/promoPop';
import { anEventDefinition } from '../../support/builders/creative';
import { aDeal, aNetwork } from '../../support/builders/media';
import { aPopularityShowChange } from '../../support/builders/popularity';
import { testId } from '../../support/ids';
import { expectSerialisable } from '../../support/trace';
import {
  baseWorld,
  completedShow,
  day,
  NORTH,
  NORTH_1,
  NORTH_2,
  OMNISCIENT,
  runShows,
  SOUTH,
  SOUTH_1,
  SOUTH_2,
  type PromoPopRun,
} from './show-world';

const PROMOTION_A = testId('promotion', 1);
const SHOW_DAY = '2026-01-05';

function showChange(run: PromoPopRun, eventInstanceId: EventInstanceId): ShowPopularityChangeView {
  const result = run.engine.query('popularity.showChange', { eventInstanceId }, OMNISCIENT);
  if (!result.ok) {
    expect.fail(JSON.stringify(result.reasons));
  }
  expectSerialisable(result.data);
  return result.data;
}

/** A televised show of A in North 1, carried in Test Country South at tier 2 (weight 0.3). */
async function televisedRun(): Promise<{ run: PromoPopRun; showId: EventInstanceId }> {
  let showId = null as EventInstanceId | null;
  const builder = baseWorld().with('televised show', (context) => {
    const promotionId = context.ids.promotions.A ?? expect.fail('no promotion');
    const definition = context.insert(
      'eventDefinitions',
      anEventDefinition({ promotionId }, context.sequence),
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
    context.insert(
      'deals',
      aDeal(
        { networkId: network.id, promotionId, eventDefinitionId: definition.id },
        context.sequence,
      ),
    );
    showId = completedShow(context, {
      score: 60,
      date: SHOW_DAY,
      name: 'Test Weekly',
      eventDefinitionId: definition.id,
    });
  });
  const run = await runShows(builder);
  return { run, showId: showId ?? expect.fail('no show') };
}

describe('popularity.showChange: an applied show', () => {
  it('lists every reached region by country with before, after, source and a Why? link', async () => {
    const { run, showId } = await televisedRun();
    const view = showChange(run, showId);
    const record = run.tables.popularityShowChanges[0] ?? expect.fail('no record');

    expect(view).toMatchObject({
      eventInstanceId: showId,
      promotionId: PROMOTION_A,
      promotionName: run.promotion(PROMOTION_A).name,
      showName: 'Test Weekly',
      date: day(SHOW_DAY),
      score: 60,
      status: 'applied',
      summary: {
        regionsGained: 4,
        regionsLost: 0,
        regionsUnchanged: 0,
        regionsCapped: 0,
        world: { before: record.worldBefore, after: record.worldAfter },
      },
    });
    expect(view.countries.map((country) => country.countryId)).toEqual([NORTH, SOUTH]);
    const [north, south] = view.countries;
    expect(north?.regions.map((region) => [region.regionId, region.sourceLabel])).toEqual([
      [NORTH_1, 'Show region'],
      [NORTH_2, 'Neighbour of Test Region North 1'],
    ]);
    // Equal changes in the South: by name.
    expect(south?.regions.map((region) => [region.regionId, region.sourceLabel])).toEqual([
      [SOUTH_1, 'TV: Southern Signal'],
      [SOUTH_2, 'TV: Southern Signal'],
    ]);
    expect(north?.regions[0]).toMatchObject({
      name: 'Test Region North 1',
      source: 'show',
      weight: 1,
      expectation: 16,
      before: 20,
      after: 22.15,
      capped: false,
      traceRef: { kind: 'promoPop.showChange', id: `${showId}/${NORTH_1}` },
    });
    expect(north?.regions[0]?.change).toBeCloseTo(2.15, 9);
    expect(south?.regions[0]).toMatchObject({ source: 'tv', weight: 0.3, before: 0, after: 0.9 });
  });

  it('weights each country by its regions’ population, untouched regions counting 0', async () => {
    const { run, showId } = await televisedRun();
    const view = showChange(run, showId);
    const [north, south] = view.countries;
    // North: 1.8M at +2.15 and 1.2M at +1.5. South: 1.1M and 0.9M, both at +0.9.
    expect(north?.change).toBeCloseTo((1.8 * 2.15 + 1.2 * 1.5) / 3, 9);
    expect(south?.change).toBeCloseTo(0.9, 9);
    expect(north?.trace.label).toBe('Popularity change in Test Country North');
    // The world: both countries, by population (3M and 2M).
    expect(view.summary?.world.change).toBeCloseTo(
      ((1.8 * 2.15 + 1.2 * 1.5) / 3) * 0.6 + 0.9 * 0.4,
      9,
    );
    expect(view.summary?.world.change).toBeCloseTo(
      (view.summary?.world.after ?? 0) - (view.summary?.world.before ?? 0),
      9,
    );
  });

  it('answers another viewer the same way: promotion popularity is public', async () => {
    const { run, showId } = await televisedRun();
    const rival = run.engine.query(
      'popularity.showChange',
      { eventInstanceId: showId },
      { kind: 'controller', controller: { kind: 'computer' } },
    );
    expect(rival.ok && rival.data).toEqual(showChange(run, showId));
    const text = JSON.stringify(rival.ok ? rival.data : null);
    expect(text).not.toMatch(/cash|morale|cents/i);
  });
});

describe('popularity.showChange: shows without a record', () => {
  it('answers notCompleted for a show that has not run', async () => {
    let showId = null as EventInstanceId | null;
    const builder = baseWorld().with('scheduled', (context) => {
      showId = completedShow(context, { score: 60, date: '2026-02-01' });
      context.tx.update('eventInstances', showId, { status: 'scheduled', result: null });
    });
    const run = await runShows(builder);
    const view = showChange(run, showId ?? expect.fail('no show'));
    expect(view).toMatchObject({
      status: 'notCompleted',
      score: null,
      summary: null,
      countries: [],
    });
  });

  it('answers notApplied for a completed show whose promotion was not active', async () => {
    let showId = null as EventInstanceId | null;
    const builder = baseWorld().with('dormant', (context) => {
      showId = completedShow(context, { score: 60, date: SHOW_DAY });
      context.tx.update('promotions', PROMOTION_A, { status: 'dormant' });
    });
    const run = await runShows(builder);
    expect(showChange(run, showId ?? expect.fail('no show'))).toMatchObject({
      status: 'notApplied',
      score: 60,
      summary: null,
    });
  });

  it('refuses an unknown show', async () => {
    const run = await runShows(baseWorld());
    const result = run.engine.query(
      'popularity.showChange',
      { eventInstanceId: testId('eventInstance', 99) },
      OMNISCIENT,
    );
    expect(result).toMatchObject({ ok: false, reasons: [{ code: 'notFound' }] });
  });
});

describe('promoPop.pruneShowChanges', () => {
  it('deletes records older than keepShowChangesDays on the 1st and keeps the rest', async () => {
    const shows: EventInstanceId[] = [];
    const builder = baseWorld().with('shows', (context) => {
      for (const date of ['2026-01-06', '2026-01-28']) {
        shows.push(completedShow(context, { score: 60, date }));
      }
    });
    // On 1 February a 10-day window keeps shows from 22 January on.
    const run = await runShows(builder, {
      days: 28,
      overrides: { 'promoPop.keepShowChangesDays': 10 },
    });
    const [old, recent] = shows;
    if (old === undefined || recent === undefined) {
      expect.fail('two shows expected');
    }
    expect(run.tables.popularityShowChanges.map((row) => row.eventInstanceId)).toEqual([recent]);
    expect(showChange(run, old)).toMatchObject({ status: 'pruned', summary: null, countries: [] });
    expect(showChange(run, recent).status).toBe('applied');
  });

  it('keeps everything inside the default year', async () => {
    const builder = baseWorld().with('show', (context) => {
      completedShow(context, { score: 60, date: '2026-01-06' });
    });
    const run = await runShows(builder, { days: 28 });
    expect(run.tables.popularityShowChanges).toHaveLength(1);
  });
});

describe('partner helpers', () => {
  const firstShow = testId('eventInstance', 1);
  const secondShow = testId('eventInstance', 2);

  function helperWorld() {
    return baseWorld()
      .with('records', (context) => {
        completedShow(context, { score: 60, date: '2026-01-05', name: 'First Show' });
        completedShow(context, { score: 70, date: '2026-01-12', name: 'Second Show' });
        context.insert(
          'popularityShowChanges',
          aPopularityShowChange(
            {
              eventInstanceId: firstShow,
              promotionId: PROMOTION_A,
              date: day('2026-01-05'),
              worldBefore: 5,
              worldAfter: 5.5,
              regions: {
                [NORTH_1]: {
                  source: 'show',
                  networkId: null,
                  weight: 1,
                  expectation: 16,
                  before: 20,
                  after: 22.15,
                  capped: false,
                },
              },
            },
            context.sequence,
          ),
        );
        context.insert(
          'popularityShowChanges',
          aPopularityShowChange(
            {
              eventInstanceId: secondShow,
              promotionId: PROMOTION_A,
              date: day('2026-01-12'),
              worldBefore: 5.5,
              worldAfter: 5.25,
            },
            context.sequence,
          ),
        );
        context.tx.update('promotions', PROMOTION_A, {
          popularityGains: { month: yearMonthOf(day('2026-01-05')), byRegion: { [NORTH_1]: 2.15 } },
        });
      })
      .build().world;
  }

  it('popularityBeforeShow reads the stored before, or null', () => {
    const world = helperWorld();
    expect(popularityBeforeShow(world, firstShow, NORTH_1)).toBe(20);
    expect(popularityBeforeShow(world, firstShow, SOUTH_1)).toBeNull();
    expect(popularityBeforeShow(world, testId('eventInstance', 99), NORTH_1)).toBeNull();
  });

  it('recentShowChanges lists the newest shows first, up to the limit', () => {
    const world = helperWorld();
    expect(recentShowChanges(world, PROMOTION_A, 5)).toEqual([
      {
        eventInstanceId: secondShow,
        date: day('2026-01-12'),
        showName: 'Second Show',
        worldChange: -0.25,
      },
      {
        eventInstanceId: firstShow,
        date: day('2026-01-05'),
        showName: 'First Show',
        worldChange: 0.5,
      },
    ]);
    expect(recentShowChanges(world, PROMOTION_A, 1)).toHaveLength(1);
    expect(recentShowChanges(world, testId('promotion', 99), 5)).toEqual([]);
  });

  it('monthlyGainsOf is empty outside the stored month', () => {
    const world = helperWorld();
    expect(monthlyGainsOf(world, PROMOTION_A, day('2026-01-31'))).toEqual({ [NORTH_1]: 2.15 });
    expect(monthlyGainsOf(world, PROMOTION_A, day('2026-02-01'))).toEqual({});
    expect(monthlyGainsOf(world, testId('promotion', 99), day('2026-01-31'))).toEqual({});
  });
});
