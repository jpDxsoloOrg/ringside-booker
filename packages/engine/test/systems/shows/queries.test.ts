// The results queries. Design: docs/design/show-night.md#results-queries
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  initialEngineState,
  type Engine,
  type EngineState,
} from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { controllerViewer, type Viewer } from '../../../src/core/api/controller';
import { addDays, type GameDate } from '../../../src/core/date';
import {
  parseId,
  type EventInstanceId,
  type PersonId,
  type SegmentId,
  type TeamId,
} from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import type { QueryArgs, QueryData } from '../../../src/core/api/maps';
import type { GameWorld } from '../../../src/model/tables';
import { matchSystem } from '../../../src/systems/match';
import {
  DEFAULT_COMPLETED_SINCE,
  SHOW_NOT_FOUND_MESSAGE,
  showsSystem,
  type SegmentResultView,
} from '../../../src/systems/shows';
import { aTeam, anEventInstance, worldBuilder } from '../../support';
import { expectSerialisable } from '../../support/trace';
import { promo, seed, singles } from '../booking/command-world';
import { OMNISCIENT, PLAYER_ONE } from '../calendar/lifecycle-world';
import { START, TODAY, competitor, titleMatch, winFor } from './title-night-world';

const PLAYER: Viewer = controllerViewer(PLAYER_ONE);
const COMPUTER: Viewer = controllerViewer({ kind: 'computer' });
const TOMORROW = addDays(TODAY, 1);

interface ResultsWorld {
  readonly world: GameWorld;
  /** A's show today: pre-show promo, tag title retained, vacant title draw, no contest, world title change. */
  readonly human: EventInstanceId;
  /** B's show today with no card: scored off-screen. */
  readonly rivalBare: EventInstanceId;
  /** B's show tomorrow with a singles match. */
  readonly rivalNext: EventInstanceId;
  /** B's show in three days, booked but not run. */
  readonly rivalLater: EventInstanceId;
  readonly card: {
    readonly promo: SegmentId;
    readonly tag: SegmentId;
    readonly vacant: SegmentId;
    readonly noContest: SegmentId;
    readonly main: SegmentId;
  };
  readonly roster: readonly PersonId[];
}

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`Missing entry ${String(index)}`);
  }
  return value;
}

