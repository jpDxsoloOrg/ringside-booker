// Trace store. Design: docs/design/calculation-traces.md#retention
import '../rng/testStreams';
import { describe, expect, it } from 'vitest';
import {
  InvalidArgumentError,
  InvalidStatePartError,
  RngRegistry,
  SchemaViolationError,
  TRACE_MAX_DEPTH,
  TRACE_MAX_NODES,
  TraceStore,
  TraceStoreMisuseError,
  addDays,
  createEngineTunables,
  inputOf,
  isFullTrace,
  makeGameDate,
  mapTraced,
  refKey,
  rollInt,
  startCalc,
  startDecision,
  topContributors,
  traceNodeSchema,
  traceStoreLimitsFrom,
  traceStoreStateSchema,
  type GameDate,
  type StoredTrace,
  type TraceNode,
  type TraceRef,
  type TraceStoreLimits,
  type TraceSummary,
  type Traced,
} from '@ringside/engine';
import { expectSerialisable } from '../../support/trace';

const START_DATE = makeGameDate(2026, 3, 2);
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- deliberately invalid test input
const NOT_A_DATE = '2026-02-30' as GameDate;
const ROOMY: TraceStoreLimits = { retentionPerKind: 10, summaryLimit: 10 };

function ref(kind: string, id: string): TraceRef {
  return { kind, id };
}

/**
 * A rating whose steps have effects +bonus, -3, x2 and an applied ceiling, so its contributors
 * are easy to predict.
 */
function rating(bonus: number): Traced<number> {
  return startCalc('Match rating', 40, { unit: 'points' })
    .add('Hometown crowd', bonus)
    .subtract('Botched finish', 3)
    .multiply('Main event weight', 2)
    .min('Production ceiling', 100)
    .done();
}

function recordAndCommit(
  store: TraceStore,
  entries: readonly { ref: TraceRef; date?: GameDate; traced: Traced<number> }[],
): void {
  const staging = store.stage();
  for (const entry of entries) {
    staging.record(entry.ref, entry.date ?? START_DATE, entry.traced);
  }
  staging.commit();
}

function expectFull(entry: StoredTrace | TraceSummary | undefined): StoredTrace {
  if (entry === undefined || !isFullTrace(entry)) {
    throw new Error('Expected a full trace');
  }
  return entry;
}

function expectSummary(entry: StoredTrace | TraceSummary | undefined): TraceSummary {
  if (entry === undefined || isFullTrace(entry)) {
    throw new Error('Expected a summary');
  }
  return entry;
}

describe('refKey', () => {
  it('joins kind and id with a colon', () => {
    expect(refKey(ref('segment.rating', 'seg_0000000001'))).toBe('segment.rating:seg_0000000001');
  });
});

