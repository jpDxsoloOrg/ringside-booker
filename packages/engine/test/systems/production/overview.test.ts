// production.overview, production.changePreview, the effect seam and the coming-shows helper
// (ECO7-02). Design: docs/design/production.md#screens
import { afterEach, describe, expect, it } from 'vitest';
import type { Engine } from '../../../src/core/api';
import { assertSerialisable } from '../../../src/core/api/serialisable';
import type { Viewer } from '../../../src/core/api/controller';
import { addDays, parseGameDate } from '../../../src/core/date';
import { RegistryError } from '../../../src/core/errors';
import type { PromotionId } from '../../../src/core/ids';
import {
  clearProductionEffectsForTests,
  registerProductionEffect,
  TV_CAMERA_MINIMUM_EFFECT_ID,
  upcomingShows,
} from '../../../src/systems/production';
import { worldBuilder } from '../../support';
import { OTHER_PLAYER, PLAYER, productionEngine, productionWorld, START } from './production-world';
import { ALTURA, HARDPAN } from './support';

const PLAYER_VIEW: Viewer = { kind: 'controller', controller: PLAYER };
const OTHER_VIEW: Viewer = { kind: 'controller', controller: OTHER_PLAYER };
const OMNISCIENT: Viewer = { kind: 'omniscient' };

function overview(engine: Engine, promotionId: PromotionId, viewer: Viewer = PLAYER_VIEW) {
  const result = engine.query('production.overview', { promotionId }, viewer);
  if (!result.ok) {
    throw new Error(`production.overview refused: ${JSON.stringify(result.reasons)}`);
  }
  assertSerialisable(result.data, 'overview');
  return result.data;
}

let restoreEffects: (() => void) | null = null;
afterEach(() => {
  restoreEffects?.();
  restoreEffects = null;
});

describe('production.overview', () => {
  it("gives the player every row with its cost, at the next show's importance", () => {
    const built = productionWorld();
    const data = overview(productionEngine(built.world), built.human);
    expect(data).toMatchObject({
      promotionName: 'Hardpan',
      mine: true,
      typicalImportance: 'minor',
      popularityCeiling: { value: 30 },
      regionsAboveCeiling: 1,
      tvDeal: null,
      upcomingShows: { count: 4, days: 28 },
    });
    expect(data.rows.map((row) => [row.area, row.level])).toEqual(Object.entries(HARDPAN));
    const camera = data.rows.find((row) => row.area === 'camera');
    // Camera 2: 0.008 × $150,000 × 0.5 (minor) = $600.
    expect(camera).toMatchObject({
      costKind: 'perShow',
      cost: 60_000,
      costBasis: 'per Hardpan Friday (minor)',
      minLevel: 0,
    });
    expect(data.rows.find((row) => row.area === 'music')).toMatchObject({
      costKind: 'monthly',
      costBasis: 'a month',
    });
    const overhead = data.monthlyOverhead;
    expect(overhead).not.toBeNull();
    if (overhead !== null) {
      const { production, marketing, backOffice } = overhead.byCategory;
      expect(production + marketing + backOffice).toBe(overhead.total);
    }
    expect(data.rows.find((row) => row.area === 'marketing')?.effects).toEqual([
      expect.objectContaining({
        id: 'production.popularityCeiling',
        label: 'Popularity ceiling',
        value: 30,
        text: 'Popularity above 30 slowly falls back',
      }),
    ]);
  });

  it('prices per-show rows at a regular show when nothing is coming', () => {
    const built = productionWorld({ weeklyShow: false });
    const data = overview(productionEngine(built.world), built.human);
    expect(data.typicalImportance).toBe('regular');
    expect(data.upcomingShows).toMatchObject({ count: 0, total: 0 });
    expect(data.rows.find((row) => row.area === 'camera')).toMatchObject({
      cost: 120_000,
      costBasis: 'per regular show',
    });
  });

  it('shows the TV deal and the camera minimum to the player', () => {
    const built = productionWorld({ dealDays: 28 });
    const data = overview(productionEngine(built.world), built.human);
    expect(data.tvDeal).toEqual({ networkName: 'Channel 9', endsOn: addDays(START, 28) });
    const camera = data.rows.find((row) => row.area === 'camera');
    expect(camera?.minLevel).toBe(1);
    expect(camera?.effects).toEqual([
      expect.objectContaining({
        id: TV_CAMERA_MINIMUM_EFFECT_ID,
        text: 'TV deal with Channel 9: camera stays at 1 or higher',
      }),
    ]);
  });

  it("shows a rival's levels and ceiling but none of its costs or its TV deal", () => {
    const built = productionWorld({ dealDays: 28 });
    const engine = productionEngine(built.world);
    const rival = overview(engine, built.rival);
    expect(rival).toMatchObject({
      mine: false,
      popularityCeiling: { value: 95 },
      monthlyOverhead: null,
      upcomingShows: null,
      typicalImportance: null,
      tvDeal: null,
    });
    expect(rival.rows.map((row) => [row.area, row.level])).toEqual(Object.entries(ALTURA));
    for (const row of rival.rows) {
      expect([row.cost, row.costTrace, row.costBasis]).toEqual([null, null, null]);
    }

    // Another player looking at Hardpan does not learn about its deal.
    const seen = overview(engine, built.human, OTHER_VIEW);
    const camera = seen.rows.find((row) => row.area === 'camera');
    expect(camera?.minLevel).toBe(0);
    expect(camera?.effects).toEqual([]);
    expect(seen.tvDeal).toBeNull();

    // The all-seeing view sees everything.
    expect(overview(engine, built.rival, OMNISCIENT)).toMatchObject({ mine: true });
    expect(overview(engine, built.human, OMNISCIENT).tvDeal).not.toBeNull();
  });
});

