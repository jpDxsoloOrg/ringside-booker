// Live show night (EVT10-01): running the player's show one segment at a time. Design:
// docs/design/show-night.md#live-show-night
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  engineLoadOptions,
  engineSaveState,
  engineStateFromSave,
  initialEngineState,
  type Engine,
  type EngineState,
  type Viewer,
} from '../../../src/core/api';
import type { EventInstanceId, SegmentId } from '../../../src/core/ids';
import { TABLES } from '../../../src/model/tables';
import { encodeSave } from '../../../src/persistence/codec';
import { loadSave } from '../../../src/persistence/load';
import { createSaveDocument } from '../../../src/persistence/world-document';
import { defaultSystems } from '../../../src/systems';
import { getSetting, newGameSettings } from '../../../src/systems/newgame/settings';
import { FINISH_TONIGHT_FIRST, SCORE_SO_FAR_LABEL } from '../../../src/systems/shows';
import { TEST_ENGINE_VERSION, TEST_SAVED_AT } from '../../support/saves';
import {
  angle,
  book,
  bookRunnable,
  change,
  match,
  PINFALL,
  PLAYER_ONE,
  PLAYER_TWO,
  validateWorld,
  who,
  type ValidateWorld,
} from '../booking/validate-world';

const AS_PLAYER_ONE: Viewer = { kind: 'controller', controller: PLAYER_ONE };
const AS_PLAYER_TWO: Viewer = { kind: 'controller', controller: PLAYER_TWO };

/** Tonight's card, in running order: the pre-show, then the main card by slot. */
interface FullCard {
  readonly preShow: SegmentId;
  readonly opener: SegmentId;
  readonly promo: SegmentId;
  readonly title: SegmentId;
  readonly mainEvent: SegmentId;
}

/**
 * A card with a pre-show match, an opener, a promo, a heavyweight title match the challenger wins
 * and a main event: something for the finishes, the ratings, the title applier and the angle
 * aftermath to do.
 */
function fullCard(built: ValidateWorld): FullCard {
  const card = bookRunnable(built);
  return {
    preShow: book(built, 0, match([[who(built, 2)], [who(built, 11)]]), { preShow: true }),
    opener: card.opener,
    promo: card.promo,
    title: book(
      built,
      3,
      match([[who(built, 0)], [who(built, 1)]], {
        titleIds: [built.heavyweight],
        outcome: { kind: 'win', winningSide: 1, methodKey: PINFALL },
      }),
    ),
    mainEvent: card.mainEvent,
  };
}

const RUNNING_ORDER = ['preShow', 'opener', 'promo', 'title', 'mainEvent'] as const;

function tonight(): { built: ValidateWorld; card: FullCard } {
  const built = validateWorld();
  return { built, card: fullCard(built) };
}

function engineOver(built: ValidateWorld): Engine {
  return createEngine({ state: initialEngineState(built.world), systems: defaultSystems });
}

function showOf(engine: Engine, id: EventInstanceId) {
  const show = engine.exportState().world.tables.eventInstances.find((row) => row.id === id);
  if (show === undefined) {
    throw new Error(`No show ${id}`);
  }
  return show;
}

