// Heat after a linked segment on show night (CRTV4-02).
// Design: docs/design/storylines.md#heat-after-segment
import { describe, expect, it } from 'vitest';
import {
  controllerViewer,
  createEngine,
  initialEngineState,
  type Engine,
  type EngineState,
} from '../../../../src/core/api';
import { simSystem } from '../../../../src/core/api/builtins';
import { addDays } from '../../../../src/core/date';
import { parseId } from '../../../../src/core/ids';
import type { DomainEventMap } from '../../../../src/core/events/types';
import type { PersonId, PromotionId, SegmentId, StorylineId } from '../../../../src/core/ids';
import type { Segment } from '../../../../src/model/entities/segment';
import type { Storyline } from '../../../../src/model/entities/storyline';
import { TABLES, type GameWorld } from '../../../../src/model/tables';
import { documentToWorld } from '../../../../src/persistence/world-document';
import { historySystem } from '../../../../src/systems/history';
import { matchSystem } from '../../../../src/systems/match';
import { showsSystem } from '../../../../src/systems/shows';
import {
  heatBeforeSegment,
  NOT_COUNTED_ENDED,
  NOT_COUNTED_NO_MEMBER,
  STORYLINE_HEAT_STEP_TRACE_KIND,
  storylinesSystem,
  type StorylineShowProgress,
  type StorylineTimeline,
} from '../../../../src/systems/storylines';
import { withMyShowsRun } from '../../../support';
import { expectSerialisable } from '../../../support/trace';
import {
  OMNISCIENT,
  PLAYER_ONE,
  runsAllButUnrun,
  showNightWorld,
  TODAY,
} from '../../shows/show-night-world';

const PULL = 0.4;
const MAX_STEP = 15;

/** The default heat step, worked by hand: `factor` is the repeat and pre-show reduction. */
function expectedHeat(before: number, score: number, factor = 1): number {
  const step = Math.min(MAX_STEP, Math.max(-MAX_STEP, (score - before) * PULL * factor));
  return Math.min(100, Math.max(0, before + step));
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`Missing ${what}`);
  }
  return value;
}

/**
 * The show night world (A's human show today: pre-show 0 v 1 won by 0; main card 2 v 3 won by 3,
 * 4 v 5 drawn, a promo by 6, 7 v 8 no contest, main event 9 v 10 won by 9; B's rival card) with
 * storylines linked to its segments:
 *
 * - `feud` (2, 3, 6; heat 50): the 2 v 3 match and the promo, so the promo is its second tonight;
 * - `preShow` (0, 1; heat 50): the pre-show match;
 * - `absent` (11; heat 50): the main event, which nobody from it is in;
 * - `ended` (9; heat 60, ended): the main event;
 * - `rival` (B's 0, 1; heat 50): B's first match.
 */