function resultsWorld(): ResultsWorld {
  let shows:
    | {
        human: EventInstanceId;
        rivalBare: EventInstanceId;
        rivalNext: EventInstanceId;
        rivalLater: EventInstanceId;
      }
    | undefined;
  let holders: TeamId | undefined;
  const { world, ids } = worldBuilder({
    startDate: START,
    currentDate: TODAY,
    players: [{ playerId: 'player-1', displayName: 'Test Player 1' }],
  })
    .withCatalogs()
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A', controller: PLAYER_ONE }, (promotion) =>
      promotion
        .withRoster(11)
        .withTitle({ name: 'Test World Title' }, { holder: 0 })
        .withTitle({ name: 'Test Tag Title', holderCount: 2 }, { holder: [2, 3] })
        .withTitle({ name: 'Test Vacant Title' })
        .withTitle({ name: 'Test Second Title' }, { holder: 8 }),
    )
    .withPromotion({ name: 'Test Promotion B' }, (promotion) => promotion.withRoster(4))
    .with('shows', (context) => {
      const promotionA = context.ids.promotions.A;
      const promotionB = context.ids.promotions.B;
      const regionId = context.ids.regions[0];
      if (promotionA === undefined || promotionB === undefined || regionId === undefined) {
        throw new Error('The results world is missing a promotion or a region');
      }
      holders = context.insert(
        'teams',
        aTeam(
          {
            name: 'Test Holders',
            memberIds: [at(context.ids.people, 2), at(context.ids.people, 3)],
          },
          context.sequence,
        ),
      ).id;
      const add = (
        name: string,
        promotionId: typeof promotionA,
        date: GameDate,
        extra: { status?: 'booked'; format?: { slots: number; preShowSlots: number } } = {},
      ): EventInstanceId =>
        context.insert(
          'eventInstances',
          anEventInstance({ name, promotionId, regionId, date, ...extra }, context.sequence),
        ).id;
      shows = {
        human: add('Test Human Show', promotionA, TODAY, {
          status: 'booked',
          format: { slots: 5, preShowSlots: 1 },
        }),
        rivalBare: add('Test Rival Bare', promotionB, TODAY),
        rivalNext: add('Test Rival Next', promotionB, TOMORROW),
        rivalLater: add('Test Rival Later', promotionB, addDays(TODAY, 3), { status: 'booked' }),
      };
    })
    .build();
  if (shows === undefined || holders === undefined) {
    throw new Error('The results world was built without its shows');
  }
  const roster = ids.people.slice(0, 11);
  const rivals = ids.people.slice(11, 15);
  const person = (index: number): PersonId => at(roster, index);
  const [world0, tag, vacant, second] = ids.titles;
  if (world0 === undefined || tag === undefined || vacant === undefined || second === undefined) {
    throw new Error('The results world is missing a title');
  }
  const team = holders;
  const card = {
    promo: seed(world, shows.human, 0, promo(person(10)), true),
    tag: seed(
      world,
      shows.human,
      1,
      titleMatch(
        [
          competitor(person(2), 0, team),
          competitor(person(3), 0, team),
          competitor(person(4), 1),
          competitor(person(5), 1),
        ],
        winFor(0),
        [tag],
        'match.tag-team',
      ),
    ),
    vacant: seed(
      world,
      shows.human,
      2,
      titleMatch([competitor(person(6), 0), competitor(person(7), 1)], { kind: 'draw' }, [vacant]),
    ),
    noContest: seed(
      world,
      shows.human,
      3,
      titleMatch([competitor(person(8), 0), competitor(person(9), 1)], { kind: 'noContest' }, [
        second,
      ]),
    ),
    main: seed(
      world,
      shows.human,
      4,
      titleMatch([competitor(person(0), 0), competitor(person(1), 1)], winFor(1), [world0]),
    ),
  };
  seed(world, shows.rivalNext, 0, singles(at(rivals, 0), at(rivals, 1), winFor(0)));
  seed(world, shows.rivalLater, 0, singles(at(rivals, 2), at(rivals, 3), winFor(1)));
  return { world, ...shows, card, roster };
}

const SYSTEMS = [simSystem, matchSystem, showsSystem];

/** Runs today and tomorrow, so the world stands on the day after tomorrow. */
async function playedEngine(): Promise<{ engine: Engine; built: ResultsWorld }> {
  const built = resultsWorld();
  const engine = createEngine({ state: initialEngineState(built.world), systems: SYSTEMS });
  const advanced = await engine.advanceDays({ maxDays: 2 });
  expect(advanced.failures).toEqual([]);
  return { engine, built };
}

function query<N extends 'shows.results' | 'shows.lastCompleted' | 'shows.completedSince'>(
  engine: Engine,
  name: N,
  args: QueryArgs<N>,
  viewer: Viewer = PLAYER,
): QueryData<N> {
  const result = engine.query(name, args, viewer);
  if (!result.ok) {
    throw new Error(`${name} failed: ${JSON.stringify(result.reasons)}`);
  }
  expectSerialisable(result.data);
  return result.data;
}

function results(engine: Engine, id: EventInstanceId, viewer: Viewer = PLAYER) {
  const view = query(engine, 'shows.results', { eventInstanceId: id }, viewer);
  if (view === null) {
    throw new Error(`No results for ${id}`);
  }
  return view;
}

function segment(segments: readonly SegmentResultView[], id: SegmentId): SegmentResultView {
  const found = segments.find((entry) => entry.segmentId === id);
  if (found === undefined) {
    throw new Error(`No segment ${id}`);
  }
  return found;
}