function ok<T>(result: { ok: true; data: T } | { ok: false; reasons: unknown }): T {
  if (!result.ok) {
    throw new Error(`Refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

function runNext(engine: Engine, id: EventInstanceId, issuedBy = PLAYER_ONE) {
  return engine.command('shows.runNextSegment', { eventInstanceId: id }, issuedBy);
}

/** Runs `count` segments of the show, one command each. */
function runSegments(engine: Engine, id: EventInstanceId, count: number): void {
  for (let index = 0; index < count; index += 1) {
    ok(runNext(engine, id));
  }
}

function liveState(engine: Engine, id: EventInstanceId, viewer: Viewer = AS_PLAYER_ONE) {
  return engine.query('shows.liveState', { eventInstanceId: id }, viewer);
}

function gateReasons(engine: Engine): string[] {
  return ok(engine.query('sim.pendingGates', {}, AS_PLAYER_ONE)).hits.map((hit) => hit.reason);
}

interface ShowEvent {
  type: string;
  payload: unknown;
}

function showEvents(engine: Engine): ShowEvent[] {
  return ok(
    engine.query(
      'sim.recentEvents',
      { limit: 10_000, types: ['segment.completed', 'show.completed'] },
      { kind: 'omniscient' },
    ),
  ).map((event) => ({ type: event.type, payload: event.payload }));
}

/** Traces without their store-wide sequence number, sorted by ref. */
function tracesOf(state: EngineState) {
  return state.traces.full
    .map(({ ref, date, trace, value }) => ({ key: `${ref.kind}:${ref.id}`, date, trace, value }))
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
}

/** Everything a way of running the show leaves behind that the others must match. */
function outcomeOf(engine: Engine) {
  const state = engine.exportState();
  return {
    world: state.world,
    rng: state.rng,
    traces: tracesOf(state),
    events: showEvents(engine),
  };
}

async function saveAndLoad(engine: Engine, built: ValidateWorld): Promise<Engine> {
  const doc = createSaveDocument(engineSaveState(engine.exportState()), {
    headerPromotionId: built.world.tables.eventInstances.require(built.show).promotionId,
    savedAt: TEST_SAVED_AT,
    label: 'Half way through the show',
    engineVersion: TEST_ENGINE_VERSION,
  });
  const report = await loadSave(await encodeSave(doc), TABLES, engineLoadOptions());
  if (!report.ok) {
    throw new Error(JSON.stringify(report.issues, null, 2));
  }
  return createEngine({ state: engineStateFromSave(report.doc), systems: defaultSystems });
}

describe('the Show night setting', () => {
  it('is registered as Live or Auto, Live by default, and an old world reads Live', () => {
    const def = newGameSettings().find((setting) => setting.key === 'showNight');
    expect(def).toMatchObject({ kind: 'enum', options: ['live', 'auto'], default: 'live' });
    const { built } = tonight();
    expect(built.world.meta.settings.extra['showNight']).toBeUndefined();
    expect(getSetting(built.world, 'showNight')).toBe('live');
  });

  it('changes mid-game for a player, and is refused for anyone else', () => {
    const { built } = tonight();
    const engine = engineOver(built);
    expect(ok(engine.command('shows.setShowNight', { mode: 'auto' }, PLAYER_ONE))).toEqual({
      mode: 'auto',
    });
    expect(ok(liveState(engine, built.show)).mode).toBe('auto');
    expect(
      engine.command(
        'shows.setShowNight',
        { mode: 'live' },
        { kind: 'human', playerId: 'someone-else' },
      ),
    ).toMatchObject({ ok: false, reasons: [{ code: 'notAllowed' }] });
    expect(
      engine.command('shows.setShowNight', { mode: 'live' }, { kind: 'computer' }),
    ).toMatchObject({ ok: false, reasons: [{ code: 'notAllowed' }] });
  });
});

describe('running a show one segment at a time', () => {
  it('runs the card in running order, pre-show first, and the last segment completes the show', () => {
    const { built, card } = tonight();
    const engine = engineOver(built);
    const ran: SegmentId[] = [];
    for (const [index] of RUNNING_ORDER.entries()) {
      const step = ok(runNext(engine, built.show));
      ran.push(step.segmentId);
      expect(step.finished).toBe(index === RUNNING_ORDER.length - 1);
      expect(showOf(engine, built.show).status).toBe(step.finished ? 'completed' : 'scheduled');
    }
    expect(ran).toEqual(RUNNING_ORDER.map((key) => card[key]));
    const show = showOf(engine, built.show);
    expect(show.liveRun).toBeUndefined();
    expect(show.result?.score).toEqual(expect.any(Number));
    expect(showEvents(engine).map((event) => event.type)).toEqual([
      ...RUNNING_ORDER.map(() => 'segment.completed'),
      'show.completed',
    ]);
  });

  it('keeps the segments run so far on the show while it is under way', () => {
    const { built, card } = tonight();
    const engine = engineOver(built);
    ok(runNext(engine, built.show));
    ok(runNext(engine, built.show));
    expect(showOf(engine, built.show)).toMatchObject({
      status: 'scheduled',
      liveRun: { ranSegmentIds: [card.preShow, card.opener] },
    });
  });

  it('runs the rest at once, and runRestOfShow on a show not started runs it all', () => {
    const { built, card } = tonight();
    const engine = engineOver(built);
    ok(runNext(engine, built.show));
    expect(
      ok(engine.command('shows.runRestOfShow', { eventInstanceId: built.show }, PLAYER_ONE)),
    ).toEqual({
      eventInstanceId: built.show,
      segmentIds: RUNNING_ORDER.slice(1).map((key) => card[key]),
    });
    expect(showOf(engine, built.show).status).toBe('completed');

    const fresh = tonight();
    const whole = engineOver(fresh.built);
    expect(
      ok(whole.command('shows.runRestOfShow', { eventInstanceId: fresh.built.show }, PLAYER_ONE))
        .segmentIds,
    ).toEqual(RUNNING_ORDER.map((key) => fresh.card[key]));
  });

  it('lets Run the show finish a show under way', () => {
    const { built } = tonight();
    const engine = engineOver(built);
    ok(runNext(engine, built.show));
    ok(engine.command('shows.runTonight', { eventInstanceId: built.show }, PLAYER_ONE));
    expect(showOf(engine, built.show).status).toBe('completed');
    expect(showEvents(engine).filter((event) => event.type === 'show.completed')).toHaveLength(1);
  });
});

describe('the same results however the show is run', () => {
  it('gives identical worlds, random state, traces and events live, all at once and in Auto', async () => {
    // Auto: Run the show (`shows.runTonight`), as before EVT10.
    const auto = tonight();
    const viaAuto = engineOver(auto.built);
    ok(viaAuto.command('shows.setShowNight', { mode: 'auto' }, PLAYER_ONE));
    ok(viaAuto.command('shows.runTonight', { eventInstanceId: auto.built.show }, PLAYER_ONE));
    ok(viaAuto.command('shows.setShowNight', { mode: 'live' }, PLAYER_ONE));

    // Live, one segment at a time.
    const live = tonight();
    const viaLive = engineOver(live.built);
    runSegments(viaLive, live.built.show, RUNNING_ORDER.length);

    // Live for two segments, then the rest at once.
    const mixed = tonight();
    const viaMixed = engineOver(mixed.built);
    ok(runNext(viaMixed, mixed.built.show));
    ok(runNext(viaMixed, mixed.built.show));
    ok(viaMixed.command('shows.runRestOfShow', { eventInstanceId: mixed.built.show }, PLAYER_ONE));

    // Live for two segments, a save and a load, then the rest one at a time.
    const saved = tonight();
    let viaSave = engineOver(saved.built);
    ok(runNext(viaSave, saved.built.show));
    ok(runNext(viaSave, saved.built.show));
    viaSave = await saveAndLoad(viaSave, saved.built);
    expect(showOf(viaSave, saved.built.show).liveRun?.ranSegmentIds).toHaveLength(2);
    expect(gateReasons(viaSave)).toEqual([`${FINISH_TONIGHT_FIRST}: Test Monday Show`]);
    runSegments(viaSave, saved.built.show, RUNNING_ORDER.length - 2);

    const expected = outcomeOf(viaAuto);
    expect(expected.traces.length).toBeGreaterThan(0);
    expect(showOf(viaAuto, auto.built.show).status).toBe('completed');
    // The command log differs (different commands), so the world and its parts are compared.
    for (const engine of [viaLive, viaMixed, viaSave]) {
      const outcome = outcomeOf(engine);
      expect(outcome.world.tables).toEqual(expected.world.tables);
      expect(outcome.rng).toEqual(expected.rng);
      expect(outcome.traces).toEqual(expected.traces);
      expect(outcome.events).toEqual(expected.events);
    }
  });

  it('is not moved by other random draws between segments', () => {
    const quiet = tonight();
    const viaQuiet = engineOver(quiet.built);
    ok(viaQuiet.command('shows.runTonight', { eventInstanceId: quiet.built.show }, PLAYER_ONE));

    // Between segments the rest of the world rolls a few numbers on the very streams a segment
    // rolls on. The segments roll on their own streams, so nothing they do changes.
    const busy = tonight();
    const viaBusy = engineOver(busy.built);
    ok(runNext(viaBusy, busy.built.show));
    const state = viaBusy.exportState();
    const moved = createEngine({
      state: {
        ...state,
        rng: {
          ...state.rng,
          streams: {
            ...state.rng.streams,
            'match.rating': [1, 2, 3, 4],
            'match.angle': [5, 6, 7, 8],
            'match.finish': [9, 10, 11, 12],
            'match.auto-winner': [13, 14, 15, 16],
            'match.wear': [17, 18, 19, 20],
            'match.injury': [21, 22, 23, 24],
          },
        },
      },
      systems: defaultSystems,
    });
    ok(moved.command('shows.runRestOfShow', { eventInstanceId: busy.built.show }, PLAYER_ONE));
    expect(moved.exportState().world.tables).toEqual(viaQuiet.exportState().world.tables);
    expect(tracesOf(moved.exportState())).toEqual(tracesOf(viaQuiet.exportState()));
  });
});

describe('the show-day stop while a show is under way', () => {
  it("reads Tonight before the show, Finish tonight's show first during it, and clears after", async () => {
    const { built } = tonight();
    const engine = engineOver(built);
    expect(gateReasons(engine)).toEqual(['Tonight: Test Monday Show']);
    ok(runNext(engine, built.show));
    expect(gateReasons(engine)).toEqual([`${FINISH_TONIGHT_FIRST}: Test Monday Show`]);

    const stopped = await engine.advanceDays({ maxDays: 3 });
    expect(stopped.daysAdvanced).toBe(0);
    expect(showOf(engine, built.show).liveRun?.ranSegmentIds).toHaveLength(1);
    expect(ok(engine.query('clock.get', {}, AS_PLAYER_ONE)).date).toBe(
      built.world.meta.currentDate,
    );

    ok(engine.command('shows.runRestOfShow', { eventInstanceId: built.show }, PLAYER_ONE));
    expect(gateReasons(engine)).toEqual([]);
    const advanced = await engine.advanceDays({ maxDays: 1 });
    expect(advanced.daysAdvanced).toBe(1);
  });
});

describe('live show refusals', () => {
  it('refuses another player, a show not tonight and a finished show', () => {
    const { built } = tonight();
    bookRunnable(built, built.rival);
    const engine = engineOver(built);
    expect(runNext(engine, built.show, PLAYER_TWO)).toMatchObject({
      ok: false,
      reasons: [{ code: 'notYourShow' }],
    });
    expect(runNext(engine, built.rival, PLAYER_TWO)).toMatchObject({
      ok: false,
      reasons: [{ code: 'notTonight' }],
    });
    ok(engine.command('shows.runTonight', { eventInstanceId: built.show }, PLAYER_ONE));
    for (const name of [
      'shows.runNextSegment',
      'shows.runRestOfShow',
      'shows.finishShow',
    ] as const) {
      expect(engine.command(name, { eventInstanceId: built.show }, PLAYER_ONE)).toMatchObject({
        ok: false,
        reasons: [{ code: 'showCompleted' }],
      });
    }
  });

  it('refuses the first segment of a card with errors, as Run the show does', () => {
    const built = validateWorld();
    book(built, 0, match([[who(built, 6)], [who(built, 7)]], { outcome: null }));
    const engine = engineOver(built);
    const result = runNext(engine, built.show);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reasons.map((reason) => reason.code)).toContain('cardNotRunnable');
    expect(showOf(engine, built.show).liveRun).toBeUndefined();
  });

  it('does not check the card again once the show is under way, so it can always finish', () => {
    const { built, card } = tonight();
    // Part-way through, and someone booked later on the card is hurt: the card has an error now.
    change(built, (tx) => {
      tx.update('eventInstances', built.show, { liveRun: { ranSegmentIds: [] } });
      const hurt = tx.view.tables.people.require(who(built, 4)).injury;
      if (hurt === null) {
        throw new Error('Max Dorn is not hurt');
      }
      tx.update('people', who(built, 9), { injury: { ...hurt } });
    });
    const engine = engineOver(built);
    expect(
      ok(engine.command('shows.runRestOfShow', { eventInstanceId: built.show }, PLAYER_ONE))
        .segmentIds,
    ).toEqual(RUNNING_ORDER.map((key) => card[key]));
    expect(showOf(engine, built.show).status).toBe('completed');
  });

  it('refuses Finish the show while segments are left, and the card edits while under way', () => {
    const { built } = tonight();
    const engine = engineOver(built);
    ok(runNext(engine, built.show));
    expect(
      engine.command('shows.finishShow', { eventInstanceId: built.show }, PLAYER_ONE),
    ).toMatchObject({
      ok: false,
      reasons: [
        { code: 'segmentsLeft', message: '4 segments still to run before the show can finish' },
      ],
    });
    expect(
      engine.command(
        'booking.addSegment',
        { eventInstanceId: built.show, preShow: false, slot: 1, draft: angle([who(built, 11)]) },
        PLAYER_ONE,
      ),
    ).toMatchObject({ ok: false, reasons: [{ code: 'showLive' }] });
  });

  it('finishes a show whose segments were all rated before the night', () => {
    const { built } = tonight();
    change(built, (tx) => {
      for (const segment of tx.view.tables.segments.lookup('byEventInstance', built.show)) {
        tx.update('segments', segment.id, {
          rating: {
            score: 50,
            stars: 2.5,
            workRate: null,
            crowd: 50,
            expectation: 50,
            traceId: null,
          },
        });
      }
    });
    const engine = engineOver(built);
    expect(runNext(engine, built.show)).toMatchObject({
      ok: false,
      reasons: [{ code: 'noSegmentLeft' }],
    });
    ok(engine.command('shows.finishShow', { eventInstanceId: built.show }, PLAYER_ONE));
    const show = showOf(engine, built.show);
    expect(show.status).toBe('completed');
    // Every segment scored 50; the two empty main-card slots cost their penalty.
    expect(show.result?.score).toBeLessThan(50);
  });

  it("never touches the other player's or anyone else's shows", () => {
    const { built } = tonight();
    bookRunnable(built, built.rival);
    const engine = engineOver(built);
    runSegments(engine, built.show, RUNNING_ORDER.length);
    const others = engine
      .exportState()
      .world.tables.eventInstances.filter((show) => show.id !== built.show);
    expect(others.map((show) => [show.status, show.liveRun])).toEqual(
      built.world.tables.eventInstances
        .values()
        .filter((show) => show.id !== built.show)
        .map((show) => [show.status, undefined]),
    );
  });
});

describe('shows.liveState', () => {
  it('shows the next segment before the show, the results so far and the score so far', () => {
    const { built, card } = tonight();
    const engine = engineOver(built);
    expect(ok(liveState(engine, built.show))).toMatchObject({
      eventInstanceId: built.show,
      name: 'Test Monday Show',
      stage: 'notStarted',
      mode: 'live',
      segmentsRun: [],
      next: { segmentId: card.preShow, preShow: true, outcome: null, rating: null },
      segmentsLeft: 5,
      scoreSoFar: null,
    });

    ok(runNext(engine, built.show));
    ok(runNext(engine, built.show));
    const during = ok(liveState(engine, built.show));
    expect(during.stage).toBe('live');
    expect(during.segmentsRun.map((segment) => segment.segmentId)).toEqual([
      card.preShow,
      card.opener,
    ]);
    for (const segment of during.segmentsRun) {
      expect(segment.rating?.score).toEqual(expect.any(Number));
      expect(segment.outcome?.kind).toBe('win');
    }
    expect(during.next).toMatchObject({ segmentId: card.promo, rating: null });
    expect(during.segmentsLeft).toBe(3);
    expect(during.scoreSoFar?.trace.label).toBe(SCORE_SO_FAR_LABEL);
    expect(during.scoreSoFar?.score).toBeGreaterThanOrEqual(0);

    ok(engine.command('shows.runRestOfShow', { eventInstanceId: built.show }, PLAYER_ONE));
    expect(ok(liveState(engine, built.show))).toMatchObject({
      stage: 'finished',
      next: null,
      segmentsLeft: 0,
      scoreSoFar: null,
    });
    expect(ok(liveState(engine, built.show)).segmentsRun).toHaveLength(5);
  });

  it('weighs the score so far by slot over the segments run, as the show score does', () => {
    const { built } = tonight();
    const engine = engineOver(built);
    ok(runNext(engine, built.show)); // the pre-show
    ok(runNext(engine, built.show)); // the opener
    const state = ok(liveState(engine, built.show));
    const opener = state.segmentsRun[1]?.rating?.score;
    // The pre-show counts for nothing at the default factor, so the opener is the score so far.
    expect(state.scoreSoFar?.score).toBe(opener);
  });

  it("is only for the show's runner", () => {
    const { built } = tonight();
    const engine = engineOver(built);
    expect(liveState(engine, built.show, AS_PLAYER_TWO)).toMatchObject({
      ok: false,
      reasons: [{ code: 'notFound' }],
    });
    expect(liveState(engine, built.show, { kind: 'omniscient' }).ok).toBe(true);
  });
});
