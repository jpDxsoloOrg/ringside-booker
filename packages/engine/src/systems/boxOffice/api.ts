/**
 * The box office's commands and queries (EVT6-03): the shapes screens read and send. The player
 * sets or auto-picks the venue of one of their upcoming shows (`booking.setVenue`,
 * `booking.autoVenue`), reads its crowd forecast (`boxOffice.forecast`) and the venues to choose
 * from (`boxOffice.venues`), and anyone can read where a show is held (`boxOffice.showVenue`).
 * Design: docs/design/box-office.md#venue-commands-and-queries.
 */

import { z } from 'zod';
import type { EventInstanceId, VenueId } from '../../core/ids';
import type { TraceNode } from '../../core/trace/types';
import {
  GENERIC_VENUE_TIERS,
  type GenericVenueTier,
  type VenueKind,
} from '../../model/entities/venue';
import { zId, type ImageRef } from '../../model/primitives';
import type { ShowVenue, VenueUnavailableCode } from './showVenue';
import type { VenueFit } from './venueFit';

/** What the player picks: a real venue, or a size of generic local venue in the show's region. */
export type VenueChoice =
  { kind: 'venue'; venueId: VenueId } | { kind: 'generic'; tier: GenericVenueTier };

export const VenueChoiceSchema: z.ZodType<VenueChoice> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('venue'), venueId: zId('venue') }),
  z.strictObject({ kind: z.literal('generic'), tier: z.enum(GENERIC_VENUE_TIERS) }),
]);

/** A show's venue as the screens show it: `ShowVenue` with the place names and the choice it is. */
export type VenueSummary = ShowVenue & {
  readonly regionName: string;
  readonly countryName: string;
  /** The choice that names this venue, to send back in `booking.setVenue`. */
  readonly choice: VenueChoice;
};

/** `boxOffice.forecast`: the crowd forecast of one show at one venue. */
export interface ShowForecast {
  eventInstanceId: EventInstanceId;
  /** The show's venue, or null while none is chosen. */
  current: VenueSummary | null;
  /** Where the game would hold the show, when no venue is chosen yet; otherwise null. */
  suggested: VenueSummary | null;
  /** The venue the numbers are for: the `choice` asked about, else `current`, else `suggested`. */
  shown: VenueSummary;
  /** The expected crowd at the shown venue, capped at its capacity. */
  expected: number;
  /** How many people want to come, before the capacity cap (the trace's value). */
  demand: number;
  /** The lowest the real crowd can be, capped at the capacity. */
  low: number;
  /** The highest the real crowd can be, capped at the capacity. */
  high: number;
  capacity: number;
  /** True when the venue is too small for the top of the range. */
  cappedByCapacity: boolean;
  fit: VenueFit;
  /** "Likely sell-out", "Good fit" or "Will look empty". */
  fitLabel: string;
  /** How the expected crowd was worked out, inline (queries cannot store traces). */
  trace: TraceNode;
  /** Why the game would pick `suggested`, or null when the show already has a venue. */
  pickTrace: TraceNode | null;
}

/** Which part of the venue list an option is in, in list order. */
export const VENUE_OPTION_GROUPS = ['region', 'country', 'abroad', 'generic'] as const;
export type VenueOptionGroup = (typeof VENUE_OPTION_GROUPS)[number];

/** How far `boxOffice.venues` looks for real venues. */
export const VENUE_SCOPES = ['country', 'world'] as const;
export type VenueScope = (typeof VENUE_SCOPES)[number];

/** One venue the player can choose from in `boxOffice.venues`. */
export interface VenueOption {
  choice: VenueChoice;
  name: string;
  regionName: string;
  countryName: string;
  group: VenueOptionGroup;
  capacity: number;
  venueKind: VenueKind;
  imageRef: ImageRef;
  /** The expected crowd at this venue (in its own region), capped at its capacity. */
  expected: number;
  low: number;
  high: number;
  fit: VenueFit;
  fitLabel: string;
  /** The show's preferred venue. */
  preferred: boolean;
  /** The show's venue now. */
  current: boolean;
  /** Why it cannot be chosen, or null when it can. */
  disabled: { code: VenueUnavailableCode; message: string } | null;
}

/** `boxOffice.venues`. */
export interface ShowVenueOptions {
  current: VenueSummary | null;
  suggested: VenueSummary | null;
  options: VenueOption[];
}

/** What `booking.setVenue` and `booking.autoVenue` stored. */
export interface SetVenueResult {
  eventInstanceId: EventInstanceId;
  venue: VenueSummary;
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'boxOffice.forecast': {
      args: { eventInstanceId: EventInstanceId; choice?: VenueChoice | undefined };
      result: ShowForecast;
    };
    'boxOffice.venues': {
      args: { eventInstanceId: EventInstanceId; scope: VenueScope };
      result: ShowVenueOptions;
    };
    'boxOffice.showVenue': {
      args: { eventInstanceId: EventInstanceId };
      result: { venue: VenueSummary | null };
    };
  }
  interface CommandMap {
    'booking.setVenue': {
      args: { eventInstanceId: EventInstanceId; choice: VenueChoice };
      result: SetVenueResult;
    };
    'booking.autoVenue': {
      args: { eventInstanceId: EventInstanceId };
      result: SetVenueResult;
    };
  }
}
