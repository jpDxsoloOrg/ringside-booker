/**
 * The venue pick (EVT6-02): where a show without a venue is held. Rules, in order:
 *
 * 1. The show's preferred venue, when it is open and can be booked, whatever its size.
 * 2. The smallest venue in the show's region that fits the expected crowd × headroom.
 * 3. The smallest venue elsewhere in the show's country that fits.
 * 4. A generic local venue: the smallest size that fits, or the largest size when none does.
 *
 * Venues that are closed, exclusive to another promotion or used that night by another promotion
 * are never picked; they are listed in the Why? with their reason. Ties go to the smaller venue,
 * then the lower id. Deterministic: no rolls. Design: docs/design/box-office.md#pick.
 */

import type { GameDate } from '../../../core/date';
import type { CountryId, PromotionId, RegionId, VenueId } from '../../../core/ids';
import { InvariantError } from '../../../core/errors';
import { startDecision, type Decision } from '../../../core/trace/decision';
import type { Traced } from '../../../core/trace/types';
import type { EngineTunables } from '../../tunables';
import {
  GENERIC_VENUE_TIERS,
  genericVenueLabel,
  type GenericVenueSize,
  type GenericVenueTier,
} from '../genericVenues';
import type { VenueAvailability } from '../showVenue';

export const PICK_VENUE_DOC_REF = 'box-office.md#pick';

/** A pick's answer: a real venue's id, or `generic:<tier>` for a generic local venue. */
export type VenueOptionKey = VenueId | `generic:${GenericVenueTier}`;

/** The option key of a generic size. */
export function genericOptionKey(tier: GenericVenueTier): `generic:${GenericVenueTier}` {
  return `generic:${tier}`;
}

/** True when the option key names a generic size rather than a real venue. */
export function isGenericOptionKey(key: VenueOptionKey): key is `generic:${GenericVenueTier}` {
  return GENERIC_VENUE_TIERS.some((tier) => key === genericOptionKey(tier));
}

/** The generic size an option key names, or null when it names a real venue. */
export function genericTierOf(key: VenueOptionKey): GenericVenueTier | null {
  return GENERIC_VENUE_TIERS.find((tier) => key === genericOptionKey(tier)) ?? null;
}

/** A real venue the pick can choose, with whether it can be booked for this show. */
export interface VenueCandidate {
  readonly venueId: VenueId;
  readonly name: string;
  readonly capacity: number;
  readonly regionId: RegionId;
  readonly availability: VenueAvailability;
}

export interface PickVenueInputs {
  readonly show: {
    readonly promotionId: PromotionId;
    readonly date: GameDate;
    readonly regionId: RegionId;
    readonly regionName: string;
    readonly countryId: CountryId;
    readonly countryName: string;
  };
  /** The expected crowd, from `forecastAttendance` in the show's region. */
  readonly expected: number;
  /** The show's preferred venue, or null when it has none. */
  readonly preferred: VenueCandidate | null;
  /** The real venues in the show's region. */
  readonly inRegion: readonly VenueCandidate[];
  /** The real venues in the rest of the show's country. */
  readonly inCountry: readonly VenueCandidate[];
  /** The generic sizes and their capacities, in any order. */
  readonly genericSizes: readonly GenericVenueSize[];
}

