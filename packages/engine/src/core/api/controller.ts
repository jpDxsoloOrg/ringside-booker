/**
 * Who issues commands and who reads queries (design decision D-07).
 *
 * `Controller` is defined once, in `model/controller.ts`, next to the `controller` field of
 * promotions and brands; the API re-exports it and never declares its own. A command names the
 * controller that issued it. A query runs for a {@link Viewer}: a controller, or the all-seeing
 * view that tools, tests and the sandbox setting use.
 *
 * Single-player is one human controller. The engine never stores or reads a global "player
 * promotion": which promotion a human runs is only ever read from the `controller` field of the
 * promotion rows, which the new-game command sets. {@link viewerPromotionIds} is the one place
 * that lookup happens.
 */

import { z } from 'zod';
import type { PromotionId } from '../ids';
import { ControllerSchema, type Controller } from '../../model/controller';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';

export { ControllerSchema, type Controller };

/** A query's viewer: someone running promotions, or everything visible. */
export const ViewerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('controller'), controller: ControllerSchema }),
  /** Sees everything. For tools, tests and the sandbox setting, never for a seat in a game. */
  z.strictObject({ kind: z.literal('omniscient') }),
]);

/** Who a query runs for. */
export type Viewer = z.infer<typeof ViewerSchema>;

/** The all-seeing viewer. */
export const OMNISCIENT_VIEWER: Viewer = Object.freeze({ kind: 'omniscient' });

/** The viewer for a controller. */
export function controllerViewer(controller: Controller): Viewer {
  return { kind: 'controller', controller };
}

/**
 * The promotions the viewer runs: every promotion whose `controller` is the same human (`kind:
 * 'human'` and the same `playerId`), in ascending ID order. A computer controller and the
 * omniscient viewer run no promotion and get `[]`. A human can run several (brand wars, or a
 * promotion and its development territory); screens that need one take the first.
 */
export function viewerPromotionIds(read: GameWorldView, viewer: Viewer): PromotionId[] {
  if (viewer.kind !== 'controller' || viewer.controller.kind !== 'human') {
    return [];
  }
  const { playerId } = viewer.controller;
  return read.tables.promotions
    .values()
    .filter(
      (promotion) =>
        promotion.controller.kind === 'human' && promotion.controller.playerId === playerId,
    )
    .map((promotion) => promotion.id);
}

/** True when both are the computer, or both are the same human player. */
export function sameController(
  left: DeepReadonly<Controller>,
  right: DeepReadonly<Controller>,
): boolean {
  if (left.kind === 'human' && right.kind === 'human') {
    return left.playerId === right.playerId;
  }
  return left.kind === 'computer' && right.kind === 'computer';
}

/**
 * True when `controller` runs promotion `promotionId` and so may issue commands for it: the same
 * human as the promotion's `controller`, or the computer for a computer-run promotion. This is the
 * one rule every command uses (AIP1-07): the rival desk acts on its own promotions through the
 * same commands a player uses (D-01, D-07), and never on a player's. False for a promotion that
 * is not in the world.
 *
 * Queries scope by {@link viewerPromotionIds} instead, which stays human-only: a computer seat
 * reads no screens.
 */
export function controlsPromotion(
  read: GameWorldView,
  promotionId: PromotionId,
  controller: DeepReadonly<Controller>,
): boolean {
  const promotion = read.tables.promotions.get(promotionId);
  return promotion !== undefined && sameController(promotion.controller, controller);
}
