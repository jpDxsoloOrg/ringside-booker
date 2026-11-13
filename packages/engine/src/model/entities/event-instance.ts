/**
 * Event instances: one dated show.
 *
 * An instance copies `importance` and `format` from its definition when it is scheduled, so a
 * later edit to the definition never rewrites a show that already happened. A one-off show has no
 * definition and sets its own. Its card is the `segments` that point at it.
 *
 * Design notes: docs/design/data-model.md, "Titles, events, storylines and seasons".
 */

import { z } from 'zod';
import { compareDates, type GameDate } from '../../core/date';
import type { EventDefinitionId } from '../../core/ids';
import { defineTable } from '../table-def';
import { zGameDate, zId, zNonNegativeCents, zNonNegativeInt, zStat } from '../primitives';
import { isPresentIff, zName } from './entity-refinements';
import { ShowFormatSchema, zEventImportance } from './event-definition';
import { GenericVenueTierSchema, VENUE_CAPACITY_MAX } from './venue';

export const EVENT_INSTANCE_STATUSES = ['scheduled', 'booked', 'completed', 'cancelled'] as const;
export type EventInstanceStatus = (typeof EVENT_INSTANCE_STATUSES)[number];

/**
 * Why a show did not happen. `notRun`: its day passed with the show still open, so the day's close
 * shut it. `byPromotion`: the promotion that owned it called it off.
 */
export const CANCELLATION_REASONS = ['notRun', 'byPromotion'] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

/** The reason a show was cancelled and the day that happened. */
export const EventCancellationSchema = z.strictObject({
  reason: z.enum(CANCELLATION_REASONS),
  on: zGameDate,
});

/**
 * What a completed show produced. EVT3 writes `score`, `rawScore` and `traceId`; EVT6 writes
 * `attendance` and `gate`; ECO8 writes `viewers`. Each of the last three stays null until the
 * feature that computes it lands, and crowd size is never the same number as crowd reaction (D-02).
 */
export const EventResultSchema = z.strictObject({
  /** The final show score, 0-100. */
  score: zStat,
  /**
   * The show score before any `cap`-stage modifier (EVT4's production ceiling); equal to `score`
   * when no cap applies.
   */
  rawScore: zStat,
  /** The ref key (`refKey(ref)`) of the show score's trace, or null when none was kept. */
  traceId: z.string().min(1).nullable(),
  /** People in the building, or null until EVT6 computes it. */
  attendance: zNonNegativeInt.nullable(),
  /** Ticket revenue, or null until EVT6 computes it. */
  gate: zNonNegativeCents.nullable(),
  /** TV or stream viewers, or null for a show that did not air or until ECO8 computes it. */
  viewers: zNonNegativeInt.nullable(),
});

/**
 * A generic local venue a show is held in (EVT6-02): its size and the capacity that size had when
 * it was chosen, copied in so a later tunable change never rewrites a past show.
 */
export const GenericVenueSchema = z.strictObject({
  tier: GenericVenueTierSchema,
  capacity: z.number().int().min(1).max(VENUE_CAPACITY_MAX),
});

export const EventInstanceSchema = z
  .strictObject({
    id: zId('eventInstance'),
    promotionId: zId('promotion'),
    /** The definition the show was scheduled from, or null for a one-off. */
    eventDefinitionId: zId('eventDefinition').nullable(),
    brandId: zId('brand').nullable(),
    name: zName(60),
    /** Copied from the definition at scheduling. */
    importance: zEventImportance,
    /** Copied from the definition at scheduling. */
    format: ShowFormatSchema,
    /** The day the show runs live, or the taping day. */
    date: zGameDate,
    /** The day the show airs: equal to `date` unless it was taped. */
    airDate: zGameDate,
    status: z.enum(EVENT_INSTANCE_STATUSES),
    venueId: zId('venue').nullable(),
    /**
     * The generic local venue the show is held in, or null. Never set together with `venueId`;
     * both null means the venue is not chosen yet. Defaults to null for saves made before EVT6-02.
     */
    genericVenue: GenericVenueSchema.nullable().default(null),
    regionId: zId('region'),
    /** Set exactly when the show is completed. */
    result: EventResultSchema.nullable(),
    /** Set exactly when the show is cancelled. */
    cancellation: EventCancellationSchema.nullable(),
  })
  .refine((instance) => compareDates(instance.airDate, instance.date) >= 0, {
    message: 'airDate must not be before date',
    path: ['airDate'],
  })
  .refine((instance) => isPresentIff(instance.result, instance.status === 'completed'), {
    message: 'result is set exactly when status is completed',
    path: ['result'],
  })
  .refine((instance) => instance.venueId === null || instance.genericVenue === null, {
    message: 'a show has a real venue or a generic venue, not both',
    path: ['genericVenue'],
  })
  .refine((instance) => isPresentIff(instance.cancellation, instance.status === 'cancelled'), {
    message: 'cancellation is set exactly when status is cancelled',
    path: ['cancellation'],
  });

export type EventResult = z.infer<typeof EventResultSchema>;
export type GenericVenue = z.infer<typeof GenericVenueSchema>;
export type EventCancellation = z.infer<typeof EventCancellationSchema>;
export type EventInstance = z.infer<typeof EventInstanceSchema>;

/**
 * The key a recurring show is filed under in the unique `byDefinitionAirDate` index. The calendar
 * looks a date up with it before scheduling, so a definition never gets two shows for one air date.
 */
export function definitionAirDateKey(
  eventDefinitionId: EventDefinitionId,
  airDate: GameDate,
): string {
  return `${eventDefinitionId}|${airDate}`;
}

export const eventInstancesTable = defineTable({
  kind: 'eventInstance',
  name: 'eventInstances',
  schema: EventInstanceSchema,
  refs: [
    { path: 'promotionId', target: 'promotion', nullable: false },
    { path: 'eventDefinitionId', target: 'eventDefinition', nullable: true },
    { path: 'brandId', target: 'brand', nullable: true },
    { path: 'venueId', target: 'venue', nullable: true },
    { path: 'regionId', target: 'region', nullable: false },
  ],
  indexes: [
    { name: 'byPromotion', key: (instance) => instance.promotionId },
    { name: 'byDate', key: (instance) => instance.date },
    { name: 'byDefinition', key: (instance) => instance.eventDefinitionId },
    /** Lets a phase scan only the open (scheduled or booked) shows. */
    { name: 'byStatus', key: (instance) => instance.status },
    /**
     * At most one show per definition and air date, whatever its status. One-offs have no
     * definition and stay out of the index.
     */
    {
      name: 'byDefinitionAirDate',
      key: (instance) =>
        instance.eventDefinitionId === null
          ? null
          : definitionAirDateKey(instance.eventDefinitionId, instance.airDate),
      unique: true,
    },
  ],
});
