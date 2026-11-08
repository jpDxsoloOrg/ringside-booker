import { describe, expect, it } from 'vitest';
import { addDays, parseGameDate, type GameDate } from '../../../src/core/date';
import { PipelineError } from '../../../src/core/errors';
import {
  advanceDays,
  createRuntime,
  deterministicDayReport,
  evaluateGates,
  GateRegistry,
  MAX_ADVANCE_DAYS,
  REPEATED_FAILURE_GATE_ID,
  STOP_DATE_GATE_ID,
  type AdvanceOptions,
  type AdvanceProgress,
  type AdvanceResult,
  type GateHit,
  type GateSpec,
  type PhaseContext,
  type PhaseSpec,
} from '../../../src/core/pipeline';
import { intBetween } from '../../../src/core/rng/odds';
import { createEngineTunables } from '../../../src/systems/tunables';
import { serialiseWorld } from '../../support/serialise';
import { ownerId, widgetId, type ToyRegistry } from '../../support/toy-registry';
import { MONDAY, pipelineToyWorld, toyRuntime, type ToyRuntime } from './pipelineWorld';

type ToyPhase = PhaseSpec<ToyRegistry>;
type ToyContext = PhaseContext<ToyRegistry>;
type ToyGate = GateSpec<ToyRegistry>;

/** A daily phase in the shows group. */
function phase(id: string, order: number, run: (ctx: ToyContext) => void): ToyPhase {
  return { id, group: 'shows', order, cadence: { kind: 'daily' }, run };
}

/** A gate that hits on one date, with a player-facing reason and a link to a widget. */
function gateOn(id: string, hitDate: GameDate): ToyGate {
  return {
    id,
    label: 'Show needs booking',
    check: (_view, date) =>
      date === hitDate
        ? {
            gateId: id,
            reason: `Your show 'Friday Fury' on ${hitDate} has no card yet`,
            subject: { kind: 'title', id: widgetId(1) },
            actionHint: 'booking',
          }
        : null,
  };
}

/** A runtime whose repeated-failure gate trips after `threshold` days. */
function runtimeWithThreshold(threshold: number): ToyRuntime {
  return createRuntime({
    world: pipelineToyWorld(),
    tunables: createEngineTunables({ 'sim.stopSkipAfterConsecutiveFailures': threshold }),
  });
}

/** Lets pending microtasks run until `condition` holds. Never uses a timer. */
async function flushUntil(condition: () => boolean): Promise<void> {
  for (let tick = 0; tick < 1000 && !condition(); tick++) {
    await Promise.resolve();
  }
  expect(condition()).toBe(true);
}

/** A fixed snapshot of everything a gate check must not change. */
function snapshot(runtime: ToyRuntime) {
  return {
    world: serialiseWorld(runtime.world),
    date: runtime.world.meta.currentDate,
    rng: runtime.rng.toState(),
    seq: runtime.bus.seq,
    events: runtime.bus.toState(),
    failures: runtime.failureLog.toState(),
  };
}

describe('advanceDays: running days', () => {
  it('advances maxDays days and reports completed', async () => {
    const runtime = toyRuntime({ date: MONDAY });
    const progress: AdvanceProgress[] = [];

    const result = await advanceDays(runtime, {
      maxDays: 7,
      onDay: (step) => progress.push(step),
    });

    expect(result).toEqual({
      startDate: MONDAY,
      endDate: addDays(MONDAY, 7),
      daysAdvanced: 7,
      stoppedBy: { kind: 'completed' },
      failures: [],
      eventsPublished: 14,
      timing: { ms: 0 },
    });
    expect(runtime.world.meta.currentDate).toBe(addDays(MONDAY, 7));
    expect(progress.map((step) => [step.dayIndex, step.date, step.totalDays])).toEqual(
      Array.from({ length: 7 }, (_, index) => [index + 1, addDays(MONDAY, index), 7]),
    );
    expect(runtime.lastDayReport?.date).toBe(addDays(MONDAY, 6));
  });

  it('returns a JSON-safe result', async () => {
    const runtime = toyRuntime();
    runtime.phases.register(
      phase('shows.broken', 0, () => {
        throw new Error('no arena');
      }),
    );
    runtime.gates.register(gateOn('events.showNeedsBooking', addDays(MONDAY, 2)));

    const result = await advanceDays(runtime, { maxDays: 30 });

    const roundTrip: unknown = JSON.parse(JSON.stringify(result));
    expect(roundTrip).toStrictEqual(result);
    expect(result.failures).toEqual([
      { date: MONDAY, stepId: 'shows.broken', message: 'no arena' },
      { date: addDays(MONDAY, 1), stepId: 'shows.broken', message: 'no arena' },
    ]);
  });

  it('times the advance with the host clock', async () => {
    let tick = 0;
    const runtime = toyRuntime({
      now: () => {
        tick += 1;
        return tick;
      },
    });
    const result = await advanceDays(runtime, { maxDays: 3 });
    expect(result.timing.ms).toBeGreaterThan(0);
  });
});

