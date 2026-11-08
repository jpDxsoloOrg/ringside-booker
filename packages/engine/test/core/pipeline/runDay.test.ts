import { describe, expect, it } from 'vitest';
import { addDays, parseGameDate, type GameDate } from '../../../src/core/date';
import { InvariantError } from '../../../src/core/errors';
import type { AnyDomainEvent } from '../../../src/core/events/types';
import {
  CLOSE_STEP_ID,
  createRuntime,
  OPEN_STEP_ID,
  runDay,
  deterministicDayReport,
  type PhaseContext,
  type PhaseSpec,
  type ReactionContext,
} from '../../../src/core/pipeline';
import { idStreamName } from '../../../src/core/rng';
import { createIdMinter } from '../../../src/core/rng/ids';
import { chance, intBetween } from '../../../src/core/rng/odds';
import { RngRegistry } from '../../../src/core/rng/registry';
import { inputOf } from '../../../src/core/trace/helpers';
import { serialiseWorld } from '../../support/serialise';
import { ownerId, widgetId, type ToyRegistry } from '../../support/toy-registry';
import {
  MONDAY,
  pipelineToyWorld,
  scoreOf,
  toyRuntime,
  TUESDAY,
  type ToyRuntime,
} from './pipelineWorld';

type ToyPhase = PhaseSpec<ToyRegistry>;
type ToyContext = PhaseContext<ToyRegistry>;

/** A daily phase in the shows group. */
function phase(id: string, order: number, run: (ctx: ToyContext) => void): ToyPhase {
  return { id, group: 'shows', order, cadence: { kind: 'daily' }, run };
}

/** Sets widget `serial`'s owner-1 score. */
function setScore(ctx: ToyContext, serial: number, score: number): void {
  ctx.tx.update('widgets', widgetId(serial), (widget) => ({
    ...widget,
    scores: { ...widget.scores, [ownerId(1)]: score },
  }));
}

function eventTypes(runtime: ToyRuntime): string[] {
  return runtime.bus.recent().map((event) => event.type);
}

