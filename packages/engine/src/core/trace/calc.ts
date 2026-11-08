/**
 * The calculation builder: computes a number and records its trace in the same fluent chain.
 *
 * ```ts
 * const calc = startCalc('Fatigue after rest', inputOf('Fatigue before rest', fatigue));
 * return calc
 *   .subtract('Rest', calc.tunable(tunables, 'condition.restRecovery'))
 *   .clamp(0, 100)
 *   .done();
 * ```
 *
 * The arithmetic is the trace: every step updates the running value and records a node with the
 * value before and after it, so the two cannot drift apart. `replayTrace` re-runs the recorded
 * steps to prove it.
 */

import { InvalidArgumentError } from '../errors';
import type { RollRecord } from '../rng/rolls';
import type { TunableDefinitions, TunableValue } from '../tunables/define';
import type { TunableReader } from '../tunables/resolver';
import { assertFiniteNumber, roundByMode, withoutNegativeZero } from './helpers';
import { createTraceBudget, type TraceBudget } from './limits';
import { tunableNode } from './tunable-node';
import type {
  ArithmeticKind,
  ArithmeticNode,
  ClampNode,
  FormulaNode,
  InputNode,
  LimitNode,
  RoundMode,
  RoundNode,
  TraceNode,
  TraceUnit,
  Traced,
} from './types';

/** Options for {@link startCalc}. */
export interface CalcOptions {
  /** What the result measures. Recorded on the root and on a plain-number starting value. */
  unit?: TraceUnit;
  /** Design doc anchor for the formula, for example `condition.md#recovery`. */
  docRef?: string;
  /** Label for a plain-number starting value. Defaults to "Starting value". */
  startLabel?: string;
}

/** A number in the making. Every method but `tunable` and `done` returns the same builder. */
export interface Calc {
  /** The running value after the steps so far, for branching inside a formula. */
  readonly current: number;
  /** Adds `amount`. A traced amount is embedded as the step's children. */
  add(label: string, amount: number | Traced<number>, reason?: string): Calc;
  /** Subtracts `amount`. A traced amount is embedded as the step's children. */
  subtract(label: string, amount: number | Traced<number>, reason?: string): Calc;
  /** Multiplies by `factor`. A traced factor is embedded as the step's children. */
  multiply(label: string, factor: number | Traced<number>, reason?: string): Calc;
  /** Divides by `divisor`. Throws `InvalidArgumentError` when the divisor is 0. */
  divide(label: string, divisor: number | Traced<number>, reason?: string): Calc;
  /** A ceiling: the value becomes `Math.min(value, limit)`. Recorded even when it does not bite. */
  min(label: string, limit: number | Traced<number>): Calc;
  /** A floor: the value becomes `Math.max(value, limit)`. Recorded even when it does not bite. */
  max(label: string, limit: number | Traced<number>): Calc;
  /** Keeps the value within `min`..`max` (both included). Recorded even when it does not bite. */
  clamp(min: number, max: number, label?: string): Calc;
  /** Rounds to the nearest whole number (halves go up), down (`floor`) or up (`ceil`). */
  round(mode: RoundMode, label?: string): Calc;
  /**
   * Reads a tunable and returns its value. The read is recorded as a `tunable` node (with its
   * default and override state) under the next step, so pass the value straight into that step:
   * `calc.multiply('Rest rate', calc.tunable(tunables, 'condition.restRate'))`.
   * `label` defaults to the tunable's description.
   */
  tunable<Defs extends TunableDefinitions, Key extends keyof Defs & string>(
    reader: TunableReader<Defs>,
    key: Key,
    label?: string,
  ): TunableValue<Defs[Key]>;
  /** Records a random roll. Use the roll's value in a later step. */
  roll(record: RollRecord): Calc;
  /** Records a line of text. */
  note(text: string): Calc;
  /** Records a condition that was checked, and whether its branch was taken. */
  branch(condition: string, taken: boolean): Calc;
  /** The result and its trace. The builder can keep going afterwards; `done` takes a snapshot. */
  done(): Traced<number>;
}

