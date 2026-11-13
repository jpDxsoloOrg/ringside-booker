// The Promotions queries and who sees what (AIP1-05): promotions.list, promotions.profile,
// promotions.roster, aip.needs and aip.decisionLog, and the one reveal rule.
// Design: docs/design/rival-desk.md#promotions-queries
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  initialEngineState,
  OMNISCIENT_VIEWER,
  type Engine,
  type Viewer,
} from '../../../src/core/api';
import type { QueryArgs, QueryData, QueryName } from '../../../src/core/api/maps';
import { addDays, type GameDate } from '../../../src/core/date';
import { cents } from '../../../src/core/money';
import type { PromotionId } from '../../../src/core/ids';
import type { GameWorld } from '../../../src/model/tables';
import { isRevealedTo, setCompanySizeSource } from '../../../src/systems/aip';
import { defaultSystems } from '../../../src/systems';
import { anAiDecision } from '../../support/builders/promotions';
import { TEST_PLAYER_ID, TEST_START_DATE } from '../../support/builders/build-row';
import { testId } from '../../support/ids';
import { expectSerialisable } from '../../support/trace';
import { worldBuilder, type BuiltWorld } from '../../support/world-builder';

const HUMAN = { kind: 'human', playerId: TEST_PLAYER_ID } as const;
const COMPUTER = { kind: 'computer' } as const;
const PLAYER: Viewer = { kind: 'controller', controller: HUMAN };
const TODAY: GameDate = TEST_START_DATE;
const MISSING = testId('promotion', 9_999);

interface QueryWorld extends BuiltWorld {
  readonly engine: Engine;
  readonly own: PromotionId;
  readonly rival: PromotionId;
}

/** A: the player's (cash 1,000,000.00); B: a computer rival (cash 2,500,000.00), with decisions. */
function queryWorld(sandbox = false): QueryWorld {
  const built = worldBuilder({ settings: { sandbox } })
    .withGeography('mini')
    .withPromotion({ controller: HUMAN, cash: cents(100_000_000) }, (promotion) =>
      promotion
        .withBrand()
        .withRoster(4)
        .withTitle({ name: 'A Title' }, { holder: 0 })
        .withWeeklyShow(),
    )
    .withPromotion(
      { controller: COMPUTER, cash: cents(250_000_000), name: 'B Wrestling' },
      (promotion) =>
        promotion
          .withBrand()
          .withRoster(6, {
            employment: (index) => ({
              role: index === 5 ? 'referee' : 'wrestler',
              push: index === 5 ? 'none' : 'midCard',
            }),
          })
          .withTitle({ name: 'B Title' }, { holder: 1 }),
    )
    .with('decisions', (context) => {
      const rival = context.ids.promotions.B;
      if (rival === undefined) {
        throw new Error('no rival');
      }
      // Yesterday's review (revealed), today's plan (still hidden) and tomorrow's (hidden).
      for (const [date, revealOn] of [
        [addDays(TODAY, -1), addDays(TODAY, -1)],
        [TODAY, TODAY],
        [TODAY, addDays(TODAY, 1)],
      ] as const) {
        context.insert(
          'aiDecisions',
          anAiDecision({ promotionId: rival, date, revealOn }, context.sequence),
        );
      }
    })
    .build();
  const own = built.ids.promotions.A;
  const rival = built.ids.promotions.B;
  if (own === undefined || rival === undefined) {
    throw new Error('the query world has no promotions');
  }
  const engine = createEngine({ state: initialEngineState(built.world), systems: defaultSystems });
  return { ...built, engine, own, rival };
}

function ask<N extends QueryName>(
  engine: Engine,
  name: N,
  args: QueryArgs<N>,
  viewer: Viewer = PLAYER,
): QueryData<N> {
  const result = engine.query(name, args, viewer);
  if (!result.ok) {
    return expect.fail(`${name} refused: ${JSON.stringify(result.reasons)}`);
  }
  expectSerialisable(result.data);
  return result.data;
}