describe('runDay: order and the clock', () => {
  it('runs phases in group-then-order sequence, all on the same date', () => {
    const runtime = toyRuntime({ date: MONDAY });
    const seen: string[] = [];
    const record =
      (id: string) =>
      (ctx: ToyContext): void => {
        seen.push(`${id}@${ctx.date}`);
      };
    runtime.phases.register({
      ...phase('money.payroll', 0, record('money.payroll')),
      group: 'money',
    });
    runtime.phases.register(phase('shows.second', 20, record('shows.second')));
    runtime.phases.register({
      ...phase('house.cleanup', 5, record('house.cleanup')),
      group: 'housekeeping',
    });
    runtime.phases.register(phase('shows.first', 10, record('shows.first')));

    const report = runDay(runtime);

    expect(seen).toEqual([
      `house.cleanup@${MONDAY}`,
      `shows.first@${MONDAY}`,
      `shows.second@${MONDAY}`,
      `money.payroll@${MONDAY}`,
    ]);
    expect(report.steps.map((step) => [step.stepId, step.group, step.status])).toEqual([
      [OPEN_STEP_ID, 'open', 'ok'],
      ['house.cleanup', 'housekeeping', 'ok'],
      ['shows.first', 'shows', 'ok'],
      ['shows.second', 'shows', 'ok'],
      ['money.payroll', 'money', 'ok'],
      [CLOSE_STEP_ID, 'close', 'ok'],
    ]);
  });

  it('simulates D and leaves the world on D + 1', () => {
    const runtime = toyRuntime({ date: MONDAY });
    const report = runDay(runtime);

    expect(report.date).toBe(MONDAY);
    expect(runtime.world.meta.currentDate).toBe(TUESDAY);
    expect(runtime.world.meta.daysSimulated).toBe(1);
    expect(report.failedCount).toBe(0);
    expect(report.eventsPublished).toBe(2);
    const events = runtime.bus.recent();
    expect(events.map((event) => [event.type, event.date, event.payload])).toEqual([
      ['day.started', MONDAY, { date: MONDAY }],
      ['day.ended', MONDAY, { date: MONDAY, failedSteps: 0 }],
    ]);

    runDay(runtime);
    expect(runtime.world.meta.currentDate).toBe(addDays(MONDAY, 2));
    expect(runtime.world.meta.daysSimulated).toBe(2);
  });

  it('skips a weekly Monday phase on a Tuesday because of its cadence', () => {
    const runtime = toyRuntime({ date: TUESDAY });
    let runs = 0;
    runtime.phases.register({
      ...phase('shows.weekly', 0, () => {
        runs += 1;
      }),
      cadence: { kind: 'weekly', weekday: 'mon' },
    });

    const tuesday = runDay(runtime);
    expect(tuesday.steps[1]).toMatchObject({
      stepId: 'shows.weekly',
      status: 'skipped',
      skippedReason: 'cadence',
    });
    expect(runs).toBe(0);

    // Six more days brings the world to the next Monday, where it runs.
    for (let i = 0; i < 5; i++) {
      runDay(runtime);
    }
    const monday = runDay(runtime);
    expect(monday.date).toBe(addDays(MONDAY, 7));
    expect(monday.steps[1]?.status).toBe('ok');
    expect(runs).toBe(1);
  });

  it('skips a phase whose condition is false, reading the world settings', () => {
    const runtime = toyRuntime({
      meta: {
        settings: {
          agingEnabled: false,
          sandbox: false,
          generationLevel: 'medium',
          levelPlayingField: false,
          season: { lengthDays: 91 },
          extra: {},
        },
      },
    });
    let runs = 0;
    runtime.phases.register({
      ...phase('workers.aging', 0, () => {
        runs += 1;
      }),
      when: (view) => view.meta.settings.agingEnabled,
    });

    const report = runDay(runtime);

    expect(report.steps[1]).toMatchObject({
      stepId: 'workers.aging',
      status: 'skipped',
      skippedReason: 'condition',
    });
    expect(runs).toBe(0);
  });

  it('reports a condition that throws as a failed step and carries on', () => {
    const runtime = toyRuntime();
    let laterRuns = 0;
    runtime.phases.register({
      ...phase('workers.aging', 0, () => undefined),
      when: () => {
        throw new Error('settings unreadable');
      },
    });
    runtime.phases.register(
      phase('shows.later', 1, () => {
        laterRuns += 1;
      }),
    );

    const report = runDay(runtime);

    expect(report.steps[1]).toMatchObject({
      stepId: 'workers.aging',
      status: 'failed',
      error: { name: 'Error', message: 'settings unreadable' },
    });
    expect(laterRuns).toBe(1);
    expect(report.failedCount).toBe(1);
  });

  it('iterates rows in ascending ID order even when they were inserted in reverse', () => {
    const runtime = toyRuntime({ widgetSerials: [5, 4, 3, 2, 1] });
    const visited: string[] = [];
    runtime.phases.register(
      phase('shows.visit', 0, (ctx) => {
        for (const widget of ctx.read.tables.widgets.values()) {
          visited.push(widget.id);
        }
        for (const id of ctx.read.tables.widgets.ids()) {
          visited.push(id);
        }
      }),
    );

    runDay(runtime);

    const ascending = [1, 2, 3, 4, 5].map((serial) => widgetId(serial));
    expect(visited).toEqual([...ascending, ...ascending]);
  });

  it('throws when the closing step cannot move the clock', () => {
    const lastDay = parseGameDate('2999-12-31');
    const runtime = toyRuntime({ date: lastDay });
    expect(() => runDay(runtime)).toThrow(InvariantError);
    expect(runtime.world.meta.currentDate).toBe(lastDay);
    expect(runtime.failureLog.recent().map((failure) => failure.stepId)).toEqual([CLOSE_STEP_ID]);
  });
});