describe('TraceStore staging', () => {
  it('never shows staged entries that are then discarded', () => {
    const store = new TraceStore(ROOMY);
    const staging = store.stage();
    staging.record(ref('k', 'a'), START_DATE, rating(5));
    expect(store.get(ref('k', 'a'))).toBeUndefined();
    expect(store.has(ref('k', 'a'))).toBe(false);
    staging.discard();
    expect(store.get(ref('k', 'a'))).toBeUndefined();
    expect(store.listByKind('k')).toStrictEqual([]);
    expect(store.seq).toBe(0);
    expect(store.toState()).toStrictEqual({ version: 1, seq: 0, full: [], summaries: [] });
  });

  it('shows committed entries with their date, seq, trace and value', () => {
    const store = new TraceStore(ROOMY);
    const traced = rating(5);
    const staging = store.stage();
    staging.record(ref('k', 'a'), START_DATE, traced);
    expect(store.has(ref('k', 'a'))).toBe(false);
    staging.commit();

    const entry = expectFull(store.get(ref('k', 'a')));
    expect(entry).toStrictEqual({
      ref: { kind: 'k', id: 'a' },
      date: START_DATE,
      seq: 1,
      trace: traced.trace,
      value: 84,
    });
    expect(store.has(ref('k', 'a'))).toBe(true);
    expect(store.has(ref('k', 'b'))).toBe(false);
    expect(store.has(ref('other', 'a'))).toBe(false);
  });

  it('keeps one staging from seeing or losing another', () => {
    const store = new TraceStore(ROOMY);
    const kept = store.stage();
    const rolledBack = store.stage();
    kept.record(ref('k', 'kept'), START_DATE, rating(1));
    rolledBack.record(ref('k', 'lost'), START_DATE, rating(2));
    rolledBack.discard();
    kept.commit();
    expect(store.has(ref('k', 'kept'))).toBe(true);
    expect(store.has(ref('k', 'lost'))).toBe(false);
    expect(store.seq).toBe(1);
  });

  it('replaces an earlier staged entry when the same ref is recorded again', () => {
    const store = new TraceStore(ROOMY);
    const staging = store.stage();
    staging.record(ref('k', 'a'), START_DATE, rating(1));
    staging.record(ref('k', 'a'), START_DATE, rating(9));
    staging.commit();
    expect(expectFull(store.get(ref('k', 'a'))).value).toBe(92);
    expect(store.listByKind('k')).toHaveLength(1);
    expect(store.seq).toBe(1);
  });

  it('refuses to be used after it is closed', () => {
    const store = new TraceStore(ROOMY);
    const committed = store.stage();
    committed.commit();
    expect(() => {
      committed.record(ref('k', 'a'), START_DATE, rating(1));
    }).toThrow(TraceStoreMisuseError);
    expect(() => {
      committed.commit();
    }).toThrow(TraceStoreMisuseError);
    const discarded = store.stage();
    discarded.discard();
    expect(() => {
      discarded.discard();
    }).toThrow(TraceStoreMisuseError);
  });

  it('rejects a bad ref kind, an empty id and a bad date', () => {
    const staging = new TraceStore(ROOMY).stage();
    expect(() => {
      staging.record(ref('Segment rating', 'a'), START_DATE, rating(1));
    }).toThrow(InvalidArgumentError);
    expect(() => {
      staging.record(ref('k:x', 'a'), START_DATE, rating(1));
    }).toThrow(InvalidArgumentError);
    expect(() => {
      staging.record(ref('k', ''), START_DATE, rating(1));
    }).toThrow(InvalidArgumentError);
    expect(() => {
      staging.record(ref('k', 'a'), NOT_A_DATE, rating(1));
    }).toThrow(InvalidArgumentError);
  });

  it('rejects a hand-built trace the load schema would reject, at record time', () => {
    const staging = new TraceStore(ROOMY).stage();
    const handBuilt: TraceNode = { kind: 'input', label: 'Popularity', value: 64 };
    const badTrace = { ...handBuilt, extra: 'not a trace field' } as TraceNode;
    expect(() => {
      staging.record(ref('k', 'a'), START_DATE, { value: 64, trace: badTrace });
    }).toThrow(SchemaViolationError);
  });

  it('stores -0 as 0, so the state loads again without going through JSON', () => {
    const store = new TraceStore(ROOMY);
    const negated = mapTraced(inputOf('Momentum', 0), 'Momentum, reversed', (value) => -value);
    expect(Object.is(negated.value, -0)).toBe(true);
    recordAndCommit(store, [{ ref: ref('k', 'a'), traced: rating(1) }]);
    const staging = store.stage();
    staging.record(ref('k', 'zero'), START_DATE, negated);
    staging.commit();
    const entry = expectFull(store.get(ref('k', 'zero')));
    expect(Object.is(entry.value, 0)).toBe(true);
    expect(Object.is(entry.trace.value, 0)).toBe(true);
    const loaded = TraceStore.fromState(store.toState(), store.limits);
    expect(loaded.get(ref('k', 'zero'))).toStrictEqual(entry);
  });

  it('copies the recorded trace rather than freezing the caller objects', () => {
    const traced = rating(5);
    const staging = new TraceStore(ROOMY).stage();
    staging.record(ref('k', 'a'), START_DATE, traced);
    staging.commit();
    expect(Object.isFrozen(traced.trace)).toBe(false);
  });

  it('stores decision traces as well as numbers', () => {
    const store = new TraceStore(ROOMY);
    const decision = startDecision<'retain' | 'change'>('Title decision')
      .consider('retain', 62)
      .consider('change', 48)
      .choose('retain', 'Keeping the title scored higher');
    const staging = store.stage();
    staging.record(ref('title.decision', 'tit_0000000001'), START_DATE, decision);
    staging.commit();
    expect(expectFull(store.get(ref('title.decision', 'tit_0000000001'))).value).toBe('retain');
  });
});