function refusalCodes<N extends QueryName>(engine: Engine, name: N, args: QueryArgs<N>): string[] {
  const result = engine.query(name, args, PLAYER);
  return result.ok ? [] : result.reasons.map((reason) => reason.code);
}

/** Every object key anywhere in a JSON value. */
function keysIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      keysIn(item, found);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      found.add(key);
      keysIn(item, found);
    }
  }
  return found;
}

describe('promotions.list', () => {
  it('shows your own cash exactly and hides the rival’s', () => {
    const { engine, own, rival } = queryWorld();
    const rows = ask(engine, 'promotions.list', {});
    expect(rows.map((row) => row.promotionId)).toEqual(
      [...rows]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((row) => row.promotionId),
    );
    const ownRow = rows.find((row) => row.promotionId === own);
    const rivalRow = rows.find((row) => row.promotionId === rival);
    expect(ownRow).toMatchObject({
      controlledBy: 'you',
      controllerName: 'Test Player 1',
      cash: { kind: 'exact', value: 100_000_000 },
      rosterCount: 4,
      crewCount: 0,
      brandCount: 1,
    });
    expect(rivalRow).toMatchObject({
      controlledBy: 'computer',
      controllerName: null,
      cash: { kind: 'hidden' },
      rosterCount: 5,
      crewCount: 1,
    });
    expect(rivalRow?.champions.map((line) => [line.titleName, line.holderNames.length])).toEqual([
      ['B Title', 1],
    ]);
    expect(rivalRow?.popularity.home.trace).toBeDefined();
    // ECO1's public size band (AIP1-07), never cash.
    expect(rivalRow?.size).toEqual({
      label: expect.stringMatching(/^(Local|Regional|National|Continental|Global)$/),
      reach: expect.any(Number),
    });
  });

  it('carries no size when no feature supplies one (a game without ECO1)', () => {
    const restore = setCompanySizeSource(null);
    try {
      const rows = ask(queryWorld().engine, 'promotions.list', {});
      expect(rows.every((row) => row.size === null)).toBe(true);
    } finally {
      restore();
    }
  });

  it("reads the size off ECO1's finance.company", () => {
    const { engine, rival } = queryWorld();
    const row = ask(engine, 'promotions.list', {}).find((entry) => entry.promotionId === rival);
    const company = ask(engine, 'finance.company', { promotionId: rival });
    expect(row?.size).toEqual({ label: company.sizeLabel, reach: company.reach });
  });

  it('shows every cash figure to the all-seeing viewer and in a sandbox game', () => {
    const omniscient = ask(queryWorld().engine, 'promotions.list', {}, OMNISCIENT_VIEWER);
    expect(omniscient.every((row) => row.cash.kind === 'exact')).toBe(true);
    // The all-seeing viewer runs nothing, so a human promotion is another player's.
    expect(omniscient.map((row) => row.controlledBy).sort()).toEqual(['computer', 'otherPlayer']);

    const sandbox = queryWorld(true);
    const rivalRow = ask(sandbox.engine, 'promotions.list', {}).find(
      (row) => row.promotionId === sandbox.rival,
    );
    expect(rivalRow?.cash).toEqual({ kind: 'exact', value: 250_000_000 });
  });
});

