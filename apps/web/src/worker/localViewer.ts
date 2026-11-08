import { controllerViewer } from '@ringside/engine';
import type { Controller, EngineState, PromotionId, Viewer } from '@ringside/engine';

/**
 * Who this device plays as: the viewer every query runs for, the controller every command is
 * issued by, and the promotion that controller runs (null while unemployed, observing or in a
 * sandbox). The engine host works it out when a world is installed and injects it into every call,
 * so no screen or hook ever handles a viewer or a controller.
 *
 * `viewer` is always `{ kind: 'controller', controller }` for the same controller, never the
 * omniscient viewer: a seat in a game only sees what its promotion would know.
 */
export interface LocalSeat {
  readonly viewer: Viewer;
  readonly controller: Controller;
  readonly promotionId: PromotionId | null;
}

/** The player id of the local seat in a world that has no human controller at all. */
export const LOCAL_OBSERVER_PLAYER_ID = 'local';

export interface ResolvedLocalViewer {
  readonly seat: LocalSeat;
  /** Things worth logging about the choice, such as a save with several human players. */
  readonly warnings: string[];
}

/** Code-unit order, so the choice never depends on the browser's locale. */
function compareCodeUnits(first: string, second: string): number {
  if (first < second) return -1;
  if (first > second) return 1;
  return 0;
}

/**
 * Picks the local seat from the `controller` fields of the state's promotion and brand rows.
 *
 * - One human player id across those rows: that human. Their promotion is the first (lowest ID)
 *   promotion whose own controller is that human, or else the first promotion owning a brand
 *   that human controls, or null.
 * - No human controller: an observer seat, `{ kind: 'human', playerId: 'local' }`, with no
 *   promotion (an unemployed start or a sandbox).
 * - Several human player ids (a multiplayer save): the lowest player id, with a warning. Picking
 *   a seat belongs to multiplayer, where the server assigns it; this is the only function that
 *   changes then.
 *
 * It reads plain state data only. For a human who runs a promotion through its own controller,
 * the promotion agrees with the engine's `viewerPromotionIds` (its first ID).
 */
export function resolveLocalViewer(state: EngineState): ResolvedLocalViewer {
  const { promotions, brands } = state.world.tables;
  const humanPlayerIds = new Set<string>();
  for (const promotion of promotions) {
    if (promotion.controller.kind === 'human') humanPlayerIds.add(promotion.controller.playerId);
  }
  for (const brand of brands) {
    if (brand.controller?.kind === 'human') humanPlayerIds.add(brand.controller.playerId);
  }

  const sortedPlayerIds = [...humanPlayerIds].sort(compareCodeUnits);
  const [chosenPlayerId] = sortedPlayerIds;
  if (chosenPlayerId === undefined) {
    const observer: Controller = { kind: 'human', playerId: LOCAL_OBSERVER_PLAYER_ID };
    return {
      seat: { viewer: controllerViewer(observer), controller: observer, promotionId: null },
      warnings: [],
    };
  }

  const warnings: string[] = [];
  if (sortedPlayerIds.length > 1) {
    warnings.push(
      `This save has ${String(sortedPlayerIds.length)} human players ` +
        `(${sortedPlayerIds.join(', ')}). Playing as "${chosenPlayerId}" until seats can be chosen.`,
    );
  }

  const isChosenHuman = (controller: Controller | null): boolean =>
    controller?.kind === 'human' && controller.playerId === chosenPlayerId;
  const ownPromotionIds = promotions
    .filter((promotion) => isChosenHuman(promotion.controller))
    .map((promotion) => promotion.id)
    .sort(compareCodeUnits);
  const brandPromotionIds = brands
    .filter((brand) => isChosenHuman(brand.controller))
    .map((brand) => brand.promotionId)
    .sort(compareCodeUnits);
  const promotionId = ownPromotionIds[0] ?? brandPromotionIds[0] ?? null;

  const controller: Controller = { kind: 'human', playerId: chosenPlayerId };
  return {
    seat: { viewer: controllerViewer(controller), controller, promotionId },
    warnings,
  };
}
