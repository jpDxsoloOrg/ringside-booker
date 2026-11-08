// Trace replay. Design: docs/design/calculation-traces.md#replay
import { describe, expect, it } from 'vitest';
import {
  assertTraceReplays,
  replayTrace,
  startCalc,
  TraceReplayError,
  untraced,
  type FormulaNode,
  type TraceNode,
  type Traced,
} from '@ringside/engine';
import { expectTraceReplays } from '../../support/trace';

/** A hand-built trace: 10, plus 5, times 2, capped at 25. */
function handBuiltSteps(): TraceNode[] {
  return [
    { kind: 'input', label: 'Base', value: 10 },
    { kind: 'add', label: 'Bonus', value: 15, operand: 5, before: 10, after: 15 },
    { kind: 'multiply', label: 'Double', value: 30, operand: 2, before: 15, after: 30 },
    { kind: 'min', label: 'Ceiling', value: 25, limit: 25, before: 30, after: 25, applied: true },
  ];
}

/** A hand-built traced number. The root stays a FormulaNode so tests can tamper with it by spreading. */
function handBuilt(
  value: number,
  steps: TraceNode[] = handBuiltSteps(),
): Traced<number> & { trace: FormulaNode } {
  const trace: FormulaNode = { kind: 'formula', label: 'Hand built', value, children: steps };
  return { value, trace };
}

describe('replayTrace', () => {
  it('recomputes a hand-built formula from its starting value', () => {
    expect(replayTrace(handBuilt(25).trace)).toBe(25);
    expectTraceReplays(handBuilt(25));
  });

  it('fails assertTraceReplays when the recorded value was tampered with', () => {
    const tampered = handBuilt(26);
    expect(() => {
      assertTraceReplays(tampered);
    }).toThrow(TraceReplayError);
    expect(() => {
      assertTraceReplays({ value: 26, trace: { ...tampered.trace, value: 25 } });
    }).toThrow(/replays to 25 but the traced value is 26/);
    expect(() => {
      assertTraceReplays({ value: 25, trace: { ...tampered.trace, value: 26 } });
    }).toThrow(/root node records 26/);
  });

  it('fails when a builder result is tampered with after the fact', () => {
    const result = startCalc('x', 10).add('a', 5).done();
    expectTraceReplays(result);
    expect(() => {
      assertTraceReplays({ ...result, value: 16 });
    }).toThrow(TraceReplayError);
  });

  it('fails when a step records a before or after the replay does not reach', () => {
    const steps = handBuiltSteps();
    steps[2] = { kind: 'multiply', label: 'Double', value: 30, operand: 2, before: 14, after: 30 };
    expect(() => {
      assertTraceReplays(handBuilt(25, steps));
    }).toThrow(/step "Double" \(multiply\) records before 14 but replay gives 15/);
  });

  it('fails when a limit records the wrong applied flag', () => {
    const steps = handBuiltSteps();
    steps[3] = {
      kind: 'min',
      label: 'Ceiling',
      value: 25,
      limit: 25,
      before: 30,
      after: 25,
      applied: false,
    };
    try {
      assertTraceReplays(handBuilt(25, steps));
      expect.fail('expected a TraceReplayError');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(TraceReplayError);
      if (error instanceof TraceReplayError) {
        expect(error.problems).toStrictEqual([
          'step "Ceiling" (min) records applied false but replay gives true',
        ]);
        expect(error.code).toBe('TRACE_REPLAY');
      }
    }
  });

  it('replays round("floor") at and around whole numbers', () => {
    for (const [start, expected] of [
      [3, 3],
      [2.999999, 2],
      [-0.5, -1],
      [-2, -2],
    ] as const) {
      const result = startCalc('x', start).round('floor').done();
      expect(result.value).toBe(expected);
      expect(replayTrace(result.trace)).toBe(expected);
      expectTraceReplays(result);
    }
  });

  it('replays min and max exactly at their limit, below it and above it', () => {
    for (const start of [44, 45, 46]) {
      const capped = startCalc('x', start).min('Ceiling', 45).done();
      const floored = startCalc('x', start).max('Floor', 45).done();
      expect(replayTrace(capped.trace)).toBe(Math.min(start, 45));
      expect(replayTrace(floored.trace)).toBe(Math.max(start, 45));
      expectTraceReplays(capped);
      expectTraceReplays(floored);
    }
    const atLimit = startCalc('x', 45).min('Ceiling', 45).max('Floor', 45).done();
    expect(
      atLimit.trace.children?.slice(1).map((node) => 'applied' in node && node.applied),
    ).toStrictEqual([false, false]);
  });

  it('replays clamp at both ends of its range', () => {
    for (const start of [-1, 0, 50, 100, 101]) {
      const result = startCalc('x', start).clamp(0, 100).done();
      expect(replayTrace(result.trace)).toBe(Math.min(Math.max(start, 0), 100));
      expectTraceReplays(result);
    }
  });

  it('tolerates floating-point noise within epsilon, and only within it', () => {
    const result = startCalc('x', 0.1).add('a', 0.2).done();
    expectTraceReplays({ ...result, value: 0.3 });
    expect(() => {
      assertTraceReplays({ ...result, value: 0.3001 });
    }).toThrow(TraceReplayError);
    assertTraceReplays({ ...result, value: 0.3001 }, 1e-3);
  });

  it('replays a fact node to its own value', () => {
    expect(replayTrace(untraced(7, 'Seven').trace)).toBe(7);
    expectTraceReplays(untraced(7, 'Seven'));
  });

  it('refuses traces it cannot replay', () => {
    expect(() => replayTrace(untraced('text', 'Words').trace)).toThrow(TraceReplayError);
    expect(() => replayTrace({ kind: 'formula', label: 'Empty', value: 1, children: [] })).toThrow(
      /no starting value/,
    );
    expect(() =>
      replayTrace({
        kind: 'formula',
        label: 'Bad divide',
        value: 1,
        children: [
          { kind: 'input', label: 'One', value: 1 },
          { kind: 'divide', label: 'Zero', value: 1, operand: 0, before: 1, after: 1 },
        ],
      }),
    ).toThrow(TraceReplayError);
  });

  it('ignores informational steps between the arithmetic', () => {
    const steps: TraceNode[] = [
      { kind: 'input', label: 'Base', value: 10 },
      { kind: 'note', label: 'Just a note', value: null },
      { kind: 'branch', label: 'Main event', value: true, condition: 'Main event', taken: true },
      { kind: 'subtract', label: 'Penalty', value: 7, operand: 3, before: 10, after: 7 },
    ];
    expectTraceReplays(handBuilt(7, steps));
  });
});
