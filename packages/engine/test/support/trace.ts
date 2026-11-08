/**
 * Vitest helpers for calculation traces. Every formula test uses these: `expectTraceReplays` on
 * every numeric result, `expectSerialisable` on every trace.
 */

import { expect } from 'vitest';
import {
  assertJsonValue,
  assertTraceReplays,
  findTraceNodes,
  walkTrace,
  type RollRecord,
  type Traced,
  type TraceNode,
  type TraceNodeKind,
  type TraceNodeOfKind,
} from '@ringside/engine';

/**
 * Fails unless the trace replays to its value, every recorded step matches the replay, and the
 * result is plain JSON ({@link expectSerialisable}), so every numeric trace a test replays is also
 * checked for serialisability.
 */
export function expectTraceReplays(result: Traced<number>, epsilon?: number): void {
  // Throws a TraceReplayError that lists every mismatching step, so a failure names the step.
  assertTraceReplays(result, epsilon);
  expectSerialisable(result);
}

/** What a node must look like to match: its kind, and its label when given. */
export interface TraceNodeMatch<K extends TraceNodeKind> {
  kind: K;
  label?: string | RegExp;
}

function labelMatches(label: string, wanted: string | RegExp | undefined): boolean {
  if (wanted === undefined) {
    return true;
  }
  return typeof wanted === 'string' ? label === wanted : wanted.test(label);
}

function describeTree(root: TraceNode): string {
  const lines: string[] = [];
  walkTrace(root, (node, depth) => {
    lines.push(`${'  '.repeat(depth - 1)}${node.kind}: ${node.label}`);
  });
  return lines.join('\n');
}

/**
 * Finds the first node of `kind` (with `label`, when given) anywhere in the trace and returns it,
 * narrowed to that kind, for further assertions. Fails with the whole tree printed when none match.
 */
export function expectTraceContains<K extends TraceNodeKind>(
  result: Traced<unknown>,
  match: TraceNodeMatch<K>,
): TraceNodeOfKind<K> {
  const found = findTraceNodes(result.trace, match.kind).find((node) =>
    labelMatches(node.label, match.label),
  );
  if (found === undefined) {
    const wanted =
      match.label === undefined ? match.kind : `${match.kind} "${String(match.label)}"`;
    expect.fail(`Expected a ${wanted} node in the trace:\n${describeTree(result.trace)}`);
  }
  return found;
}

/** Finds the first roll from `stream` in the trace and returns its record. */
export function expectRollRecorded(result: Traced<unknown>, stream: string): RollRecord {
  const rolls = findTraceNodes(result.trace, 'roll');
  const found = rolls.find((node) => node.roll.stream === stream);
  if (found === undefined) {
    const streams = rolls.map((node) => node.roll.stream);
    expect.fail(
      `Expected a roll from stream "${stream}" in the trace; found ${streams.length === 0 ? 'no rolls' : streams.join(', ')}`,
    );
  }
  return found.roll;
}

/**
 * Fails unless `value` is plain JSON (the engine's own check) and survives a JSON round trip
 * unchanged. No `structuredClone`: the engine's TypeScript config has no DOM or Node types.
 */
export function expectSerialisable(value: unknown): void {
  assertJsonValue(value);
  const roundTripped: unknown = JSON.parse(JSON.stringify(value));
  expect(roundTripped).toStrictEqual(value);
}
