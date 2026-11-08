import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  DuplicateSubscriberError,
  EventBus,
  EventBusMisuseError,
  NotSerialisableError,
  makeGameDate,
  type AnyDomainEvent,
  type DomainEvent,
  type EventStaging,
  type EventType,
} from '@ringside/engine';
import { TEST_DATE, createTestRunner, type TestReactionContext } from './testEvents';

const PHASE = { kind: 'phase', id: 'test.phase' } as const;

function createBus(maxCascadeDepth = 8, logSize = 50): EventBus<TestReactionContext> {
  return new EventBus<TestReactionContext>({ logSize, maxCascadeDepth });
}

/** Stages, publishes and commits a list of pings in one go. */
function commitPings(bus: EventBus<TestReactionContext>, counts: number[]): AnyDomainEvent[] {
  const staging = bus.stage(PHASE, TEST_DATE);
  for (const count of counts) {
    staging.publish('test.pinged', { count });
  }
  return [...staging.commit()];
}

describe('staging', () => {
  it('delivers nothing from a discarded staging and does not advance seq', () => {
    const bus = createBus();
    const delivered: number[] = [];
    bus.subscribe(
      'test.pinged',
      (event) => {
        delivered.push(event.seq);
      },
      { id: 'test.listener' },
    );
    const staging = bus.stage(PHASE, TEST_DATE);
    staging.publish('test.pinged', { count: 1 });
    staging.publish('test.pinged', { count: 2 });
    staging.discard();

    expect(bus.seq).toBe(0);
    expect(bus.recent()).toEqual([]);
    const next = commitPings(bus, [3]);
    expect(next.map((event) => event.seq)).toEqual([1]);
    bus.dispatch(next, createTestRunner(bus, []));
    expect(delivered).toEqual([1]);
  });

  it('gives committed events consecutive seq values in publish order', () => {
    const bus = createBus();
    const first = commitPings(bus, [10, 20, 30]);
    const second = commitPings(bus, [40]);
    expect(first.map((event) => [event.seq, event.payload])).toEqual([
      [1, { count: 10 }],
      [2, { count: 20 }],
      [3, { count: 30 }],
    ]);
    expect(second[0]?.seq).toBe(4);
    expect(bus.seq).toBe(4);
    expect(first[0]).toMatchObject({ type: 'test.pinged', date: TEST_DATE, source: PHASE });
  });

  it('assigns seq at commit time, so stagings committed in a different order get numbered in commit order', () => {
    const bus = createBus();
    const early = bus.stage(PHASE, TEST_DATE);
    const late = bus.stage({ kind: 'command', id: 'test.command' }, TEST_DATE);
    early.publish('test.pinged', { count: 1 });
    late.publish('test.pinged', { count: 2 });
    expect(late.commit()[0]?.seq).toBe(1);
    expect(early.commit()[0]?.seq).toBe(2);
  });

  it('produces the same seq numbers on every run', () => {
    const runOnce = (): number[] => {
      const bus = createBus();
      commitPings(bus, [1, 2]);
      const discarded = bus.stage(PHASE, TEST_DATE);
      discarded.publish('test.pinged', { count: 3 });
      discarded.discard();
      return commitPings(bus, [4, 5]).map((event) => event.seq);
    };
    expect(runOnce()).toEqual([3, 4]);
    expect(runOnce()).toEqual(runOnce());
  });

  it('closes a staging after commit or discard', () => {
    const bus = createBus();
    const committed = bus.stage(PHASE, TEST_DATE);
    committed.commit();
    expect(() => {
      committed.publish('test.pinged', { count: 1 });
    }).toThrow(EventBusMisuseError);
    expect(() => committed.commit()).toThrow(EventBusMisuseError);

    const discarded = bus.stage(PHASE, TEST_DATE);
    discarded.discard();
    expect(() => {
      discarded.discard();
    }).toThrow(EventBusMisuseError);
  });

  it('freezes committed events and their payloads', () => {
    const bus = createBus();
    const staging = bus.stage(PHASE, TEST_DATE);
    staging.publish('test.loose', { value: { nested: [1, 2] } });
    const [event] = staging.commit();
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event?.payload)).toBe(true);
    expect(Object.isFrozen(event?.source)).toBe(true);
    if (event?.type === 'test.loose') {
      expect(Object.isFrozen(event.payload.value)).toBe(true);
    }
  });
});

