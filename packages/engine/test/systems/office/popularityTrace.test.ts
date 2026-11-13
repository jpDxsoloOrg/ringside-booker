// The headline popularity Why? behind the top bar and the Office (DAY2-02).
// Design: docs/design/office.md#headline-popularity
import { afterEach, describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type EngineState } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { definePhase } from '../../../src/core/pipeline/phase';
import { defineSystem } from '../../../src/core/api/system';
import { weekday, type GameDate } from '../../../src/core/date';
import { parseId, type PromotionId } from '../../../src/core/ids';
import { isFullTrace } from '../../../src/core/trace/store';
import { findTraceNodes } from '../../../src/core/trace';
import type { Viewer } from '../../../src/core/api/controller';
import type { Controller } from '../../../src/model/controller';
import { createNewGame } from '../../../src/systems/newgame';
import {
  createOfficeRoller,
  formatPopularity,
  headlinePopularityValue,
  officeSystem,
  POPULARITY_TRACE_KIND,
  registerPopularityTraceSection,
} from '../../../src/systems/office';
import { applyPopularityChange, workersSystem } from '../../../src/systems/workers';
import { miniWorldPacks } from '../../support/fixture-packs';
import { worldBuilder } from '../../support/world-builder';

const PLAYER_ID = 'local-player';
const HUMAN: Controller = { kind: 'human', playerId: PLAYER_ID };
const VIEWER = { kind: 'controller', controller: HUMAN } as const;
const OMNISCIENT = { kind: 'omniscient' } as const;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function newGameState(): EngineState {
  const result = createNewGame(miniWorldPacks(), {
    rootPackId: 'mini-world',
    seed: 'office-popularity',
    playerId: PLAYER_ID,
    playerName: 'Alex Booker',
    saveName: 'Popularity',
    seasonLength: { preset: '12m' },
    player: { mode: 'existing', promotionKey: 'harbour-city-wrestling' },
    settings: {},
  });
  if (!result.ok) {
    throw new Error(JSON.stringify(result.reasons));
  }
  return result.state;
}

function humanPromotionId(state: EngineState): PromotionId {
  const promotion = state.world.tables.promotions.find(
    (candidate) => candidate.controller.kind === 'human',
  );
  if (promotion === undefined) throw new Error('The new game has a human promotion');
  return promotion.id;
}

/**
 * A test system whose phase raises the promotion's popularity once, on the first day that is not
 * a Monday (so the weekly phase is not what re-records the Why?), and notes the headline
 * `headlinePopularityValue` gives right after.
 */
function boostSystem(promotionId: PromotionId) {
  const seen: { date: GameDate | null; value: number | null } = { date: null, value: null };
  const system = defineSystem({
    id: 'boostTest',
    phases: [
      definePhase({
        id: 'boostTest.raise',
        group: 'housekeeping',
        order: 10,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          if (seen.date !== null || weekday(ctx.date) === 0) return;
          const home = ctx.read.tables.promotions.require(promotionId).homeRegionId;
          applyPopularityChange(ctx, {
            subject: { kind: 'promotion', id: promotionId },
            regionWeights: { [home]: 1 },
            delta: 10,
            source: 'system',
            reason: { key: 'test.boost', label: 'A test boost' },
          });
          seen.date = ctx.date;
          seen.value = headlinePopularityValue(
            ctx.read,
            promotionId,
            ctx.tunables,
            createOfficeRoller(ctx.read),
          );
        },
      }),
    ],
  });
  return { system, seen };
}

function statusOf(engine: ReturnType<typeof createEngine>, viewer: Viewer = VIEWER) {
  const status = engine.query('sim.status', {}, viewer);
  if (!status.ok) throw new Error(JSON.stringify(status));
  return status.data;
}

/** The home country's roll-up, as the Fan base sheet shows it. */
function homeCountryValue(
  engine: ReturnType<typeof createEngine>,
  state: EngineState,
  promotionId: PromotionId,
): number {
  const promotion = state.world.tables.promotions.find((row) => row.id === promotionId);
  const region = state.world.tables.regions.find((row) => row.id === promotion?.homeRegionId);
  const view = engine.query('office.fanBase', { promotionId }, OMNISCIENT);
  if (!view.ok) throw new Error(JSON.stringify(view));
  const country = view.data.rollup.continents
    .flatMap((continent) => continent.countries)
    .find((candidate) => candidate.id === region?.countryId);
  if (country === undefined) throw new Error('The home country is on the map');
  return country.value;
}

