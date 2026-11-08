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
import { compareDates } from '../../core/date';
import { defineTable } from '../table-def';
import { zGameDate, zId, zNonNegativeCents, zNonNegativeInt, zStat } from '../primitives';
import { isPresentIff, zName } from './entity-refinements';
import { ShowFormatSchema, zEventImportance } from './event-definition';

export const EVENT_INSTANCE_STATUSES = ['scheduled', 'booked', 'completed', 'cancelled'] as const;
export type EventInstanceStatus = (typeof EVENT_INSTANCE_STATUSES)[number];

/**
 * What a completed show produced. The EVT and ECO epics extend it (score components, revenue
 * lines) with a migration once the format is frozen.
 */
export const EventResultSchema = z.strictObject({
  /** The show score, 0-100. */
  score: zStat,
  attendance: zNonNegativeInt,
  /** Ticket revenue. */
  gate: zNonNegativeCents,
  /** TV or stream viewers, or null for a show that did not air. */
  viewers: zNonNegativeInt.nullable(),
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
    regionId: zId('region'),
    /** Set exactly when the show is completed. */
    result: EventResultSchema.nullable(),
  })
  .refine((instance) => compareDates(instance.airDate, instance.date) >= 0, {
    message: 'airDate must not be before date',
    path: ['airDate'],
  })
  .refine((instance) => isPresentIff(instance.result, instance.status === 'completed'), {
    message: 'result is set exactly when status is completed',
    path: ['result'],
  });

export type EventResult = z.infer<typeof EventResultSchema>;
export type EventInstance = z.infer<typeof EventInstanceSchema>;

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
  ],
});
