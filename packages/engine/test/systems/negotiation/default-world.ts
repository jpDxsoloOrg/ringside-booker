/**
 * The shipped default world as a plain world view, for the ECO5-02 calibration test: a new game
 * played as Altura (the flagship), with the default tunables.
 */

import type { PromotionId } from '../../../src/core/ids';
import { TABLES, type GameWorld } from '../../../src/model/tables';
import { documentToWorld } from '../../../src/persistence/world-document';
import { loadEngineTunables, type EngineTunables } from '../../../src/systems/tunables';
import { startDefaultGame } from '../calendar/default-game';

export interface DefaultWorld {
  readonly world: GameWorld;
  readonly tunables: EngineTunables;
  /** Promotion id by content key, for example `pro-flagship`. */
  promotion(key: string): PromotionId;
}

export function defaultWorld(seed = 'negotiation-calibration'): DefaultWorld {
  const state = startDefaultGame({ seed });
  const world = documentToWorld({ state: { world: state.world } }, TABLES);
  const keys = world.meta.contentKeys['promotion'] ?? {};
  return {
    world,
    tunables: loadEngineTunables({}).reader,
    promotion(key) {
      const id = keys[key];
      if (id === undefined) {
        throw new Error(`default world: no promotion ${key}`);
      }
      return id as PromotionId;
    },
  };
}