/** "12,000": whole people with thousands separators, the same in every locale. */
function formatCount(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function byCapacityThenId(left: VenueCandidate, right: VenueCandidate): number {
  if (left.capacity !== right.capacity) {
    return left.capacity - right.capacity;
  }
  return left.venueId < right.venueId ? -1 : left.venueId > right.venueId ? 1 : 0;
}

/**
 * Lists `candidates` in the Why? (smallest first, each with why it can or cannot be used) and
 * returns the smallest available one that holds `needed`, or null.
 */
function smallestFitting(
  decision: Decision<VenueOptionKey>,
  considered: Set<VenueOptionKey>,
  candidates: readonly VenueCandidate[],
  needed: number,
): VenueCandidate | null {
  let found: VenueCandidate | null = null;
  for (const candidate of [...candidates].sort(byCapacityThenId)) {
    if (considered.has(candidate.venueId)) {
      continue;
    }
    considered.add(candidate.venueId);
    let reason: string;
    if (!candidate.availability.available) {
      reason = `${candidate.name}: ${candidate.availability.message}`;
    } else if (candidate.capacity < needed) {
      reason = `${candidate.name}: Too small (holds ${formatCount(candidate.capacity)})`;
    } else if (found === null) {
      reason = `${candidate.name}: Smallest that fits (holds ${formatCount(candidate.capacity)})`;
      found = candidate;
    } else {
      reason = `${candidate.name}: Bigger than needed (holds ${formatCount(candidate.capacity)})`;
    }
    decision.consider(candidate.venueId, candidate.capacity, reason);
  }
  return found;
}

/** Where the show is held. The trace is the "Venue" decision with every rule it checked. */
export function pickVenue(
  inputs: PickVenueInputs,
  deps: { readonly tunables: EngineTunables },
): Traced<VenueOptionKey> {
  const { show, expected } = inputs;
  const decision = startDecision<VenueOptionKey>('Venue', { docRef: PICK_VENUE_DOC_REF });
  const considered = new Set<VenueOptionKey>();
  decision.note(`Expected crowd in ${show.regionName}: ${formatCount(expected)}`);

  // 1. The preferred venue, whatever its size.
  const { preferred } = inputs;
  if (preferred === null) {
    decision.note('No preferred venue');
  } else {
    const usable = preferred.availability.available;
    considered.add(preferred.venueId);
    decision.consider(
      preferred.venueId,
      preferred.capacity,
      preferred.availability.available
        ? `${preferred.name}: Preferred venue (holds ${formatCount(preferred.capacity)})`
        : `${preferred.name}: ${preferred.availability.message}`,
    );
    decision.rule(`Preferred venue ${preferred.name} is open and can be booked`, usable);
    if (usable) {
      return decision.choose(preferred.venueId, `${preferred.name} is the preferred venue`);
    }
  }

  const headroom = decision.tunable(
    deps.tunables,
    'boxOffice.pick.headroom',
    'Room left for a good night',
  );
  const needed = Math.ceil(expected * headroom);
  const fitsText = `${formatCount(expected)} × ${String(headroom)} (${formatCount(needed)})`;

  // 2. The smallest venue in the region that fits.
  const inRegion = smallestFitting(decision, considered, inputs.inRegion, needed);
  decision.rule(`Smallest venue in ${show.regionName} that fits ${fitsText}`, inRegion !== null);
  if (inRegion !== null) {
    return decision.choose(
      inRegion.venueId,
      `${inRegion.name} is the smallest venue in ${show.regionName} that fits`,
    );
  }

  // 3. The smallest venue elsewhere in the country that fits.
  const inCountry = smallestFitting(decision, considered, inputs.inCountry, needed);
  decision.rule(
    `Smallest venue elsewhere in ${show.countryName} that fits ${formatCount(needed)}`,
    inCountry !== null,
  );
  if (inCountry !== null) {
    return decision.choose(
      inCountry.venueId,
      `${inCountry.name} is the smallest venue in ${show.countryName} that fits`,
    );
  }

  // 4. A generic local venue: the smallest size that fits, else the largest.
  const sizes = [...inputs.genericSizes]
    .map((size, order) => ({ ...size, order }))
    .sort((left, right) => left.capacity - right.capacity || left.order - right.order);
  const fitting = sizes.find((size) => size.capacity >= needed);
  const largest = sizes.at(-1);
  if (largest === undefined) {
    throw new InvariantError('pickVenue was given no generic venue sizes');
  }
  const chosen = fitting ?? largest;
  for (const size of sizes) {
    const key = genericOptionKey(size.tier);
    const label = genericVenueLabel(size.tier);
    const holds = `holds ${formatCount(size.capacity)}`;
    let reason: string;
    if (size.tier === chosen.tier) {
      reason =
        fitting === undefined
          ? `${label}: Largest size (${holds})`
          : `${label}: Smallest that fits (${holds})`;
    } else if (size.capacity < needed) {
      reason = `${label}: Too small (${holds})`;
    } else {
      reason = `${label}: Bigger than needed (${holds})`;
    }
    decision.consider(key, size.capacity, reason);
  }
  decision.rule('Generic venue: smallest size that fits', fitting !== undefined);
  const chosenLabel = genericVenueLabel(chosen.tier);
  if (fitting === undefined) {
    const because = `Bigger than any venue size: ${chosenLabel}`;
    decision.note(because);
    return decision.choose(genericOptionKey(chosen.tier), because);
  }
  return decision.choose(
    genericOptionKey(chosen.tier),
    `${chosenLabel} is the smallest local venue that fits`,
  );
}