describe('runDay: failure isolation', () => {
  it('rolls back a failing phase and keeps the phases around it', () => {
    const runtime = toyRuntime();
    const delivered: string[] = [];
    runtime.bus.subscribe(
      'test.widgetScored',
      (event) => {
        delivered.push(event.payload.widgetId);
      },
      { id: 'test.listener' },
    );
    const failureNotices: AnyDomainEvent[] = [];
    runtime.bus.observe((event) => {
      if (event.type === 'pipeline.stepFailed') {
        failureNotices.push(event);
      }
    });
    const traceRef = { kind: 'test.widgetScore', id: widgetId(2) };

    runtime.phases.register(
      phase('shows.before', 0, (ctx) => {
        setScore(ctx, 1, 10);
      }),
    );
    runtime.phases.register(
      phase('shows.broken', 1, (ctx) => {
        setScore(ctx, 2, 99);
        ctx.publish('test.widgetScored', { widgetId: widgetId(2), score: 99 });
        ctx.recordTrace(traceRef, ctx.date, inputOf('Score', 99));
        ctx.log('about to fail');
        throw new Error('boom');
      }),
    );
    runtime.phases.register(
      phase('shows.after', 2, (ctx) => {
        setScore(ctx, 3, 30);
      }),
    );

    const report = runDay(runtime);

    expect(scoreOf(runtime, 1)).toBe(10);
    expect(scoreOf(runtime, 2)).toBe(0);
    expect(scoreOf(runtime, 3)).toBe(30);

    const broken = report.steps.find((step) => step.stepId === 'shows.broken');
    expect(broken).toMatchObject({
      status: 'failed',
      group: 'shows',
      error: { name: 'Error', message: 'boom' },
      eventsPublished: 0,
      tracesRecorded: 0,
      logs: ['about to fail'],
    });
    expect(report.failedCount).toBe(1);

    // Its staged event was never delivered or logged, and its trace was never stored.
    expect(delivered).toEqual([]);
    expect(eventTypes(runtime)).not.toContain('test.widgetScored');
    expect(runtime.traces.has(traceRef)).toBe(false);

    // The failure itself was published, logged and counted.
    expect(failureNotices.map((event) => [event.source, event.payload])).toEqual([
      [
        { kind: 'phase', id: 'shows.broken' },
        { stepId: 'shows.broken', message: 'boom' },
      ],
    ]);
    expect(eventTypes(runtime)).toEqual(['day.started', 'pipeline.stepFailed', 'day.ended']);
    expect(runtime.bus.recent({ types: ['day.ended'] })[0]?.payload.failedSteps).toBe(1);
    expect(runtime.failureLog.recent()).toMatchObject([
      { date: MONDAY, stepId: 'shows.broken', error: { message: 'boom' } },
    ]);
    // The clock still moved.
    expect(runtime.world.meta.currentDate).toBe(TUESDAY);
  });

  it('commits the events and traces of a passing phase', () => {
    const runtime = toyRuntime();
    const traceRef = { kind: 'test.widgetScore', id: widgetId(1) };
    runtime.phases.register(
      phase('shows.score', 0, (ctx) => {
        setScore(ctx, 1, 7);
        ctx.publish('test.widgetScored', { widgetId: widgetId(1), score: 7 });
        ctx.recordTrace(traceRef, ctx.date, inputOf('Score', 7));
        ctx.recordTrace(traceRef, ctx.date, inputOf('Score', 7));
      }),
    );

    const report = runDay(runtime);

    expect(report.steps[1]).toMatchObject({ status: 'ok', eventsPublished: 1, tracesRecorded: 1 });
    expect(runtime.traces.get(traceRef)).toMatchObject({ date: MONDAY, value: 7 });
    expect(eventTypes(runtime)).toEqual(['day.started', 'test.widgetScored', 'day.ended']);
  });

  it('fails a phase that returns a promise and rolls back what it wrote first', () => {
    const runtime = toyRuntime();
    // An `async` run writes, then hands back a promise. TypeScript lets a function that returns
    // anything stand in for a void one, so the pipeline has to catch it at runtime.
    const asVoid =
      (fn: (ctx: ToyContext) => unknown): ((ctx: ToyContext) => void) =>
      (ctx) =>
        fn(ctx);
    runtime.phases.register(
      phase(
        'shows.async',
        0,
        asVoid((ctx) => {
          setScore(ctx, 1, 42);
          return Promise.resolve();
        }),
      ),
    );
    runtime.phases.register(
      phase('shows.after', 1, (ctx) => {
        setScore(ctx, 2, 5);
      }),
    );

    const report = runDay(runtime);

    expect(scoreOf(runtime, 1)).toBe(0);
    expect(scoreOf(runtime, 2)).toBe(5);
    expect(report.steps.find((step) => step.stepId === 'shows.async')).toMatchObject({
      status: 'failed',
      error: { code: 'TX_STATE' },
    });
    expect(report.failedCount).toBe(1);
  });

  it('puts the RNG back so the next phase draws what it would have without the failure', () => {
    const drawsOfB = (registerFailingA: boolean): number[] => {
      const runtime = toyRuntime();
      const draws: number[] = [];
      if (registerFailingA) {
        runtime.phases.register(
          phase('test.phaseA', 0, (ctx) => {
            const stream = ctx.rng('test.alpha');
            stream.nextUint32();
            stream.nextUint32();
            stream.nextUint32();
            throw new Error('phase A failed');
          }),
        );
      }
      runtime.phases.register(
        phase('test.phaseB', 1, (ctx) => {
          const stream = ctx.rng('test.alpha');
          draws.push(stream.nextUint32(), stream.nextUint32(), stream.nextUint32());
        }),
      );
      const report = runDay(runtime);
      expect(report.failedCount).toBe(registerFailingA ? 1 : 0);
      return draws;
    };

    const withFailure = drawsOfB(true);
    const withoutA = drawsOfB(false);
    expect(withFailure).toHaveLength(3);
    expect(withFailure).toEqual(withoutA);
  });
});

