// New game (WLD-10): createNewGame with the WLD-02 fixture packs.
// Design: docs/design/new-game.md
import { afterEach, describe, expect, it } from 'vitest';
import {
  addDays,
  compareDates,
  diffDays,
  parseGameDate,
  weekday,
  type GameDate,
} from '../../../src/core/date';
import { createEngine, type EngineState } from '../../../src/core/api';
import type { RawPack } from '../../../src/persistence/packs';
import { defaultSystems } from '../../../src/systems';
import { PROMOTION_STYLES } from '../../../src/model/entities/promotion-style';
import {
  createNewGame,
  FOUNDING_SIZES,
  getSetting,
  registerSetupStep,
  setupSteps,
  type NewGameResult,
  type NewGameSummary,
} from '../../../src/systems/newgame';
import { miniWorldPacks, recordsOf, withFiles } from '../../support/fixture-packs';

const PACK_START: GameDate = parseGameDate('2026-01-05');
const FIXTURE_CONTRACT_END: GameDate = parseGameDate('2027-03-01');
const OMNISCIENT = { kind: 'omniscient' } as const;

/** Removers for steps registered by a test, run after each test. */
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function baseInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rootPackId: 'mini-world',
    seed: 'new-game-test',
    playerId: 'local-player',
    playerName: 'Alex Booker',
    saveName: 'Harbour Run',
    seasonLength: { preset: '12m' },
    player: { mode: 'existing', promotionKey: 'harbour-city-wrestling' },
    settings: {},
    ...overrides,
  };
}

function foundInput(player: Record<string, unknown> = {}): Record<string, unknown> {
  return baseInput({
    player: {
      mode: 'found',
      name: 'Northern Lights Wrestling',
      shortName: 'nlw',
      homeRegionKey: 'north-ridge',
      style: 'traditional',
      size: 'medium',
      color: '#335577',
      starterKit: true,
      weeklyShowDay: 3,
      ...player,
    },
  });
}

function expectOk(result: NewGameResult): { state: EngineState; summary: NewGameSummary } {
  if (!result.ok) {
    throw new Error(`New game was refused: ${JSON.stringify(result.reasons)}`);
  }
  return result;
}

function newGame(input: Record<string, unknown>, packs: RawPack[] = miniWorldPacks()) {
  return expectOk(createNewGame(packs, input));
}

function reasonsOf(result: NewGameResult) {
  if (result.ok) {
    throw new Error('Expected new game to be refused');
  }
  return result.reasons;
}

