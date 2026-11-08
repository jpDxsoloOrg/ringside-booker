import { describe, expect, it } from 'vitest';
import {
  EventBus,
  EventLog,
  InvalidArgumentError,
  InvalidStatePartError,
  eventBusStateSchema,
  parseEventBusState,
  type AnyDomainEvent,
} from '@ringside/engine';
import { TEST_DATE, type TestReactionContext } from './testEvents';

const PHASE = { kind: 'phase', id: 'test.phase' } as const;

/** Commits one event per entry: numbers become pings, strings become tunable changes. */
function commitMixed(bus: EventBus<TestReactionContext>, entries: (number | string)[]): void {
  const staging = bus.stage(PHASE, TEST_DATE);
  for (const entry of entries) {
    if (typeof entry === 'number') {
      staging.publish('test.pinged', { count: entry });
    } else {
      staging.publish('tunables.changed', { key: entry, value: null });
    }
  }
  staging.commit();
}

function seqs(events: readonly AnyDomainEvent[]): number[] {
  return events.map((event) => event.seq);
}

function createBus(logSize: number): EventBus<TestReactionContext> {
  return new EventBus<TestReactionContext>({ logSize, maxCascadeDepth: 4 });
}

describe('EventLog', () => {
  it('keeps the newest N committed events, oldest first', () => {
    const bus = createBus(3);
    commitMixed(bus, [1, 2]);
    commitMixed(bus, [3, 4, 5]);
    expect(seqs(bus.recent())).toEqual([3, 4, 5]);
    commitMixed(bus, [6]);
    expect(seqs(bus.recent())).toEqual([4, 5, 6]);
    expect(seqs(bus.recent({ limit: 2 }))).toEqual([5, 6]);
    expect(bus.recent({ limit: 0 })).toEqual([]);
  });

  it('filters by type and applies the limit to the matches', () => {
    const bus = createBus(10);
    commitMixed(bus, [1, 'sim.eventLogSize', 2, 'sim.commandLogSize', 3]);
    const pings = bus.recent({ types: ['test.pinged'] });
    expect(pings.map((event) => event.payload.count)).toEqual([1, 2, 3]);
    expect(seqs(bus.recent({ types: ['tunables.changed'], limit: 1 }))).toEqual([4]);
    expect(seqs(bus.recent({ types: ['tunables.changed', 'test.pinged'], limit: 3 }))).toEqual([
      3, 4, 5,
    ]);
    expect(bus.recent({ types: ['day.started'] })).toEqual([]);
  });

  it('keeps nothing at size 0, but sequence numbers still advance', () => {
    const bus = createBus(0);
    commitMixed(bus, [1, 2, 3]);
    expect(bus.recent()).toEqual([]);
    expect(bus.seq).toBe(3);
    expect(bus.toState()).toEqual({ version: 1, seq: 3, recent: [] });
  });

  it('keeps the newest events when seeded with more than it holds', () => {
    const source = createBus(10);
    commitMixed(source, [1, 2, 3, 4]);
    const log = new EventLog(2, source.recent());
    expect(log.length).toBe(2);
    expect(seqs(log.toArray())).toEqual([3, 4]);
  });

  it('rejects a negative or fractional size and limit', () => {
    expect(() => new EventLog(-1)).toThrow(InvalidArgumentError);
    expect(() => new EventLog(1.5)).toThrow(InvalidArgumentError);
    expect(() => new EventLog(1).recent({ limit: -1 })).toThrow(InvalidArgumentError);
  });
});

describe('event bus state', () => {
  it('round-trips through JSON', () => {
    const bus = createBus(4);
    commitMixed(bus, [1, 'sim.eventLogSize', 2, 3, 4]);
    const state = bus.toState();
    const text = JSON.stringify(state);
    const parsed = parseEventBusState(JSON.parse(text));

    expect(parsed).toEqual(state);
    expect(state.seq).toBe(5);
    expect(seqs(state.recent)).toEqual([2, 3, 4, 5]);

    const loaded = new EventBus<TestReactionContext>({
      logSize: 4,
      maxCascadeDepth: 4,
      state: JSON.parse(text),
    });
    expect(JSON.stringify(loaded.toState())).toBe(text);
    expect(loaded.recent({ types: ['tunables.changed'] })[0]?.payload.key).toBe('sim.eventLogSize');
  });

  it('keeps only the newest events when loaded into a smaller log', () => {
    const bus = createBus(5);
    commitMixed(bus, [1, 2, 3, 4, 5]);
    const loaded = new EventBus<TestReactionContext>({
      logSize: 2,
      maxCascadeDepth: 4,
      state: bus.toState(),
    });
    expect(seqs(loaded.recent())).toEqual([4, 5]);
    expect(loaded.seq).toBe(5);
  });

  it('rejects broken states and names the bad field', () => {
    const bus = createBus(5);
    commitMixed(bus, [1, 2]);
    const valid = bus.toState();
    expect(eventBusStateSchema.safeParse(valid).success).toBe(true);

    const badCases: { state: unknown; message: RegExp }[] = [
      { state: { ...valid, version: 2 }, message: /\$\.version: unsupported event bus state/ },
      { state: { ...valid, seq: 1 }, message: /\$\.recent\[1\]\.seq: seq must not be greater/ },
      {
        state: { ...valid, recent: [valid.recent[1], valid.recent[0]] },
        message: /\$\.recent\[1\]\.seq: seq must be greater than the previous/,
      },
      {
        state: { ...valid, recent: [{ ...valid.recent[0], type: 'Not An Event' }] },
        message: /\$\.recent\[0\]\.type/,
      },
      {
        state: { ...valid, recent: [{ ...valid.recent[0], date: '2026-02-30' }] },
        message: /\$\.recent\[0\]\.date/,
      },
    ];
    for (const { state, message } of badCases) {
      expect(() => parseEventBusState(state)).toThrow(InvalidStatePartError);
      expect(() => parseEventBusState(state)).toThrow(message);
    }
  });

  it('checks payloads are plain JSON on load, but not their shape', () => {
    const bus = createBus(5);
    commitMixed(bus, [1]);
    const valid = bus.toState();
    const withNaN = { ...valid, recent: [{ ...valid.recent[0], payload: { count: Number.NaN } }] };
    expect(() => parseEventBusState(withNaN)).toThrow(/\$\.recent\[0\]\.payload/);
    // Which payload belongs to which type is only known at compile time, so any plain JSON
    // payload is accepted on load.
    const reshaped = { ...valid, recent: [{ ...valid.recent[0], payload: { other: [1] } }] };
    expect(() => parseEventBusState(reshaped)).not.toThrow();
  });
});