describe('runDay: reactions', () => {
  it('runs each reaction in its own transaction and reports the ones that fail', () => {
    const runtime = toyRuntime();
    const subscribe = (id: string, handler: (ctx: ReactionContext<ToyRegistry>) => void): void => {
      runtime.bus.subscribe(
        'test.widgetScored',
        (_event, ctx) => {
          handler(ctx);
        },
        { id },
      );
    };
    subscribe('test.goodReaction', (ctx) => {
      ctx.tx.update('widgets', widgetId(2), (widget) => ({
        ...widget,
        scores: { ...widget.scores, [ownerId(1)]: 2 },
      }));
      ctx.log('scored widget 2');
    });
    subscribe('test.badReaction', (ctx) => {
      ctx.tx.update('widgets', widgetId(3), (widget) => ({
        ...widget,
        scores: { ...widget.scores, [ownerId(1)]: 3 },
      }));
      ctx.rng('test.beta').nextUint32();
      throw new Error('reaction broke');
    });

    runtime.phases.register(
      phase('test.phaseA', 0, (ctx) => {
        setScore(ctx, 1, 1);
        ctx.publish('test.widgetScored', { widgetId: widgetId(1), score: 1 });
      }),
    );

    const report = runDay(runtime);
    const phaseReport = report.steps.find((step) => step.stepId === 'test.phaseA');
    const scoredEvent = runtime.bus.recent({ types: ['test.widgetScored'] })[0];

    expect(scoreOf(runtime, 1)).toBe(1);
    expect(scoreOf(runtime, 2)).toBe(2);
    expect(scoreOf(runtime, 3)).toBe(0);
    expect(runtime.rng.toState().streams).not.toHaveProperty(['test.beta']);
    expect(phaseReport?.status).toBe('ok');
    expect(phaseReport?.logs).toEqual(['test.goodReaction: scored widget 2']);
    expect(phaseReport?.reactionFailures).toEqual([
      {
        subscriberId: 'test.badReaction',
        eventSeq: scoredEvent?.seq,
        error: expect.objectContaining({ name: 'Error', message: 'reaction broke' }) as unknown,
      },
    ]);
    // Reaction failures are listed on their step, not counted as failed steps.
    expect(report.failedCount).toBe(0);
    expect(runtime.failureLog.recent().map((failure) => failure.stepId)).toEqual([
      'reaction:test.badReaction',
    ]);
  });

  it('delivers the failure notice to subscribers, which run as reactions', () => {
    const runtime = toyRuntime();
    runtime.bus.subscribe(
      'pipeline.stepFailed',
      (event, ctx) => {
        ctx.tx.update('owners', ownerId(2), { name: `Saw ${event.payload.stepId}` });
      },
      { id: 'test.failureWatcher' },
    );
    runtime.phases.register(
      phase('test.broken', 0, () => {
        throw new Error('nope');
      }),
    );

    runDay(runtime);

    expect(runtime.world.tables.owners.require(ownerId(2)).name).toBe('Saw test.broken');
  });
});

describe('createRuntime', () => {
  it('installs the seeded ID minter, so tx.create draws only from the ids stream of its kind', () => {
    const world = pipelineToyWorld();
    const runtime = createRuntime({ world });
    expect(runtime.rng.toState().streams).toEqual({});

    const result = runtime.world.transact('create', (tx) =>
      tx.create('owners', {
        name: 'New owner',
        controller: { type: 'computer' },
        homeRegionId: null,
      }),
    );
    if (!result.ok) {
      throw result.error;
    }

    // The sequential factory the world was built with would have minted pro_0000000001.
    const expected = createIdMinter(new RngRegistry(world.meta.seed)).next(
      'promotion',
      () => false,
    );
    expect(result.value.id).toBe(expected);
    const streams = runtime.rng.toState().streams;
    expect(Object.keys(streams)).toEqual([idStreamName('promotion')]);
    expect(streams['ids.pro']).not.toEqual(
      new RngRegistry(world.meta.seed).toState().streams['ids.pro'],
    );
  });

  it('refuses an RNG registry seeded differently from the world', () => {
    expect(() =>
      createRuntime({ world: pipelineToyWorld({ seed: 'one' }), rng: new RngRegistry('two') }),
    ).toThrow(/does not match the world seed/);
  });

  it('times steps with the host clock and never on its own', () => {
    let tick = 0;
    const runtime = toyRuntime({
      now: () => {
        tick += 5;
        return tick;
      },
    });
    const report = runDay(runtime);
    expect(report.timing.ms).toBeGreaterThan(0);
    expect(toyRuntime().host.now()).toBe(0);
  });
});