describe('advanceDays: gates', () => {
  it('stops before the day a gate hits on, with the hit in the result', async () => {
    const runtime = toyRuntime({ date: MONDAY });
    const thirdDay = addDays(MONDAY, 2);
    runtime.gates.register(gateOn('events.showNeedsBooking', thirdDay));

    const result = await advanceDays(runtime, { maxDays: 7 });

    expect(result.daysAdvanced).toBe(2);
    expect(result.endDate).toBe(thirdDay);
    expect(runtime.world.meta.currentDate).toBe(thirdDay);
    expect(result.stoppedBy).toEqual({
      kind: 'gate',
      hits: [
        {
          gateId: 'events.showNeedsBooking',
          reason: `Your show 'Friday Fury' on ${thirdDay} has no card yet`,
          subject: { kind: 'title', id: widgetId(1) },
          actionHint: 'booking',
        },
      ],
    });
  });

  it('returns 0 days when a gate hits on the current date, without simulating anything', async () => {
    const runtime = toyRuntime({ date: MONDAY });
    runtime.gates.register(gateOn('events.showNeedsBooking', MONDAY));
    const before = snapshot(runtime);
    let days = 0;
    let yields = 0;

    const result = await advanceDays(runtime, {
      maxDays: 7,
      onDay: () => {
        days += 1;
      },
      yieldToHost: () => {
        yields += 1;
        return Promise.resolve();
      },
    });

    expect(result.daysAdvanced).toBe(0);
    expect(result.startDate).toBe(MONDAY);
    expect(result.endDate).toBe(MONDAY);
    expect(result.eventsPublished).toBe(0);
    expect(result.stoppedBy.kind).toBe('gate');
    expect(days).toBe(0);
    expect(yields).toBe(0);
    expect(snapshot(runtime)).toEqual(before);
    expect(runtime.lastDayReport).toBeNull();
  });

  it('collects every hit in registration order, the first being the main reason', async () => {
    const runtime = toyRuntime({ date: MONDAY });
    const day = addDays(MONDAY, 1);
    runtime.gates.register(gateOn('inbox.decisionPending', day));
    runtime.gates.register({ id: 'test.never', label: 'Never', check: () => null });
    runtime.gates.register(gateOn('events.showNeedsBooking', day));

    const result = await advanceDays(runtime, { maxDays: 5 });

    expect(result.daysAdvanced).toBe(1);
    const hits = result.stoppedBy.kind === 'gate' ? result.stoppedBy.hits : [];
    expect(hits.map((hit) => hit.gateId)).toEqual([
      'inbox.decisionPending',
      'events.showNeedsBooking',
    ]);
  });

  it('stops at the start of stopAtDate, before simulating it', async () => {
    const runtime = toyRuntime({ date: MONDAY });
    const stopAtDate = addDays(MONDAY, 5);
    let lastSimulated: GameDate | null = null;

    const result = await advanceDays(runtime, {
      maxDays: 30,
      stopAtDate,
      onDay: (progress) => {
        lastSimulated = progress.date;
      },
    });

    expect(result.daysAdvanced).toBe(5);
    expect(result.endDate).toBe(stopAtDate);
    expect(lastSimulated).toBe(addDays(MONDAY, 4));
    expect(result.stoppedBy).toEqual({
      kind: 'gate',
      hits: [{ gateId: STOP_DATE_GATE_ID, reason: 'Reached the date you asked to stop at' }],
    });
  });

  it('completes without a gate hit when maxDays runs out before stopAtDate', async () => {
    const runtime = toyRuntime({ date: MONDAY });
    const result = await advanceDays(runtime, { maxDays: 3, stopAtDate: addDays(MONDAY, 5) });
    expect(result.daysAdvanced).toBe(3);
    expect(result.stoppedBy).toEqual({ kind: 'completed' });
  });

  it('treats a gate check that throws as a hit naming the gate', async () => {
    const runtime = toyRuntime({ date: MONDAY });
    runtime.gates.register({
      id: 'inbox.decisionPending',
      label: 'Decision pending',
      check: () => {
        throw new Error('inbox unreadable');
      },
    });

    const result = await advanceDays(runtime, { maxDays: 5 });

    expect(result.daysAdvanced).toBe(0);
    expect(result.stoppedBy).toEqual({
      kind: 'gate',
      hits: [
        {
          gateId: 'inbox.decisionPending',
          reason:
            'Couldn\'t check "Decision pending", so the skip stopped to be safe: inbox unreadable',
        },
      ],
    });
  });
});