/** Every key in a JSON value, at any depth. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(keysOf);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)]);
  }
  return [];
}

function ringNameOf(state: EngineState, personId: PersonId): string | undefined {
  return state.world.tables.employments.find(
    (employment) => employment.personId === personId && employment.status === 'active',
  )?.ringName;
}

describe('shows.results', () => {
  it('returns every segment of a completed show in card order with its result', async () => {
    const { engine, built } = await playedEngine();
    const view = results(engine, built.human);

    expect(view).toMatchObject({
      eventInstanceId: built.human,
      name: 'Test Human Show',
      status: 'completed',
      mine: true,
      offscreen: false,
      format: { slots: 5, preShowSlots: 1 },
    });
    expect(view.result?.score).toBeGreaterThanOrEqual(0);
    expect(view.result?.scoreTraceRef).toEqual({ kind: 'shows.showScore', id: built.human });
    expect(view.segments.map((entry) => entry.segmentId)).toEqual([
      built.card.promo,
      built.card.tag,
      built.card.vacant,
      built.card.noContest,
      built.card.main,
    ]);
    expect(
      view.segments.map((entry) => [entry.slotNumber, entry.preShow, entry.roleLabel]),
    ).toEqual([
      [1, true, 'Pre-show'],
      [2, false, 'Midcard'],
      [3, false, 'Midcard'],
      [4, false, 'Semi-main'],
      [5, false, 'Main event'],
    ]);

    const promoView = segment(view.segments, built.card.promo);
    expect(promoView).toMatchObject({ kind: 'angle', typeName: 'Promo', outcome: null });
    expect(promoView.rating?.workRate).toBeNull();

    const main = segment(view.segments, built.card.main);
    expect(main.outcome).toEqual({
      kind: 'win',
      winningSide: 1,
      methodName: 'Pinfall',
      // MTCH2 picks the finish on the night and keeps the decision for the winner Why? (EVT3-07).
      finishName: expect.any(String) as unknown,
      resultTraceRef: { kind: 'match.result', id: built.card.main },
    });
    expect(main.durationLabel).toBe('Long');
    expect(main.rating?.traceRef).toEqual({ kind: 'shows.segmentScore', id: built.card.main });
    const winner = at(built.roster, 1);
    const state = engine.exportState();
    expect(main.sides[1]?.members[0]).toMatchObject({
      personId: winner,
      name: ringNameOf(state, winner),
      role: 'competitor',
    });
    expect(main.titles).toEqual([
      expect.objectContaining({
        name: 'Test World Title',
        outcome: 'newChampion',
        newHolderNames: [ringNameOf(state, winner)],
        outcomeTraceRef: {
          kind: 'shows.titleOutcome',
          id: `${built.card.main}|${String(main.titles[0]?.titleId)}`,
        },
      }),
    ]);

    const tag = segment(view.segments, built.card.tag);
    expect(tag.sides[0]?.label).toBe('Test Holders');
    expect(tag.titles[0]).toMatchObject({ outcome: 'retained', newHolderNames: [] });
    expect(tag.titles[0]?.outcomeTraceRef).not.toBeNull();

    const vacant = segment(view.segments, built.card.vacant);
    expect(vacant.outcome).toMatchObject({ kind: 'draw' });
    expect(vacant.titles[0]?.outcome).toBe('stillVacant');

    const noContest = segment(view.segments, built.card.noContest);
    expect(noContest.outcome).toMatchObject({ kind: 'noContest' });
    expect(noContest.titles[0]?.outcome).toBe('none');
  });

  it('keeps the ref of a summarised trace and drops the ref of an evicted one', async () => {
    const { engine, built } = await playedEngine();
    const override = (key: string, value: number) => {
      const done = engine.command('tunables.setOverride', { key, value }, PLAYER_ONE);
      expect(done.ok).toBe(true);
    };

    override('sim.traceRetentionPerKind', 0);
    const summarised = results(engine, built.human);
    expect(segment(summarised.segments, built.card.main).rating?.traceRef).toEqual({
      kind: 'shows.segmentScore',
      id: built.card.main,
    });
    expect(summarised.result?.scoreTraceRef).not.toBeNull();

    override('sim.traceSummaryLimit', 0);
    const evicted = results(engine, built.human);
    const main = segment(evicted.segments, built.card.main);
    expect(main.rating?.traceRef).toBeNull();
    expect(main.titles[0]?.outcomeTraceRef).toBeNull();
    expect(evicted.result?.scoreTraceRef).toBeNull();
  });

  it('breaks the score down from its trace, slot by slot, adding up to the score', async () => {
    const { engine, built } = await playedEngine();
    const view = results(engine, built.human);
    const breakdown = view.result?.breakdown;
    if (breakdown === null || breakdown === undefined) throw new Error('No breakdown');
    const sum = breakdown.rows.reduce((total, row) => total + row.points, 0);
    expect(sum).toBeCloseTo(view.result?.score ?? -1, 9);

    const rated = view.segments.filter((entry) => entry.rating !== null);
    const rows = breakdown.rows.filter((row) => row.kind === 'segment');
    expect(rows.map((row) => row.segmentId)).toEqual(rated.map((entry) => entry.segmentId));
    expect(rows.map((row) => row.score)).toEqual(rated.map((entry) => entry.rating?.score));
    // The pre-show promo counts at the pre-show factor.
    expect(rows[0]).toMatchObject({ preShow: true, segmentId: built.card.promo });
    expect(breakdown.preShowFactor).not.toBeNull();
  });

  it('gives each rated segment its top two reasons, and none once the trace is summarised', async () => {
    const { engine, built } = await playedEngine();
    const main = segment(results(engine, built.human).segments, built.card.main);
    const reasons = main.rating?.reasons ?? [];
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.length).toBeLessThanOrEqual(2);
    for (const reason of reasons) {
      expect(reason.label).not.toBe('');
      expect(Math.abs(reason.effect)).toBeGreaterThanOrEqual(0.5);
    }

    const done = engine.command(
      'tunables.setOverride',
      { key: 'sim.traceRetentionPerKind', value: 0 },
      PLAYER_ONE,
    );
    expect(done.ok).toBe(true);
    const summarised = results(engine, built.human);
    expect(segment(summarised.segments, built.card.main).rating?.reasons).toEqual([]);
    expect(summarised.result?.breakdown).toBeNull();
  });

  it('has no breakdown for a show scored off-screen', async () => {
    const { engine, built } = await playedEngine();
    expect(results(engine, built.rivalBare).result?.breakdown).toBeNull();
  });

  it('shows the gate only to the promotion that ran the show', async () => {
    const { engine, built } = await playedEngine();
    const state = engine.exportState();
    for (const instance of state.world.tables.eventInstances) {
      if (instance.result !== null) {
        instance.result.gate = cents(123_400);
      }
    }
    const withGates = createEngine({ state, systems: SYSTEMS });

    expect(results(withGates, built.human).result?.gate).toBe(123_400);
    expect(results(withGates, built.rivalNext).result?.gate).toBeNull();
    expect(results(withGates, built.rivalNext).mine).toBe(false);
    expect(results(withGates, built.human, COMPUTER).result?.gate).toBeNull();
    expect(results(withGates, built.human, COMPUTER).mine).toBe(false);
  });

  it('marks an off-screen show and lists no segments', async () => {
    const { engine, built } = await playedEngine();
    const view = results(engine, built.rivalBare);
    expect(view.offscreen).toBe(true);
    expect(view.segments).toEqual([]);
    expect(view.result).not.toBeNull();
  });

  it("hides a rival's card until it airs", async () => {
    const { engine, built } = await playedEngine();
    const later = results(engine, built.rivalLater);
    expect(later.status).toBe('booked');
    expect(later.result).toBeNull();
    expect(later.segments).toEqual([]);

    const aired = results(engine, built.rivalNext);
    expect(aired.segments).toHaveLength(1);
    expect(aired.segments[0]?.outcome).toMatchObject({ kind: 'win', winningSide: 0 });
    expect(aired.segments[0]?.rating?.traceRef).toMatchObject({ kind: 'shows.rivalSegmentScore' });
  });

  it("shows the viewer's own unaired card without results", () => {
    const built = resultsWorld();
    const engine = createEngine({ state: initialEngineState(built.world), systems: SYSTEMS });
    const view = results(engine, built.human);
    expect(view.result).toBeNull();
    expect(view.segments).toHaveLength(5);
    for (const entry of view.segments) {
      expect(entry.outcome).toBeNull();
      expect(entry.rating).toBeNull();
      expect(entry.titles.every((title) => title.outcome === 'none')).toBe(true);
    }
  });

  it('refuses an unknown show', async () => {
    const { engine } = await playedEngine();
    const result = engine.query(
      'shows.results',
      { eventInstanceId: parseId('eventInstance', 'evi_zzzzzzzzzz') },
      PLAYER,
    );
    expect(result).toEqual({
      ok: false,
      reasons: [{ code: 'notFound', message: SHOW_NOT_FOUND_MESSAGE }],
    });
  });
});

describe('shows.lastCompleted', () => {
  it("returns the viewer's latest show by default and the world's on request", async () => {
    const { engine, built } = await playedEngine();
    const mine = query(engine, 'shows.lastCompleted', {});
    expect(mine).toMatchObject({ eventInstanceId: built.human, mine: true });
    expect(mine?.mainEvent).toMatchObject({
      typeName: 'Singles',
      winnerSide: mine?.mainEvent?.sides[1],
    });
    expect(mine?.titleChanges).toEqual([
      { titleName: 'Test World Title', newHolderNames: [expect.any(String)] },
    ]);

    expect(query(engine, 'shows.lastCompleted', { scope: 'world' })?.eventInstanceId).toBe(
      built.rivalNext,
    );
    // The omniscient viewer runs nothing, so "mine" reads the whole world.
    expect(query(engine, 'shows.lastCompleted', {}, OMNISCIENT)?.eventInstanceId).toBe(
      built.rivalNext,
    );
  });

  it('returns null before any show has run', () => {
    const built = resultsWorld();
    const engine = createEngine({ state: initialEngineState(built.world), systems: SYSTEMS });
    expect(query(engine, 'shows.lastCompleted', { scope: 'world' })).toBeNull();
  });
});

describe('shows.completedSince', () => {
  it('honours the half-open range, the scope and the limit', async () => {
    const { engine, built } = await playedEngine();
    const ids = (args: QueryArgs<'shows.completedSince'>) =>
      query(engine, 'shows.completedSince', args).map((show) => show.eventInstanceId);
    const dayAfter = addDays(TODAY, 2);
    const todays = [built.human, built.rivalBare].sort().reverse();

    expect(ids({ from: TODAY, to: dayAfter, scope: 'world' })).toEqual([
      built.rivalNext,
      ...todays,
    ]);
    expect(ids({ from: TODAY, to: TOMORROW, scope: 'world' })).toEqual(todays);
    expect(ids({ from: TOMORROW, to: dayAfter, scope: 'world' })).toEqual([built.rivalNext]);
    expect(ids({ from: TODAY, to: TODAY, scope: 'world' })).toEqual([]);
    expect(ids({ from: TODAY, to: dayAfter, scope: 'mine' })).toEqual([built.human]);
    expect(ids({ from: TODAY, to: dayAfter, scope: 'world', limit: 1 })).toEqual([built.rivalNext]);
    expect(DEFAULT_COMPLETED_SINCE).toBe(10);
  });

  it('refuses a backwards or too long range and a bad limit', async () => {
    const { engine } = await playedEngine();
    const refused = (args: QueryArgs<'shows.completedSince'>) =>
      engine.query('shows.completedSince', args, PLAYER).ok;
    expect(refused({ from: TOMORROW, to: TODAY, scope: 'world' })).toBe(false);
    expect(refused({ from: TODAY, to: addDays(TODAY, 3651), scope: 'world' })).toBe(false);
    expect(refused({ from: TODAY, to: TOMORROW, scope: 'world', limit: 51 })).toBe(false);
    expect(refused({ from: TODAY, to: TOMORROW, scope: 'world', limit: 0 })).toBe(false);
  });
});

describe('the results views', () => {
  it('have no field that is a length or a time', async () => {
    const { engine, built } = await playedEngine();
    const views: unknown[] = [
      results(engine, built.human),
      results(engine, built.rivalNext),
      results(engine, built.rivalBare),
      query(engine, 'shows.lastCompleted', {}),
      query(engine, 'shows.completedSince', {
        from: TODAY,
        to: addDays(TODAY, 2),
        scope: 'world',
      }),
    ];
    const keys = views.flatMap(keysOf);
    expect(keys.length).toBeGreaterThan(50);
    expect(keys.filter((key) => /minute|length/i.test(key))).toEqual([]);
  });
});