/** Three phases and a reaction that use every part of the runtime, for the determinism test. */
function registerBusyPhases(runtime: ToyRuntime): void {
  runtime.phases.register({
    id: 'test.spawn',
    group: 'housekeeping',
    order: 0,
    cadence: { kind: 'daily' },
    run: (ctx) => {
      if (chance(ctx.rng('test.alpha'), 0.3)) {
        const owner = ctx.tx.create('owners', {
          name: `Spawned on ${ctx.date}`,
          controller: { type: 'computer' },
          homeRegionId: null,
        });
        ctx.publish('test.ownerCreated', { ownerId: owner.id });
      }
    },
  });
  runtime.phases.register({
    id: 'test.score',
    group: 'shows',
    order: 0,
    cadence: { kind: 'weekly', weekday: 'fri' },
    run: (ctx) => {
      for (const widget of ctx.read.tables.widgets.values()) {
        const score = (widget.scores[ownerId(1)] ?? 0) + intBetween(ctx.rng('test.beta'), 1, 6);
        ctx.tx.update('widgets', widget.id, {
          scores: { ...widget.scores, [ownerId(1)]: score },
        });
        ctx.recordTrace(
          { kind: 'test.widgetScore', id: widget.id },
          ctx.date,
          inputOf('Score', score),
        );
        ctx.publish('test.widgetScored', { widgetId: widget.id, score });
      }
    },
  });
  runtime.phases.register({
    id: 'test.flaky',
    group: 'money',
    order: 0,
    cadence: { kind: 'daily' },
    run: (ctx) => {
      const roll = ctx.rng('test.gamma').nextFloat();
      setScore(ctx, 1, Math.round(roll * 1000));
      if (roll < 0.25) {
        throw new Error(`flaky on ${ctx.date}`);
      }
    },
  });
  runtime.bus.subscribe(
    'test.widgetScored',
    (event, ctx) => {
      const bonus = intBetween(ctx.rng('test.seeds'), 0, 3);
      if (bonus === 0) {
        throw new Error('no bonus');
      }
      ctx.tx.update('owners', ownerId(2), {
        name: `Bonus ${String(bonus)} for ${event.payload.widgetId}`,
      });
    },
    { id: 'test.bonus' },
  );
}

describe('runDay: determinism', () => {
  it('gives identical state from the same toy world and seed after 60 days', () => {
    const simulate = (clockStep: number) => {
      let tick = 0;
      const runtime = toyRuntime({
        seed: 'determinism',
        now: () => {
          tick += clockStep;
          return tick;
        },
      });
      registerBusyPhases(runtime);
      const reports = [];
      let date: GameDate = runtime.world.meta.currentDate;
      for (let day = 0; day < 60; day++) {
        const report = runDay(runtime);
        expect(report.date).toBe(date);
        date = addDays(date, 1);
        reports.push(deterministicDayReport(report));
      }
      return {
        world: serialiseWorld(runtime.world),
        rng: runtime.rng.toState(),
        events: runtime.bus.toState(),
        traces: runtime.traces.toState(),
        failures: runtime.failureLog
          .toState()
          .entries.map(({ date: failedOn, stepId }) => [failedOn, stepId]),
        reports,
        ownerCount: runtime.world.tables.owners.ids().length,
      };
    };

    const first = simulate(1);
    const second = simulate(7);

    expect(second).toEqual(first);
    // The run exercised every path: new rows, failures and committed traces.
    expect(first.ownerCount).toBeGreaterThan(2);
    expect(first.failures.some(([, stepId]) => stepId === 'test.flaky')).toBe(true);
    expect(first.failures.some(([, stepId]) => stepId === 'reaction:test.bonus')).toBe(true);
    expect(first.traces.full.length).toBeGreaterThan(0);
    expect(first.events.seq).toBeGreaterThan(120);
  });
});