const DEFAULT_START_LABEL = 'Starting value';

const ROUND_LABELS: Readonly<Record<RoundMode, string>> = {
  round: 'Rounded',
  floor: 'Rounded down',
  ceil: 'Rounded up',
};

function isTraced(amount: number | Traced<number>): amount is Traced<number> {
  return typeof amount !== 'number';
}

function applyArithmetic(kind: ArithmeticKind, before: number, operand: number): number {
  switch (kind) {
    case 'add':
      return before + operand;
    case 'subtract':
      return before - operand;
    case 'multiply':
      return before * operand;
    case 'divide':
      return before / operand;
  }
}

class CalcBuilder implements Calc {
  readonly #label: string;
  readonly #options: CalcOptions;
  readonly #budget: TraceBudget = createTraceBudget();
  readonly #steps: TraceNode[] = [];
  /** Tunable reads waiting to be attached to the next step. */
  #pending: TraceNode[] = [];
  #current: number;

  constructor(label: string, initial: number | Traced<number>, options: CalcOptions) {
    this.#label = label;
    this.#options = options;
    if (isTraced(initial)) {
      assertFiniteNumber('startCalc', 'initial.value', initial.value);
      this.#current = withoutNegativeZero(initial.value);
      this.#record(initial.trace);
    } else {
      assertFiniteNumber('startCalc', 'initial', initial);
      this.#current = withoutNegativeZero(initial);
      const start: InputNode = {
        kind: 'input',
        label: options.startLabel ?? DEFAULT_START_LABEL,
        value: this.#current,
        ...(options.unit === undefined ? {} : { unit: options.unit }),
      };
      this.#record(start);
    }
  }

  get current(): number {
    return this.#current;
  }

  add(label: string, amount: number | Traced<number>, reason?: string): Calc {
    return this.#arithmetic('add', label, amount, reason);
  }

  subtract(label: string, amount: number | Traced<number>, reason?: string): Calc {
    return this.#arithmetic('subtract', label, amount, reason);
  }

  multiply(label: string, factor: number | Traced<number>, reason?: string): Calc {
    return this.#arithmetic('multiply', label, factor, reason);
  }

  divide(label: string, divisor: number | Traced<number>, reason?: string): Calc {
    const operand = isTraced(divisor) ? divisor.value : divisor;
    if (operand === 0) {
      throw new InvalidArgumentError('Calc.divide', 'divisor', operand, 'a number other than 0');
    }
    return this.#arithmetic('divide', label, divisor, reason);
  }

  min(label: string, limit: number | Traced<number>): Calc {
    return this.#limit('min', label, limit);
  }

  max(label: string, limit: number | Traced<number>): Calc {
    return this.#limit('max', label, limit);
  }

  clamp(min: number, max: number, label?: string): Calc {
    assertFiniteNumber('Calc.clamp', 'min', min);
    assertFiniteNumber('Calc.clamp', 'max', max);
    if (min > max) {
      throw new InvalidArgumentError('Calc.clamp', 'min', min, `at most max (${String(max)})`);
    }
    const before = this.#current;
    const after = withoutNegativeZero(Math.min(Math.max(before, min), max));
    const node: ClampNode = {
      kind: 'clamp',
      label: label ?? `Kept between ${String(min)} and ${String(max)}`,
      value: after,
      min: withoutNegativeZero(min),
      max: withoutNegativeZero(max),
      before,
      after,
      applied: after !== before,
    };
    this.#current = after;
    this.#record(node);
    return this;
  }

  round(mode: RoundMode, label?: string): Calc {
    const before = this.#current;
    const after = withoutNegativeZero(roundByMode(mode, before));
    const node: RoundNode = {
      kind: 'round',
      label: label ?? ROUND_LABELS[mode],
      value: after,
      mode,
      before,
      after,
    };
    this.#current = after;
    this.#record(node);
    return this;
  }