function heatWorld() {
  const built = showNightWorld();
  const { world } = built;
  const person = (index: number): PersonId =>
    required(built.roster[index], `roster ${String(index)}`);
  const rival = (index: number): PersonId =>
    required(built.rivals[index], `rival ${String(index)}`);
  const promotionOf = (name: string): PromotionId =>
    required(
      world.tables.promotions.values().find((row) => row.name === name),
      name,
    ).id;
  const promotionA = promotionOf('Test Promotion A');
  const promotionB = promotionOf('Test Promotion B');
  const base = (
    name: string,
    members: readonly PersonId[],
    extra: Partial<Storyline> = {},
  ): Omit<Storyline, 'id'> => ({
    promotionId: promotionA,
    brandId: null,
    name,
    status: 'active',
    startedOn: world.meta.startDate,
    endedOn: null,
    heat: 50,
    members: members.map((personId, index) => ({
      personId,
      side: index % 2 === 0 ? 'face' : 'heel',
    })),
    summary: '',
    lastProgressOn: null,
    finaleSegmentId: null,
    progress: [],
    progressTotals: { segments: 0, matches: 0, angles: 0, heatGained: 0, heatLost: 0 },
    payoff: null,
    ...extra,
  });
  const [preShowMatch, feudMatch, , promoSegment, , mainEvent] = built.humanCard;
  const rivalMatch = required(built.rivalMatches[0], 'rival match');
  const made = world.transact('storylines', (tx) => {
    const add = (row: Omit<Storyline, 'id'>): StorylineId => tx.create('storylines', row).id;
    const storylines = {
      feud: add(base('Test Feud', [person(2), person(3), person(6)])),
      preShow: add(base('Test Pre-show Feud', [person(0), person(1)])),
      absent: add(base('Test Absent', [person(11)])),
      ended: add(
        base('Test Ended', [person(9)], {
          heat: 60,
          status: 'ended',
          endedOn: world.meta.startDate,
        }),
      ),
      rival: add(base('Test Rival Feud', [rival(0), rival(1)], { promotionId: promotionB })),
    };
    const linkTo = (segmentId: SegmentId | undefined, ids: StorylineId[]) => {
      tx.update('segments', required(segmentId, 'segment'), { storylineIds: ids });
    };
    linkTo(feudMatch, [storylines.feud]);
    linkTo(promoSegment, [storylines.feud]);
    linkTo(preShowMatch, [storylines.preShow]);
    linkTo(mainEvent, [storylines.absent, storylines.ended]);
    linkTo(rivalMatch, [storylines.rival]);
    return storylines;
  });
  if (!made.ok) throw made.error;
  return {
    ...built,
    storylines: made.value,
    segments: {
      preShowMatch: required(preShowMatch, 'pre-show match'),
      feudMatch: required(feudMatch, 'feud match'),
      promoSegment: required(promoSegment, 'promo'),
      mainEvent: required(mainEvent, 'main event'),
      rivalMatch,
    },
    person,
  };
}

type HeatWorld = ReturnType<typeof heatWorld>;

function heatEngine(world: GameWorld, withHistory = false): Engine {
  const systems = [simSystem, matchSystem, showsSystem, storylinesSystem];
  return createEngine({
    state: initialEngineState(world),
    systems: withMyShowsRun(withHistory ? [...systems, historySystem] : systems, runsAllButUnrun),
  });
}

async function runShowNight(built: HeatWorld, withHistory = false) {
  const engine = heatEngine(built.world, withHistory);
  const advanced = await engine.advanceDays({ maxDays: 1 });
  expect(advanced.failures).toEqual([]);
  return engine;
}

function storylineIn(state: EngineState, id: StorylineId): Storyline {
  return required(
    state.world.tables.storylines.find((row) => row.id === id),
    `storyline ${id}`,
  );
}

function scoreOf(state: EngineState, id: SegmentId): number {
  const segment: Segment = required(
    state.world.tables.segments.find((row) => row.id === id),
    `segment ${id}`,
  );
  if (segment.rating === null) throw new Error(`segment ${id} was not rated`);
  return segment.rating.score;
}

function progressedEvents(engine: Engine): DomainEventMap['storyline.progressed'][] {
  const result = engine.query(
    'sim.recentEvents',
    { limit: 10_000, types: ['storyline.progressed'] },
    OMNISCIENT,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.reasons));
  return result.data.flatMap((event) =>
    event.type === 'storyline.progressed' ? [event.payload] : [],
  );
}

function worldOf(engine: Engine): GameWorld {
  return documentToWorld({ state: { world: engine.exportState().world } }, TABLES);
}

