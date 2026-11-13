/**
 * The decision builder: traces for choices that are not arithmetic, such as a computer GM's pick, who
 * wins a match, or a yes/no outcome.
 *
 * ```ts
 * const pick = startDecision<'retain' | 'change'>('Title decision')
 *   .rule('Champion is fit to defend', true)
 *   .consider('retain', retainScore, 'Reign is still drawing')
 *   .consider('change', changeScore)
 *   .choose('retain', 'Keeping the title scored higher');
 * ```
 */

import { InvalidArgumentError } from '../errors';
import type { RollRecord } from '../rng/rolls';
import type { TunableDefinitions, TunableValue } from '../tunables/define';
import type { TunableReader } from '../tunables/resolver';
import { assertFiniteNumber, withoutNegativeZero } from './helpers';
import { createTraceBudget, type TraceBudget } from './limits';
import { tunableNode } from './tunable-node';
import type { ConsideredOption, DecisionNode, TraceNode, Traced } from './types';

/** Options for {@link startDecision}. */
export interface DecisionOptions {
  /** Design doc anchor for the decision rule. */
  docRef?: string;
}

/** A choice in the making. Every method but `tunable` and `choose` returns the same builder. */
export interface Decision<T extends string | boolean> {
  /**
   * Weighs an option with its score. Options keep the order they were considered in; a traced
   * score is embedded as a child. Considering the same option twice throws.
   */
  consider(option: T, score: Traced<number> | number, reason?: string): Decision<T>;
  /** Records a rule that was checked, and whether it passed. */
  rule(text: string, passed: boolean): Decision<T>;
  /** Records a random roll that fed the decision. */
  roll(record: RollRecord): Decision<T>;
  /** Records a line of text. */
  note(text: string): Decision<T>;
  /**
   * Nests another trace, numeric or not (a sub-decision, a calculation), as a child under `label`.
   * Use it for a choice made inside this one, such as a challenger pick inside a match's decision.
   */
  include(label: string, traced: Traced<string | number | boolean> | TraceNode): Decision<T>;
  /** Reads a tunable, records it as a child and returns its value. */
  tunable<Defs extends TunableDefinitions, Key extends keyof Defs & string>(
    reader: TunableReader<Defs>,
    key: Key,
    label?: string,
  ): TunableValue<Defs[Key]>;
  /**
   * The chosen option and its trace. When any options were considered, `option` must be one of
   * them. The builder can keep going afterwards; `choose` takes a snapshot.
   */
  choose(option: T, because: string): Traced<T>;
}

class DecisionBuilder<T extends string | boolean> implements Decision<T> {
  readonly #label: string;
  readonly #options: DecisionOptions;
  readonly #budget: TraceBudget = createTraceBudget();
  readonly #steps: TraceNode[] = [];
  readonly #considered: ConsideredOption[] = [];

  constructor(label: string, options: DecisionOptions) {
    this.#label = label;
    this.#options = options;
  }

  consider(option: T, score: Traced<number> | number, reason?: string): Decision<T> {
    if (this.#considered.some((entry) => entry.option === option)) {
      throw new InvalidArgumentError(
        'Decision.consider',
        'option',
        option,
        'an option not already considered',
      );
    }
    const scoreValue = withoutNegativeZero(typeof score === 'number' ? score : score.value);
    assertFiniteNumber('Decision.consider', 'score', scoreValue);
    this.#considered.push({
      option,
      score: scoreValue,
      ...(reason === undefined ? {} : { reason }),
    });
    if (typeof score !== 'number') {
      this.#record(score.trace);
    }
    return this;
  }

  rule(text: string, passed: boolean): Decision<T> {
    this.#record({ kind: 'branch', label: text, value: passed, condition: text, taken: passed });
    return this;
  }

  roll(record: RollRecord): Decision<T> {
    this.#record({ kind: 'roll', label: record.label, value: record.result, roll: { ...record } });
    return this;
  }

  note(text: string): Decision<T> {
    this.#record({ kind: 'note', label: text, value: null });
    return this;
  }

  include(label: string, traced: Traced<string | number | boolean> | TraceNode): Decision<T> {
    const node = 'trace' in traced ? traced.trace : traced;
    this.#record({ ...node, label });
    return this;
  }

  tunable<Defs extends TunableDefinitions, Key extends keyof Defs & string>(
    reader: TunableReader<Defs>,
    key: Key,
    label?: string,
  ): TunableValue<Defs[Key]> {
    const value = reader.get(key);
    this.#record(tunableNode(reader, key, label));
    return value;
  }

  choose(option: T, because: string): Traced<T> {
    if (this.#considered.length > 0 && !this.#considered.some((entry) => entry.option === option)) {
      throw new InvalidArgumentError(
        'Decision.choose',
        'option',
        option,
        'one of the options considered',
      );
    }
    const children = this.#budget.finish(this.#steps, null);
    const trace: DecisionNode = {
      kind: 'decision',
      label: this.#label,
      value: option,
      chosen: option,
      reason: because,
      considered: this.#considered.map((entry) => ({ ...entry })),
      ...(this.#options.docRef === undefined ? {} : { docRef: this.#options.docRef }),
      ...(children.length === 0 ? {} : { children }),
    };
    return { value: option, trace };
  }

  #record(node: TraceNode): void {
    const placed = this.#budget.place(node);
    if (placed !== null) {
      this.#steps.push(placed);
    }
  }
}

/** Starts a decision. `T` is the option type: a string union for choices, `boolean` for yes/no. */
export function startDecision<T extends string | boolean>(
  label: string,
  options: DecisionOptions = {},
): Decision<T> {
  return new DecisionBuilder<T>(label, options);
}
