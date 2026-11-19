// Big world speed (POL4-13): Full detail is today's behaviour; Fast runs distant rival shows on a
// light path that still decides winners, scores, money and popularity. Design:
// docs/design/show-night.md#big-world-speed
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  initialEngineState,
  worldHash,
  type EngineState,
} from '../../../src/core/api';
import { controllerViewer } from '../../../src/core/api/controller';
import { TABLES, type GameWorldView } from '../../../src/model/tables';
import { documentToWorld } from '../../../src/persistence/world-document';
import { defaultSystems } from '../../../src/systems';
import { getSetting, newGameSettingDef } from '../../../src/systems/newgame/settings';
import {
  BIG_WORLD_SPEED_SETTING,
  showDetailVerdict,
} from '../../../src/systems/shows/bigWorldSpeed';
import { showContextOf } from '../../../src/systems/shows/context';
import { LIGHT_PATH_NOTE } from '../../../src/systems/shows/lightPath';
import { createEngineTunables } from '../../../src/systems/tunables';
import { resetTestIds, rosterWorld } from '../../support';
import { withMyShowsRun } from '../../support/run-my-shows';
import { startDefaultGame } from '../calendar/default-game';

const PLAYER = { kind: 'human', playerId: 'local-player' } as const;

function viewOf(state: EngineState): GameWorldView {
  return documentToWorld({ state: { world: state.world } }, TABLES);
}

/** The roster fixture with nobody playing: every show is a computer show, so Fast lightens all. */
function rivalStart(speed: 'full' | 'fast' | null): EngineState {
  resetTestIds();
  const { world } = rosterWorld(80);
  const extra =
    speed === null
      ? world.meta.settings.extra
      : { ...world.meta.settings.extra, bigWorldSpeed: speed };
  return initialEngineState({
    meta: { ...world.meta, players: [], settings: { ...world.meta.settings, extra } },
    tables: world.tables,
  });
}

async function run(start: EngineState, days: number): Promise<EngineState> {
  const engine = createEngine({ state: start, systems: withMyShowsRun([...defaultSystems]) });
  const advanced = await engine.advanceDays({ maxDays: days });
  expect(advanced.failures).toEqual([]);
  return engine.exportState();
}

const DAYS = 21;

describe('Big world speed: the setting', () => {
  it('is a world setting, Full detail by default, stored only when it is Fast', () => {
    expect(newGameSettingDef('bigWorldSpeed')).toMatchObject({
      kind: 'enum',
      options: ['full', 'fast'],
      default: 'full',
      group: 'world',
    });
    const fullGame = startDefaultGame();
    // A Full detail world stores exactly the settings it stored before the setting existed.
    expect(fullGame.world.meta.settings.extra).not.toHaveProperty('bigWorldSpeed');
    expect(getSetting(fullGame.world, 'bigWorldSpeed')).toBe('full');
  });

  it('changes mid-game from a player seat, and Full detail removes the stored value', () => {
    const engine = createEngine({ state: startDefaultGame(), systems: defaultSystems });
    const before = engine.exportState().world.meta.settings;
    const speedNow = (): unknown => {
      const read = engine.query('world.bigWorldSpeed', {}, controllerViewer(PLAYER));
      return read.ok ? read.data.speed : read.reasons;
    };
    expect(speedNow()).toBe('full');
    const fast = engine.command('world.setBigWorldSpeed', { speed: 'fast' }, PLAYER);
    expect(fast.ok).toBe(true);
    expect(speedNow()).toBe('fast');
    expect(engine.exportState().world.meta.settings.extra['bigWorldSpeed']).toBe('fast');
    const full = engine.command('world.setBigWorldSpeed', { speed: 'full' }, PLAYER);
    expect(full.ok).toBe(true);
    expect(engine.exportState().world.meta.settings.extra).not.toHaveProperty('bigWorldSpeed');
    expect(engine.exportState().world.meta.settings).toEqual(before);
  });

  it('refuses a seat that is not a player in the game', () => {
    const engine = createEngine({ state: startDefaultGame(), systems: defaultSystems });
    const refused = engine.command(
      'world.setBigWorldSpeed',
      { speed: 'fast' },
      { kind: 'human', playerId: 'someone-else' },
    );
    expect(refused.ok).toBe(false);
    expect(BIG_WORLD_SPEED_SETTING.default).toBe('full');
  });
});

