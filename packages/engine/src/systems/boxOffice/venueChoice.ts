/**
 * Between the player's `VenueChoice`, the pick's option key and the screens' `VenueSummary`
 * (EVT6-03), and the one automatic pick every path shares: `booking.autoVenue`, the show-night
 * hook and the `boxOffice.assignVenues` phase. Design: docs/design/box-office.md#venue-commands-and-queries.
 */

import type { EventInstance } from '../../model/entities/event-instance';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { InvariantError } from '../../core/errors';
import type { StepContext } from '../../core/pipeline/context';
import type { Traced } from '../../core/trace/types';
import type { EngineTunables } from '../tunables';
import type { VenueChoice, VenueSummary } from './api';
import { applyVenueChoice } from './applyVenue';
import {
  genericOptionKey,
  genericTierOf,
  isGenericOptionKey,
  type VenueOptionKey,
} from './formulas/pickVenue';
import { genericCapacityKey } from './genericVenues';
import { pickVenueFor } from './pickVenueFor';
import { showVenueOf, type ShowVenue } from './showVenue';

/** The pick's option key for a choice. */
export function optionKeyOf(choice: VenueChoice): VenueOptionKey {
  return choice.kind === 'venue' ? choice.venueId : genericOptionKey(choice.tier);
}

/** The choice an option key names. */
export function choiceOfKey(key: VenueOptionKey): VenueChoice {
  if (!isGenericOptionKey(key)) {
    return { kind: 'venue', venueId: key };
  }
  const tier = genericTierOf(key);
  if (tier === null) {
    throw new InvariantError(`Unknown generic venue option ${key}`);
  }
  return { kind: 'generic', tier };
}

/** The choice that names a show venue. */
export function choiceOfVenue(venue: ShowVenue): VenueChoice {
  return venue.kind === 'venue'
    ? { kind: 'venue', venueId: venue.venueId }
    : { kind: 'generic', tier: venue.tier };
}

/** True when both name the same venue (or the same generic size). */
export function sameChoice(left: VenueChoice, right: VenueChoice): boolean {
  return optionKeyOf(left) === optionKeyOf(right);
}

/**
 * Where `instance` would be held with `choice`: the real venue from the table, or the generic size
 * in the show's region with its capacity today. Null for a venue that is not in the world.
 */
export function showVenueForChoice(
  read: GameWorldView,
  tunables: EngineTunables,
  instance: DeepReadonly<Pick<EventInstance, 'regionId'>>,
  choice: VenueChoice,
): ShowVenue | null {
  if (choice.kind === 'venue') {
    return showVenueOf(read, {
      venueId: choice.venueId,
      genericVenue: null,
      regionId: instance.regionId,
    });
  }
  return showVenueOf(read, {
    venueId: null,
    genericVenue: { tier: choice.tier, capacity: tunables.get(genericCapacityKey(choice.tier)) },
    regionId: instance.regionId,
  });
}

/** A show venue with its region and country names, as the screens show it. */
export function summaryOf(read: GameWorldView, venue: ShowVenue): VenueSummary {
  const region = read.tables.regions.get(venue.regionId);
  const country = region === undefined ? undefined : read.tables.countries.get(region.countryId);
  return {
    ...venue,
    regionName: region?.name ?? venue.regionId,
    countryName: country?.name ?? region?.countryId ?? '',
    choice: choiceOfVenue(venue),
  };
}

/** The pick's answer as a summary, for a show whose region is `instance.regionId`. */
export function summaryOfKey(
  read: GameWorldView,
  tunables: EngineTunables,
  instance: DeepReadonly<Pick<EventInstance, 'regionId'>>,
  key: VenueOptionKey,
): VenueSummary | null {
  const venue = showVenueForChoice(read, tunables, instance, choiceOfKey(key));
  return venue === null ? null : summaryOf(read, venue);
}

/** True when the show has a venue, real or generic. */
export function hasVenue(
  instance: DeepReadonly<Pick<EventInstance, 'venueId' | 'genericVenue'>>,
): boolean {
  return instance.venueId !== null || instance.genericVenue !== null;
}

/**
 * Runs the venue pick for `instance` and stores it as the game's choice (`auto: true`). The pick's
 * Why? is stored only when `storeTrace` is true: the player's shows keep theirs, rival shows do not,
 * so a year of rival calendars adds nothing to the trace store. Returns the stored key.
 */
export function autoPickVenue(
  ctx: StepContext,
  instance: DeepReadonly<EventInstance>,
  options: { readonly storeTrace: boolean },
): VenueOptionKey {
  const pick: Traced<VenueOptionKey> = pickVenueFor(ctx.read, ctx.tunables, instance);
  applyVenueChoice(ctx, instance.id, pick.value, {
    auto: true,
    ...(options.storeTrace ? { trace: pick } : {}),
  });
  return pick.value;
}
