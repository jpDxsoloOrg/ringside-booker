/**
 * The own-injury notice rule (WRK6-04): an injury to one of the player's own workers waits to be
 * noticed, so the `health.ownWorkerInjured` gate can stop the day for it once.
 *
 * The rule is decided when the injury is written (`health.injure`), because a gate cannot read
 * tunables: the gate only reads the `awaitingNotice` index. Design:
 * docs/design/health.md#own-injury-gate.
 */

import { sameController } from '../../core/api/controller';
import type { GameDate } from '../../core/date';
import type { PersonId } from '../../core/ids';
import type { Controller } from '../../model/controller';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { unitControllerOf } from '../aip/units';
import type { EngineTunables } from '../tunables';
import { activeEmploymentsOf } from '../workers/helpers/employment';

/** The controllers that run the person's employers on `date`: the brand's own, else the promotion's. */
export function employerControllersOf(
  read: GameWorldView,
  personId: PersonId,
  date: GameDate,
): Controller[] {
  const controllers: Controller[] = [];
  for (const employment of activeEmploymentsOf(read, personId, date)) {
    if (read.tables.promotions.get(employment.promotionId) === undefined) {
      continue;
    }
    controllers.push(unitControllerOf(read, employment.promotionId, employment.brandId));
  }
  return controllers;
}

/** True when a human runs one of the person's employers (or the brand they work for) on `date`. */
export function worksForAHuman(read: GameWorldView, personId: PersonId, date: GameDate): boolean {
  return employerControllersOf(read, personId, date).some((controller) => controller.kind === 'human');
}

/** True when `controller` runs one of the person's employers (or their brand) on `date`. */
export function worksFor(
  read: GameWorldView,
  personId: PersonId,
  date: GameDate,
  controller: DeepReadonly<Controller>,
): boolean {
  return employerControllersOf(read, personId, date).some((employer) =>
    sameController(employer, controller),
  );
}

/**
 * Whether a new injury to `personId` on `date` must wait to be noticed: `health.stopOnOwnInjury`
 * is on and a human runs one of their employers. Everyone else's injuries are noticed on the day.
 */
export function needsNotice(
  read: GameWorldView,
  tunables: EngineTunables,
  personId: PersonId,
  date: GameDate,
): boolean {
  return tunables.get('health.stopOnOwnInjury') && worksForAHuman(read, personId, date);
}
