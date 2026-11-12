// Show night: the shows.runShows phase. Design: docs/design/show-night.md#phase
import { afterEach, describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type EngineState } from '../../../src/core/api';
import { runStep } from '../../../src/core/pipeline/runStep';
import { createRuntime } from '../../../src/core/pipeline/runtime';
import { startDecision, walkTrace, type TraceNode } from '../../../src/core/trace';
import type { EventInstanceId, SegmentId } from '../../../src/core/ids';
import type { Segment } from '../../../src/model/entities/segment';
import { defaultSystems } from '../../../src/systems';
import {
  NO_PLAN_NO_CONTEST_REASON,
  RIVAL_SEGMENT_SCORE_TRACE_KIND,
  SEGMENT_SCORE_TRACE_KIND,
  SHOW_SCORE_TRACE_KIND,
  registerMatchOutcomeResolver,
  registerSegmentResultApplier,
  resultPeople,
  runShowsPhase,
  segmentScoreTraceRef,
  showScoreTraceRef,
  unregisterMatchOutcomeResolver,
  unregisterSegmentResultApplier,
  matchOutcomeResolver,
  type SegmentResult,
} from '../../../src/systems/shows';
import {
  MATCH_OUTCOME_RESOLVER_ID,
  showNightOutcomeResolver,
} from '../../../src/systems/match/finishes/showNight';
import { createEngineTunables } from '../../../src/systems/tunables';
import { SYSTEMS_WITHOUT_SHOW_DAY_GATE } from '../../support';
import { PINFALL, SUBMISSION } from '../booking/command-world';
import {
  OMNISCIENT,
  segmentEvents,
  showEvents,
  showNightEngine,
  showNightEvents,
  showNightWorld,
  TODAY,
  type ShowNightWorld,
} from './show-night-world';

const APPLIER_ID = 'test.recordResults';
const RESOLVER_ID = 'test.alwaysDraw';

afterEach(() => {
  unregisterSegmentResultApplier(APPLIER_ID);
  unregisterMatchOutcomeResolver(RESOLVER_ID);
  // Tests of the seam itself set MTCH2's resolver aside; put it back.
  if (matchOutcomeResolver().id !== MATCH_OUTCOME_RESOLVER_ID) {
    registerMatchOutcomeResolver(showNightOutcomeResolver);
  }
});

