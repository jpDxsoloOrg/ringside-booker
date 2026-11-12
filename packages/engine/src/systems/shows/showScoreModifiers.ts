/**
 * The show score modifier seam: how later features add lines to a show's score without editing
 * the formula (docs/design/show-night.md#seams).
 *
 * A modifier has a stage. `adjust` modifiers (D-04 card flow) run before the score is kept within
 * 0..100 and rounded, so they are part of the raw score. `cap` modifiers (EVT4's production
 * ceiling) run after it, so the result keeps both the raw and the final score.
 *
 * `gather` runs in the shows phase and may read the world; whatever it returns is put in
 * `inputs.extras[id]`, so `apply` stays pure and its lines replay.
 */

import { RegistryError } from '../../core/errors';
import type { JsonValue } from '../../core/json';
import type { Calc } from '../../core/trace';
import type { EventInstance } from '../../model/entities/event-instance';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { PHASE_ID_PATTERN } from '../../core/pipeline/phase';
import type { EngineTunables } from '../tunables';
import type { ShowScoreInputs } from './formulas/showScore';

/** When a modifier runs: before the raw score is fixed (`adjust`) or after it (`cap`). */
export const SHOW_SCORE_MODIFIER_STAGES = ['adjust', 'cap'] as const;
export type ShowScoreModifierStage = (typeof SHOW_SCORE_MODIFIER_STAGES)[number];

/** What a system writes to add lines to every show's score. */
export interface ShowScoreModifier {
  /** `system.camelName`, like a phase id, for example `evt.cardFlow`. */
  readonly id: string;
  readonly stage: ShowScoreModifierStage;
  /** Position within the stage; lower runs first. Equal orders run by id. */
  readonly order: number;
  /** Reads what `apply` needs from the world, in the shows phase. Must return plain JSON. */
  readonly gather?: (read: GameWorldView, show: DeepReadonly<EventInstance>) => JsonValue;
  /**
   * Adds the modifier's lines to the show score. Pure: it reads only its arguments, and `extra`
   * is what `gather` returned (undefined without a `gather`).
   */
  readonly apply: (
    calc: Calc,
    inputs: ShowScoreInputs,
    extra: JsonValue | undefined,
    deps: { tunables: EngineTunables },
  ) => void;
}

const registry = new Map<string, ShowScoreModifier>();

function compareModifiers(left: ShowScoreModifier, right: ShowScoreModifier): number {
  const stageDifference =
    SHOW_SCORE_MODIFIER_STAGES.indexOf(left.stage) -
    SHOW_SCORE_MODIFIER_STAGES.indexOf(right.stage);
  if (stageDifference !== 0) {
    return stageDifference;
  }
  if (left.order !== right.order) {
    return left.order - right.order;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
}

/** The modifiers in the order they run: by stage (`adjust` first), then `order`, then id. */
export function sortShowScoreModifiers(
  modifiers: readonly ShowScoreModifier[],
): ShowScoreModifier[] {
  return [...modifiers].sort(compareModifiers);
}

/**
 * Adds a show score modifier.
 *
 * @throws RegistryError for a malformed id, an unknown stage, an order that is not a finite
 *   number, or an id that is already registered.
 */
export function registerShowScoreModifier(def: ShowScoreModifier): void {
  const fail = (message: string): never => {
    throw new RegistryError(`Show score modifier "${def.id}": ${message}`, { modifierId: def.id });
  };
  if (!PHASE_ID_PATTERN.test(def.id)) {
    fail('the id must look like "system.camelName", for example "evt.cardFlow"');
  }
  if (!SHOW_SCORE_MODIFIER_STAGES.includes(def.stage)) {
    fail('the stage must be "adjust" or "cap"');
  }
  if (!Number.isFinite(def.order)) {
    fail('the order must be a finite number');
  }
  if (registry.has(def.id)) {
    fail('a modifier with this id is already registered');
  }
  registry.set(def.id, { ...def });
}

/** Every registered modifier, in the order they run. */
export function listShowScoreModifiers(): ShowScoreModifier[] {
  return sortShowScoreModifiers([...registry.values()]);
}

/** Removes a modifier. For tests. Returns false when no modifier had that id. */
export function unregisterShowScoreModifier(id: string): boolean {
  return registry.delete(id);
}
