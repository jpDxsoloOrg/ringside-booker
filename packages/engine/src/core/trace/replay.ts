/**
 * Replaying a numeric trace: recompute its value from the recorded steps alone.
 *
 * The builder makes the arithmetic and the trace the same thing, but a formula can still compute
 * outside the chain and hand in a number that does not match. {@link assertTraceReplays} catches
 * that: it re-runs every arithmetic, limit and round step of the root formula from its starting
 * value, checks each step's recorded `before`, `after` and `applied` against the replay, and checks
 * the final number against the traced value. Tests call it on every numeric result.
 */

import { TraceReplayError } from '../errors';
import { walkTrace } from './helpers';
import { isTruncationNote } from './limits';
import type { FormulaNode, TraceNode, Traced } from './types';

/** True when `actual` is within `epsilon` of `expected`, relative to their size once above 1. */
function isClose(actual: number, expected: number, epsilon: number): boolean {
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
  return Math.abs(actual - expected) <= epsilon * scale;
}

/** Collects mismatches between recorded steps and the replay. Null when only the value is wanted. */
interface ReplayCheck {
  readonly epsilon: number;
  readonly problems: string[];
}

function checkNumber(
  check: ReplayCheck | null,
  step: TraceNode,
  field: string,
  recorded: number,
  replayed: number,
): void {
  if (check !== null && !isClose(recorded, replayed, check.epsilon)) {
    check.problems.push(
      `step "${step.label}" (${step.kind}) records ${field} ${String(recorded)} but replay gives ${String(replayed)}`,
    );
  }
}

function checkApplied(
  check: ReplayCheck | null,
  step: TraceNode,
  recorded: boolean,
  replayed: boolean,
): void {
  if (check !== null && recorded !== replayed) {
    check.problems.push(
      `step "${step.label}" (${step.kind}) records applied ${String(recorded)} but replay gives ${String(replayed)}`,
    );
  }
}

/** Applies one step to the running value. Steps that carry no arithmetic leave it unchanged. */
function applyStep(step: TraceNode, current: number, check: ReplayCheck | null): number {
  switch (step.kind) {
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide': {
      checkNumber(check, step, 'before', step.before, current);
      const after = applyArithmeticStep(step.kind, step.label, current, step.operand);
      checkNumber(check, step, 'after', step.after, after);
      checkNumber(check, step, 'value', step.value, after);
      return after;
    }
    case 'min':
    case 'max': {
      checkNumber(check, step, 'before', step.before, current);
      const after =
        step.kind === 'min' ? Math.min(current, step.limit) : Math.max(current, step.limit);
      checkNumber(check, step, 'after', step.after, after);
      checkNumber(check, step, 'value', step.value, after);
      checkApplied(check, step, step.applied, after !== current);
      return after;
    }
    case 'clamp': {
      checkNumber(check, step, 'before', step.before, current);
      if (step.min > step.max) {
        throw new TraceReplayError(step.label, [
          `clamp range ${String(step.min)} to ${String(step.max)} is empty`,
        ]);
      }
      const after = Math.min(Math.max(current, step.min), step.max);
      checkNumber(check, step, 'after', step.after, after);
      checkNumber(check, step, 'value', step.value, after);
      checkApplied(check, step, step.applied, after !== current);
      return after;
    }
    case 'round': {
      checkNumber(check, step, 'before', step.before, current);
      const after = Math[step.mode](current);
      checkNumber(check, step, 'after', step.after, after);
      checkNumber(check, step, 'value', step.value, after);
      return after;
    }
    case 'note':
      // The steps cut by the size limits cannot be replayed; their note records where they left
      // the running value, and the replay carries on from there.
      return isTruncationNote(step) && step.value !== null ? step.value : current;
    case 'formula':
    case 'input':
    case 'constant':
    case 'tunable':
    case 'roll':
    case 'branch':
    case 'decision':
      return current;
  }
}

function applyArithmeticStep(
  kind: 'add' | 'subtract' | 'multiply' | 'divide',
  label: string,
  current: number,
  operand: number,
): number {
  switch (kind) {
    case 'add':
      return current + operand;
    case 'subtract':
      return current - operand;
    case 'multiply':
      return current * operand;
    case 'divide':
      if (operand === 0) {
        throw new TraceReplayError(label, ['divides by 0']);
      }
      return current / operand;
  }
}

function replayFormula(node: FormulaNode, check: ReplayCheck | null): number {
  const [start, ...steps] = node.children;
  if (start === undefined) {
    throw new TraceReplayError(node.label, ['formula has no starting value']);
  }
  if (typeof start.value !== 'number') {
    throw new TraceReplayError(node.label, [`starting value "${start.label}" is not a number`]);
  }
  let current = start.value;
  for (const step of steps) {
    current = applyStep(step, current, check);
  }
  return current;
}

/**
 * Recomputes a numeric trace. A `formula` node is replayed from its first child (the starting
 * value) through its arithmetic, limit and round steps in order; any other node with a number value
 * is a recorded fact and replays to itself. Throws {@link TraceReplayError} when the trace has no
 * numeric value to replay or divides by 0.
 */
export function replayTrace(node: TraceNode): number {
  if (node.kind === 'formula') {
    return replayFormula(node, null);
  }
  if (typeof node.value !== 'number') {
    throw new TraceReplayError(node.label, [`a ${node.kind} node with a non-numeric value`]);
  }
  return node.value;
}

/**
 * Replays every numeric formula nested inside `root` (sub-formulas embedded as a step's children,
 * traced scores and so on) against the value it records. A nested formula cut down to no children
 * by the size limits has nothing left to replay and is skipped.
 */
function checkNestedFormulas(root: TraceNode, check: ReplayCheck): void {
  walkTrace(root, (node) => {
    if (
      node === root ||
      node.kind !== 'formula' ||
      node.children.length === 0 ||
      typeof node.value !== 'number'
    ) {
      return;
    }
    const nested: ReplayCheck = { epsilon: check.epsilon, problems: [] };
    const replayed = replayFormula(node, nested);
    if (!isClose(replayed, node.value, check.epsilon)) {
      nested.problems.push(`replays to ${String(replayed)} but records ${String(node.value)}`);
    }
    for (const problem of nested.problems) {
      check.problems.push(`in "${node.label}": ${problem}`);
    }
  });
}

/**
 * Throws {@link TraceReplayError} unless the trace reproduces the traced value: the replay must be
 * within `epsilon` of `traced.value` (relative once the values are above 1), the root node must
 * record the same value, every replayed step must record the `before`, `after` and `applied` the
 * replay computes, and every formula nested inside the trace must replay to its own value too.
 */
export function assertTraceReplays(traced: Traced<number>, epsilon = 1e-9): void {
  const root = traced.trace;
  const check: ReplayCheck = { epsilon, problems: [] };
  const replayed = root.kind === 'formula' ? replayFormula(root, check) : replayTrace(root);
  if (!isClose(replayed, traced.value, epsilon)) {
    check.problems.push(
      `replays to ${String(replayed)} but the traced value is ${String(traced.value)}`,
    );
  }
  if (typeof root.value !== 'number' || !isClose(root.value, traced.value, epsilon)) {
    check.problems.push(
      `root node records ${String(root.value)} but the traced value is ${String(traced.value)}`,
    );
  }
  checkNestedFormulas(root, check);
  if (check.problems.length > 0) {
    throw new TraceReplayError(root.label, check.problems);
  }
}