describe('production.changePreview', () => {
  it('lists the fee, the costs before and after and the ceiling for marketing', () => {
    const built = productionWorld();
    const engine = productionEngine(built.world);
    const result = engine.query(
      'production.changePreview',
      { promotionId: built.human, area: 'marketing', level: 3 },
      PLAYER_VIEW,
    );
    if (!result.ok) {
      throw new Error('the preview should run');
    }
    assertSerialisable(result.data, 'preview');
    expect(result.data).toMatchObject({ area: 'marketing', from: 1, to: 3, canApply: true });
    expect(result.data.fee).toBeGreaterThan(0);
    expect(result.data.rows.map((row) => row.id)).toEqual([
      'areaCost',
      'monthlyOverhead',
      'popularityCeiling',
    ]);
    expect(result.data.rows.find((row) => row.id === 'popularityCeiling')).toMatchObject({
      before: 30,
      after: 40,
      unit: 'points',
    });
  });

  it("refuses a rival's promotion", () => {
    const built = productionWorld();
    const result = productionEngine(built.world).query(
      'production.changePreview',
      { promotionId: built.rival, area: 'camera', level: 9 },
      PLAYER_VIEW,
    );
    expect(result).toEqual({
      ok: false,
      reasons: [expect.objectContaining({ code: 'production.notYourPromotion' })],
    });
  });
});

describe('registerProductionEffect', () => {
  it("adds a line to its area's row and a row to the change dialog", () => {
    restoreEffects = clearProductionEffectsForTests();
    registerProductionEffect({
      id: 'test.musicHype',
      order: 1,
      areas: ['music'],
      describe: (_read, { levels }) => ({
        id: 'test.musicHype',
        label: 'Crowd energy',
        value: levels.music * 2,
        unit: 'points',
        text: `Crowds are ${String(levels.music * 2)} points louder`,
        trace: null,
      }),
    });
    const built = productionWorld();
    const engine = productionEngine(built.world);
    const music = overview(engine, built.human).rows.find((row) => row.area === 'music');
    expect(music?.effects).toEqual([
      expect.objectContaining({ id: 'test.musicHype', text: 'Crowds are 2 points louder' }),
    ]);
    expect(
      overview(engine, built.human).rows.find((row) => row.area === 'camera')?.effects,
    ).toEqual([]);

    const preview = engine.query(
      'production.changePreview',
      { promotionId: built.human, area: 'music', level: 4 },
      PLAYER_VIEW,
    );
    expect(
      preview.ok && preview.data.rows.find((row) => row.id === 'test.musicHype'),
    ).toMatchObject({ label: 'Crowd energy', before: 2, after: 8, unit: 'points' });
    if (preview.ok) {
      assertSerialisable(preview.data, 'preview');
    }
  });

  it('throws for a duplicate id, a malformed id and no areas', () => {
    restoreEffects = clearProductionEffectsForTests();
    const effect = { id: 'test.twice', order: 1, areas: ['stage'] as const, describe: () => null };
    registerProductionEffect(effect);
    expect(() => registerProductionEffect(effect)).toThrow(RegistryError);
    expect(() => registerProductionEffect({ ...effect, id: 'Not An Id' })).toThrow(RegistryError);
    expect(() => registerProductionEffect({ ...effect, id: 'test.none', areas: [] })).toThrow(
      RegistryError,
    );
  });
});

describe('upcomingShows', () => {
  it('reads the weekly definitions when nothing is scheduled: 4 Fridays in 28 days from a Monday', () => {
    const built = productionWorld();
    const shows = upcomingShows(built.world, built.human, START, 28);
    expect(shows.map((show) => [show.name, show.date, show.importance])).toEqual([
      ['Hardpan Friday', '2026-01-09', 'minor'],
      ['Hardpan Friday', '2026-01-16', 'minor'],
      ['Hardpan Friday', '2026-01-23', 'minor'],
      ['Hardpan Friday', '2026-01-30', 'minor'],
    ]);
    expect(shows.every((show) => show.eventInstanceId === null)).toBe(true);
  });

  it('uses the scheduled and booked shows when there are any in the window', () => {
    const { world, ids } = worldBuilder({ startDate: '2026-01-05' })
      .withGeography('mini')
      .withPromotion({}, (promotion) =>
        promotion.withWeeklyShow({}, { name: 'Weekly', importance: 'minor' }),
      )
      .withEventInstance({
        name: 'Big Night',
        date: parseGameDate('2026-01-20'),
        importance: 'major',
      })
      .withEventInstance({
        name: 'Booked Night',
        date: parseGameDate('2026-01-10'),
        status: 'booked',
      })
      .withEventInstance({ name: 'Done', date: parseGameDate('2026-01-06'), status: 'completed' })
      .withEventInstance({ name: 'Too late', date: parseGameDate('2026-02-02') })
      .build();
    const promotionId = ids.promotions.A;
    if (promotionId === undefined) {
      throw new Error('no promotion');
    }
    expect(
      upcomingShows(world, promotionId, START, 28).map((show) => [
        show.name,
        show.date,
        show.eventInstanceId === null,
      ]),
    ).toEqual([
      ['Booked Night', '2026-01-10', false],
      ['Big Night', '2026-01-20', false],
    ]);
  });
});