describe('storylines.heat applier', () => {
  it('moves a linked match’s storyline toward its score and restarts the grace period', async () => {
    const built = heatWorld();
    const engine = await runShowNight(built);
    const state = engine.exportState();
    const feud = storylineIn(state, built.storylines.feud);
    const firstScore = scoreOf(state, built.segments.feudMatch);
    const afterFirst = expectedHeat(50, firstScore);

    expect(feud.lastProgressOn).toBe(TODAY);
    expect(feud.progress[0]).toMatchObject({
      segmentId: built.segments.feudMatch,
      date: TODAY,
      heatBefore: 50,
      heatAfter: expect.closeTo(afterFirst, 10) as unknown,
      traceId: `${STORYLINE_HEAT_STEP_TRACE_KIND}:${built.storylines.feud}/${built.segments.feudMatch}`,
    });
  });

  it('counts a second linked segment of the same storyline that night at the repeat factor', async () => {
    const built = heatWorld();
    const engine = await runShowNight(built);
    const state = engine.exportState();
    const feud = storylineIn(state, built.storylines.feud);
    const afterFirst = expectedHeat(50, scoreOf(state, built.segments.feudMatch));
    const afterSecond = expectedHeat(afterFirst, scoreOf(state, built.segments.promoSegment), 0.5);

    expect(feud.progress).toHaveLength(2);
    expect(feud.progress[1]).toMatchObject({ segmentId: built.segments.promoSegment });
    expect(feud.progress[1]?.heatBefore).toBeCloseTo(afterFirst, 10);
    expect(feud.progress[1]?.heatAfter).toBeCloseTo(afterSecond, 10);
    expect(feud.heat).toBeCloseTo(afterSecond, 10);
    expect(feud.progressTotals).toMatchObject({ segments: 2, matches: 1, angles: 1 });
    const change = (feud.progress[0]?.heatAfter ?? 0) - 50;
    const secondChange = afterSecond - afterFirst;
    expect(feud.progressTotals.heatGained - feud.progressTotals.heatLost).toBeCloseTo(
      change + secondChange,
      10,
    );
  });

  it('applies the pre-show factor to a pre-show link', async () => {
    const built = heatWorld();
    const engine = await runShowNight(built);
    const state = engine.exportState();
    const preShow = storylineIn(state, built.storylines.preShow);
    expect(preShow.heat).toBeCloseTo(
      expectedHeat(50, scoreOf(state, built.segments.preShowMatch), 0.5),
      10,
    );
    expect(preShow.progress).toHaveLength(1);
  });

  it('leaves a storyline nobody from is in, and an ended one, unchanged with no row', async () => {
    const built = heatWorld();
    const engine = await runShowNight(built);
    const state = engine.exportState();
    const absent = storylineIn(state, built.storylines.absent);
    const ended = storylineIn(state, built.storylines.ended);
    expect(absent).toMatchObject({ heat: 50, lastProgressOn: null, progress: [] });
    expect(absent.progressTotals.segments).toBe(0);
    expect(ended).toMatchObject({ heat: 60, lastProgressOn: null, progress: [] });
  });

  it('moves a computer promotion’s storyline by the same numbers, without a step trace', async () => {
    const built = heatWorld();
    const engine = await runShowNight(built);
    const state = engine.exportState();
    const rival = storylineIn(state, built.storylines.rival);
    expect(rival.heat).toBeCloseTo(expectedHeat(50, scoreOf(state, built.segments.rivalMatch)), 10);
    expect(rival.lastProgressOn).toBe(TODAY);
    expect(rival.progress).toEqual([
      expect.objectContaining({ segmentId: built.segments.rivalMatch, traceId: null }),
    ]);
  });

  it('publishes storyline.progressed once per counted row', async () => {
    const built = heatWorld();
    const engine = await runShowNight(built);
    const state = engine.exportState();
    const events = progressedEvents(engine);
    expect(events).toHaveLength(4);
    const rows = [built.storylines.feud, built.storylines.preShow, built.storylines.rival].flatMap(
      (id) =>
        storylineIn(state, id).progress.map((row) => ({
          storylineId: id,
          segmentId: row.segmentId,
          eventInstanceId: row.eventInstanceId,
          heatBefore: row.heatBefore,
          heatAfter: row.heatAfter,
        })),
    );
    expect(
      events.map((event) => ({
        storylineId: event.storylineId,
        segmentId: event.segmentId,
        eventInstanceId: event.eventInstanceId,
        heatBefore: event.heatBefore,
        heatAfter: event.heatAfter,
      })),
    ).toEqual(expect.arrayContaining(rows));
    expectSerialisable(events);
  });

  it('heatBeforeSegment returns the heat walking into the segment after the show', async () => {
    const built = heatWorld();
    const engine = await runShowNight(built);
    const world = worldOf(engine);
    const feud = storylineIn(engine.exportState(), built.storylines.feud);
    expect(heatBeforeSegment(world, built.storylines.feud, built.segments.feudMatch)).toBe(50);
    expect(heatBeforeSegment(world, built.storylines.feud, built.segments.promoSegment)).toBe(
      feud.progress[0]?.heatAfter,
    );
    // A segment that never counted: the storyline's current heat.
    expect(heatBeforeSegment(world, built.storylines.absent, built.segments.mainEvent)).toBe(50);
  });

  it('heatBeforeSegment is the current heat before the show and null for an unknown storyline', () => {
    const built = heatWorld();
    expect(heatBeforeSegment(built.world, built.storylines.feud, built.segments.feudMatch)).toBe(
      50,
    );
    expect(
      heatBeforeSegment(
        built.world,
        parseId('storyline', 'sty_9999999999'),
        built.segments.feudMatch,
      ),
    ).toBeNull();
  });

  it('records the player’s step Why? and the current heat Why?', async () => {
    const built = heatWorld();
    const engine = await runShowNight(built);
    const step = engine.query(
      'trace.get',
      {
        ref: {
          kind: STORYLINE_HEAT_STEP_TRACE_KIND,
          id: `${built.storylines.feud}/${built.segments.feudMatch}`,
        },
      },
      OMNISCIENT,
    );
    expect(step.ok && step.data !== null && 'trace' in step.data).toBe(true);
    const current = engine.query(
      'trace.get',
      { ref: { kind: 'storylines.heat', id: built.storylines.feud } },
      OMNISCIENT,
    );
    if (!current.ok || current.data === null || !('trace' in current.data)) {
      throw new Error('no current heat trace');
    }
    expect(current.data.trace.label).toBe("Heat after 'Slot 3'");
  });

  it('cools no heat inside the grace period after a linked show, and cools the day after', async () => {
    const built = heatWorld();
    const engine = await runShowNight(built);
    const after = storylineIn(engine.exportState(), built.storylines.preShow).heat;
    await engine.advanceDays({ maxDays: 7 });
    const state = engine.exportState();
    expect(state.world.meta.currentDate).toBe(addDays(TODAY, 8));
    expect(storylineIn(state, built.storylines.preShow).heat).toBe(after);
    await engine.advanceDays({ maxDays: 1 });
    expect(storylineIn(engine.exportState(), built.storylines.preShow).heat).toBeCloseTo(
      after - 1,
      10,
    );
  });

  it('trims progress rows past the detail window, keeping the all-time totals', async () => {
    const built = heatWorld();
    const engine = await runShowNight(built, true);
    await engine.advanceDays({ maxDays: 40 });
    const feud = storylineIn(engine.exportState(), built.storylines.feud);
    expect(feud.progress).toEqual([]);
    expect(feud.progressTotals).toMatchObject({ segments: 2, matches: 1, angles: 1 });
    const step = engine.query(
      'trace.get',
      {
        ref: {
          kind: STORYLINE_HEAT_STEP_TRACE_KIND,
          id: `${built.storylines.feud}/${built.segments.feudMatch}`,
        },
      },
      OMNISCIENT,
    );
    expect(step.ok && step.data !== null && !('trace' in step.data)).toBe(true);
  });
});