  tunable<Defs extends TunableDefinitions, Key extends keyof Defs & string>(
    reader: TunableReader<Defs>,
    key: Key,
    label?: string,
  ): TunableValue<Defs[Key]> {
    const value = reader.get(key);
    this.#pending.push(tunableNode(reader, key, label));
    return value;
  }

  roll(record: RollRecord): Calc {
    this.#record({ kind: 'roll', label: record.label, value: record.result, roll: { ...record } });
    return this;
  }

  note(text: string): Calc {
    this.#record({ kind: 'note', label: text, value: null });
    return this;
  }

  branch(condition: string, taken: boolean): Calc {
    this.#record({ kind: 'branch', label: condition, value: taken, condition, taken });
    return this;
  }

  done(): Traced<number> {
    // Tunables read but never passed to a step are still part of the story; record them as steps.
    const unusedReads = this.#pending;
    this.#pending = [];
    for (const read of unusedReads) {
      this.#record(read);
    }
    const trace: FormulaNode = {
      kind: 'formula',
      label: this.#label,
      value: this.#current,
      ...(this.#options.unit === undefined ? {} : { unit: this.#options.unit }),
      ...(this.#options.docRef === undefined ? {} : { docRef: this.#options.docRef }),
      children: this.#budget.finish(this.#steps, this.#current),
    };
    return { value: this.#current, trace };
  }

  #arithmetic(
    kind: ArithmeticKind,
    label: string,
    amount: number | Traced<number>,
    reason: string | undefined,
  ): Calc {
    const functionName = `Calc.${kind}`;
    const operand = withoutNegativeZero(isTraced(amount) ? amount.value : amount);
    assertFiniteNumber(functionName, 'amount', operand);
    const before = this.#current;
    const after = withoutNegativeZero(applyArithmetic(kind, before, operand));
    if (!Number.isFinite(after)) {
      throw new InvalidArgumentError(functionName, 'result', after, 'a finite number');
    }
    const node: ArithmeticNode = {
      kind,
      label,
      value: after,
      operand,
      before,
      after,
      ...(reason === undefined ? {} : { reason }),
      ...(isTraced(amount) ? { children: [amount.trace] } : {}),
    };
    this.#current = after;
    this.#record(node);
    return this;
  }

  #limit(kind: 'min' | 'max', label: string, limit: number | Traced<number>): Calc {
    const limitValue = withoutNegativeZero(isTraced(limit) ? limit.value : limit);
    assertFiniteNumber(`Calc.${kind}`, 'limit', limitValue);
    const before = this.#current;
    const after = withoutNegativeZero(
      kind === 'min' ? Math.min(before, limitValue) : Math.max(before, limitValue),
    );
    const node: LimitNode = {
      kind,
      label,
      value: after,
      limit: limitValue,
      before,
      after,
      applied: after !== before,
      ...(isTraced(limit) ? { children: [limit.trace] } : {}),
    };
    this.#current = after;
    this.#record(node);
    return this;
  }

  /** Records a step, attaching any pending tunable reads as its first children. */
  #record(node: TraceNode): void {
    const withReads: TraceNode =
      this.#pending.length === 0
        ? node
        : { ...node, children: [...this.#pending, ...(node.children ?? [])] };
    this.#pending = [];
    const placed = this.#budget.place(withReads);
    if (placed !== null) {
      this.#steps.push(placed);
    }
  }
}

/**
 * Starts a calculation from `initial`. A plain number becomes an `input` node labelled
 * `options.startLabel`; a traced number brings its own trace, which becomes the first child.
 */
export function startCalc(
  label: string,
  initial: number | Traced<number>,
  options: CalcOptions = {},
): Calc {
  return new CalcBuilder(label, initial, options);
}
