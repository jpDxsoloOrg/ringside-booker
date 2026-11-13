/**
 * Venues: the buildings shows run in.
 *
 * A venue sits in one region (by ID) and has a fixed capacity. It can be bound to one promotion
 * (`exclusivePromotionId`), such as a company's own studio or a hall it holds a long lease on.
 */

import { z } from 'zod';
import { compareDates, type GameDate } from '../../core/date';
import type { IntegrityIssue } from '../integrity';
import { zGameDate, zId, zImageRef } from '../primitives';
import { defineTable } from '../table-def';
import { tableOf, type WorldView } from '../world';
import { readSiblingString } from './sibling-tables';

export const VENUE_KINDS = ['hall', 'theatre', 'arena', 'stadium', 'studio', 'outdoor'] as const;
export const VenueKindSchema = z.enum(VENUE_KINDS);
export type VenueKind = z.infer<typeof VenueKindSchema>;

/** The largest capacity a venue can have. */
export const VENUE_CAPACITY_MAX = 200_000;

/**
 * The sizes of generic local venue a show can be held in when no real venue suits it (EVT6-02),
 * smallest first by default. Their capacities are tunables; see
 * `systems/boxOffice/genericVenues.ts` and docs/design/box-office.md#generic-venues.
 */
export const GENERIC_VENUE_TIERS = [
  'room',
  'smallHall',
  'hall',
  'largeHall',
  'smallArena',
  'arena',
  'largeArena',
  'stadium',
] as const;
export const GenericVenueTierSchema = z.enum(GENERIC_VENUE_TIERS);
export type GenericVenueTier = z.infer<typeof GenericVenueTierSchema>;

export const VenueSchema = z
  .strictObject({
    id: zId('venue'),
    name: z.string().min(1).max(80),
    regionId: zId('region'),
    /** Seats (or standing places) sold for a show. */
    capacity: z.number().int().min(1).max(VENUE_CAPACITY_MAX),
    kind: VenueKindSchema,
    /** When the venue opened, or null when it has always been there. */
    openedOn: zGameDate.nullable(),
    /** When the venue closed (or will close), or null while it stays open. After `openedOn`. */
    closedOn: zGameDate.nullable(),
    /** The only promotion allowed to book the venue, or null when anyone can. */
    exclusivePromotionId: zId('promotion').nullable(),
    imageRef: zImageRef,
  })
  .superRefine((venue, context) => {
    if (
      venue.openedOn !== null &&
      venue.closedOn !== null &&
      compareDates(venue.closedOn, venue.openedOn) <= 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'closedOn must be after openedOn',
        path: ['closedOn'],
      });
    }
  });

export type Venue = z.infer<typeof VenueSchema>;

/** True when the venue is open on `date`: opened on or before it and not closed by then. */
export function isVenueOpenOn(
  venue: Pick<Venue, 'openedOn' | 'closedOn'>,
  date: GameDate,
): boolean {
  const opened = venue.openedOn === null || compareDates(venue.openedOn, date) <= 0;
  const notClosed = venue.closedOn === null || compareDates(venue.closedOn, date) > 0;
  return opened && notClosed;
}

/**
 * Warns about an open venue that is exclusive to a closed promotion. It is legal (the lease can
 * outlive the company for a while) but nobody can book the venue, so world tools should flag it.
 */
function exclusiveClosedIssues(view: WorldView): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  for (const venue of tableOf(view, venuesTable).values()) {
    if (venue.exclusivePromotionId === null || !isVenueOpenOn(venue, view.meta.currentDate)) {
      continue;
    }
    const status = readSiblingString(view, 'promotion', venue.exclusivePromotionId, 'status');
    if (status === 'closed') {
      issues.push({
        code: 'venue.exclusiveClosed',
        table: 'venues',
        id: venue.id,
        path: 'exclusivePromotionId',
        severity: 'warning',
        message: `Venue ${venue.id} is open but exclusive to closed promotion ${venue.exclusivePromotionId}`,
      });
    }
  }
  return issues;
}

export const venuesTable = defineTable({
  kind: 'venue',
  name: 'venues',
  schema: VenueSchema,
  refs: [
    { path: 'regionId', target: 'region', nullable: false },
    { path: 'exclusivePromotionId', target: 'promotion', nullable: true },
  ],
  indexes: [{ name: 'byRegion', key: (venue) => venue.regionId }],
  invariants: [
    {
      name: 'exclusivePromotionNotClosed',
      check(view): IntegrityIssue[] {
        return exclusiveClosedIssues(view);
      },
    },
  ],
});
