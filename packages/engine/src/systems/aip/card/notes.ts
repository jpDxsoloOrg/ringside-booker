/**
 * Booker's notes: the lines of a planned segment's decision, written down while the segment is
 * being built and copied into a decision once its matchup (the decision's label) is known.
 */

import type { RollRecord } from '../../../core/rng/rolls';
import { startDecision, type Decision, type Traced, type TraceNode } from '../../../core/trace';

type Line =
  | { readonly kind: 'note'; readonly text: string }
  | { readonly kind: 'rule'; readonly text: string; readonly passed: boolean }
  | { readonly kind: 'roll'; readonly record: RollRecord }
  | {
      readonly kind: 'include';
      readonly label: string;
      readonly traced: Traced<string | number | boolean> | TraceNode;
    }
  | {
      readonly kind: 'consider';
      readonly option: string;
      readonly score: number;
      readonly reason: string | undefined;
    };

export class BookerNotes {
  readonly #lines: Line[] = [];

  note(text: string): this {
    this.#lines.push({ kind: 'note', text });
    return this;
  }

  rule(text: string, passed: boolean): this {
    this.#lines.push({ kind: 'rule', text, passed });
    return this;
  }

  roll(record: RollRecord): this {
    this.#lines.push({ kind: 'roll', record });
    return this;
  }

  include(label: string, traced: Traced<string | number | boolean> | TraceNode): this {
    this.#lines.push({ kind: 'include', label, traced });
    return this;
  }

  /** Weighs an option; considering the same option twice keeps the first. */
  consider(option: string, score: number, reason?: string): this {
    if (!this.#lines.some((line) => line.kind === 'consider' && line.option === option)) {
      this.#lines.push({ kind: 'consider', option, score, reason });
    }
    return this;
  }

  /** The lines so far, for a copy that tries something and may be thrown away. */
  fork(): BookerNotes {
    const copy = new BookerNotes();
    copy.#lines.push(...this.#lines);
    return copy;
  }

  /** The decision `label` with these lines, choosing `option` because `because`. */
  decide(label: string, option: string, because: string, docRef: string): Traced<string> {
    const decision: Decision<string> = startDecision<string>(label, { docRef });
    let considered = false;
    for (const line of this.#lines) {
      switch (line.kind) {
        case 'note':
          decision.note(line.text);
          break;
        case 'rule':
          decision.rule(line.text, line.passed);
          break;
        case 'roll':
          decision.roll(line.record);
          break;
        case 'include':
          decision.include(line.label, line.traced);
          break;
        case 'consider':
          considered = true;
          decision.consider(line.option, line.score, line.reason);
          break;
      }
    }
    if (
      considered &&
      !this.#lines.some((line) => line.kind === 'consider' && line.option === option)
    ) {
      decision.consider(option, 0, 'Chosen without a roll');
    }
    return decision.choose(option, because);
  }
}
