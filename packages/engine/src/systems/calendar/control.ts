/**
 * Who controls a show (design decisions D-06 and D-07).
 *
 * A show belongs to a promotion and, sometimes, to one of its brands. A brand with its own
 * controller is run by that controller (a GM in a brand war, or a second seat); every other show is
 * run by the promotion's controller. This is the one place that rule lives: commands, gates and
 * screens that need to know whose show it is call these helpers and never read the two
 * `controller` fields themselves.
 *
 * Design notes: docs/design/calendar.md#who-controls-a-show.
 */

import { sameController, type Viewer } from '../../core/api/controller';
import { EntityNotFoundError } from '../../core/errors';
import type { Controller } from '../../model/controller';
import type { EventInstance } from '../../model/entities/event-instance';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';

/** The part of a show that decides who controls it. */
export type ShowOwnership = DeepReadonly<Pick<EventInstance, 'promotionId' | 'brandId'>>;

/**
 * The controller that runs `show`: its brand's controller when the show has a brand and that brand
 * has a controller of its own, otherwise its promotion's controller.
 *
 * @throws EntityNotFoundError when the show's promotion is not in the world.
 */
export function showControllerOf(read: GameWorldView, show: ShowOwnership): Controller {
  if (show.brandId !== null) {
    const brandController = read.tables.brands.get(show.brandId)?.controller ?? null;
    if (brandController !== null) {
      return brandController;
    }
  }
  const promotion = read.tables.promotions.get(show.promotionId);
  if (promotion === undefined) {
    throw new EntityNotFoundError('promotions', show.promotionId);
  }
  return promotion.controller;
}

/** The one controller rule (`core/api/controller.ts`), re-exported where calendar callers look. */
export { sameController };

/** True when `controller` is the one that runs `show`. */
export function controlsShow(
  read: GameWorldView,
  show: ShowOwnership,
  controller: DeepReadonly<Controller>,
): boolean {
  return sameController(showControllerOf(read, show), controller);
}

/**
 * True when the viewer runs `show`. The omniscient viewer sees every show and runs none, so it
 * always gets false.
 */
export function viewerControlsShow(
  read: GameWorldView,
  show: ShowOwnership,
  viewer: DeepReadonly<Viewer>,
): boolean {
  return viewer.kind === 'controller' && controlsShow(read, show, viewer.controller);
}
