/**
 * Calculation traces: the shape of "every number explains itself".
 *
 * A formula returns a {@link Traced} value: the result together with a {@link TraceNode} tree that
 * records every input, tunable, modifier, limit and roll that produced it. The "Why?" panel renders
 * the tree. Traces are plain JSON (no functions, `Map`, `Set`, `Date`, class instances or
 * `undefined` entries), so they go into saves and across the Web Worker boundary unchanged.
 *
 * Labels are written for the player ("Fatigue before rest"), never internal names ("fat0").
 *
 * See docs/design/calculation-traces.md.
 */

import type { EntityKind } from '../ids';
import type { RollRecord } from '../rng/rolls';
import type { TunableRawValue, TunableUnit } from '../tunables/define';

/** A result together with the trace that explains it. */
export interface Traced<T> {
  value: T;
  trace: TraceNode;
}

/** What a traced number measures: every tunable unit (star ratings included). */
export type TraceUnit = TunableUnit;

/** Any value a trace node can show. Numbers are always finite. */
export type TraceValue = number | boolean | string | null;

/** A link to an entity, so a trace can point at a person, promotion or show without embedding it. */
export interface EntityRef {
  readonly kind: EntityKind;
  readonly id: string;
}

/** Fields every trace node carries. */
interface TraceNodeBase {
  /** Plain English, written for the player: "Fatigue before rest", not "fat0". */
  readonly label: string;
  /** What the node's value measures. Steps of a calculation share the formula's unit. */
  readonly unit?: TraceUnit;
  /** Design doc anchor that explains this step, for example `condition.md#recovery`. */
  readonly docRef?: string;
  /** Sub-steps, shown as a collapsible group under this node. */
  readonly children?: readonly TraceNode[];
}

/**
 * The root of a calculation. For a numeric formula, the first child is the starting value and the
 * remaining children are the steps applied to it, in order; `value` is the result.
 */
export interface FormulaNode extends TraceNodeBase {
  readonly kind: 'formula';
  readonly value: TraceValue;
  readonly children: readonly TraceNode[];
}

/** A named input value, optionally linked to the entity it came from. */
export interface InputNode extends TraceNodeBase {
  readonly kind: 'input';
  readonly value: TraceValue;
  readonly ref?: EntityRef;
}

/** A fixed number that is deliberately not tunable, with the reason it is fixed. */
export interface ConstantNode extends TraceNodeBase {
  readonly kind: 'constant';
  readonly value: number;
  readonly reason: string;
}

/** A balance number read from the tunables registry, with its default and override state. */
export interface TunableNode extends TraceNodeBase {
  readonly kind: 'tunable';
  readonly key: string;
  readonly value: TunableRawValue;
  readonly defaultValue: TunableRawValue;
  /** True when the save sets this tunable, even to its default value or to 0. */
  readonly overridden: boolean;
}

/**
 * The arithmetic step kinds. `power` raises the running value to the operand: `after = before **
 * operand`.
 */
export type ArithmeticKind = 'add' | 'subtract' | 'multiply' | 'divide' | 'power';

/** One arithmetic step: `after = before (op) operand`. `value` equals `after`. */
export interface ArithmeticNode extends TraceNodeBase {
  readonly kind: ArithmeticKind;
  readonly value: number;
  readonly operand: number;
  readonly before: number;
  readonly after: number;
  /** Why this modifier applies, in plain English. */
  readonly reason?: string;
  /**
   * Read time only: the unit `before` is in, when this step turns the running value into the
   * calculation's unit (a crowd count times a price per head). `withStepUnits` fills it in; the
   * builder never records it and the save schema does not accept it.
   */
  readonly beforeUnit?: TraceUnit;
  /**
   * Read time only: the unit of `operand` on such a step, when it is not a plain factor (the price
   * per head). Filled in by `withStepUnits` like `beforeUnit`.
   */
  readonly operandUnit?: TraceUnit;
}

