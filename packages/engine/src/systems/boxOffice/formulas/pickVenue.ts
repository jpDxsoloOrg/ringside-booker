/**
 * The venue pick (EVT6-02, sized to the crowd by EVT6-14): where a show without a venue is held.
 * Rules, in order:
 *
 * 1. The show's preferred venue, when it is open and can be booked, whatever its size.
 * 2. The best fit in the show's region, among its real venues and the generic local sizes: the
 *    smallest that seats the expected crowd × (1 + `boxOffice.venueHeadroom`). When another that
 *    also fits is at most `boxOffice.venueTieBand` bigger and cheaper to rent, the cheapest wins.
 * 3. The best fit elsewhere in the show's country, the same way (only reached for a crowd bigger
 *    than every local size).
 * 4. Nothing is big enough: the largest venue that can be booked.
 *
 * Venues that are closed, exclusive to another promotion or used that night by another promotion
 * are never picked; they are listed in the Why? with their reason. Remaining ties go to the smaller
 * venue, then the lower key. Deterministic: no rolls. Design: docs/design/box-office.md#pick.
 */

import type { GameDate } from '../../../core/date';
import type { CountryId, PromotionId, RegionId, VenueId } from '../../../core/ids';
import { InvariantError } from '../../../core/errors';
import { startDecision, type Decision } from '../../../core/trace/decision';
import type { Traced } from '../../../core/trace/types';
import type { VenueKind } from '../../../model/entities/venue';
import type { EngineTunables } from '../../tunables';
import {
  GENERIC_VENUE_KINDS,
  GENERIC_VENUE_TIERS,
  genericVenueLabel,
  type GenericVenueSize,
  type GenericVenueTier,
} from '../genericVenues';
import type { VenueAvailability } from '../showVenue';
import { computeVenueRent } from './venueRent';

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
  readonly venueKind: VenueKind;
  readonly regionId: RegionId;
  /** True when the venue is exclusive to the show's own promotion, so it rents at a discount. */
  readonly ownVenue: boolean;
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

/** "$4,480": whole cents as whole dollars. */
function formatRent(rentCents: number): string {
  return `$${formatCount(rentCents / 100)}`;
}

/** One place the pick can hold the show: a real venue or a generic size, with its rent. */
interface PickOption {
  readonly key: VenueOptionKey;
  readonly name: string;
  readonly capacity: number;
  /** The rent for the show in whole cents, as `computeVenueRent` charges it. */
  readonly rent: number;
  /** Null when the venue can be booked, else why not. */
  readonly unavailable: string | null;
}

function rentOf(
  capacity: number,
  venueKind: VenueKind,
  venueName: string,
  ownVenue: boolean,
  tunables: EngineTunables,
): number {
  return computeVenueRent({ capacity, venueKind, venueName, ownVenue }, { tunables }).value;
}

function realOption(candidate: VenueCandidate, tunables: EngineTunables): PickOption {
  return {
    key: candidate.venueId,
    name: candidate.name,
    capacity: candidate.capacity,
    rent: rentOf(
      candidate.capacity,
      candidate.venueKind,
      candidate.name,
      candidate.ownVenue,
      tunables,
    ),
    unavailable: candidate.availability.available ? null : candidate.availability.message,
  };
}

function genericOption(size: GenericVenueSize, tunables: EngineTunables): PickOption {
  const name = genericVenueLabel(size.tier);
  return {
    key: genericOptionKey(size.tier),
    name,
    capacity: size.capacity,
    rent: rentOf(size.capacity, GENERIC_VENUE_KINDS[size.tier], name, false, tunables),
    unavailable: null,
  };
}

function compareKeys(left: VenueOptionKey, right: VenueOptionKey): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Smallest first, then cheaper, then the lower key: the order options are listed in. */
function bySize(left: PickOption, right: PickOption): number {
  return (
    left.capacity - right.capacity || left.rent - right.rent || compareKeys(left.key, right.key)
  );
}

/** Cheaper first, then smaller, then the lower key: how close sizes are settled. */
function byRent(left: PickOption, right: PickOption): number {
  return (
    left.rent - right.rent || left.capacity - right.capacity || compareKeys(left.key, right.key)
  );
}

/**
 * The best fit among `options`: the smallest available one that holds `needed`, unless another
 * that also holds it, at most `tieBand` bigger, is cheaper to rent; then the cheapest of those.
 * Null when none holds `needed`. Every option is listed in the Why? (smallest first) with why it
 * was or was not used.
 */
