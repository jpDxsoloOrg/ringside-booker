// Calculation builder. Design: docs/design/calculation-traces.md
import '../rng/testStreams';
import { describe, expect, it } from 'vitest';
import {
  RngRegistry,
  TRACE_MAX_DEPTH,
  TRACE_MAX_NODES,
  constantOf,
  countTraceNodes,
  createTunables,
  defineTunables,
  findTraceNodes,
  inputOf,
  InvalidArgumentError,
  isTruncationNote,
  mapTraced,
  parseId,
  rollInt,
  startCalc,
  traceDepth,
  traced,
  untraced,
  type FormulaNode,
  type TraceNode,
} from '@ringside/engine';
import {
  expectRollRecorded,
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../support/trace';

const testTunables = defineTunables({
  'test.restFactor': {
    kind: 'number',
    default: 0.5,
    min: 0,
    max: 2,
    unit: 'multiplier',
    category: 'Test',
    description: 'How much of a day off turns into recovery.',
    docRef: 'calculation-traces.md#constants-and-tunables',
  },
  'test.bonus': {
    kind: 'integer',
    default: 4,
    min: 0,
    max: 10,
    unit: 'points',
    category: 'Test',
    description: 'A flat bonus.',
  },
});

function rootChildren(trace: TraceNode): readonly TraceNode[] {
  if (trace.kind !== 'formula') {
    throw new Error(`Expected a formula root, got ${trace.kind}`);
  }
  return trace.children;
}

describe('startCalc', () => {
  it('computes the example chain to 25 with an applied clamp, and replays it', () => {
    const result = startCalc('x', 10).add('a', 5).multiply('b', 2).clamp(0, 25).done();

    expect(result.value).toBe(25);
    const clamp = expectTraceContains(result, { kind: 'clamp' });
    expect(clamp).toMatchObject({ before: 30, after: 25, min: 0, max: 25, applied: true });
    expectTraceReplays(result);
    expectSerialisable(result);
  });

  it('records the starting value, every step in order, and the result on the root', () => {
    const result = startCalc('Total', 10, { unit: 'points', docRef: 'test.md#total' })
      .add('Bonus', 5, 'Hometown crowd')
      .subtract('Penalty', 3)
      .multiply('Scale', 2)
      .divide('Split', 4)
      .done();

    expect(result.value).toBe(6);
    expect(result.trace).toMatchObject({
      kind: 'formula',
      label: 'Total',
      value: 6,
      unit: 'points',
      docRef: 'test.md#total',
    });
    expect(rootChildren(result.trace)).toStrictEqual([
      { kind: 'input', label: 'Starting value', value: 10, unit: 'points' },
      {
        kind: 'add',
        label: 'Bonus',
        value: 15,
        operand: 5,
        before: 10,
        after: 15,
        reason: 'Hometown crowd',
      },
      { kind: 'subtract', label: 'Penalty', value: 12, operand: 3, before: 15, after: 12 },
      { kind: 'multiply', label: 'Scale', value: 24, operand: 2, before: 12, after: 24 },
      { kind: 'divide', label: 'Split', value: 6, operand: 4, before: 24, after: 6 },
    ]);
    expectTraceReplays(result);
    expectSerialisable(result);
  });

  it('uses the start label option for a plain starting number', () => {
    const result = startCalc('Fatigue after rest', 40, {
      startLabel: 'Fatigue before rest',
    }).done();
    expect(rootChildren(result.trace)[0]).toStrictEqual({
      kind: 'input',
      label: 'Fatigue before rest',
      value: 40,
    });
    expectTraceReplays(result);
  });

  it('starts from a traced value by embedding its trace as the first child', () => {
    const fatigue = inputOf('Fatigue before rest', 40, {
      kind: 'person',
      id: parseId('person', 'per_0000000001'),
    });
    const result = startCalc('Fatigue after rest', fatigue).subtract('Rest', 15).done();

    expect(result.value).toBe(25);
    expect(rootChildren(result.trace)[0]).toStrictEqual(fatigue.trace);
    expect(expectTraceContains(result, { kind: 'input' }).ref).toStrictEqual({
      kind: 'person',
      id: 'per_0000000001',
    });
    expectTraceReplays(result);
    expectSerialisable(result);
  });

  it('records a clamp that does not bite with applied: false', () => {
    const result = startCalc('x', 10).clamp(0, 25).done();
    expect(result.value).toBe(10);
    expect(expectTraceContains(result, { kind: 'clamp' })).toMatchObject({
      before: 10,
      after: 10,
      applied: false,
    });
    expectTraceReplays(result);
  });

  it('treats both clamp ends as inside the range', () => {
    const atMin = startCalc('x', 0).clamp(0, 25).done();
    const atMax = startCalc('x', 25).clamp(0, 25).done();
    expect(expectTraceContains(atMin, { kind: 'clamp' }).applied).toBe(false);
    expect(expectTraceContains(atMax, { kind: 'clamp' }).applied).toBe(false);
    expectTraceReplays(atMin);
    expectTraceReplays(atMax);
  });

  it('records min (a ceiling) and max (a floor) with applied set either way', () => {
    const capped = startCalc('x', 50).min('Production ceiling', 45).done();
    expect(capped.value).toBe(45);
    expect(expectTraceContains(capped, { kind: 'min' })).toMatchObject({
      limit: 45,
      before: 50,
      after: 45,
      applied: true,
    });

    const underCeiling = startCalc('x', 30).min('Production ceiling', 45).done();
    expect(underCeiling.value).toBe(30);
    expect(expectTraceContains(underCeiling, { kind: 'min' }).applied).toBe(false);

    const floored = startCalc('x', -5).max('No negative crowd', 0).done();
    expect(floored.value).toBe(0);
    expect(expectTraceContains(floored, { kind: 'max' }).applied).toBe(true);

    for (const result of [capped, underCeiling, floored]) {
      expectTraceReplays(result);
    }
  });

  it('throws on divide by 0, from a number or a traced value', () => {
    expect(() => startCalc('x', 10).divide('Split', 0)).toThrow(InvalidArgumentError);
    expect(() => startCalc('x', 10).divide('Split', untraced(0, 'Nobody'))).toThrow(
      InvalidArgumentError,
    );
  });

  it('throws on non-finite amounts and an empty clamp range', () => {
    expect(() => startCalc('x', Number.NaN)).toThrow(InvalidArgumentError);
    expect(() => startCalc('x', 1).add('a', Number.POSITIVE_INFINITY)).toThrow(
      InvalidArgumentError,
    );
    expect(() => startCalc('x', Number.MAX_VALUE).multiply('Huge', 10)).toThrow(
      InvalidArgumentError,
    );
    expect(() => startCalc('x', 1).clamp(5, 4)).toThrow(InvalidArgumentError);
  });

  it('rounds in each mode, with halves going up', () => {
    const rounded = startCalc('x', 2.5).round('round').done();
    const floored = startCalc('x', 2.7).round('floor').done();
    const ceiled = startCalc('x', 2.1).round('ceil').done();
    expect([rounded.value, floored.value, ceiled.value]).toStrictEqual([3, 2, 3]);
    expect(expectTraceContains(floored, { kind: 'round' })).toMatchObject({
      label: 'Rounded down',
      mode: 'floor',
      before: 2.7,
      after: 2,
    });
    for (const result of [rounded, floored, ceiled]) {
      expectTraceReplays(result);
    }
  });

  it('never records negative zero', () => {
    const result = startCalc('x', -0.4).round('round').multiply('Flip', -1).done();
    expect(Object.is(result.value, 0)).toBe(true);
    expectSerialisable(result);
  });

  it('records a tunable override of 0 as overridden with value 0 under the next step', () => {
    const tunables = createTunables(testTunables, { 'test.restFactor': 0 });
    const calc = startCalc('Recovery', 20);
    const factor = calc.tunable(tunables, 'test.restFactor', 'Rest factor');
    const result = calc.multiply('Rest', factor).done();

    expect(factor).toBe(0);
    expect(result.value).toBe(0);
    const multiply = expectTraceContains(result, { kind: 'multiply', label: 'Rest' });
    expect(multiply.children).toStrictEqual([
      {
        kind: 'tunable',
        label: 'Rest factor',
        key: 'test.restFactor',
        value: 0,
        defaultValue: 0.5,
        overridden: true,
        unit: 'multiplier',
        docRef: 'calculation-traces.md#constants-and-tunables',
      },
    ]);
    expectTraceReplays(result);
    expectSerialisable(result);
  });

  it('records a tunable at its default as not overridden, labelled by its description', () => {
    const tunables = createTunables(testTunables, {});
    const calc = startCalc('Score', 1);
    const result = calc.add('Bonus', calc.tunable(tunables, 'test.bonus')).done();
    expect(expectTraceContains(result, { kind: 'tunable' })).toMatchObject({
      label: 'A flat bonus.',
      value: 4,
      defaultValue: 4,
      overridden: false,
    });
    expectTraceReplays(result);
  });

  it('keeps a tunable read that no step used as a step of its own', () => {
    const tunables = createTunables(testTunables, {});
    const calc = startCalc('Score', 1);
    calc.tunable(tunables, 'test.bonus', 'Unused bonus');
    const result = calc.done();
    expect(rootChildren(result.trace).map((node) => node.kind)).toStrictEqual(['input', 'tunable']);
    expectTraceReplays(result);
  });

  it('nests a traced amount as the children of its step', () => {
    const bonus = startCalc('Crowd bonus', 3).multiply('Hype', 2).done();
    const result = startCalc('Rating', 50).add('Crowd bonus', bonus).done();

    expect(result.value).toBe(56);
    const add = expectTraceContains(result, { kind: 'add', label: 'Crowd bonus' });
    expect(add.operand).toBe(6);
    expect(add.children).toStrictEqual([bonus.trace]);
    expectTraceReplays(result);
    expectTraceReplays(bonus);
    expectSerialisable(result);
  });

  it('nests a traced multiplier, divisor and limit too', () => {
    const scale = constantOf('Percent scale', 100, 'Percentages are stored as 0 to 100');
    const ceiling = untraced(45, 'Production ceiling');
    const result = startCalc('Share', 30)
      .divide('As a fraction', scale)
      .multiply('Boost', untraced(2, 'Boost'))
      .min('Production ceiling', ceiling)
      .done();
    expect(result.value).toBeCloseTo(0.6, 12);
    expect(expectTraceContains(result, { kind: 'divide' }).children).toStrictEqual([scale.trace]);
    expect(expectTraceContains(result, { kind: 'min' }).children).toStrictEqual([ceiling.trace]);
    expectTraceContains(result, { kind: 'constant', label: 'Percent scale' });
    expectTraceReplays(result);
  });

  it('records rolls, notes and branches without changing the value', () => {
    const stream = new RngRegistry('trace-calc').stream('test.alpha');
    const swing = rollInt(stream, -3, 3, 'Crowd swing');
    const calc = startCalc('Rating', 50).roll(swing.roll).add('Crowd swing', swing.value);
    calc.branch('Main event', true).note('Title match');
    const result = calc.done();

    expect(result.value).toBe(50 + swing.value);
    expect(expectRollRecorded(result, 'test.alpha')).toStrictEqual(swing.roll);
    expect(expectTraceContains(result, { kind: 'branch' })).toMatchObject({
      label: 'Main event',
      condition: 'Main event',
      taken: true,
      value: true,
    });
    expect(expectTraceContains(result, { kind: 'note' })).toStrictEqual({
      kind: 'note',
      label: 'Title match',
      value: null,
    });
    expectTraceReplays(result);
    expectSerialisable(result);
  });

  it('exposes the running value for branching inside a formula', () => {
    const calc = startCalc('x', 10).add('a', 5);
    expect(calc.current).toBe(15);
  });

  it('takes a snapshot on done and lets the chain carry on', () => {
    const calc = startCalc('x', 1).add('a', 1);
    const first = calc.done();
    const second = calc.add('b', 1).done();
    expect(first.value).toBe(2);
    expect(rootChildren(first.trace)).toHaveLength(2);
    expect(second.value).toBe(3);
    expect(rootChildren(second.trace)).toHaveLength(3);
    expectTraceReplays(first);
    expectTraceReplays(second);
  });
});

describe('trace size limits', () => {
  it('caps 1,000 chained adds at 400 nodes plus one note, and the value stays exact', () => {
    let calc = startCalc('Roster total', 0);
    for (let i = 1; i <= 1_000; i++) {
      calc = calc.add(`Worker ${String(i)}`, i);
    }
    const result = calc.done();

    expect(result.value).toBe(500_500);
    expect(countTraceNodes(result.trace)).toBeLessThanOrEqual(TRACE_MAX_NODES + 1);
    const notes = findTraceNodes(result.trace, 'note');
    expect(notes).toHaveLength(1);
    const [note] = notes;
    expect(note !== undefined && isTruncationNote(note)).toBe(true);
    expect(note?.label).toMatch(/^\d+ more steps not shown$/);
    const children = rootChildren(result.trace);
    expect(children[children.length - 1]).toBe(note);
    const shownAdds = children.filter((node) => node.kind === 'add').length;
    expect(note?.hiddenSteps).toBe(1_000 - shownAdds);
    expectTraceReplays(result);
    expectSerialisable(result);
  });

  it('trims a large embedded trace to the room that is left', () => {
    let inner = startCalc('Inner', 0);
    for (let i = 0; i < 600; i++) {
      inner = inner.add('Step', 1);
    }
    const innerResult = inner.done();
    const result = startCalc('Outer', 1).add('Inner total', innerResult).add('Last', 1).done();

    expect(result.value).toBe(1 + innerResult.value + 1);
    expect(countTraceNodes(result.trace)).toBeLessThanOrEqual(TRACE_MAX_NODES + 1);
    expectTraceReplays(result);
    expectSerialisable(result);
  });

  it('cuts nesting below the depth limit with a note, without throwing', () => {
    let nested = startCalc('Level 1', 1).add('Step', 1).done();
    for (let level = 2; level <= 20; level++) {
      nested = startCalc(`Level ${String(level)}`, 1)
        .add('Nested', nested)
        .done();
    }

    expect(traceDepth(nested.trace)).toBeLessThanOrEqual(TRACE_MAX_DEPTH);
    expect(findTraceNodes(nested.trace, 'note').some(isTruncationNote)).toBe(true);
    expect(nested.value).toBe(21);
    expectTraceReplays(nested);
    expectSerialisable(nested);
  });

  it('keeps the counts on each builder, so builders do not share a budget', () => {
    const first = startCalc('First', 0);
    const second = startCalc('Second', 0);
    for (let i = 0; i < 500; i++) {
      first.add('Step', 1);
    }
    second.add('Step', 1);
    expect(findTraceNodes(second.done().trace, 'note')).toHaveLength(0);
    expect(findTraceNodes(first.done().trace, 'note')).toHaveLength(1);
  });

  it('fits a hand-built trace passed to traced() into the limits', () => {
    const steps: TraceNode[] = [];
    for (let i = 0; i < 1_000; i++) {
      steps.push({ kind: 'note', label: `Line ${String(i)}`, value: null });
    }
    const root: FormulaNode = { kind: 'formula', label: 'Big', value: 0, children: steps };
    const result = traced(0, root);
    expect(countTraceNodes(result.trace)).toBeLessThanOrEqual(TRACE_MAX_NODES);
    expectSerialisable(result);
  });
});

describe('trace helpers', () => {
  it('inputOf records a linked input and untraced a bare one', () => {
    const popularity = inputOf(
      'Popularity',
      70,
      { kind: 'promotion', id: parseId('promotion', 'pro_0000000001') },
      'points',
    );
    expect(popularity).toStrictEqual({
      value: 70,
      trace: {
        kind: 'input',
        label: 'Popularity',
        value: 70,
        unit: 'points',
        ref: { kind: 'promotion', id: 'pro_0000000001' },
      },
    });
    expect(untraced(3, 'Three')).toStrictEqual({
      value: 3,
      trace: { kind: 'input', label: 'Three', value: 3 },
    });
    expect(() => untraced(Number.NaN, 'Broken')).toThrow(InvalidArgumentError);
  });

  it('mapTraced derives a value and keeps the source trace as its child', () => {
    const score = startCalc('Match score', 70).add('Crowd', 12).done();
    const stars = mapTraced(score, 'Star rating', (value) => `${String(value / 20)} stars`);
    expect(stars.value).toBe('4.1 stars');
    expect(stars.trace).toStrictEqual({
      kind: 'input',
      label: 'Star rating',
      value: '4.1 stars',
      children: [score.trace],
    });
    expectSerialisable(stars);
  });
});