describe('advanceDays: cancellation', () => {
  it('stops after the day on which the signal was set, with a whole day simulated', async () => {
    const runtime = toyRuntime({ date: MONDAY });
    let scored = 0;
    runtime.phases.register(
      phase('shows.score', 0, (ctx) => {
        scored += 1;
        ctx.tx.update('widgets', widgetId(1), (widget) => ({
          ...widget,
          scores: { ...widget.scores, [ownerId(1)]: scored },
        }));
      }),
    );
    const signal = { aborted: false };

    const result = await advanceDays(runtime, {
      maxDays: 10,
      signal,
      onDay: (progress) => {
        if (progress.dayIndex === 4) {
          signal.aborted = true;
        }
      },
    });

    expect(result.daysAdvanced).toBe(4);
    expect(result.stoppedBy).toEqual({ kind: 'cancelled' });
    expect(result.endDate).toBe(addDays(MONDAY, 4));
    expect(runtime.world.meta.daysSimulated).toBe(4);
    expect(scored).toBe(4);
    expect(runtime.world.tables.widgets.require(widgetId(1)).scores[ownerId(1)]).toBe(4);
  });

  it('does not start when the signal is already set', async () => {
    const runtime = toyRuntime({ date: MONDAY });
    const result = await advanceDays(runtime, { maxDays: 10, signal: { aborted: true } });
    expect(result.daysAdvanced).toBe(0);
    expect(result.stoppedBy).toEqual({ kind: 'cancelled' });
    expect(runtime.world.meta.currentDate).toBe(MONDAY);
  });
});

