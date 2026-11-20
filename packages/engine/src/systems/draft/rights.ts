/**
 * Who a draft keeps off the market: wrestlers who **sit out** (left out of the pool, DRF-07) and
 * unsigned picks whose rights a promotion **holds** (DRF-03). Contract eligibility and the
 * free-agent lists read these, so a sitting-out wrestler is nobody's free agent and a reserved
 * pick can only talk to the promotion that drafted them.
 *
 * Leaf module: it reads the draft tables only, so contracts code can import it without pulling in
 * the draft system.
 *
 * Design: docs/design/draft.md#contracts and #pool.
 */

import { compareDates, type GameDate } from '../../core/date';
import type { PersonId, PromotionId } from '../../core/ids';
import type { Draft, DraftPick } from '../../model/entities/draft';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';

export const SITTING_OUT_REASON_CODE = 'draft.sittingOut';
export const DRAFT_RIGHTS_REASON_CODE = 'draft.rightsHeld';

const sitOutSets = new WeakMap<object, ReadonlySet<string>>();

function sitOutSetOf(draft: DeepReadonly<Draft>): ReadonlySet<string> {
  let set = sitOutSets.get(draft);
  if (set === undefined) {
    set = new Set<string>(draft.sitOut);
    sitOutSets.set(draft, set);
  }
  return set;
}

/** True when a draft left this person out of its pool, so they sit out. */
export function isSittingOut(read: GameWorldView, personId: PersonId): boolean {
  for (const draft of read.tables.drafts.values()) {
    if (draft.sitOut.length > 0 && sitOutSetOf(draft).has(personId)) {
      return true;
    }
  }
  return false;
}

/** The unsigned pick holding this person's rights on `date`, or null. */
export function heldRights(
  read: GameWorldView,
  personId: PersonId,
  date: GameDate,
): DeepReadonly<DraftPick> | null {
  for (const pick of read.tables.draftPicks.lookup('byPerson', personId)) {
    if (
      pick.status === 'reserved' &&
      pick.reservedUntil !== null &&
      compareDates(date, pick.reservedUntil) <= 0
    ) {
      return pick;
    }
  }
  return null;
}

/** The promotion holding this person's draft rights on `date`, or null. */
export function rightsHolder(
  read: GameWorldView,
  personId: PersonId,
  date: GameDate,
): PromotionId | null {
  return heldRights(read, personId, date)?.promotionId ?? null;
}