describe('storylines.showProgress', () => {
  function progressOf(built: HeatWorld, engine: Engine, viewer = PLAYER_ONE) {
    const result = engine.query(
      'storylines.showProgress',
      { eventInstanceId: required(built.human ?? undefined, 'human show') },
      controllerViewer(viewer),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.reasons));
    expectSerialisable(result.data);
    return result.data;
  }

  function okProgress(result: StorylineShowProgress) {
    if (result.kind !== 'ok') throw new Error(JSON.stringify(result.reason));
    return result;
  }

  it('lists each linked segment’s rows, what did not count and the covered losers', async () => {
    const built = heatWorld();
    const engine = await runShowNight(built);
    const result = okProgress(progressOf(built, engine));
    expect(result.pastDetailWindow).toBe(false);
    expect(result.segments.map((segment) => segment.segmentId)).toEqual([
      built.segments.preShowMatch,
      built.segments.feudMatch,
      built.segments.promoSegment,
      built.segments.mainEvent,
    ]);
    const [preShow, feudMatch, promo, mainEvent] = result.segments;
    expect(preShow).toMatchObject({
      preShow: true,
      rows: [{ storylineId: built.storylines.preShow, heatBefore: 50, finale: false }],
      protectedLosers: [{ personId: built.person(1), storylineId: built.storylines.preShow }],
    });
    expect(feudMatch?.rows[0]?.traceRef).toEqual({
      kind: STORYLINE_HEAT_STEP_TRACE_KIND,
      id: `${built.storylines.feud}/${built.segments.feudMatch}`,
    });
    expect(feudMatch?.protectedLosers).toEqual([
      { personId: built.person(2), storylineId: built.storylines.feud },
    ]);
    expect(promo?.protectedLosers).toEqual([]);
    expect(mainEvent?.rows).toEqual([]);
    expect(mainEvent?.notCounted).toEqual([
      { storylineId: built.storylines.absent, name: 'Test Absent', reason: NOT_COUNTED_NO_MEMBER },
      { storylineId: built.storylines.ended, name: 'Test Ended', reason: NOT_COUNTED_ENDED },
    ]);
  });

  it('says nothing has counted before the show runs', () => {
    const built = heatWorld();
    const engine = heatEngine(built.world);
    const result = okProgress(progressOf(built, engine));
    expect(result.segments.every((segment) => segment.rows.length === 0)).toBe(true);
    expect(result.segments.every((segment) => segment.notCounted.length === 0)).toBe(true);
  });

  it('refuses a rival show', async () => {
    const built = heatWorld();
    const engine = await runShowNight(built);
    const result = engine.query(
      'storylines.showProgress',
      { eventInstanceId: built.rivalCard },
      controllerViewer(PLAYER_ONE),
    );
    expect(result.ok && result.data.kind === 'unavailable' && result.data.reason.code).toBe(
      'notYourShow',
    );
  });
});