describe('promotions.profile', () => {
  it('gives header, KPIs, popularity, shows, titles and the rules, with cash hidden for a rival', () => {
    const { engine, own, rival } = queryWorld();
    const profile = ask(engine, 'promotions.profile', { promotionId: rival });
    expect(profile.header).toMatchObject({ name: 'B Wrestling', controlledBy: 'computer' });
    expect(profile.kpis).toMatchObject({
      rosterCount: 5,
      crewCount: 1,
      championCount: 1,
      showsPerMonth: 0,
      cash: { kind: 'hidden' },
    });
    expect(profile.hidden).toEqual(['cash']);
    expect(profile.hasProfile).toBe(false);
    expect(profile.rules.inForce).toBe(true);
    expect(profile.rules.shortcuts).toHaveLength(6);
    expect(profile.rules.shortcuts.every((shortcut) => shortcut.on)).toBe(true);
    expect(
      profile.titles.map((title) => [title.name, title.holderNames.length, title.wonOn]),
    ).toEqual([['B Title', 1, TODAY]]);

    const mine = ask(engine, 'promotions.profile', { promotionId: own });
    expect(mine.kpis.cash).toEqual({ kind: 'exact', value: 100_000_000 });
    expect(mine.hidden).toEqual([]);
    expect(mine.rules.inForce).toBe(false);
    expect(mine.rules.shortcuts.every((shortcut) => !shortcut.on)).toBe(true);
    // A weekly show on Mondays: four show dates in the next 28 days.
    expect(mine.kpis.showsPerMonth).toBe(4);
    expect(mine.shows).toHaveLength(1);
    expect(mine.shows[0]?.recurrenceLabel).toContain('Monday');
    expect(mine.header.brands.map((brand) => brand.controlledBy)).toEqual(['you']);
  });

  it('refuses an unknown promotion with notFound', () => {
    const { engine } = queryWorld();
    expect(refusalCodes(engine, 'promotions.profile', { promotionId: MISSING })).toEqual([
      'notFound',
    ]);
  });
});

describe('promotions.roster', () => {
  it('values wrestlers, leaves crew without a card value and never shows private fields', () => {
    const { engine, rival } = queryWorld();
    for (const viewer of [PLAYER, OMNISCIENT_VIEWER]) {
      const roster = ask(engine, 'promotions.roster', { promotionId: rival }, viewer);
      expect(roster.rows).toHaveLength(6);
      const keys = keysIn(roster);
      for (const banned of ['terms', 'morale', 'development', 'potential']) {
        expect(keys.has(banned)).toBe(false);
      }
      const referee = roster.rows.find((row) => row.role === 'referee');
      expect(referee?.cardValue).toBeNull();
      expect(roster.rows.at(-1)?.role).toBe('referee');
      const wrestlers = roster.rows.filter((row) => row.role === 'wrestler');
      expect(wrestlers.every((row) => row.cardValue !== null)).toBe(true);
      const values = wrestlers.map((row) => row.cardValue?.value ?? 0);
      expect(values).toEqual([...values].sort((left, right) => right - left));
      expect(roster.rows.filter((row) => row.isChampion)).toHaveLength(1);
      expect(roster.taste.label).toBe('Style taste: Mainstream');
      expect(roster.taste.axes).toHaveLength(8);
    }
  });

  it('filters by brand and refuses an unknown promotion or a brand of another', () => {
    const { engine, rival, ids } = queryWorld();
    const rivalBrand = ids.brands[1];
    const ownBrand = ids.brands[0];
    if (rivalBrand === undefined || ownBrand === undefined) {
      throw new Error('no brands');
    }
    expect(
      ask(engine, 'promotions.roster', { promotionId: rival, brandId: rivalBrand }).rows,
    ).toHaveLength(6);
    expect(
      refusalCodes(engine, 'promotions.roster', { promotionId: rival, brandId: ownBrand }),
    ).toEqual(['notFound']);
    expect(refusalCodes(engine, 'promotions.roster', { promotionId: MISSING })).toEqual([
      'notFound',
    ]);
  });
});

describe('aip.needs', () => {
  it('works out needs live for a rival and for your own promotion', () => {
    const { engine, own, rival } = queryWorld();
    const needs = ask(engine, 'aip.needs', { promotionId: rival });
    expect(needs.unitName).toBe('B Wrestling');
    expect(needs.computedOn).toBe(TODAY);
    // No shows: the default 6 slots × 2 wrestlers per slot.
    expect(needs.slotsDemanded.value).toBe(12);
    expect(needs.needs.length).toBeGreaterThan(0);
    for (const need of needs.needs) {
      expect(need.severity.trace).toBeDefined();
      expect(need.text).not.toBe(need.summary.key);
    }
    const mine = ask(engine, 'aip.needs', { promotionId: own });
    expect(mine.slotsDemanded.trace.label).toBe('Wrestlers the shows call for');
    expect(refusalCodes(engine, 'aip.needs', { promotionId: MISSING })).toEqual(['notFound']);
  });
});