describe('TraceStore retention', () => {
  it('summarises the two oldest of four commits with retention 2', () => {
    const store = new TraceStore({ retentionPerKind: 2, summaryLimit: 10 });
    for (const [index, bonus] of [1, 2, 3, 4].entries()) {
      recordAndCommit(store, [
        {
          ref: ref('k', `r${String(index)}`),
          date: addDays(START_DATE, index),
          traced: rating(bonus),
        },
      ]);
    }

    const oldest = expectSummary(store.get(ref('k', 'r0')));
    expect(oldest).toStrictEqual({
      ref: { kind: 'k', id: 'r0' },
      date: START_DATE,
      seq: 1,
      label: 'Match rating',
      value: 76,
      unit: 'points',
      // 41 - 3 = 38, x2 = 76 (+38), ceiling 100 not applied: the largest effects first.
      topContributors: [
        { label: 'Main event weight', effect: 38 },
        { label: 'Botched finish', effect: -3 },
        { label: 'Hometown crowd', effect: 1 },
      ],
    });
    expect(expectSummary(store.get(ref('k', 'r1'))).seq).toBe(2);
    expect(expectFull(store.get(ref('k', 'r2'))).seq).toBe(3);
    expect(expectFull(store.get(ref('k', 'r3'))).seq).toBe(4);

    expect(store.listByKind('k').map((entry) => entry.ref.id)).toStrictEqual([
      'r3',
      'r2',
      'r1',
      'r0',
    ]);
    expect(store.listByKind('k', 3).map((entry) => entry.ref.id)).toStrictEqual(['r3', 'r2', 'r1']);
    expect(store.listByKind('k', 0)).toStrictEqual([]);
  });

  it('counts retention per kind, so one busy kind cannot push out another', () => {
    const store = new TraceStore({ retentionPerKind: 1, summaryLimit: 10 });
    recordAndCommit(store, [{ ref: ref('contract.ask', 'c1'), traced: rating(1) }]);
    for (let index = 0; index < 5; index++) {
      recordAndCommit(store, [
        { ref: ref('segment.rating', `s${String(index)}`), traced: rating(2) },
      ]);
    }
    expect(isFullTrace(store.get(ref('contract.ask', 'c1')) ?? expectSummary(undefined))).toBe(
      true,
    );
    expect(store.listByKind('segment.rating').filter(isFullTrace)).toHaveLength(1);
  });

  it('demotes within one commit when a step records more than the retention', () => {
    const store = new TraceStore({ retentionPerKind: 2, summaryLimit: 10 });
    recordAndCommit(store, [
      { ref: ref('k', 'a'), traced: rating(1) },
      { ref: ref('k', 'b'), traced: rating(2) },
      { ref: ref('k', 'c'), traced: rating(3) },
    ]);
    expectSummary(store.get(ref('k', 'a')));
    expectFull(store.get(ref('k', 'b')));
    expectFull(store.get(ref('k', 'c')));
  });

  it('summarises immediately with retention 0', () => {
    const store = new TraceStore({ retentionPerKind: 0, summaryLimit: 10 });
    recordAndCommit(store, [{ ref: ref('k', 'a'), traced: rating(5) }]);
    const summary = expectSummary(store.get(ref('k', 'a')));
    expect(summary.value).toBe(84);
    expect(store.toState().full).toStrictEqual([]);
    expect(store.toState().summaries).toHaveLength(1);
  });

  it('drops the oldest summaries beyond the summary limit, across kinds', () => {
    const store = new TraceStore({ retentionPerKind: 0, summaryLimit: 2 });
    recordAndCommit(store, [{ ref: ref('a', '1'), traced: rating(1) }]);
    recordAndCommit(store, [{ ref: ref('b', '2'), traced: rating(2) }]);
    recordAndCommit(store, [{ ref: ref('a', '3'), traced: rating(3) }]);
    expect(store.has(ref('a', '1'))).toBe(false);
    expect(expectSummary(store.get(ref('b', '2'))).seq).toBe(2);
    expect(expectSummary(store.get(ref('a', '3'))).seq).toBe(3);
    expect(store.toState().summaries.map((summary) => summary.seq)).toStrictEqual([2, 3]);
  });

  it('drops by seq, not by when a summary was made', () => {
    // Kind "slow" demotes its older trace (seq 1) after kind "fast" has demoted seq 2 and 3.
    const store = new TraceStore({ retentionPerKind: 1, summaryLimit: 2 });
    recordAndCommit(store, [{ ref: ref('slow', 'old'), traced: rating(1) }]);
    recordAndCommit(store, [{ ref: ref('fast', 'f1'), traced: rating(1) }]);
    recordAndCommit(store, [{ ref: ref('fast', 'f2'), traced: rating(1) }]);
    recordAndCommit(store, [{ ref: ref('fast', 'f3'), traced: rating(1) }]);
    recordAndCommit(store, [{ ref: ref('slow', 'new'), traced: rating(1) }]);
    // Summaries made: f1 (seq 2), f2 (seq 3), then old (seq 1). The limit keeps seq 2 and 3.
    expect(store.has(ref('slow', 'old'))).toBe(false);
    expect(store.toState().summaries.map((summary) => summary.ref.id)).toStrictEqual(['f1', 'f2']);
  });

  it('keeps no summaries with summary limit 0', () => {
    const store = new TraceStore({ retentionPerKind: 1, summaryLimit: 0 });
    recordAndCommit(store, [{ ref: ref('k', 'a'), traced: rating(1) }]);
    recordAndCommit(store, [{ ref: ref('k', 'b'), traced: rating(2) }]);
    expect(store.has(ref('k', 'a'))).toBe(false);
    expectFull(store.get(ref('k', 'b')));
    expect(store.toState().summaries).toStrictEqual([]);
  });

  it('keeps nothing with both limits at 0', () => {
    const store = new TraceStore({ retentionPerKind: 0, summaryLimit: 0 });
    recordAndCommit(store, [{ ref: ref('k', 'a'), traced: rating(1) }]);
    expect(store.has(ref('k', 'a'))).toBe(false);
    expect(store.toState()).toStrictEqual({ version: 1, seq: 1, full: [], summaries: [] });
  });

  it('replaces the trace of a re-recorded ref and keeps one entry, even once summarised', () => {
    const store = new TraceStore({ retentionPerKind: 1, summaryLimit: 10 });
    recordAndCommit(store, [{ ref: ref('k', 'a'), traced: rating(1) }]);
    recordAndCommit(store, [{ ref: ref('k', 'a'), traced: rating(7) }]);
    const replaced = expectFull(store.get(ref('k', 'a')));
    expect(replaced.value).toBe(88);
    expect(replaced.seq).toBe(2);
    expect(store.listByKind('k')).toHaveLength(1);

    recordAndCommit(store, [{ ref: ref('k', 'b'), traced: rating(2) }]);
    expectSummary(store.get(ref('k', 'a')));
    recordAndCommit(store, [{ ref: ref('k', 'a'), traced: rating(3) }]);
    expect(expectFull(store.get(ref('k', 'a'))).value).toBe(80);
    const state = store.toState();
    expect(state.full.map((entry) => entry.ref.id)).toStrictEqual(['a']);
    expect(state.summaries.map((summary) => summary.ref.id)).toStrictEqual(['b']);
  });

  it('applies lowered limits straight away', () => {
    const store = new TraceStore(ROOMY);
    recordAndCommit(store, [
      { ref: ref('k', 'a'), traced: rating(1) },
      { ref: ref('k', 'b'), traced: rating(2) },
      { ref: ref('k', 'c'), traced: rating(3) },
    ]);
    store.setLimits({ retentionPerKind: 1, summaryLimit: 1 });
    expect(store.has(ref('k', 'a'))).toBe(false);
    expectSummary(store.get(ref('k', 'b')));
    expectFull(store.get(ref('k', 'c')));
  });

  it('rejects negative or fractional limits', () => {
    expect(() => new TraceStore({ retentionPerKind: -1, summaryLimit: 0 })).toThrow(
      InvalidArgumentError,
    );
    expect(() => new TraceStore({ retentionPerKind: 0, summaryLimit: 1.5 })).toThrow(
      InvalidArgumentError,
    );
    expect(() => new TraceStore(ROOMY).listByKind('k', -1)).toThrow(InvalidArgumentError);
  });

  it('reads its limits from the engine tunables, where 0 means 0', () => {
    expect(traceStoreLimitsFrom(createEngineTunables())).toStrictEqual({
      retentionPerKind: 200,
      summaryLimit: 5000,
    });
    expect(
      traceStoreLimitsFrom(
        createEngineTunables({ 'sim.traceRetentionPerKind': 0, 'sim.traceSummaryLimit': 0 }),
      ),
    ).toStrictEqual({ retentionPerKind: 0, summaryLimit: 0 });
  });
});

