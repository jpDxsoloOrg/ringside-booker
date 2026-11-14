/**
 * The contracts side of D-09 (ECO4-03): a worker featured in a hot storyline is getting TV time
 * and a story that goes somewhere, so their unhappy clock and any walk-out roll pause while the
 * storyline is hot. Losing inside a hot angle therefore never ends in a release request or a
 * walk-out.
 *
 * WRK8 owns the morale side of the story shield. Until it is on main this reads its own heat
 * line, `contracts.quit.storyShieldHeat`; ECO4-05 points it at WRK8's `morale.storyShield.hotHeat`.
 *
 * Design: docs/design/contracts.md#unhappy-workers and design-decisions.md D-09.
 */

import type { PersonId, PromotionId, StorylineId } from '../../core/ids';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';

/** The hot storyline that pauses a worker's clock and walk-out rolls. */
export interface HotStoryline {
  readonly storylineId: StorylineId;
  readonly name: string;
  readonly heat: number;
}

/**
 * The hottest active storyline of `promotionId` that `personId` is a member of, with heat at or
 * above `contracts.quit.storyShieldHeat` (ties by id), or null.
 */
export function hotStorylineFor(
  read: GameWorldView,
  personId: PersonId,
  promotionId: PromotionId,
  tunables: EngineTunables,
): HotStoryline | null {
  const minHeat = tunables.get('contracts.quit.storyShieldHeat');
  let best: HotStoryline | null = null;
  for (const storyline of read.tables.storylines.lookup('byMember', personId)) {
    if (
      storyline.status !== 'active' ||
      storyline.promotionId !== promotionId ||
      storyline.heat < minHeat
    ) {
      continue;
    }
    if (
      best === null ||
      storyline.heat > best.heat ||
      (storyline.heat === best.heat && compareIds(storyline.id, best.storylineId) < 0)
    ) {
      best = { storylineId: storyline.id, name: storyline.name, heat: storyline.heat };
    }
  }
  return best;
}

/** "In a hot storyline (Title Chase, heat 82)". */
export function hotStorylineText(hot: { readonly name: string; readonly heat: number }): string {
  return `In a hot storyline (${hot.name}, heat ${String(hot.heat)})`;
}