describe('the headline popularity trace', () => {
  it('is recorded at new game, so sim.status shows the headline with a Why? that opens', () => {
    const state = newGameState();
    const promotionId = humanPromotionId(state);
    const engine = createEngine({ state, systems: [simSystem, officeSystem] });

    const popularity = statusOf(engine).promotion?.popularity;
    expect(popularity?.headline).toBeCloseTo(homeCountryValue(engine, state, promotionId), 9);
    expect(popularity?.headlineLabel).toMatch(/ popularity$/u);
    expect(popularity?.traceRef).toEqual({ kind: POPULARITY_TRACE_KIND, id: promotionId });

    const opened = engine.query(
      'trace.get',
      { ref: { kind: POPULARITY_TRACE_KIND, id: promotionId } },
      VIEWER,
    );
    expect(opened.ok && opened.data?.value).toBe(popularity?.headline);
  });

  it('is re-recorded the same day a popularity door changes the promotion', async () => {
    const state = newGameState();
    const promotionId = humanPromotionId(state);
    const boost = boostSystem(promotionId);
    const engine = createEngine({
      state,
      systems: [simSystem, workersSystem, officeSystem, boost.system],
    });
    const before = statusOf(engine).promotion?.popularity.headline;

    // The mini world starts on a Monday; the boost waits for Tuesday.
    const advance = await engine.advanceDays({ maxDays: 2 });
    expect(advance.failures).toEqual([]);
    expect(boost.seen.date).not.toBeNull();

    const after = statusOf(engine).promotion?.popularity.headline;
    expect(after).toBeGreaterThan(before ?? Infinity);
    expect(after).toBeCloseTo(boost.seen.value ?? Number.NaN, 9);
    const entry = engine.query(
      'trace.get',
      { ref: { kind: POPULARITY_TRACE_KIND, id: promotionId } },
      VIEWER,
    );
    expect(entry.ok && entry.data?.date).toBe(boost.seen.date);
  });

  it('follows a change of the scope tunable, and carries the registered section lines', () => {
    cleanups.push(
      registerPopularityTraceSection({
        id: 'test.recentShows',
        order: 10,
        lines: () => ['Recent shows: Test Show on 5 January, worldwide +0.8'],
      }),
    );
    const state = newGameState();
    const promotionId = humanPromotionId(state);
    const engine = createEngine({ state, systems: [simSystem, officeSystem] });

    const changed = engine.commandRaw(
      'tunables.setOverride',
      { key: 'office.popularity.headlineScope', value: 'world' },
      HUMAN,
    );
    expect(changed.ok).toBe(true);

    const popularity = statusOf(engine).promotion?.popularity;
    const view = engine.query('office.fanBase', {}, VIEWER);
    if (!view.ok) throw new Error(JSON.stringify(view));
    expect(view.data.scope).toBe('world');
    expect(popularity?.headline).toBeCloseTo(view.data.rollup.world.value, 9);
    expect(view.data.headline.value).toBe(popularity?.headline);
    const entry = engine.query(
      'trace.get',
      { ref: { kind: POPULARITY_TRACE_KIND, id: promotionId } },
      VIEWER,
    );
    if (!entry.ok || entry.data === null || !isFullTrace(entry.data)) {
      throw new Error('The full trace is stored');
    }
    const notes = findTraceNodes(entry.data.trace, 'note').map((node) => node.label);
    expect(notes).toContain('Recent shows: Test Show on 5 January, worldwide +0.8');
  });

  it('refuses a second section with the same id', () => {
    const section = { id: 'test.duplicate', order: 1, lines: () => [] };
    cleanups.push(registerPopularityTraceSection(section));
    expect(() => registerPopularityTraceSection(section)).toThrow(/already registered/u);
  });

  it('gives the omniscient viewer no promotion', () => {
    const engine = createEngine({ state: newGameState(), systems: [simSystem, officeSystem] });
    expect(statusOf(engine, OMNISCIENT).promotion).toBeNull();
  });

  it('leaves headline and traceRef null in a world that has no trace yet', () => {
    const { world } = worldBuilder()
      .withGeography('mini')
      .withPromotion({ controller: HUMAN })
      .build();
    const engine = createEngine({
      state: initialEngineState(world),
      systems: [simSystem, officeSystem],
    });
    const popularity = statusOf(engine).promotion?.popularity;
    expect(popularity).toMatchObject({ headline: null, headlineLabel: null, traceRef: null });
    expect(popularity?.trace).toBeDefined();
  });
});