describe('topContributors', () => {
  it('counts applied limits, skips unapplied limits and other steps, and keeps three', () => {
    const traced = startCalc('Attendance', 500)
      .add('Hype', 300)
      .max('No empty building', 0)
      .round('round')
      .min('Venue capacity', 600)
      .subtract('Rain', 20)
      .add('Local hero', 50)
      .done();
    expect(topContributors(traced.trace)).toStrictEqual([
      { label: 'Hype', effect: 300 },
      { label: 'Venue capacity', effect: -200 },
      { label: 'Local hero', effect: 50 },
    ]);
  });

  it('breaks ties by trace order and leaves out steps with no effect', () => {
    const traced = startCalc('x', 10)
      .add('Nothing', 0)
      .add('First', 2)
      .subtract('Second', 2)
      .done();
    expect(topContributors(traced.trace)).toStrictEqual([
      { label: 'First', effect: 2 },
      { label: 'Second', effect: -2 },
    ]);
  });

  it('holds an effect too large for a number to the largest finite number', () => {
    const traced = startCalc('Runaway', -Number.MAX_VALUE).multiply('Flip', -1).done();
    const [flip] = topContributors(traced.trace);
    expect(flip).toStrictEqual({ label: 'Flip', effect: Number.MAX_VALUE });
    const store = new TraceStore({ retentionPerKind: 0, summaryLimit: 1 });
    recordAndCommit(store, [{ ref: ref('k', 'a'), traced }]);
    const loaded = TraceStore.fromState(JSON.parse(JSON.stringify(store.toState())), store.limits);
    expect(loaded.get(ref('k', 'a'))).toStrictEqual(store.get(ref('k', 'a')));
  });

  it('counts a power step by its effect on the running value', () => {
    const traced = startCalc('x', 0.5).power('Curve', 2).add('Bonus', 0.1).done();
    expect(topContributors(traced.trace)).toStrictEqual([
      { label: 'Curve', effect: -0.25 },
      { label: 'Bonus', effect: expect.closeTo(0.1, 12) as number },
    ]);
  });

  it('gives no contributors for a trace without arithmetic steps', () => {
    expect(topContributors(inputOf('Popularity', 64).trace)).toStrictEqual([]);
  });
});