/** Sets MTCH2's resolver aside, so the built-in one (or a test's) decides. */
function withoutMatchResolver(): void {
  unregisterMatchOutcomeResolver(MATCH_OUTCOME_RESOLVER_ID);
}

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${what}`);
  }
  return value;
}

function showIn(state: EngineState, id: EventInstanceId | null) {
  return required(
    state.world.tables.eventInstances.find((row) => row.id === id),
    `show ${String(id)}`,
  );
}

function segmentIn(state: EngineState, id: SegmentId): Segment {
  return required(
    state.world.tables.segments.find((row) => row.id === id),
    `segment ${id}`,
  );
}

function cardIn(state: EngineState, id: EventInstanceId | null): Segment[] {
  return state.world.tables.segments.filter((row) => row.eventInstanceId === id);
}

async function runDay(built: ShowNightWorld) {
  const engine = showNightEngine(built.world);
  const advanced = await engine.advanceDays({ maxDays: 1 });
  return { engine, advanced, state: engine.exportState() };
}

function storedTrace(engine: ReturnType<typeof showNightEngine>, kind: string, id: string) {
  const found = engine.query('trace.get', { ref: { kind, id } }, OMNISCIENT);
  if (!found.ok || found.data === null || !('trace' in found.data)) {
    throw new Error(`No full trace ${kind}:${id}`);
  }
  return found.data.trace;
}

/** Every label in the trace, plus every decision's reason (the line the player reads). */
function labelsIn(node: TraceNode): string[] {
  const labels: string[] = [];
  walkTrace(node, (visited) => {
    labels.push(visited.label);
    if (visited.kind === 'decision') {
      labels.push(visited.reason);
    }
  });
  return labels;
}

describe('shows.runShows', () => {
  it('is a daily phase in the shows group at order 10', () => {
    const phase = defaultSystems
      .flatMap((system) => system.phases)
      .find((candidate) => candidate.id === 'shows.runShows');
    expect(phase).toMatchObject({ group: 'shows', order: 10, cadence: { kind: 'daily' } });
  });

  describe('a locked human show with 6 segments', () => {
    it('rates every segment, keeps the planned results and completes the show', async () => {
      const built = showNightWorld();
      const { advanced, state } = await runDay(built);
      expect(advanced.failures).toEqual([]);

      const card = built.humanCard.map((id) => segmentIn(state, id));
      expect(card).toHaveLength(6);
      for (const segment of card) {
        const rating = required(segment.rating, `rating of ${segment.id}`);
        expect(rating.stars * 4).toBe(Math.round(rating.stars * 4));
        expect(rating.crowd).not.toBeNull();
        expect(rating.expectation).not.toBeNull();
        expect(rating.workRate === null).toBe(segment.kind === 'angle');
        expect(rating.traceId).toBe(`${SEGMENT_SCORE_TRACE_KIND}:${segment.id}`);
      }
      expect(card.map((segment) => (segment.kind === 'match' ? segment.outcome : null))).toEqual([
        { kind: 'win', winningSide: 0, methodKey: PINFALL },
        { kind: 'win', winningSide: 1, methodKey: SUBMISSION },
        { kind: 'draw' },
        null,
        { kind: 'noContest' },
        { kind: 'win', winningSide: 0, methodKey: PINFALL },
      ]);

      const show = showIn(state, built.human);
      expect(show.status).toBe('completed');
      const result = required(show.result, 'result');
      expect(result).toMatchObject({
        traceId: `${SHOW_SCORE_TRACE_KIND}:${String(built.human)}`,
        attendance: null,
        gate: null,
        viewers: null,
      });
      // No cap modifier is registered, so the score is the raw score.
      expect(result.score).toBe(result.rawScore);
    });

    it('stores a show trace with one line per slot and segment traces that start with the slot', async () => {
      const built = showNightWorld();
      const { engine } = await runDay(built);
      const human = required(built.human, 'human show');
      const showTrace = storedTrace(engine, SHOW_SCORE_TRACE_KIND, human);
      const slotLines = (showTrace.kind === 'formula' ? showTrace.children : [])
        .map((child) => child.label)
        .filter((label) => /^(Pre-show|Opener|Midcard|Semi-main|Main event): /.test(label));
      expect(slotLines).toHaveLength(6);
      expect(slotLines[0]).toMatch(/^Pre-show: /);
      expect(slotLines[5]).toMatch(/^Main event: /);

      const mainEvent = required(built.humanCard[5], 'main event');
      const segmentTrace = storedTrace(engine, SEGMENT_SCORE_TRACE_KIND, mainEvent);
      const children = segmentTrace.kind === 'formula' ? segmentTrace.children : [];
      expect(children[1]).toMatchObject({ kind: 'note', label: 'Main event (long)' });
      expect(children[3]).toMatchObject({ kind: 'decision', label: 'Match result' });
    });

    it('publishes segment.completed for each segment in card order, then show.completed', async () => {
      const built = showNightWorld();
      const { engine } = await runDay(built);
      const human = required(built.human, 'human show');
      const forHuman = showNightEvents(engine).filter(
        (event) => event.payload.eventInstanceId === human,
      );
      expect(forHuman.map((event) => event.type)).toEqual([
        ...Array.from({ length: 6 }, () => 'segment.completed'),
        'show.completed',
      ]);
      const segments = segmentEvents(engine).filter((event) => event.eventInstanceId === human);
      expect(segments.map((event) => event.segmentId)).toEqual(built.humanCard);
      expect(segments[0]).toMatchObject({ preShow: true, slot: 0, kind: 'match' });

      const person = (index: number) => required(built.roster[index], `roster ${String(index)}`);
      const sorted = (...ids: string[]) => [...ids].sort();
      expect(
        segments.map(({ winnerIds, loserIds, drawIds }) => ({ winnerIds, loserIds, drawIds })),
      ).toEqual([
        { winnerIds: [person(0)], loserIds: [person(1)], drawIds: [] },
        { winnerIds: [person(3)], loserIds: [person(2)], drawIds: [] },
        { winnerIds: [], loserIds: [], drawIds: sorted(person(4), person(5)) },
        { winnerIds: [], loserIds: [], drawIds: [] },
        { winnerIds: [], loserIds: [], drawIds: [] },
        { winnerIds: [person(9)], loserIds: [person(10)], drawIds: [] },
      ]);
      expect(segments[1]).toMatchObject({
        methodKey: SUBMISSION,
        finishKey: expect.stringMatching(/^finish\./) as unknown,
      });

      const shows = showEvents(engine).filter((event) => event.eventInstanceId === human);
      expect(shows).toEqual([
        expect.objectContaining({ offscreen: false, segmentCount: 6, date: TODAY }),
      ]);
    });
  });

  it('leaves an unlocked human show and a cancelled show untouched', async () => {
    const built = showNightWorld();
    const before = initialEngineState(built.world);
    const { state, advanced } = await runDay(built);
    expect(advanced.failures).toEqual([]);
    for (const id of [built.unlocked, built.cancelled]) {
      expect(showIn(state, id)).toEqual(showIn(before, id));
      expect(cardIn(state, id)).toEqual(cardIn(before, id));
    }
    expect(showIn(state, built.unlocked).status).toBe('scheduled');
  });

  it('scores a rival show with no card off-screen', async () => {
    const built = showNightWorld();
    const { engine, state } = await runDay(built);
    const bare = required(built.rivalBare[0], 'bare rival show');
    const show = showIn(state, bare);
    expect(show.status).toBe('completed');
    const result = required(show.result, 'result');
    expect(result.rawScore).toBe(result.score);
    expect(showEvents(engine).filter((event) => event.eventInstanceId === bare)).toEqual([
      expect.objectContaining({ offscreen: true, segmentCount: 0, score: result.score }),
    ]);
    expect(segmentEvents(engine).some((event) => event.eventInstanceId === bare)).toBe(false);
    expect(storedTrace(engine, SHOW_SCORE_TRACE_KIND, bare).label).toBe(
      'Show score (card not booked in detail)',
    );
  });

  it('ends every unplanned match on a rival card as a no contest without MTCH2, with the reason traced', async () => {
    withoutMatchResolver();
    const built = showNightWorld();
    const { engine, state } = await runDay(built);
    for (const segmentId of built.rivalMatches) {
      const segment = segmentIn(state, segmentId);
      expect(segment.kind === 'match' ? segment.outcome : null).toEqual({ kind: 'noContest' });
      expect(segment.rating?.traceId).toBe(`${RIVAL_SEGMENT_SCORE_TRACE_KIND}:${segmentId}`);
      expect(labelsIn(storedTrace(engine, RIVAL_SEGMENT_SCORE_TRACE_KIND, segmentId))).toContain(
        NO_PLAN_NO_CONTEST_REASON,
      );
    }
    const events = segmentEvents(engine).filter(
      (event) => event.eventInstanceId === built.rivalCard,
    );
    expect(events.map((event) => event.segmentId)).toEqual(built.rivalMatches);
    for (const event of events) {
      expect([event.winnerIds, event.loserIds, event.drawIds]).toEqual([[], [], []]);
    }
    expect(showIn(state, built.rivalCard).status).toBe('completed');
    expect(showEvents(engine).find((event) => event.eventInstanceId === built.rivalCard)).toEqual(
      expect.objectContaining({ offscreen: false, segmentCount: 2 }),
    );
  });

  it('runs a registered applier on every segment, in card order', async () => {
    const seen: SegmentResult[] = [];
    registerSegmentResultApplier({
      id: APPLIER_ID,
      order: 10,
      apply: (_ctx, result) => {
        seen.push(result);
      },
    });
    const built = showNightWorld();
    await runDay(built);
    const human = seen.filter((result) => result.eventInstanceId === built.human);
    expect(human.map((result) => result.segmentId)).toEqual(built.humanCard);
    expect(human[0]).toMatchObject({ preShow: true, roleKey: 'preShow', humanShow: true });
    expect(human[5]).toMatchObject({ roleKey: 'mainEvent', durationClass: 'long' });
    expect(human[3]).toMatchObject({ kind: 'angle', outcome: null, winnerIds: [] });
    const rival = seen.filter((result) => result.eventInstanceId === built.rivalCard);
    expect(rival.map((result) => result.humanShow)).toEqual([false, false]);
  });

  it('rolls back every show of the day when an applier throws', async () => {
    registerSegmentResultApplier({
      id: APPLIER_ID,
      order: 10,
      apply: () => {
        throw new Error('Test applier failure');
      },
    });
    const built = showNightWorld();
    const before = initialEngineState(built.world);
    const { engine, state, advanced } = await runDay(built);
    expect(advanced.failures.map((failure) => failure.stepId)).toEqual(['shows.runShows']);
    const failures = engine.query('sim.failures', { limit: 10 }, OMNISCIENT);
    expect(failures.ok && failures.data.map((failure) => failure.stepId)).toEqual([
      'shows.runShows',
    ]);
    expect(showIn(state, built.human).status).toBe('booked');
    for (const id of [built.human, built.rivalBare[0] ?? null, built.rivalCard]) {
      expect(showIn(state, id)).toEqual(showIn(before, id));
      expect(cardIn(state, id)).toEqual(cardIn(before, id));
    }
    expect(showNightEvents(engine)).toEqual([]);
  });

  it('uses a registered outcome resolver instead of the planned result', async () => {
    withoutMatchResolver();
    registerMatchOutcomeResolver({
      id: RESOLVER_ID,
      resolve: () => ({
        outcome: { kind: 'draw' },
        finishKey: null,
        methodKey: null,
        titleCanChange: null,
        trace: startDecision<string>('Test resolver').choose('draw', 'Every match is a draw').trace,
      }),
    });
    const built = showNightWorld();
    const { engine, state } = await runDay(built);
    const matches = [...built.humanCard, ...built.rivalMatches]
      .map((id) => segmentIn(state, id))
      .filter((segment) => segment.kind === 'match');
    expect(matches).toHaveLength(7);
    for (const segment of matches) {
      expect(segment.outcome).toEqual({ kind: 'draw' });
    }
    const first = required(built.rivalMatches[0], 'rival match');
    expect(labelsIn(storedTrace(engine, RIVAL_SEGMENT_SCORE_TRACE_KIND, first))).toContain(
      'Test resolver',
    );
  });

  it('refuses a second resolver', () => {
    withoutMatchResolver();
    const resolver = {
      id: RESOLVER_ID,
      resolve: () => {
        throw new Error('not called');
      },
    };
    registerMatchOutcomeResolver(resolver);
    expect(() => {
      registerMatchOutcomeResolver({ ...resolver, id: 'test.another' });
    }).toThrow(/already registered/);
  });

  it('changes nothing when run a second time on the same date', () => {
    const built = showNightWorld();
    const runtime = createRuntime({ world: built.world, tunables: createEngineTunables() });
    const source = { kind: 'phase', id: runShowsPhase.id } as const;
    const first = runStep(runtime, runShowsPhase.id, source, runShowsPhase.run, { date: TODAY });
    expect(first.status).toBe('ok');
    const tables = JSON.stringify({
      shows: built.world.tables.eventInstances.values(),
      segments: built.world.tables.segments.values(),
    });
    const seq = runtime.bus.seq;
    const rng = JSON.stringify(runtime.rng.toState());
    const traces = JSON.stringify(runtime.traces.toState());

    const second = runStep(runtime, runShowsPhase.id, source, runShowsPhase.run, { date: TODAY });
    expect(second.status).toBe('ok');
    expect(
      JSON.stringify({
        shows: built.world.tables.eventInstances.values(),
        segments: built.world.tables.segments.values(),
      }),
    ).toBe(tables);
    expect(runtime.bus.seq).toBe(seq);
    expect(JSON.stringify(runtime.rng.toState())).toBe(rng);
    expect(JSON.stringify(runtime.traces.toState())).toBe(traces);
  });

  it('runs before the day closes, so a full day completes the locked show and closes the unlocked one', async () => {
    const built = showNightWorld();
    const engine = createEngine({
      state: initialEngineState(built.world),
      systems: SYSTEMS_WITHOUT_SHOW_DAY_GATE,
    });
    const advanced = await engine.advanceDays({ maxDays: 1 });
    expect(advanced.failures).toEqual([]);
    const state = engine.exportState();
    expect(showIn(state, built.human).status).toBe('completed');
    expect(showIn(state, built.rivalCard).status).toBe('completed');
    expect(showIn(state, built.unlocked)).toMatchObject({
      status: 'cancelled',
      cancellation: { reason: 'notRun' },
    });
    expect(cardIn(state, built.unlocked).every((segment) => segment.rating === null)).toBe(true);
  });
});

describe('segmentScoreTraceRef and showScoreTraceRef', () => {
  it('file human and rival segments under their own kinds', () => {
    const built = showNightWorld();
    const human = required(built.humanCard[0], 'segment');
    expect(segmentScoreTraceRef(human, true).kind).toBe(SEGMENT_SCORE_TRACE_KIND);
    expect(segmentScoreTraceRef(human, false).kind).toBe(RIVAL_SEGMENT_SCORE_TRACE_KIND);
    expect(showScoreTraceRef(built.rivalCard).kind).toBe(SHOW_SCORE_TRACE_KIND);
  });
});

describe('resultPeople', () => {
  const { roster } = showNightWorld();
  const person = (index: number) => required(roster[index], `roster ${String(index)}`);
  const sorted = (...ids: string[]) => [...ids].sort();
  const people = [
    { side: 0, competitorIds: [person(1), person(0)] },
    { side: 1, competitorIds: [person(2)] },
    { side: 2, competitorIds: [person(4), person(3)] },
  ];

  it('makes the winning side winners and every other side losers, by id', () => {
    expect(resultPeople({ kind: 'win', winningSide: 2, methodKey: PINFALL }, people)).toEqual({
      winnerIds: sorted(person(3), person(4)),
      loserIds: sorted(person(0), person(1), person(2)),
      drawIds: [],
    });
  });

  it('puts every competitor in a draw, and nobody in a no contest or an angle', () => {
    expect(resultPeople({ kind: 'draw' }, people).drawIds).toEqual(
      sorted(person(0), person(1), person(2), person(3), person(4)),
    );
    const nobody = { winnerIds: [], loserIds: [], drawIds: [] };
    expect(resultPeople({ kind: 'noContest' }, people)).toEqual(nobody);
    expect(resultPeople(null, people)).toEqual(nobody);
  });
});