describe('advanceDays: repeated failures', () => {
  it('stops after the configured number of days in a row with the same failed step', async () => {
    const runtime = toyRuntime({ date: MONDAY });
    runtime.phases.register(
      phase('shows.broken', 0, (ctx) => {
        throw new Error(`no arena on ${ctx.date}`);
      }),
    );

    const result = await advanceDays(runtime, { maxDays: 365 });

    expect(runtime.tunables.get('sim.stopSkipAfterConsecutiveFailures')).toBe(3);
    expect(result.daysAdvanced).toBe(3);
    expect(result.failures).toHaveLength(3);
    expect(result.stoppedBy).toEqual({
      kind: 'gate',
      hits: [
        {
          gateId: REPEATED_FAILURE_GATE_ID,
          reason: `The skip stopped because "shows.broken" failed on each of the last 3 days. Last error: no arena on ${addDays(MONDAY, 2)}`,
        },
      ],
    });
  });

  it('follows the tunable', async () => {
    const runtime = runtimeWithThreshold(5);
    runtime.phases.register(
      phase('shows.broken', 0, () => {
        throw new Error('no arena');
      }),
    );

    const result = await advanceDays(runtime, { maxDays: 365 });

    expect(result.daysAdvanced).toBe(5);
    expect(result.stoppedBy.kind).toBe('gate');
  });

  it('never trips for a phase that fails on alternating days', async () => {
    const runtime = runtimeWithThreshold(2);
    runtime.phases.register(
      phase('shows.flaky', 0, (ctx) => {
        if (ctx.read.meta.daysSimulated % 2 === 0) {
          throw new Error('flaky');
        }
      }),
    );

    const result = await advanceDays(runtime, { maxDays: 40 });

    expect(result.daysAdvanced).toBe(40);
    expect(result.stoppedBy).toEqual({ kind: 'completed' });
    expect(result.failures).toHaveLength(20);
  });

  it('does not trip when different steps fail on consecutive days', async () => {
    const runtime = toyRuntime({ date: MONDAY });
    runtime.phases.register(
      phase('shows.even', 0, (ctx) => {
        if (ctx.read.meta.daysSimulated % 2 === 0) {
          throw new Error('even');
        }
      }),
    );
    runtime.phases.register(
      phase('shows.odd', 1, (ctx) => {
        if (ctx.read.meta.daysSimulated % 2 === 1) {
          throw new Error('odd');
        }
      }),
    );

    const result = await advanceDays(runtime, { maxDays: 10 });

    expect(result.daysAdvanced).toBe(10);
    expect(result.stoppedBy).toEqual({ kind: 'completed' });
  });

  it('counts failures only within one advance', async () => {
    const runtime = toyRuntime({ date: MONDAY });
    runtime.phases.register(
      phase('shows.broken', 0, () => {
        throw new Error('no arena');
      }),
    );

    for (let call = 0; call < 5; call++) {
      const result = await advanceDays(runtime, { maxDays: 2 });
      expect(result.stoppedBy).toEqual({ kind: 'completed' });
    }
    expect(runtime.world.meta.daysSimulated).toBe(10);
  });
});