/**
 * A one-sided limit, named after the maths function it applies. `min` is a ceiling
 * (`Math.min(before, limit)`), `max` is a floor (`Math.max(before, limit)`). Always recorded, with
 * `applied: false` when the limit was checked but did not change the value.
 */
export interface LimitNode extends TraceNodeBase {
  readonly kind: 'min' | 'max';
  readonly value: number;
  readonly limit: number;
  readonly before: number;
  readonly after: number;
  readonly applied: boolean;
}

/** A two-sided limit. Always recorded, with `applied: false` when the value was already in range. */
export interface ClampNode extends TraceNodeBase {
  readonly kind: 'clamp';
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly before: number;
  readonly after: number;
  readonly applied: boolean;
}

/** How a round step rounds: to nearest (halves go up), down or up. */
export type RoundMode = 'round' | 'floor' | 'ceil';

/** A rounding step. */
export interface RoundNode extends TraceNodeBase {
  readonly kind: 'round';
  readonly value: number;
  readonly mode: RoundMode;
  readonly before: number;
  readonly after: number;
}

/** A random roll, with its stream, odds and result. `value` equals the roll's result. */
export interface RollNode extends TraceNodeBase {
  readonly kind: 'roll';
  readonly value: number | boolean | string;
  readonly roll: RollRecord;
}

/** A condition that was checked, and whether its branch was taken. `value` equals `taken`. */
export interface BranchNode extends TraceNodeBase {
  readonly kind: 'branch';
  readonly value: boolean;
  readonly condition: string;
  readonly taken: boolean;
}

/** One option a decision weighed, with its score. */
export interface ConsideredOption {
  readonly option: string | boolean;
  readonly score: number;
  readonly reason?: string;
}

/** A non-numeric choice: the option chosen, why, and every alternative considered with its score. */
export interface DecisionNode extends TraceNodeBase {
  readonly kind: 'decision';
  readonly value: string | boolean;
  readonly chosen: string | boolean;
  /** Why this option was chosen, in plain English. */
  readonly reason: string;
  /** The options weighed, in the order they were considered. */
  readonly considered: readonly ConsideredOption[];
}

/**
 * Text only: the label is the note. A note that stands in for steps cut by the size limits carries
 * `hiddenSteps` (how many nodes are not shown) and, inside a numeric formula, the running value
 * after the hidden steps; any other note has a `null` value.
 */
export interface NoteNode extends TraceNodeBase {
  readonly kind: 'note';
  readonly value: number | null;
  readonly hiddenSteps?: number;
}

/** One node of a calculation trace. `kind` is the discriminant. */
export type TraceNode =
  | FormulaNode
  | InputNode
  | ConstantNode
  | TunableNode
  | ArithmeticNode
  | LimitNode
  | ClampNode
  | RoundNode
  | RollNode
  | BranchNode
  | DecisionNode
  | NoteNode;

/** Every node kind. */
export type TraceNodeKind = TraceNode['kind'];

/** Picks the union members whose `kind` covers `K`, narrowed to that kind. */
type NodesWithKind<Node extends TraceNode, K extends TraceNodeKind> = Node extends unknown
  ? K extends Node['kind']
    ? Node & { readonly kind: K }
    : never
  : never;

/**
 * The node type of one kind: `TraceNodeOfKind<'clamp'>` is {@link ClampNode}, and
 * `TraceNodeOfKind<'min'>` is a {@link LimitNode} whose kind is `'min'`.
 */
export type TraceNodeOfKind<K extends TraceNodeKind> = NodesWithKind<TraceNode, K>;

/** Every node kind, in the order the calculation traces doc lists them. */
export const TRACE_NODE_KINDS: readonly TraceNodeKind[] = [
  'formula',
  'input',
  'constant',
  'tunable',
  'add',
  'subtract',
  'multiply',
  'divide',
  'power',
  'min',
  'max',
  'clamp',
  'round',
  'roll',
  'branch',
  'decision',
  'note',
];