function bestFit(
  decision: Decision<VenueOptionKey>,
  options: readonly PickOption[],
  needed: number,
  tieBand: number,
): PickOption | null {
  const sorted = [...options].sort(bySize);
  const fitting = sorted.filter(
    (option) => option.unavailable === null && option.capacity >= needed,
  );
  const smallest = fitting[0];
  const close =
    smallest === undefined
      ? []
      : fitting.filter((option) => option.capacity <= smallest.capacity * (1 + tieBand));
  const best = [...close].sort(byRent)[0] ?? null;
  for (const option of sorted) {
    const holds = `holds ${formatCount(option.capacity)}`;
    const rent = `rent ${formatRent(option.rent)}`;
    let reason: string;
    if (option.unavailable !== null) {
      reason = `${option.name}: ${option.unavailable}`;
    } else if (option.capacity < needed) {
      reason = `${option.name}: Too small (${holds})`;
    } else if (option === best) {
      reason =
        option === smallest
          ? `${option.name}: Smallest that fits (${holds}, ${rent})`
          : `${option.name}: Close in size and cheaper (${holds}, ${rent})`;
    } else if (close.includes(option)) {
      reason = `${option.name}: Close in size but dearer (${holds}, ${rent})`;
    } else {
      reason = `${option.name}: Bigger than needed (${holds})`;
    }
    decision.consider(option.key, option.capacity, reason);
  }
  return best;
}

/** Where the show is held. The trace is the "Venue" decision with every rule it checked. */
export function pickVenue(
  inputs: PickVenueInputs,
  deps: { readonly tunables: EngineTunables },
): Traced<VenueOptionKey> {
  const { show, expected } = inputs;
  const { tunables } = deps;
  const decision = startDecision<VenueOptionKey>('Venue', { docRef: PICK_VENUE_DOC_REF });
  decision.note(`Expected crowd in ${show.regionName}: ${formatCount(expected)}`);

  // 1. The preferred venue, whatever its size.
  const { preferred } = inputs;
  if (preferred === null) {
    decision.note('No preferred venue');
  } else {
    const usable = preferred.availability.available;
    decision.consider(
      preferred.venueId,
      preferred.capacity,
      usable
        ? `${preferred.name}: Preferred venue (holds ${formatCount(preferred.capacity)})`
        : `${preferred.name}: ${preferred.availability.message}`,
    );
    decision.rule(`Preferred venue ${preferred.name} is open and can be booked`, usable);
    if (usable) {
      return decision.choose(preferred.venueId, `${preferred.name} is the preferred venue`);
    }
  }
  const notPreferred = (candidate: VenueCandidate): boolean =>
    candidate.venueId !== preferred?.venueId;

  if (inputs.genericSizes.length === 0) {
    throw new InvariantError('pickVenue was given no generic venue sizes');
  }
  const headroom = decision.tunable(
    tunables,
    'boxOffice.venueHeadroom',
    'Room left for a good night',
  );
  const tieBand = decision.tunable(
    tunables,
    'boxOffice.venueTieBand',
    'How much bigger a cheaper venue may be',
  );
  const needed = Math.ceil(expected * (1 + headroom));
  const fitsText = `${formatCount(expected)} + ${String(Math.round(headroom * 100))}% (${formatCount(needed)})`;

  // 2. The best fit in the region: its real venues and the generic local sizes.
  const inRegion = [
    ...inputs.inRegion.filter(notPreferred).map((candidate) => realOption(candidate, tunables)),
    ...inputs.genericSizes.map((size) => genericOption(size, tunables)),
  ];
  const regionBest = bestFit(decision, inRegion, needed, tieBand);
  decision.rule(`Best fit in ${show.regionName} for ${fitsText}`, regionBest !== null);
  if (regionBest !== null) {
    return decision.choose(
      regionBest.key,
      `${regionBest.name} is the best fit in ${show.regionName}`,
    );
  }

  // 3. The best fit elsewhere in the country, for a crowd bigger than every local size.
  const inCountry = inputs.inCountry
    .filter(notPreferred)
    .map((candidate) => realOption(candidate, tunables));
  const countryBest = bestFit(decision, inCountry, needed, tieBand);
  decision.rule(
    `Best fit elsewhere in ${show.countryName} for ${formatCount(needed)}`,
    countryBest !== null,
  );
  if (countryBest !== null) {
    return decision.choose(
      countryBest.key,
      `${countryBest.name} is the best fit in ${show.countryName}`,
    );
  }

  // 4. Nothing is big enough: the largest that can be booked, the region's first, then the cheaper.
  let largest: PickOption | null = null;
  for (const option of [...inRegion, ...inCountry]) {
    if (option.unavailable !== null) {
      continue;
    }
    if (
      largest === null ||
      option.capacity > largest.capacity ||
      (option.capacity === largest.capacity && option.rent < largest.rent)
    ) {
      largest = option;
    }
  }
  if (largest === null) {
    throw new InvariantError('pickVenue found no venue that can be booked');
  }
  const because = `Bigger than any venue: ${largest.name}`;
  decision.note(because);
  return decision.choose(largest.key, because);
}