describe('payload checks', () => {
  it('rejects a payload containing a Map when debug checks are on (the default)', () => {
    const bus = createBus();
    expect(bus.debugChecks).toBe(true);
    const staging = bus.stage(PHASE, TEST_DATE);
    expect(() => {
      staging.publish('test.loose', { value: { roster: new Map() } });
    }).toThrow(NotSerialisableError);
    expect(() => {
      staging.publish('test.loose', { value: { roster: new Map() } });
    }).toThrow('events.test.loose.value.roster is not serialisable');
    expect(staging.commit()).toEqual([]);
  });

  it('skips the check when debug checks are off', () => {
    const bus = new EventBus<TestReactionContext>({
      logSize: 0,
      maxCascadeDepth: 1,
      debugChecks: false,
    });
    const staging = bus.stage(PHASE, TEST_DATE);
    expect(() => {
      staging.publish('test.loose', { value: new Map() });
    }).not.toThrow();
  });
});

describe('subscribers', () => {
  it('runs subscribers in priority order, then registration order', () => {
    const bus = createBus();
    const order: string[] = [];
    const record = (id: string) => (): void => {
      order.push(id);
    };
    bus.subscribe('test.pinged', record('late'), { id: 'late', priority: 10 });
    bus.subscribe('test.pinged', record('default-a'), { id: 'default-a' });
    bus.subscribe('test.pinged', record('early'), { id: 'early', priority: -5 });
    bus.subscribe('test.pinged', record('default-b'), { id: 'default-b', priority: 0 });
    bus.subscribe('test.pinged', record('late-b'), { id: 'late-b', priority: 10 });

    expect(bus.subscriberIds()).toEqual(['early', 'default-a', 'default-b', 'late', 'late-b']);
    bus.dispatch(commitPings(bus, [1]), createTestRunner(bus, []));
    expect(order).toEqual(['early', 'default-a', 'default-b', 'late', 'late-b']);
  });

  it("delivers every type to '*' subscribers and only matching types to the others", () => {
    const bus = createBus();
    const everything: EventType[] = [];
    const pingsOnly: number[] = [];
    bus.subscribe(
      '*',
      (event) => {
        everything.push(event.type);
      },
      { id: 'test.all' },
    );
    bus.subscribe(
      'test.pinged',
      (event) => {
        pingsOnly.push(event.payload.count);
      },
      { id: 'test.pings' },
    );
    const staging = bus.stage(PHASE, TEST_DATE);
    staging.publish('day.started', { date: TEST_DATE });
    staging.publish('test.pinged', { count: 7 });
    staging.publish('tunables.changed', { key: 'sim.eventLogSize', value: 10 });
    const report = bus.dispatch(staging.commit(), createTestRunner(bus, []));

    expect(everything).toEqual(['day.started', 'test.pinged', 'tunables.changed']);
    expect(pingsOnly).toEqual([7]);
    expect(report.reactionsRun).toBe(4);
  });

  it('throws on a duplicate subscriber id', () => {
    const bus = createBus();
    bus.subscribe('test.pinged', () => undefined, { id: 'test.same' });
    expect(() => bus.subscribe('*', () => undefined, { id: 'test.same' })).toThrow(
      DuplicateSubscriberError,
    );
  });

  it('stops delivering after unsubscribe and frees the id', () => {
    const bus = createBus();
    const seen: number[] = [];
    const unsubscribe = bus.subscribe(
      'test.pinged',
      (event) => {
        seen.push(event.seq);
      },
      { id: 'test.once' },
    );
    bus.dispatch(commitPings(bus, [1]), createTestRunner(bus, []));
    unsubscribe();
    bus.dispatch(commitPings(bus, [2]), createTestRunner(bus, []));
    expect(seen).toEqual([1]);
    expect(() => bus.subscribe('test.pinged', () => undefined, { id: 'test.once' })).not.toThrow();
  });
});