describe('advanceDays: options', () => {
  it.each([0, MAX_ADVANCE_DAYS + 1, 2.5, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws RangeError for maxDays %s without simulating',
    async (maxDays) => {
      const runtime = toyRuntime({ date: MONDAY });
      await expect(advanceDays(runtime, { maxDays })).rejects.toThrow(RangeError);
      expect(runtime.world.meta.currentDate).toBe(MONDAY);
    },
  );

  it('accepts the 3650-day cap', async () => {
    const runtime = toyRuntime({ date: MONDAY });
    const result = await advanceDays(runtime, { maxDays: MAX_ADVANCE_DAYS });
    expect(result.daysAdvanced).toBe(MAX_ADVANCE_DAYS);
  });

  it.each([
    ['in the past', addDays(MONDAY, -1)],
    ['today', MONDAY],
  ])('throws RangeError for a stopAtDate %s', async (_label, stopAtDate) => {
    const runtime = toyRuntime({ date: MONDAY });
    await expect(advanceDays(runtime, { maxDays: 5, stopAtDate })).rejects.toThrow(RangeError);
    expect(runtime.world.meta.currentDate).toBe(MONDAY);
  });

  it('throws RangeError for a stopAtDate that is not a date', async () => {
    const runtime = toyRuntime({ date: MONDAY });
    const options: AdvanceOptions = { maxDays: 5 };
    Reflect.set(options, 'stopAtDate', '2026-02-30');
    await expect(advanceDays(runtime, options)).rejects.toThrow(RangeError);
  });
});

describe('advanceDays: yielding to the host', () => {
  it('awaits yieldToHost once per simulated day', async () => {
    const runtime = toyRuntime({ date: MONDAY });
    runtime.gates.register(gateOn('events.showNeedsBooking', addDays(MONDAY, 6)));
    let yields = 0;

    const completed = await advanceDays(runtime, {
      maxDays: 4,
      yieldToHost: () => {
        yields += 1;
        return Promise.resolve();
      },
    });
    expect(completed.daysAdvanced).toBe(4);
    expect(yields).toBe(4);

    const gated = await advanceDays(runtime, {
      maxDays: 10,
      yieldToHost: () => {
        yields += 1;
        return Promise.resolve();
      },
    });
    expect(gated.daysAdvanced).toBe(2);
    expect(yields).toBe(6);
  });

  it('gives the same result when the host holds each yield until the loop has suspended', async () => {
    const setUp = (): ToyRuntime => {
      const runtime = toyRuntime({ date: MONDAY, seed: 'yield' });
      runtime.phases.register(
        phase('shows.roll', 0, (ctx) => {
          const roll = intBetween(ctx.rng('test.seeds'), 1, 100);
          ctx.tx.update('widgets', widgetId(2), (widget) => ({
            ...widget,
            scores: { ...widget.scores, [ownerId(1)]: roll },
          }));
        }),
      );
      return runtime;
    };

    const immediateRuntime = setUp();
    const immediate = await advanceDays(immediateRuntime, { maxDays: 6 });

    const deferredRuntime = setUp();
    const pendingYields: (() => void)[] = [];
    let settled: AdvanceResult | null = null;
    const running = (async () => {
      settled = await advanceDays(deferredRuntime, {
        maxDays: 6,
        yieldToHost: () =>
          new Promise<void>((resolve) => {
            pendingYields.push(resolve);
          }),
      });
    })();

    for (let day = 1; day <= 6; day++) {
      await flushUntil(() => pendingYields.length === 1);
      // The loop is parked on the yield: a whole day is done and the next has not started.
      expect(deferredRuntime.world.meta.daysSimulated).toBe(day);
      await Promise.resolve();
      await Promise.resolve();
      expect(deferredRuntime.world.meta.daysSimulated).toBe(day);
      expect(settled).toBeNull();
      pendingYields.shift()?.();
    }
    await running;

    expect(settled).toEqual(immediate);
    expect(serialiseWorld(deferredRuntime.world)).toBe(serialiseWorld(immediateRuntime.world));
    expect(deferredRuntime.rng.toState()).toEqual(immediateRuntime.rng.toState());
  });
});

describe('evaluateGates', () => {
  it('returns the hit of a gate that hits today', () => {
    const runtime = toyRuntime({ date: MONDAY });
    runtime.gates.register(gateOn('events.showNeedsBooking', MONDAY));

    const hits: GateHit[] = evaluateGates(runtime, MONDAY);

    expect(hits).toEqual([
      {
        gateId: 'events.showNeedsBooking',
        reason: `Your show 'Friday Fury' on ${MONDAY} has no card yet`,
        subject: { kind: 'title', id: widgetId(1) },
        actionHint: 'booking',
      },
    ]);
    expect(evaluateGates(runtime, addDays(MONDAY, 1))).toEqual([]);
  });

  it('changes nothing, however often it is called', async () => {
    const runtime = toyRuntime({ date: MONDAY, seed: 'gates' });
    runtime.phases.register(
      phase('shows.roll', 0, (ctx) => {
        intBetween(ctx.rng('test.seeds'), 1, 6);
      }),
    );
    // Some history first, so the RNG, event log and seq are not at their starting values.
    await advanceDays(runtime, { maxDays: 3 });
    runtime.gates.register({
      id: 'events.showNeedsBooking',
      label: 'Show needs booking',
      check: (view, date) =>
        view.tables.widgets.values().length > 0
          ? { gateId: 'events.showNeedsBooking', reason: `Book the show on ${date}` }
          : null,
    });
    const before = snapshot(runtime);

    for (let call = 0; call < 10; call++) {
      expect(evaluateGates(runtime, runtime.world.meta.currentDate)).toHaveLength(1);
    }

    expect(snapshot(runtime)).toEqual(before);
  });

  it('returns no hits when no gates are registered', () => {
    const runtime = toyRuntime({ date: MONDAY });
    expect(evaluateGates(runtime, MONDAY)).toEqual([]);
  });

  it('attributes a hit to the gate that returned it', () => {
    const runtime = toyRuntime({ date: MONDAY });
    runtime.gates.register({
      id: 'events.showNeedsBooking',
      label: 'Show needs booking',
      check: () => ({ gateId: 'something.else', reason: 'Book it' }),
    });
    expect(evaluateGates(runtime, MONDAY)).toEqual([
      { gateId: 'events.showNeedsBooking', reason: 'Book it' },
    ]);
  });
});

describe('GateRegistry', () => {
  it('rejects a duplicate id', () => {
    const registry = new GateRegistry<ToyRegistry>();
    registry.register(gateOn('events.showNeedsBooking', MONDAY));
    expect(() => registry.register(gateOn('events.showNeedsBooking', MONDAY))).toThrow(
      PipelineError,
    );
    expect(registry.size).toBe(1);
  });

  it('rejects a malformed id, an empty label and the reserved sim. prefix', () => {
    const registry = new GateRegistry<ToyRegistry>();
    expect(() => registry.register(gateOn('Bad Id', MONDAY))).toThrow(PipelineError);
    expect(() => registry.register({ ...gateOn('events.ok', MONDAY), label: ' ' })).toThrow(
      PipelineError,
    );
    expect(() => registry.register(gateOn('sim.stopDate', MONDAY))).toThrow(/reserved/);
    expect(registry.size).toBe(0);
  });

  it('keeps registration order', () => {
    const registry = new GateRegistry<ToyRegistry>();
    registry.register(gateOn('zeta.first', MONDAY));
    registry.register(gateOn('alpha.second', MONDAY));
    expect(registry.ordered().map((gate) => gate.id)).toEqual(['zeta.first', 'alpha.second']);
    expect(registry.get('alpha.second')?.label).toBe('Show needs booking');
  });
});

describe('advanceDays: determinism', () => {
  /** Phases that draw random numbers, write rows, publish events and sometimes fail. */
  function busyRuntime(): ToyRuntime {
    const runtime = createRuntime({
      world: pipelineToyWorld({ seed: 'advance-determinism' }),
      // High enough that a run of random failures never stops the long advance early.
      tunables: createEngineTunables({ 'sim.stopSkipAfterConsecutiveFailures': 365 }),
    });
    runtime.phases.register(
      phase('shows.score', 0, (ctx) => {
        for (const widget of ctx.read.tables.widgets.values()) {
          const score = intBetween(ctx.rng('test.seeds'), 0, 100);
          ctx.tx.update('widgets', widget.id, (row) => ({
            ...row,
            scores: { ...row.scores, [ownerId(1)]: score },
          }));
          ctx.publish('test.widgetScored', { widgetId: widget.id, score });
        }
      }),
    );
    runtime.phases.register(
      phase('shows.flaky', 1, (ctx) => {
        if (intBetween(ctx.rng('test.beta'), 0, 2) === 0) {
          throw new Error('flaky');
        }
      }),
    );
    return runtime;
  }

  function stateOf(runtime: ToyRuntime) {
    return {
      world: serialiseWorld(runtime.world),
      rng: runtime.rng.toState(),
      events: runtime.bus.toState(),
      traces: runtime.traces.toState(),
      failures: runtime.failureLog
        .toState()
        .entries.map(({ date, stepId }) => [date, stepId] as const),
      lastDay:
        runtime.lastDayReport === null ? null : deterministicDayReport(runtime.lastDayReport),
    };
  }

  it('gives the same state from one 30-day advance as from thirty 1-day advances', async () => {
    const single = busyRuntime();
    const result = await advanceDays(single, { maxDays: 30 });
    expect(result.daysAdvanced).toBe(30);

    const stepped = busyRuntime();
    let failures = 0;
    for (let call = 0; call < 30; call++) {
      const day = await advanceDays(stepped, { maxDays: 1 });
      expect(day.daysAdvanced).toBe(1);
      failures += day.failures.length;
    }

    expect(stateOf(stepped)).toEqual(stateOf(single));
    expect(failures).toBe(result.failures.length);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(parseGameDate(result.endDate)).toBe(addDays(MONDAY, 30));
  });
});
