/**
 * Small helpers for building and reading traces outside the calculation and decision builders.
 */

import { InvalidArgumentError } from '../errors';
import { limitTrace } from './limits';
import type {
  ConstantNode,
  EntityRef,
  InputNode,
  RoundMode,
  TraceNode,
  TraceNodeKind,
  TraceNodeOfKind,
  TraceUnit,
  TraceValue,
  Traced,
} from './types';

/** Throws unless `value` can sit in a trace: finite numbers, booleans, strings and null. */
export function assertTraceValue(functionName: string, argumentName: string, value: unknown): void {
  const valid =
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value));
  if (!valid) {
    throw new InvalidArgumentError(
      functionName,
      argumentName,
      value,
      'a finite number, true/false, text or null',
    );
  }
}

/**
 * Rounds `value` the way a round step names it. Spelled out per mode so every `Math` member the
 * engine reads stays a fixed name the no-random lint rule can check.
 */
export function roundByMode(mode: RoundMode, value: number): number {
  switch (mode) {
    case 'round':
      return Math.round(value);
    case 'floor':
      return Math.floor(value);
    case 'ceil':
      return Math.ceil(value);
  }
}

/** Throws unless `value` is a finite number. */
export function assertFiniteNumber(
  functionName: string,
  argumentName: string,
  value: number,
): void {
  if (!Number.isFinite(value)) {
    throw new InvalidArgumentError(functionName, argumentName, value, 'a finite number');
  }
}

/** Turns `-0` into `0`, so a traced value never depends on the sign of zero. */
export function withoutNegativeZero(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * Pairs a value with a trace node. The node is fitted into the trace size limits, so a hand-built
 * trace obeys the same caps as one made by a builder.
 */
export function traced<T>(value: T, node: TraceNode): Traced<T> {
  return { value, trace: limitTrace(node) };
}

/**
 * A named input as a traced value: one `input` node, optionally linked to the entity it belongs to.
 * Use it for the plain values a formula receives, such as a worker's current fatigue.
 */
export function inputOf<T extends TraceValue>(
  label: string,
  value: T,
  ref?: EntityRef,
  unit?: TraceUnit,
): Traced<T> {
  assertTraceValue('inputOf', 'value', value);
  const node: InputNode = {
    kind: 'input',
    label,
    value,
    ...(unit === undefined ? {} : { unit }),
    ...(ref === undefined ? {} : { ref: { kind: ref.kind, id: ref.id } }),
  };
  return { value, trace: node };
}

/** A trivial value with a single `input` node as its trace, for tests and values that need no story. */
export function untraced<T extends TraceValue>(value: T, label: string): Traced<T> {
  return inputOf(label, value);
}

/**
 * A fixed number that is deliberately not a tunable (a unit conversion, a scale end), with the
 * reason it is fixed. Pass it to a calculation step like any other traced number.
 */
export function constantOf(label: string, value: number, reason: string): Traced<number> {
  assertFiniteNumber('constantOf', 'value', value);
  const node: ConstantNode = { kind: 'constant', label, value: withoutNegativeZero(value), reason };
  return { value: node.value, trace: node };
}

/**
 * Derives a new value from a traced one, keeping the source trace as the only child of an `input`
 * node: for example a star rating read off a traced score, or "is injured" read off a traced
 * condition. Numeric maths belongs in `startCalc`, where every step is recorded and replayable.
 */
export function mapTraced<A, B extends TraceValue>(
  source: Traced<A>,
  label: string,
  transform: (value: A) => B,
): Traced<B> {
  const value = transform(source.value);
  assertTraceValue('mapTraced', 'transform result', value);
  const node: InputNode = { kind: 'input', label, value, children: [source.trace] };
  return { value, trace: limitTrace(node) };
}

/** Visits every node of a trace, parents before children, in recorded order. */
export function walkTrace(
  node: TraceNode,
  visit: (current: TraceNode, depth: number) => void,
  depth = 1,
): void {
  visit(node, depth);
  for (const child of node.children ?? []) {
    walkTrace(child, visit, depth + 1);
  }
}

/** Every node of one kind in a trace, in the order {@link walkTrace} visits them. */
export function findTraceNodes<K extends TraceNodeKind>(
  node: TraceNode,
  kind: K,
): TraceNodeOfKind<K>[] {
  const found: TraceNodeOfKind<K>[] = [];
  walkTrace(node, (current) => {
    if (isNodeOfKind(current, kind)) {
      found.push(current);
    }
  });
  return found;
}

/** Narrows a node to one kind. */
export function isNodeOfKind<K extends TraceNodeKind>(
  node: TraceNode,
  kind: K,
): node is TraceNodeOfKind<K> {
  return node.kind === kind;
}
