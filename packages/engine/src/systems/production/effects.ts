/**
 * The production effect seam (ECO7-02): how other features add what a production level does to
 * the production screen and the change dialog, such as the show-quality ceiling (EVT4), the angle
 * writing band (MTCH5), merch (ECO2), hype (ECO3) or viewers (ECO8).
 *
 * ECO7 owns the levels and what they cost. The feature that turns a level into something else
 * registers an effect here, in its own words and with its own Why?, so no feature edits ECO7's
 * files. ECO7 registers its own two (`builtinEffects.ts`): the popularity ceiling and the TV-deal
 * camera minimum.
 *
 * A module-level registry, like the setup steps and the policy effects: register once when the
 * registering system's `index.ts` is imported. Design: docs/design/production.md#effects.
 */

import type { GameDate } from '../../core/date';
import { RegistryError } from '../../core/errors';
import type { PromotionId } from '../../core/ids';
import { PHASE_ID_PATTERN } from '../../core/pipeline/phase';
import type { TraceNode } from '../../core/trace/types';
import {
  PRODUCTION_AREAS,
  type Production,
  type ProductionArea,
} from '../../model/entities/promotion';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';

/** One line an effect adds to an area's row and to the change dialog. */
export interface ProductionEffectLine {
  /** The effect's id. */
  id: string;
  /** What the line is about, such as "Popularity ceiling". */
  label: string;
  /** The number behind the line, or null when it has none. The change dialog needs one. */
  value: number | null;
  /** The number's unit, such as `points`, or null. */
  unit: string | null;
  /** Plain words, such as "Popularity above 30 slowly falls back". */
  text: string;
  /** How the number was worked out, or null. */
  trace: TraceNode | null;
}

/** What `describe` is handed: the levels to describe (stored, or proposed in the dialog). */
export interface ProductionEffectInput {
  promotionId: PromotionId;
  levels: Production;
  date: GameDate;
  tunables: EngineTunables;
}

/** What a feature registers to describe what production levels do. */
export interface ProductionEffect {
  /** `system.camelName`, like a phase id, for example `cardFlow.showCeiling`. */
  readonly id: string;
  /** Position among the effects of an area; lower comes first. Equal orders go by id. */
  readonly order: number;
  /** The areas whose rows show the line, and whose changes the dialog previews it for. */
  readonly areas: readonly ProductionArea[];
  /**
   * True when only the promotion's own management may see the line (it names something private,
   * such as a TV deal). Rival viewers of the production screen never get it. Default false.
   */
  readonly ownOnly?: boolean;
  /** The line for these levels, or null when there is nothing to say. Pure: reads its arguments. */
  readonly describe: (
    read: GameWorldView,
    input: ProductionEffectInput,
  ) => ProductionEffectLine | null;
}

const registry = new Map<string, ProductionEffect>();

/**
 * Adds a production effect and returns a function that removes it. Throws `RegistryError` for a
 * malformed id, no or unknown areas, an order that is not a finite number, or an id already
 * registered.
 */
export function registerProductionEffect(effect: ProductionEffect): () => void {
  const fail = (message: string): never => {
    throw new RegistryError(`Production effect "${effect.id}": ${message}`, {
      effectId: effect.id,
    });
  };
  if (!PHASE_ID_PATTERN.test(effect.id)) {
    fail('the id must look like "system.camelName", for example "cardFlow.showCeiling"');
  }
  if (effect.areas.length === 0 || effect.areas.some((area) => !PRODUCTION_AREAS.includes(area))) {
    fail(`the areas must be one or more of ${PRODUCTION_AREAS.join(', ')}`);
  }
  if (!Number.isFinite(effect.order)) {
    fail('the order must be a finite number');
  }
  if (registry.has(effect.id)) {
    fail('an effect with this id is already registered');
  }
  const stored: ProductionEffect = { ...effect, areas: Object.freeze([...effect.areas]) };
  registry.set(effect.id, stored);
  return () => {
    if (registry.get(effect.id) === stored) {
      registry.delete(effect.id);
    }
  };
}

/** Every registered effect, by order then id; only those for `area` when one is given. */
export function listProductionEffects(area?: ProductionArea): ProductionEffect[] {
  return [...registry.values()]
    .filter((effect) => area === undefined || effect.areas.includes(area))
    .sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order;
      }
      if (left.id === right.id) {
        return 0;
      }
      return left.id < right.id ? -1 : 1;
    });
}

/**
 * Removes every production effect, for tests. Returns a function that puts back the ones that
 * were registered before, so a test can leave the built-ins as it found them.
 */
export function clearProductionEffectsForTests(): () => void {
  const saved = [...registry.entries()];
  registry.clear();
  return () => {
    registry.clear();
    for (const [id, effect] of saved) {
      registry.set(id, effect);
    }
  };
}
