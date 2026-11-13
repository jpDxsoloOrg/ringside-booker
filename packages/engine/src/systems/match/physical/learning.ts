/**
 * Ring learning (MTCH4-03): which attributes a match teaches.
 *
 * The formula lives in `../formulas/ringLearning.ts`, the hidden gate in `./learningRoom.ts`, the
 * mentor lookup in `./mentor.ts` and the per-segment collector in `./collectLearning.ts`. MTCH4's
 * show-night applier writes the gains after each match.
 *
 * Design: docs/design/physical-toll.md#ring-learning.
 */

import type { AttributeKey } from '../../../model/entities/person';

/** One attribute a match teaches, and whether someone better or a teacher can teach it. */
export interface InMatchLearningEntry {
  readonly attribute: AttributeKey;
  /** Taught attributes gain from a better worker and from teachers; the rest only from practice. */
  readonly taught: boolean;
}

/**
 * The attributes a match teaches (a constant rule, not a tunable):
 *
 * - `ringwork`, `psychology` and `safety` are craft: the worker picks them up by doing and from the
 *   people they work with, so a better worker or a teacher in the match helps;
 * - `stamina` is conditioning: it comes only from doing the work, and nobody can teach it.
 *
 * Crew attributes (`officiating`, `producing`, `broadcasting`) are learned on the job in other
 * roles, and talking (`mic`) in talking segments; those belong to WRK4 and MTCH5, which can call the
 * same formula with their own list.
 */
export const IN_MATCH_LEARNING = [
  { attribute: 'ringwork', taught: true },
  { attribute: 'psychology', taught: true },
  { attribute: 'safety', taught: true },
  { attribute: 'stamina', taught: false },
] as const satisfies readonly InMatchLearningEntry[];

/** An attribute a match teaches. */
export type InMatchLearningAttribute = (typeof IN_MATCH_LEARNING)[number]['attribute'];

/** The attributes that `producerFactor` helps: how a match is laid out, not how safe it is. */
export const PRODUCED_ATTRIBUTES: readonly AttributeKey[] = ['ringwork', 'psychology'];

/**
 * Whether `attribute` can be taught: the `IN_MATCH_LEARNING` flag, and taught for an attribute
 * outside that list (a caller with its own list passes `taught` to the formula instead).
 */
export function isTaughtAttribute(attribute: AttributeKey): boolean {
  return IN_MATCH_LEARNING.find((entry) => entry.attribute === attribute)?.taught ?? true;
}
