// The trace store's fast record check (POL4-09) gives exactly what the full check gives, or steps
// aside. Design: docs/design/day-pipeline.md#fast-paths
import '../rng/testStreams';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  constantOf,
  createEngineTunables,
  inputOf,
  limitTrace,
  RngRegistry,
  rollChance,
  rollInt,
  startCalc,
  startDecision,
  TRACE_MAX_DEPTH,
  traceNodeSchema,
  type TraceNode,
  type Traced,
  type TraceValue,
} from '@ringside/engine';
import { findJsonProblem } from '../../../src/core/json';
import { copyValidTraceContent } from '../../../src/core/trace/fastCopy';
import { traceValueSchema } from '../../../src/core/trace/schema';

/** The store's full check: plain JSON, then the load schema's parse. */
const fullSchema = z.strictObject({ trace: traceNodeSchema, value: traceValueSchema });

function fullCheck(trace: unknown, value: unknown) {
  if (findJsonProblem(trace) !== null || findJsonProblem(value) !== null) {
    return null;
  }
  const parsed = fullSchema.safeParse({ trace, value });
  return parsed.success ? parsed.data : null;
}

function expectSameAsFullCheck(traced: Traced<TraceValue>): void {
  const trace = limitTrace(traced.trace);
  const fast = copyValidTraceContent(trace, traced.value);
  const full = fullCheck(trace, traced.value);
  expect(full).not.toBeNull();
  expect(fast).toEqual(full);
  // Same key order too, so the stored JSON is byte for byte the same.
  expect(JSON.stringify(fast)).toBe(JSON.stringify(full));
  // A copy: the caller's nodes are never the ones the store freezes.
  expect(fast?.trace).not.toBe(trace);
}

/** A formula with every kind of step the builders write. */
function everyStep(): Traced<number> {
  const tunables = createEngineTunables();
  const rng = new RngRegistry('fast-copy').stream('test.alpha');
  const swing = rollInt(rng, -3, 3, 'Crowd swing');
  const pick = startDecision<'left' | 'right'>('Who goes over', { docRef: 'match-rating.md#x' })
    .consider('left', startCalc('Left side', 50).add('Push', 5).done(), 'Champion')
    .consider('right', -0)
    .rule('Both sides can wrestle', true)
    .roll(rollChance(rng, 0.25, 'Upset').roll)
    .note('A note')
    .choose('left', 'Higher value');
  const calc = startCalc('Rating', inputOf('Base', 40, { kind: 'person', id: 'per_1' }, 'points'), {
    unit: 'points',
    docRef: 'match-rating.md#rating',
  });
  calc
    .add('Bonus', constantOf('House bonus', 2, 'Always on'))
    .add('Swing', swing.value)
    .roll(swing.roll)
    .subtract('Botch', -0)
    .multiply('Weight', calc.tunable(tunables, 'sim.traceRetentionPerKind'))
    .divide('Scale', 7, 'Spread it')
    .power('Curve', 1)
    .min('Ceiling', 100)
    .max('Floor', 0)
    .clamp(0, 100)
    .round('floor')
    .note(pick.trace.label)
    .branch('Main event', false);
  return calc.done();
}

/** A trace as deep as the limits allow, with an empty formula list at the last level. */
function deepest(): Traced<number> {
  let traced: Traced<number> = startCalc('Level 12', 1).done();
  for (let level = TRACE_MAX_DEPTH - 1; level >= 1; level -= 1) {
    traced = startCalc(`Level ${String(level)}`, traced)
      .add('One', 1)
      .done();
  }
  return traced;
}

/** A trace over the node limit, so the size limits cut it and add a note. */
function tooBig(): Traced<number> {
  const calc = startCalc('Big', 0);
  for (let step = 0; step < 450; step += 1) {
    calc.add(`Step ${String(step)}`, 1);
  }
  return calc.done();
}

describe('copyValidTraceContent', () => {
  it('copies what the builders write exactly as the full check does', () => {
    expectSameAsFullCheck(everyStep());
    expectSameAsFullCheck(deepest());
    expectSameAsFullCheck(tooBig());
    expectSameAsFullCheck(inputOf('Text value', 'Main event'));
    expectSameAsFullCheck(inputOf('Nothing', null));
    expectSameAsFullCheck(
      startDecision<boolean>('Yes or no').consider(true, 1).consider(false, 0).choose(true, 'Yes'),
    );
  });

  const base = (): Record<string, unknown> => ({
    kind: 'formula',
    label: 'Root',
    value: 1,
    children: [{ kind: 'input', label: 'Start', value: 1 }],
  });
  const withChild = (child: unknown): Record<string, unknown> => ({ ...base(), children: [child] });
  class Node {
    kind = 'input';
    label = 'Class';
    value = 1;
  }
  const sparse: unknown[] = [];
  sparse.length = 1;
  const tooDeep = (): TraceNode => {
    let node: TraceNode = { kind: 'input', label: 'Bottom', value: 1 };
    for (let level = 0; level < TRACE_MAX_DEPTH; level += 1) {
      node = { kind: 'formula', label: 'Up', value: 1, children: [node] };
    }
    return node;
  };
  const cases: Record<string, unknown> = {
    'NaN value': { ...base(), value: Number.NaN },
    'infinite step': withChild({ kind: 'input', label: 'Start', value: Number.POSITIVE_INFINITY }),
    'unknown field': { ...base(), extra: 1 },
    'missing label': { kind: 'input', value: 1 },
    'unknown unit': { ...base(), unit: 'furlongs' },
    'empty doc ref': { ...base(), docRef: '' },
    'unknown kind': { kind: 'guess', label: 'Guess', value: 1 },
    'formula without children': { kind: 'formula', label: 'Root', value: 1 },
    'undefined optional field': { ...base(), unit: undefined },
    'class instance': withChild(new Node()),
    'symbol key': { ...base(), [Symbol('hidden')]: 1 },
    'sparse children': { ...base(), children: sparse },
    'children past the depth limit': tooDeep(),
    'more nodes than the limit': {
      ...base(),
      children: Array.from({ length: 401 }, () => ({ kind: 'note', label: 'n', value: null })),
    },
    'bad entity ref': withChild({
      kind: 'input',
      label: 'x',
      value: 1,
      ref: { kind: 'x', id: 'y' },
    }),
    'bad roll kind': withChild({
      kind: 'roll',
      label: 'r',
      value: 1,
      roll: { stream: 's', kind: 'dice', label: 'r', result: 1 },
    }),
    'zero hidden steps': withChild({ kind: 'note', label: 'n', value: null, hiddenSteps: 0 }),
    'text note value': withChild({ kind: 'note', label: 'n', value: 'x' }),
    'decision with a numeric choice': withChild({
      kind: 'decision',
      label: 'd',
      value: 1,
      chosen: 1,
      reason: 'r',
      considered: [],
    }),
    'considered option with an extra field': withChild({
      kind: 'decision',
      label: 'd',
      value: 'a',
      chosen: 'a',
      reason: 'r',
      considered: [{ option: 'a', score: 1, extra: true }],
    }),
    'a Map': new Map(),
  };

  it.each(Object.entries(cases))('steps aside for %s, which the full check refuses', (_, trace) => {
    expect(fullCheck(trace, 1)).toBeNull();
    expect(copyValidTraceContent(trace, 1)).toBeNull();
  });

  it('steps aside for a value the full check refuses', () => {
    const { trace } = everyStep();
    expect(copyValidTraceContent(trace, Number.NaN)).toBeNull();
    expect(copyValidTraceContent(trace, undefined)).toBeNull();
    expect(fullCheck(trace, Number.NaN)).toBeNull();
  });
});