describe('storylines.timeline', () => {
  function timelineOf(engine: Engine, storylineId: StorylineId): StorylineTimeline {
    const result = engine.query(
      'storylines.timeline',
      { storylineId },
      controllerViewer(PLAYER_ONE),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.reasons));
    expectSerialisable(result.data);
    return result.data;
  }

  it('lists the progress rows newest first, joined to their show and segment', async () => {
    const built = heatWorld();
    const engine = await runShowNight(built);
    const result = timelineOf(engine, built.storylines.feud);
    if (result.kind !== 'ok') throw new Error(JSON.stringify(result.reason));
    expect(result.keptDays).toBe(28);
    expect(result.totals.segments).toBe(2);
    expect(result.rows.map((row) => row.segmentId)).toEqual([
      built.segments.promoSegment,
      built.segments.feudMatch,
    ]);
    expect(result.rows[1]).toMatchObject({
      showName: 'Test Human Show',
      date: TODAY,
      slot: 0,
      preShow: false,
      format: { slots: 5, preShowSlots: 1 },
      kind: 'match',
      heatBefore: 50,
      finale: false,
    });
    expect(result.rows[1]?.segmentLabel).toContain(' vs ');
    expect(result.rows[0]?.kind).toBe('angle');
  });

  it('keeps a rival’s heat private', async () => {
    const built = heatWorld();
    const engine = await runShowNight(built);
    const result = timelineOf(engine, built.storylines.rival);
    expect(result.kind === 'unavailable' && result.reason.code).toBe('storylines.notYours');
  });
});