describe('aip.decisionLog', () => {
  it('hides plans that have not aired from a rival and counts them', () => {
    const { engine, rival } = queryWorld();
    const log = ask(engine, 'aip.decisionLog', { promotionId: rival });
    expect(log.entries.map((entry) => entry.date)).toEqual([addDays(TODAY, -1)]);
    expect(log.hiddenCount).toBe(2);
    expect(log.kinds).toEqual([{ kind: 'rosterReview', chip: 'Roster review', count: 1 }]);
    expect(log.entries[0]).toMatchObject({
      chip: 'Roster review',
      traceRef: null,
      text: 'Weekly roster review: no pressing needs',
    });
    expect(log.nextBefore).toBeNull();
  });

  it('shows everything to the all-seeing viewer and in a sandbox game', () => {
    const omniscient = ask(
      queryWorld().engine,
      'aip.decisionLog',
      { promotionId: queryWorld().rival },
      OMNISCIENT_VIEWER,
    );
    expect(omniscient.entries).toHaveLength(3);
    expect(omniscient.hiddenCount).toBe(0);

    const sandbox = queryWorld(true);
    const log = ask(sandbox.engine, 'aip.decisionLog', { promotionId: sandbox.rival });
    expect(log.entries).toHaveLength(3);
    expect(log.hiddenCount).toBe(0);
  });

  it('pages newest first with before and nextBefore, and filters by kind', () => {
    const { engine, rival } = queryWorld();
    const first = ask(
      engine,
      'aip.decisionLog',
      { promotionId: rival, limit: 2 },
      OMNISCIENT_VIEWER,
    );
    expect(first.entries.map((entry) => entry.date)).toEqual([TODAY, TODAY]);
    expect(first.nextBefore).toBe(first.entries[1]?.decisionId);
    const second = ask(
      engine,
      'aip.decisionLog',
      { promotionId: rival, limit: 2, before: first.nextBefore ?? undefined },
      OMNISCIENT_VIEWER,
    );
    expect(second.entries.map((entry) => entry.date)).toEqual([addDays(TODAY, -1)]);
    expect(second.nextBefore).toBeNull();

    const none = ask(
      engine,
      'aip.decisionLog',
      { promotionId: rival, kinds: ['push'] },
      OMNISCIENT_VIEWER,
    );
    expect(none.entries).toEqual([]);
    expect(none.kinds).toHaveLength(1);
    expect(refusalCodes(engine, 'aip.decisionLog', { promotionId: rival, limit: 0 })).toEqual([
      'invalidArgs',
    ]);
  });
});

describe('isRevealedTo', () => {
  function worldOn(): { world: GameWorld; rival: PromotionId; own: PromotionId } {
    const built = queryWorld();
    return { world: built.world, rival: built.rival, own: built.own };
  }

  it('hides a rival plan on its reveal day and shows it the day after', () => {
    const { world, rival, own } = worldOn();
    const today = world.meta.currentDate;
    expect(isRevealedTo(world, PLAYER, rival, today)).toBe(false);
    expect(isRevealedTo(world, PLAYER, rival, addDays(today, -1))).toBe(true);
    expect(isRevealedTo(world, PLAYER, rival, addDays(today, 1))).toBe(false);
    expect(isRevealedTo(world, OMNISCIENT_VIEWER, rival, addDays(today, 1))).toBe(true);
    expect(isRevealedTo(world, PLAYER, own, addDays(today, 30))).toBe(true);
  });
});