describe('dispatch', () => {
  it('reports a throwing subscriber, drops its writes and events, and still runs the rest', () => {
    const bus = createBus();
    const writes: string[] = [];
    bus.subscribe(
      'test.pinged',
      (_event, ctx) => {
        ctx.writes.push('first');
      },
      { id: 'test.first', priority: 1 },
    );
    bus.subscribe(
      'test.pinged',
      (_event, ctx) => {
        ctx.writes.push('broken');
        ctx.publish('test.echoed', { depth: 1 });
        throw new Error('news generator broke');
      },
      { id: 'test.broken', priority: 2 },
    );
    bus.subscribe(
      'test.pinged',
      (_event, ctx) => {
        ctx.writes.push('last');
      },
      { id: 'test.last', priority: 3 },
    );

    const report = bus.dispatch(commitPings(bus, [1]), createTestRunner(bus, writes));

    expect(writes).toEqual(['first', 'last']);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toMatchObject({
      subscriberId: 'test.broken',
      eventSeq: 1,
      eventType: 'test.pinged',
      message: 'news generator broke',
    });
    expect(report.failures[0]?.error).toBeInstanceOf(Error);
    expect(report.events.map((event) => event.type)).toEqual(['test.pinged']);
    expect(bus.seq).toBe(1);
  });

  it('contains a runner that throws instead of reporting', () => {
    const bus = createBus();
    const order: string[] = [];
    bus.subscribe('test.pinged', () => order.push('a'), { id: 'test.a' });
    bus.subscribe('test.pinged', () => order.push('b'), { id: 'test.b' });
    const report = bus.dispatch(commitPings(bus, [1]), (subscriberId, run) => {
      run({ publish: () => undefined, writes: [] });
      if (subscriberId === 'test.a') {
        throw new Error('runner blew up');
      }
      return { status: 'committed', events: [] };
    });
    expect(order).toEqual(['a', 'b']);
    expect(report.failures.map((failure) => failure.subscriberId)).toEqual(['test.a']);
  });

  it('delivers events published by a reaction in a second round', () => {
    const bus = createBus();
    const seen: string[] = [];
    bus.subscribe(
      'test.pinged',
      (event, ctx) => {
        seen.push(`ping ${String(event.seq)}`);
        ctx.publish('test.echoed', { depth: 1 });
      },
      { id: 'test.echoer' },
    );
    bus.subscribe(
      'test.echoed',
      (event) => {
        seen.push(`echo ${String(event.seq)} from ${event.source.id}`);
      },
      { id: 'test.echo-listener' },
    );

    const report = bus.dispatch(commitPings(bus, [1, 2]), createTestRunner(bus, []));

    expect(seen).toEqual([
      'ping 1',
      'ping 2',
      'echo 3 from test.echoer',
      'echo 4 from test.echoer',
    ]);
    expect(report.rounds).toBe(2);
    expect(report.events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    expect(report.events[2]?.source).toEqual({ kind: 'reaction', id: 'test.echoer' });
    expect(report.dropped).toEqual({ eventTypes: [], eventSeqs: [] });
  });

  it('stops a self-triggering reaction at the cascade limit and reports the dropped types', () => {
    const bus = createBus(3);
    const depths: number[] = [];
    bus.subscribe(
      'test.echoed',
      (event, ctx) => {
        depths.push(event.payload.depth);
        ctx.publish('test.echoed', { depth: event.payload.depth + 1 });
      },
      { id: 'test.loop' },
    );
    const staging = bus.stage(PHASE, TEST_DATE);
    staging.publish('test.echoed', { depth: 1 });

    const report = bus.dispatch(staging.commit(), createTestRunner(bus, []));

    expect(depths).toEqual([1, 2, 3]);
    expect(report.rounds).toBe(3);
    expect(report.dropped).toEqual({ eventTypes: ['test.echoed'], eventSeqs: [4] });
    // The dropped event still happened (its reaction committed), so it is logged.
    expect(bus.recent().map((event) => event.seq)).toEqual([1, 2, 3, 4]);
  });

  it('rejects a nested dispatch from inside a reaction', () => {
    const bus = createBus();
    bus.subscribe(
      'test.pinged',
      () => {
        bus.dispatch([], createTestRunner(bus, []));
      },
      { id: 'test.nested' },
    );
    const report = bus.dispatch(commitPings(bus, [1]), createTestRunner(bus, []));
    expect(report.failures[0]?.error).toBeInstanceOf(EventBusMisuseError);
  });
});

describe('observers', () => {
  it('see every event of the batch after all reactions, in seq order', () => {
    const bus = createBus();
    const timeline: string[] = [];
    bus.subscribe(
      'test.pinged',
      (event, ctx) => {
        timeline.push(`react ${String(event.seq)}`);
        ctx.publish('test.echoed', { depth: 1 });
      },
      { id: 'test.reactor' },
    );
    bus.observe((event) => {
      timeline.push(`observe ${String(event.seq)} ${event.type}`);
    });

    bus.dispatch(commitPings(bus, [1]), createTestRunner(bus, []));

    expect(timeline).toEqual(['react 1', 'observe 1 test.pinged', 'observe 2 test.echoed']);
  });

  it('get frozen events and cannot publish', () => {
    const bus = createBus();
    let observedFrozen = false;
    let staging: EventStaging | undefined;
    bus.observe((event) => {
      observedFrozen = Object.isFrozen(event) && Object.isFrozen(event.payload);
    });
    bus.observe(() => {
      staging = bus.stage(PHASE, TEST_DATE);
    });

    const report = bus.dispatch(commitPings(bus, [1]), createTestRunner(bus, []));

    expect(observedFrozen).toBe(true);
    expect(staging).toBeUndefined();
    expect(report.observerFailures).toHaveLength(1);
    expect(report.observerFailures[0]).toMatchObject({ observerNumber: 2, eventSeq: 1 });
    expect(report.observerFailures[0]?.error).toBeInstanceOf(EventBusMisuseError);
    expect(bus.seq).toBe(1);
  });

  it('catch and report a throwing observer without stopping the others', () => {
    const bus = createBus();
    const seen: number[] = [];
    bus.observe(() => {
      throw new Error('ui forwarder broke');
    });
    const stopWatching = bus.observe((event) => {
      seen.push(event.seq);
    });

    const report = bus.dispatch(commitPings(bus, [1, 2]), createTestRunner(bus, []));

    expect(seen).toEqual([1, 2]);
    expect(report.observerFailures.map((failure) => failure.message)).toEqual([
      'ui forwarder broke',
      'ui forwarder broke',
    ]);
    stopWatching();
    bus.dispatch(commitPings(bus, [3]), createTestRunner(bus, []));
    expect(seen).toEqual([1, 2]);
  });
});

describe('save state', () => {
  it('continues seq numbers after a save and load', () => {
    const bus = createBus();
    commitPings(bus, [1, 2, 3]);
    const saved: unknown = JSON.parse(JSON.stringify(bus.toState()));

    const loaded = new EventBus<TestReactionContext>({
      logSize: 50,
      maxCascadeDepth: 8,
      state: saved,
    });
    const continued = commitPings(bus, [4]);
    const continuedAfterLoad = commitPings(loaded, [4]);

    expect(loaded.seq).toBe(4);
    expect(continuedAfterLoad).toEqual(continued);
    expect(loaded.toState()).toEqual(bus.toState());
  });
});

describe('typing', () => {
  it('makes a wrong payload or an unknown type a compile error', () => {
    const bus = createBus();
    const staging = bus.stage(PHASE, TEST_DATE);
    // Closed straight away: these calls only exist for the compiler.
    staging.discard();
    const compileOnly = (): void => {
      // @ts-expect-error day.started needs { date: GameDate }, not a number
      staging.publish('day.started', { date: 5 });
      // @ts-expect-error day.started has no `day` field
      staging.publish('day.started', { day: makeGameDate(2026, 1, 1) });
      // @ts-expect-error day.ended needs failedSteps
      staging.publish('day.ended', { date: TEST_DATE });
      // @ts-expect-error an undeclared event type
      staging.publish('day.startd', { date: TEST_DATE });
      // @ts-expect-error a subscription to an undeclared event type
      bus.subscribe('title.changd', () => undefined, { id: 'test.typo' });
    };
    expect(compileOnly).toBeTypeOf('function');

    bus.subscribe(
      'day.ended',
      (event) => {
        expectTypeOf(event).toEqualTypeOf<DomainEvent<'day.ended'>>();
        expectTypeOf(event.payload.failedSteps).toEqualTypeOf<number>();
      },
      { id: 'test.typed' },
    );
    bus.subscribe(
      '*',
      (event) => {
        if (event.type === 'tunables.changed') {
          expectTypeOf(event.payload.key).toEqualTypeOf<string>();
        }
      },
      { id: 'test.narrowing' },
    );
    expectTypeOf(bus.recent({ types: ['test.pinged'] })).toEqualTypeOf<
      DomainEvent<'test.pinged'>[]
    >();
  });
});