describe('TraceStore state', () => {
  function busyStore(): TraceStore {
    const store = new TraceStore({ retentionPerKind: 2, summaryLimit: 3 });
    const rng = new RngRegistry('trace-store-test');
    for (let index = 0; index < 6; index++) {
      const swing = rollInt(rng.stream('test.alpha'), -3, 3, 'Crowd swing');
      const traced = startCalc('Crowd reaction', 50, { unit: 'points' })
        .roll(swing.roll)
        .add('Crowd swing', swing.value)
        .clamp(0, 100)
        .done();
      recordAndCommit(store, [
        {
          ref: ref(index % 2 === 0 ? 'segment.rating' : 'show.attendance', `x${String(index)}`),
          date: addDays(START_DATE, index),
          traced,
        },
      ]);
    }
    return store;
  }

  it('round-trips through JSON with equal get results', () => {
    const store = busyStore();
    const state = store.toState();
    expectSerialisable(state);
    const loaded = TraceStore.fromState(JSON.parse(JSON.stringify(state)), store.limits);

    expect(loaded.seq).toBe(store.seq);
    expect(loaded.toState()).toStrictEqual(state);
    for (let index = 0; index < 6; index++) {
      for (const kind of ['segment.rating', 'show.attendance']) {
        const key = ref(kind, `x${String(index)}`);
        expect(loaded.get(key)).toStrictEqual(store.get(key));
      }
    }
    expect(loaded.listByKind('segment.rating')).toStrictEqual(store.listByKind('segment.rating'));

    // Both stores carry on identically after the load.
    recordAndCommit(store, [{ ref: ref('segment.rating', 'next'), traced: rating(1) }]);
    recordAndCommit(loaded, [{ ref: ref('segment.rating', 'next'), traced: rating(1) }]);
    expect(loaded.toState()).toStrictEqual(store.toState());
  });

  it('keeps both arrays sorted by seq', () => {
    const state = busyStore().toState();
    const fullSeqs = state.full.map((entry) => entry.seq);
    const summarySeqs = state.summaries.map((summary) => summary.seq);
    expect(fullSeqs).toStrictEqual([...fullSeqs].sort((left, right) => left - right));
    expect(summarySeqs).toStrictEqual([...summarySeqs].sort((left, right) => left - right));
    expect(traceStoreStateSchema.safeParse(state).success).toBe(true);
  });

  it('applies the limits when loading a state saved with higher ones', () => {
    const state = busyStore().toState();
    const loaded = TraceStore.fromState(state, { retentionPerKind: 0, summaryLimit: 1 });
    const loadedState = loaded.toState();
    expect(loadedState.full).toStrictEqual([]);
    expect(loadedState.summaries.map((summary) => summary.seq)).toStrictEqual([6]);
  });

  it('rejects a trace node with an unknown kind', () => {
    const state = busyStore().toState();
    const [first, ...rest] = state.full;
    if (first === undefined) {
      throw new Error('Expected a full trace');
    }
    const badTrace = { ...first.trace, children: [{ kind: 'guess', label: 'Vibes', value: 3 }] };
    const badState = { ...state, full: [{ ...first, trace: badTrace }, ...rest] };
    expect(traceStoreStateSchema.safeParse(badState).success).toBe(false);
    expect(() => TraceStore.fromState(badState, ROOMY)).toThrow(InvalidStatePartError);
  });

  it('rejects unsorted entries, a seq above the store seq, repeated refs and unknown versions', () => {
    const state = busyStore().toState();
    const reversed = { ...state, full: [...state.full].reverse() };
    expect(traceStoreStateSchema.safeParse(reversed).success).toBe(false);
    expect(traceStoreStateSchema.safeParse({ ...state, seq: 1 }).success).toBe(false);
    const [firstSummary] = state.summaries;
    const [firstFull] = state.full;
    if (firstSummary === undefined || firstFull === undefined) {
      throw new Error('Expected entries');
    }
    const repeated = {
      ...state,
      summaries: [{ ...firstSummary, ref: firstFull.ref }, ...state.summaries.slice(1)],
    };
    expect(traceStoreStateSchema.safeParse(repeated).success).toBe(false);
    expect(traceStoreStateSchema.safeParse({ ...state, version: 2 }).success).toBe(false);
    expect(() => TraceStore.fromState({ ...state, version: 2 }, ROOMY)).toThrow(
      /trace store state version/,
    );
  });
});

