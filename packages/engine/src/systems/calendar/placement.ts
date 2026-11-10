/**
 * Where a scheduled show is held: its region and, when one is already settled, its venue.
 *
 * Design notes: docs/design/calendar.md#placement.
 */

import type { GameDate } from '../../core/date';
import { InvariantError } from '../../core/errors';
import type { RegionId, VenueId } from '../../core/ids';
import { startDecision } from '../../core/trace/decision';
import type { Traced } from '../../core/trace/types';
import type { EventDefinition } from '../../model/entities/event-definition';
import { isVenueOpenOn } from '../../model/entities/venue';
import type { GameTables } from '../../model/tables';
import type { DeepReadonly, WorldView } from '../../model/world';

const PLACEMENT_DOC = 'calendar.md#placement';

/** Where a show is held. A null venue means "not chosen yet". */
export interface ShowPlacement {
  regionId: RegionId;
  venueId: VenueId | null;
}

/** What the venue part of the decision came to. */
type VenueChoice = 'preferredVenue' | 'notChosen';

/** The labels of the rules a placement checks, in the order they are recorded. */
export const PLACEMENT_RULES = {
  hasPreferredVenue: 'The show has a preferred venue',
  venueOpen: 'The preferred venue is open on the day of the show',
  venueBookable: 'The preferred venue is free for this promotion to book',
  hasPreferredRegion: 'The show has a preferred region',
  regionFromVenue: "The region is the chosen venue's region",
} as const;

/**
 * Places one show of `definition` on `date`.
 *
 * 1. The preferred venue is used when it exists, is open on `date` and is either open to everyone
 *    or exclusive to the show's own promotion.
 * 2. Otherwise the venue is left unchosen (null).
 * 3. The region is the definition's preferred region, else the chosen venue's region, else the
 *    promotion's home region.
 *
 * The trace is a decision whose value says whether the preferred venue was used.
 */
export function placeShow(
  read: WorldView<GameTables>,
  definition: DeepReadonly<EventDefinition>,
  date: GameDate,
): Traced<ShowPlacement> {
  const decision = startDecision<VenueChoice>(`Where ${definition.name} is held`, {
    docRef: PLACEMENT_DOC,
  });

  const preferredVenue =
    definition.preferredVenueId === null
      ? undefined
      : read.tables.venues.get(definition.preferredVenueId);
  decision.rule(PLACEMENT_RULES.hasPreferredVenue, preferredVenue !== undefined);

  let venueId: VenueId | null = null;
  let venueRegionId: RegionId | null = null;
  if (preferredVenue !== undefined) {
    const open = isVenueOpenOn(preferredVenue, date);
    const bookable =
      preferredVenue.exclusivePromotionId === null ||
      preferredVenue.exclusivePromotionId === definition.promotionId;
    decision.rule(PLACEMENT_RULES.venueOpen, open);
    decision.rule(PLACEMENT_RULES.venueBookable, bookable);
    if (open && bookable) {
      venueId = preferredVenue.id;
      venueRegionId = preferredVenue.regionId;
    }
  }

  const hasPreferredRegion = definition.preferredRegionId !== null;
  decision.rule(PLACEMENT_RULES.hasPreferredRegion, hasPreferredRegion);
  let regionId = definition.preferredRegionId;
  if (regionId === null) {
    decision.rule(PLACEMENT_RULES.regionFromVenue, venueRegionId !== null);
    regionId = venueRegionId;
  }
  if (regionId === null) {
    const promotion = read.tables.promotions.get(definition.promotionId);
    if (promotion === undefined) {
      throw new InvariantError(
        `Event definition ${definition.id} belongs to promotion ${definition.promotionId}, which is not in the world`,
      );
    }
    decision.note("The show is held in the promotion's home region");
    regionId = promotion.homeRegionId;
  }

  const chosen =
    venueId === null
      ? decision.choose(
          'notChosen',
          preferredVenue === undefined
            ? 'No preferred venue, so the venue is not chosen yet'
            : 'The preferred venue cannot be used on the day, so the venue is not chosen yet',
        )
      : decision.choose('preferredVenue', 'The preferred venue is open and can be booked');
  return { value: { regionId, venueId }, trace: chosen.trace };
}