describe('office.fanBase', () => {
  it("returns the viewer's promotion with the same headline and a roll-up whose world matches the note", () => {
    const state = newGameState();
    const promotionId = humanPromotionId(state);
    const engine = createEngine({ state, systems: [simSystem, officeSystem] });

    const view = engine.query('office.fanBase', {}, VIEWER);
    if (!view.ok) throw new Error(JSON.stringify(view));
    expect(view.data.promotionId).toBe(promotionId);
    expect(view.data.scope).toBe('homeCountry');
    expect(view.data.headline.value).toBe(statusOf(engine).promotion?.popularity.headline);
    expect(view.data.headline.traceRef).toEqual({ kind: POPULARITY_TRACE_KIND, id: promotionId });

    const entry = engine.query(
      'trace.get',
      { ref: { kind: POPULARITY_TRACE_KIND, id: promotionId } },
      VIEWER,
    );
    if (!entry.ok || entry.data === null || !isFullTrace(entry.data)) {
      throw new Error('The full trace is stored');
    }
    const notes = findTraceNodes(entry.data.trace, 'note').map((node) => node.label);
    expect(notes).toContain(`Worldwide ${formatPopularity(view.data.rollup.world.value)}`);
  });

  it('answers any viewer about any promotion, and refuses an unknown one or none at all', () => {
    const state = newGameState();
    const rival = state.world.tables.promotions.find(
      (promotion) => promotion.controller.kind !== 'human',
    );
    const engine = createEngine({ state, systems: [simSystem, officeSystem] });
    if (rival !== undefined) {
      const view = engine.query('office.fanBase', { promotionId: rival.id }, OMNISCIENT);
      expect(view.ok && view.data.name).toBe(rival.name);
    }

    const unknown = engine.query(
      'office.fanBase',
      { promotionId: parseId('promotion', 'pro_zzzzzzzzzz') },
      VIEWER,
    );
    expect(unknown).toMatchObject({ ok: false, reasons: [{ code: 'unknownPromotion' }] });

    const none = engine.query('office.fanBase', {}, OMNISCIENT);
    expect(none).toMatchObject({
      ok: false,
      reasons: [
        { code: 'noPromotion', message: "You don't run a promotion, so pick one to look at" },
      ],
    });
  });

  it('names the home region, country and continent, so the sheet can open the home continent (DAY2-05)', () => {
    const state = newGameState();
    const promotionId = humanPromotionId(state);
    const engine = createEngine({ state, systems: [simSystem, officeSystem] });
    const promotion = state.world.tables.promotions.find((row) => row.id === promotionId);
    const region = state.world.tables.regions.find((row) => row.id === promotion?.homeRegionId);
    const country = state.world.tables.countries.find((row) => row.id === region?.countryId);
    if (promotion === undefined || region === undefined || country === undefined) {
      throw new Error('The promotion has a home region on the map');
    }

    const view = engine.query('office.fanBase', {}, VIEWER);
    if (!view.ok) throw new Error(JSON.stringify(view));
    expect(view.data.home).toEqual({
      regionId: region.id,
      countryId: country.id,
      countryName: country.name,
      continentId: country.continentId,
    });
    const homeContinent = view.data.rollup.continents.find(
      (continent) => continent.id === view.data.home.continentId,
    );
    expect(homeContinent?.countries.map((candidate) => candidate.id)).toContain(country.id);
  });
});