describe('traceNodeSchema', () => {
  function chain(levels: number): TraceNode {
    let node: TraceNode = { kind: 'note', label: 'Bottom', value: null };
    for (let level = 1; level < levels; level++) {
      node = {
        kind: 'formula',
        label: `Level ${String(levels - level)}`,
        value: 1,
        children: [node],
      };
    }
    return node;
  }

  it('accepts every node a builder makes', () => {
    const swing = rollInt(new RngRegistry('schema').stream('test.beta'), 1, 6, 'Swing');
    const traced = startCalc('Everything', inputOf('Popularity', 64, undefined, 'points'))
      .roll(swing.roll)
      .add('Swing', swing.value, 'Luck')
      .multiply('Scale', 1.5)
      .power('Curve', 1)
      .max('Floor', 0)
      .clamp(0, 100)
      .round('floor')
      .branch('Main event slot', true)
      .note('Title match')
      .done();
    const parsed = traceNodeSchema.parse(JSON.parse(JSON.stringify(traced.trace)));
    expect(parsed).toStrictEqual(traced.trace);
  });

  it(`accepts ${String(TRACE_MAX_DEPTH)} levels and rejects one more`, () => {
    expect(traceNodeSchema.safeParse(chain(TRACE_MAX_DEPTH)).success).toBe(true);
    const tooDeep = traceNodeSchema.safeParse(chain(TRACE_MAX_DEPTH + 1));
    expect(tooDeep.success).toBe(false);
    expect(tooDeep.error?.issues[0]?.message).toMatch(/at most 12 levels/);
  });

  it('stops checking at the depth limit, however deep the input goes', () => {
    expect(traceNodeSchema.safeParse(chain(5000)).success).toBe(false);
  });

  it(`rejects a trace of more than ${String(TRACE_MAX_NODES)} nodes`, () => {
    const children: TraceNode[] = Array.from({ length: TRACE_MAX_NODES }, (_, index) => ({
      kind: 'note',
      label: `Note ${String(index)}`,
      value: null,
    }));
    const result = traceNodeSchema.safeParse({
      kind: 'formula',
      label: 'Wide',
      value: 1,
      children,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields, non-finite numbers and undefined optional fields', () => {
    const base = { kind: 'input', label: 'Popularity', value: 64 };
    expect(traceNodeSchema.safeParse(base).success).toBe(true);
    expect(traceNodeSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(traceNodeSchema.safeParse({ ...base, value: Number.NaN }).success).toBe(false);
    expect(traceNodeSchema.safeParse({ ...base, unit: undefined }).success).toBe(false);
  });
});