describe('Big world speed: which shows are distant', () => {
  it('keeps the player and rivals near them in full detail and lightens the far ones', () => {
    const state = startDefaultGame();
    const fast = {
      ...state.world,
      meta: {
        ...state.world.meta,
        settings: {
          ...state.world.meta.settings,
          extra: { ...state.world.meta.settings.extra, bigWorldSpeed: 'fast' },
        },
      },
    };
    const read = viewOf({ ...state, world: fast });
    const tunables = createEngineTunables();
    const verdicts = new Map<string, number>();
    for (const instance of read.tables.eventInstances.values()) {
      const verdict = showDetailVerdict(read, showContextOf(read, instance), tunables);
      verdicts.set(verdict, (verdicts.get(verdict) ?? 0) + 1);
      const human = read.tables.promotions.require(instance.promotionId).controller.kind;
      if (human === 'human') {
        expect(verdict).toBe('playerShow');
      }
    }
    expect(verdicts.get('playerShow')).toBeGreaterThan(0);
    // The default world's player is its flagship, known nearly everywhere: most rivals share a region.
    expect(verdicts.get('sharedRegion')).toBeGreaterThan(0);

    const fullRead = viewOf(state);
    for (const instance of fullRead.tables.eventInstances.values()) {
      expect(showDetailVerdict(fullRead, showContextOf(fullRead, instance), tunables)).toBe(
        'fullDetailSetting',
      );
    }
  });
});

describe('Big world speed: the light path', () => {
  it(
    'still decides every result and moves popularity in the show region only',
    { timeout: 60_000 },
    async () => {
      const after = await run(rivalStart('fast'), DAYS);
      const { tables } = after.world;
      const completed = tables.eventInstances.filter(
        (show) => show.status === 'completed' && show.result !== null,
      );
      expect(completed.length).toBeGreaterThan(0);
      const carded = new Set(tables.segments.map((segment) => segment.eventInstanceId));
      const ranCards = completed.filter((show) => carded.has(show.id));
      expect(ranCards.length).toBeGreaterThan(0);
      for (const segment of tables.segments.filter((row) =>
        ranCards.some((show) => show.id === row.eventInstanceId),
      )) {
        expect(segment.rating, segment.id).not.toBeNull();
        if (segment.kind === 'match') {
          expect(segment.outcome, segment.id).not.toBeNull();
        }
      }
      // Money still moved: the shows were settled.
      expect(tables.ledgerEntries.length).toBeGreaterThan(0);

      const showRegion = new Map(completed.map((show) => [show.id, show.regionId]));
      expect(tables.aftermaths.length).toBeGreaterThan(0);
      for (const row of tables.aftermaths) {
        expect(Object.keys(row.popularity.byRegion)).toEqual([showRegion.get(row.eventInstanceId)]);
      }
      expect(tables.popularityShowChanges.length).toBeGreaterThan(0);
      for (const row of tables.popularityShowChanges) {
        expect(Object.keys(row.regions)).toEqual([showRegion.get(row.eventInstanceId)]);
      }
      const segmentSummaries = after.traces.summaries.filter(
        (entry) => entry.ref.kind === 'shows.rivalSegmentScore',
      );
      expect(segmentSummaries.length).toBeGreaterThan(0);
      for (const entry of segmentSummaries) {
        expect(entry.label).toContain(LIGHT_PATH_NOTE);
        expect(entry.summaryOnly).toBe(true);
      }
    },
  );

  it('gives the same world for the same seed and mode', { timeout: 60_000 }, async () => {
    const first = await run(rivalStart('fast'), DAYS);
    const second = await run(rivalStart('fast'), DAYS);
    expect(worldHash(second)).toBe(worldHash(first));
  });

  it(
    'is never taken in Full detail, which plays exactly as a world without the setting',
    { timeout: 60_000 },
    async () => {
      const unset = await run(rivalStart(null), DAYS);
      const full = await run(rivalStart('full'), DAYS);
      // Explicit Full detail is stored, so compare the tables and traces, not the meta.
      expect(full.world.tables).toEqual(unset.world.tables);
      expect(full.traces).toEqual(unset.traces);
      expect(full.rng).toEqual(unset.rng);
      // The full path spreads popularity beyond the show region and keeps no light summaries.
      expect(
        unset.world.tables.aftermaths.some(
          (row) => Object.keys(row.popularity.byRegion).length > 1,
        ),
      ).toBe(true);
      expect(unset.traces.summaries.some((entry) => entry.label.includes(LIGHT_PATH_NOTE))).toBe(
        false,
      );
      const fast = await run(rivalStart('fast'), DAYS);
      expect(worldHash(fast)).not.toBe(worldHash(unset));
    },
  );
});
