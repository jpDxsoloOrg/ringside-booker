/**
 * The storylines a show's card links, with the heat each had walking into the show (EVT6-11).
 *
 * CRTV4 moves a storyline's heat as soon as a linked segment is rated, and a human-run show is
 * settled right after it runs, so by settlement the storyline's current heat already includes
 * tonight. Once a segment of this show has counted for a storyline, its first progress row for the
 * show holds the heat before it (`heatBefore`); until then the current heat is that heat. Either
 * way the booking forecast on show day and the settlement read the same number.
 *
 * A storyline counts while it is active, or when it ended on or after the show's date (a finale
 * that ended it tonight still drew the crowd). Design: docs/design/box-office.md#show-heat.
 */

import { compareDates } from '../../core/date';
import type { StorylineId } from '../../core/ids';
import type { EventInstance } from '../../model/entities/event-instance';
import type { Storyline } from '../../model/entities/storyline';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { CardStorylineHeat } from './formulas/showHeat';

type Show = DeepReadonly<EventInstance>;

function countsFor(storyline: DeepReadonly<Storyline>, show: Show): boolean {
  if (storyline.status === 'active') {
    return true;
  }
  return storyline.endedOn !== null && compareDates(storyline.endedOn, show.date) >= 0;
}

/** The heat `storyline` had walking into `show`. */
function heatWalkingIn(storyline: DeepReadonly<Storyline>, show: Show): number {
  const row = storyline.progress.find((entry) => entry.eventInstanceId === show.id);
  return row === undefined ? storyline.heat : row.heatBefore;
}

/** The storylines linked on `show`'s card, each once, in id order. */
export function storylineHeatsOnCard(read: GameWorldView, show: Show): CardStorylineHeat[] {
  const segments = read.tables.segments.lookup('byEventInstance', show.id);
  if (segments.length === 0) {
    return [];
  }
  const segmentIds = new Set<string>(segments.map((segment) => segment.id));
  const linked = new Set<StorylineId>();
  for (const segment of segments) {
    for (const storylineId of segment.storylineIds) {
      linked.add(storylineId);
    }
  }
  const out: CardStorylineHeat[] = [];
  for (const storylineId of [...linked].sort(compareIds)) {
    const storyline = read.tables.storylines.get(storylineId);
    if (storyline === undefined || !countsFor(storyline, show)) {
      continue;
    }
    out.push({
      name: storyline.name,
      heat: heatWalkingIn(storyline, show),
      finale: storyline.finaleSegmentId !== null && segmentIds.has(storyline.finaleSegmentId),
      ref: { kind: 'storyline', id: storyline.id },
    });
  }
  return out;
}