describe('createNewGame: determinism and the engine state', () => {
  it('gives deep-equal states for the same packs and input', () => {
    const first = newGame(baseInput());
    const second = newGame(baseInput());
    expect(second.state).toEqual(first.state);
    expect(second.summary).toEqual(first.summary);
  });

  it('gives a state createEngine accepts, on the start date', () => {
    const { state } = newGame(baseInput());
    const engine = createEngine({ state, systems: defaultSystems });
    const clock = engine.query('clock.get', {}, OMNISCIENT);
    expect(clock.ok && clock.data.date).toBe(PACK_START);
    expect(engine.exportState().world).toEqual(state.world);
  });

  it('records world.created as the first event', () => {
    const { state, summary } = newGame(baseInput());
    expect(state.events.recent).toHaveLength(1);
    expect(state.events.recent[0]).toMatchObject({
      type: 'world.created',
      seq: 1,
      date: PACK_START,
      payload: {
        startDate: PACK_START,
        seasonLengthDays: 364,
        promotionId: summary.promotion.id,
        playerId: 'local-player',
      },
    });
  });

  it('round-trips the result through JSON', () => {
    const result = newGame(baseInput());
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe('createNewGame: controllers (D-07)', () => {
  it('gives the chosen promotion the human controller and every other one the computer', () => {
    const { state, summary } = newGame(baseInput());
    const promotions = state.world.tables.promotions;
    const human = promotions.filter((row) => row.controller.kind === 'human');
    expect(human).toHaveLength(1);
    expect(human[0]).toMatchObject({
      id: summary.promotion.id,
      shortName: 'HCW',
      controller: { kind: 'human', playerId: 'local-player' },
    });
    for (const promotion of promotions) {
      if (promotion.id !== summary.promotion.id) {
        expect(promotion.controller).toEqual({ kind: 'computer' });
      }
    }
    for (const brand of state.world.tables.brands) {
      expect(brand.controller).toBeNull();
    }
  });

  it('stores the player and the save name, and no player-promotion field', () => {
    const { state } = newGame(baseInput());
    const { meta } = state.world;
    expect(meta.players).toEqual([{ playerId: 'local-player', displayName: 'Alex Booker' }]);
    expect(meta.worldName).toBe('Harbour Run');
    const metaKeys = Object.keys(meta).map((key) => key.toLowerCase());
    expect(metaKeys.filter((key) => key.includes('promotion'))).toEqual([]);
    expect(Object.keys(meta.settings).map((key) => key.toLowerCase())).not.toContain(
      'playerpromotion',
    );
  });
});

describe('createNewGame: founding a promotion', () => {
  it('creates the promotion with the size values and the human controller', () => {
    const { state, summary } = newGame(foundInput());
    const founded = state.world.tables.promotions.find((row) => row.id === summary.promotion.id);
    const regionIds = state.world.meta.contentKeys['region'] ?? {};
    expect(founded).toMatchObject({
      name: 'Northern Lights Wrestling',
      shortName: 'NLW',
      cash: 30_000_000,
      prestige: 35,
      foundedOn: PACK_START,
      status: 'active',
      color: '#335577',
      logoRef: null,
      controller: { kind: 'human', playerId: 'local-player' },
      production: {
        stage: 0,
        camera: 0,
        editing: 0,
        pyro: 0,
        music: 0,
        writing: 0,
        marketing: 0,
        backOffice: 0,
      },
      policies: { catering: 0, travel: 0, medical: 0 },
    });
    // Home region 20, the rest of the home country 8, nothing abroad.
    expect(founded?.regionalPop).toEqual({
      [regionIds['north-ridge'] ?? '']: 20,
      [regionIds['harbour-coast'] ?? '']: 8,
    });
    expect(state.world.tables.employments.filter((row) => row.promotionId === founded?.id)).toEqual(
      [],
    );
    const others = state.world.tables.promotions.filter((row) => row.id !== founded?.id);
    expect(others.every((row) => row.controller.kind === 'computer')).toBe(true);
    expect(summary.promotion).toEqual({
      id: founded?.id,
      name: 'Northern Lights Wrestling',
      shortName: 'NLW',
      cash: 30_000_000,
    });
  });

  it('adds a vacant title and a weekly show with the starter kit', () => {
    const { state, summary } = newGame(foundInput());
    const titles = state.world.tables.titles.filter(
      (row) => row.promotionId === summary.promotion.id,
    );
    expect(titles).toHaveLength(1);
    expect(titles[0]).toMatchObject({
      name: 'NLW Championship',
      holderCount: 1,
      division: { gender: 'open' },
      prestige: 20,
      color: '#335577',
      imageRef: null,
      status: 'active',
    });
    expect(state.world.tables.titleReigns.filter((row) => row.titleId === titles[0]?.id)).toEqual(
      [],
    );
    const shows = state.world.tables.eventDefinitions.filter(
      (row) => row.promotionId === summary.promotion.id,
    );
    expect(shows).toHaveLength(1);
    expect(shows[0]).toMatchObject({
      name: 'NLW Weekly',
      importance: 'regular',
      recurrence: { kind: 'weekly', weekdays: [3] },
      format: { slots: 5, preShowSlots: 0 },
      televised: false,
      preferredRegionId: state.world.meta.contentKeys['region']?.['north-ridge'],
    });
  });

  it('takes the weekly show slots from the tunable', () => {
    const { state, summary } = newGame({
      ...foundInput(),
      tunableOverrides: { 'newgame.found.weeklyShowSlots': 8 },
    });
    const show = state.world.tables.eventDefinitions.find(
      (row) => row.promotionId === summary.promotion.id,
    );
    expect(show?.format.slots).toBe(8);
    expect(state.tunableOverrides).toEqual({ 'newgame.found.weeklyShowSlots': 8 });
  });

  it('adds no title or show without the starter kit', () => {
    const { state, summary } = newGame(foundInput({ starterKit: false, size: 'small' }));
    expect(state.world.tables.titles.some((row) => row.promotionId === summary.promotion.id)).toBe(
      false,
    );
    expect(
      state.world.tables.eventDefinitions.some((row) => row.promotionId === summary.promotion.id),
    ).toBe(false);
    expect(summary.promotion.cash).toBe(7_500_000);
  });

  it('works for every size and style', () => {
    for (const size of FOUNDING_SIZES) {
      for (const style of PROMOTION_STYLES) {
        for (const homeRegionKey of ['harbour-coast', 'north-ridge', 'vell-lowlands']) {
          const result = createNewGame(
            miniWorldPacks(),
            foundInput({ size, style, homeRegionKey }),
          );
          expect(result.ok).toBe(true);
        }
      }
    }
  });
});

describe('createNewGame: refusals', () => {
  it('refuses a short name another promotion uses, naming the clash', () => {
    const reasons = reasonsOf(createNewGame(miniWorldPacks(), foundInput({ shortName: 'hcw' })));
    expect(reasons).toEqual([
      expect.objectContaining({
        code: 'shortNameTaken',
        field: 'player.shortName',
      }),
    ]);
    expect(reasons[0]?.message).toContain('Harbour City Wrestling');
  });

  it('refuses a name another promotion uses, whatever the case', () => {
    const reasons = reasonsOf(
      createNewGame(miniWorldPacks(), foundInput({ name: 'river city WRESTLING' })),
    );
    expect(reasons).toEqual([expect.objectContaining({ code: 'nameTaken', field: 'player.name' })]);
  });

  it('refuses an unknown home region and an unknown promotion', () => {
    expect(
      reasonsOf(createNewGame(miniWorldPacks(), foundInput({ homeRegionKey: 'atlantis' }))),
    ).toEqual([expect.objectContaining({ code: 'unknownRegion', field: 'player.homeRegionKey' })]);
    expect(
      reasonsOf(
        createNewGame(
          miniWorldPacks(),
          baseInput({ player: { mode: 'existing', promotionKey: 'nobody' } }),
        ),
      ),
    ).toEqual([
      expect.objectContaining({ code: 'unknownPromotion', field: 'player.promotionKey' }),
    ]);
  });

  it('refuses an inactive promotion', () => {
    const [base, world] = miniWorldPacks();
    if (base === undefined || world === undefined) {
      throw new Error('fixture packs missing');
    }
    const promotions = recordsOf(world, 'promotion').map((row) =>
      row['key'] === 'river-city-wrestling' ? { ...row, status: 'dormant' } : row,
    );
    const packs = [base, withFiles(world, { promotion: promotions })];
    const reasons = reasonsOf(
      createNewGame(
        packs,
        baseInput({ player: { mode: 'existing', promotionKey: 'river-city-wrestling' } }),
      ),
    );
    expect(reasons).toEqual([expect.objectContaining({ code: 'promotionInactive' })]);
  });

  it('refuses an unknown setting key and a value of the wrong type', () => {
    const reasons = reasonsOf(
      createNewGame(
        miniWorldPacks(),
        baseInput({ settings: { noSuchSetting: true, generationLevel: 'extreme' } }),
      ),
    );
    expect(reasons).toEqual([
      expect.objectContaining({ code: 'invalidSetting', field: 'settings.generationLevel' }),
      expect.objectContaining({ code: 'unknownSetting', field: 'settings.noSuchSetting' }),
    ]);
  });

  it('refuses a tunable override out of range', () => {
    const reasons = reasonsOf(
      createNewGame(
        miniWorldPacks(),
        baseInput({ tunableOverrides: { 'newgame.found.weeklyShowSlots': 40 } }),
      ),
    );
    expect(reasons).toEqual([
      expect.objectContaining({
        code: 'invalidTunableOverride',
        field: 'tunableOverrides.newgame.found.weeklyShowSlots',
      }),
    ]);
  });

  it('refuses 3 custom weeks on the customWeeks field', () => {
    const reasons = reasonsOf(
      createNewGame(miniWorldPacks(), baseInput({ seasonLength: { customWeeks: 3 } })),
    );
    expect(reasons).toEqual([
      expect.objectContaining({
        code: 'seasonLengthOutOfRange',
        field: 'seasonLength.customWeeks',
      }),
    ]);
  });

  it('refuses a start date before the pack start', () => {
    const reasons = reasonsOf(
      createNewGame(miniWorldPacks(), baseInput({ startDate: addDays(PACK_START, -1) })),
    );
    expect(reasons).toEqual([
      expect.objectContaining({ code: 'startDateBeforePack', field: 'startDate' }),
    ]);
  });

  it('refuses a malformed input with invalidArgs reasons instead of throwing', () => {
    const reasons = reasonsOf(createNewGame(miniWorldPacks(), { seed: '' }));
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.every((reason) => reason.code === 'invalidArgs')).toBe(true);
  });

  it('refuses packs that do not load', () => {
    const reasons = reasonsOf(createNewGame([], baseInput()));
    expect(reasons[0]).toMatchObject({ code: 'packIssue' });
  });
});

describe('createNewGame: season 1 (D-08)', () => {
  it('turns the 3-month preset into one 91-day season', () => {
    const { state, summary } = newGame(baseInput({ seasonLength: { preset: '3m' } }));
    expect(state.world.meta.settings.season.lengthDays).toBe(91);
    expect(state.world.tables.seasons).toHaveLength(1);
    const [season] = state.world.tables.seasons;
    expect(season).toMatchObject({ number: 1, status: 'active', startDate: PACK_START });
    expect(season === undefined ? -1 : diffDays(season.startDate, season.endDate) + 1).toBe(91);
    expect(summary.season).toEqual({
      number: 1,
      startDate: PACK_START,
      endDate: season?.endDate,
      lengthDays: 91,
    });
  });

  it('turns 10 custom weeks into 70 days', () => {
    const { state } = newGame(baseInput({ seasonLength: { customWeeks: 10 } }));
    expect(state.world.meta.settings.season.lengthDays).toBe(70);
  });

  it('starts season 1 on a later chosen start date', () => {
    const startDate = addDays(PACK_START, 30);
    const { state } = newGame(baseInput({ startDate }));
    expect(state.world.meta.startDate).toBe(startDate);
    expect(state.world.tables.seasons[0]?.startDate).toBe(startDate);
  });
});

describe('createNewGame: settings', () => {
  it('stores levelPlayingField in WorldMeta.settings', () => {
    const { state } = newGame(baseInput({ settings: { levelPlayingField: true } }));
    expect(state.world.meta.settings.levelPlayingField).toBe(true);
    expect(getSetting(state.world, 'levelPlayingField')).toBe(true);
  });

  it('stores the setup-only settings in settings.extra', () => {
    const { state } = newGame(baseInput({ settings: { equalStart: true } }));
    expect(state.world.meta.settings.extra).toEqual({
      equalStart: true,
      randomiseContractLengths: false,
      rerollPotential: false,
    });
    expect(getSetting(state.world, 'equalStart')).toBe(true);
    expect(getSetting(state.world, 'generationLevel')).toBe('low');
  });

  it('applies equal start: same cash, home-country popularity only, no deals', () => {
    const { state } = newGame(
      baseInput({
        settings: { equalStart: true },
        tunableOverrides: { 'newgame.equalStart.cash': 12_345_600 },
      }),
    );
    const { world } = state;
    const countryOfRegion = new Map(world.tables.regions.map((row) => [row.id, row.countryId]));
    for (const promotion of world.tables.promotions) {
      expect(promotion.cash).toBe(12_345_600);
      expect(promotion.prestige).toBe(50);
      const homeCountry = countryOfRegion.get(promotion.homeRegionId);
      const homeRegions = world.tables.regions.filter((row) => row.countryId === homeCountry);
      expect(Object.keys(promotion.regionalPop).sort()).toEqual(
        homeRegions.map((row) => row.id).sort(),
      );
      expect(Object.values(promotion.regionalPop).every((value) => value === 35)).toBe(true);
    }
    expect(world.tables.deals).toEqual([]);
  });

  it('randomises contract lengths to exactly start + 90 when min = max = 90', () => {
    const { state } = newGame(
      baseInput({
        settings: { randomiseContractLengths: true },
        tunableOverrides: {
          'newgame.contractLength.minDays': 90,
          'newgame.contractLength.maxDays': 90,
        },
      }),
    );
    const active = state.world.tables.employments.filter((row) => row.status === 'active');
    expect(active.length).toBeGreaterThan(0);
    for (const employment of active) {
      expect(employment.endsOn).toBe(addDays(PACK_START, 90));
    }
  });

  it('moves contracts ending on or before the start date past it', () => {
    const [base, world] = miniWorldPacks();
    if (base === undefined || world === undefined) {
      throw new Error('fixture packs missing');
    }
    const employments = recordsOf(world, 'employment').map((row, index) =>
      index < 2 ? { ...row, endsOn: PACK_START } : row,
    );
    const { state } = newGame(baseInput(), [base, withFiles(world, { employment: employments })]);
    const active = state.world.tables.employments.filter((row) => row.status === 'active');
    for (const employment of active) {
      expect(employment.endsOn === null || compareDates(employment.endsOn, PACK_START) > 0).toBe(
        true,
      );
    }
    const moved = active.filter(
      (row) => row.endsOn !== null && compareDates(row.endsOn, FIXTURE_CONTRACT_END) !== 0,
    );
    expect(moved).toHaveLength(2);
    for (const employment of moved) {
      const days = employment.endsOn === null ? 0 : diffDays(PACK_START, employment.endsOn);
      expect(days).toBeGreaterThanOrEqual(30);
      expect(days).toBeLessThanOrEqual(180);
    }
  });
});

describe('createNewGame: setup steps', () => {
  it('runs the built-in steps in their documented order', () => {
    expect(setupSteps()).toEqual([
      { id: 'wld.applyTunableOverrides', order: 100 },
      { id: 'wld.foundPromotion', order: 200 },
      { id: 'wld.assignControllers', order: 300 },
      { id: 'wld.contractExpiryFixup', order: 400 },
      { id: 'wld.randomiseContractLengths', order: 500 },
      { id: 'wld.equalStart', order: 600 },
      { id: 'wld.rerollPotential', order: 700 },
      { id: 'wld.storeSettings', order: 800 },
    ]);
  });

  it('aborts with the failing step report and no world', () => {
    cleanups.push(
      registerSetupStep({
        id: 'test.alwaysFails',
        order: 950,
        run: () => {
          throw new Error('broken on purpose');
        },
      }),
    );
    const result = createNewGame(miniWorldPacks(), baseInput());
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('state');
    if (result.ok) {
      return;
    }
    expect(result.reasons).toEqual([expect.objectContaining({ code: 'setupStepFailed' })]);
    expect(result.reasons[0]?.message).toContain('test.alwaysFails');
    expect(result.report).toMatchObject({
      stepId: 'test.alwaysFails',
      status: 'failed',
      error: { message: 'broken on purpose' },
    });
  });

  it('runs a step at 650 after equal start and before the potential re-roll', () => {
    const seen: string[] = [];
    let cashAt650: number[] = [];
    cleanups.push(
      registerSetupStep({
        id: 'test.before',
        order: 599,
        run: () => {
          seen.push('before equal start');
        },
      }),
      registerSetupStep({
        id: 'test.between',
        order: 650,
        run: (tx) => {
          seen.push('650');
          cashAt650 = tx.view.tables.promotions.values().map((row) => row.cash);
        },
      }),
      registerSetupStep({
        id: 'test.after',
        order: 701,
        run: () => {
          seen.push('after re-roll');
        },
      }),
    );
    expect(setupSteps().map((step) => step.id)).toEqual([
      'wld.applyTunableOverrides',
      'wld.foundPromotion',
      'wld.assignControllers',
      'wld.contractExpiryFixup',
      'wld.randomiseContractLengths',
      'test.before',
      'wld.equalStart',
      'test.between',
      'wld.rerollPotential',
      'test.after',
      'wld.storeSettings',
    ]);
    newGame(baseInput({ settings: { equalStart: true } }));
    expect(seen).toEqual(['before equal start', '650', 'after re-roll']);
    expect(cashAt650.length).toBeGreaterThan(0);
    expect(cashAt650.every((cash) => cash === 100_000_000)).toBe(true);
  });

  it('skips a step whose condition is false', () => {
    let ran = false;
    cleanups.push(
      registerSetupStep({
        id: 'test.onlyWhenSandbox',
        order: 960,
        when: (settings) => settings['sandbox'] === true,
        run: () => {
          ran = true;
        },
      }),
    );
    newGame(baseInput());
    expect(ran).toBe(false);
    newGame(baseInput({ settings: { sandbox: true } }));
    expect(ran).toBe(true);
  });

  it('refuses a step order or id that is already taken', () => {
    expect(() => registerSetupStep({ id: 'test.clash', order: 600, run: () => undefined })).toThrow(
      /wld.equalStart/,
    );
    expect(() =>
      registerSetupStep({ id: 'wld.equalStart', order: 601, run: () => undefined }),
    ).toThrow(/already registered/);
  });
});

describe('createNewGame: summary', () => {
  it('counts the world and lists the settings and packs', () => {
    const { summary, state } = newGame(baseInput());
    expect(summary).toMatchObject({
      saveName: 'Harbour Run',
      playerName: 'Alex Booker',
      playerId: 'local-player',
      startDate: PACK_START,
      counts: {
        promotions: state.world.tables.promotions.length,
        people: state.world.tables.people.length,
        titles: state.world.tables.titles.length,
        freeAgents: 0,
      },
      packVersions: [
        { id: 'mini-base', version: '1.2.0' },
        { id: 'mini-world', version: '1.0.0' },
      ],
    });
    expect(summary.settings).toEqual({
      agingEnabled: true,
      sandbox: false,
      generationLevel: 'low',
      levelPlayingField: false,
      equalStart: false,
      randomiseContractLengths: false,
      rerollPotential: false,
    });
    expect(weekday(summary.startDate)).toBe(weekday(PACK_START));
  });
});
