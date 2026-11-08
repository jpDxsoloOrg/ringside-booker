/**
 * Event definitions: a promotion's recurring or one-off shows, before any date is booked.
 *
 * A definition says when a show runs (a typed `Recurrence`) and how big its card is (a
 * `ShowFormat` of segment slots). Cards are built from slots, never from minutes (design decision
 * D-10): nothing here stores a length or a running time. The calendar turns definitions into dated
 * `eventInstances`; that generation belongs to the EVT and DAY epics.
 *
 * Design notes: docs/design/data-model.md, "Titles, events, storylines and seasons".
 */

import { z } from 'zod';
import { weekday } from '../../core/date';
import { defineTable } from '../table-def';
import { zGameDate, zId, zImageRef, zWeekday } from '../primitives';
import { hasDuplicates, isOpenOrOnOrAfter, isStrictlyAscending, zName } from './entity-refinements';

// ---------------------------------------------------------------------------------------------
// Recurrence

/** Fewest and most weeks between shows for an `everyNWeeks` recurrence. */
export const EVERY_N_WEEKS_MIN = 2;
export const EVERY_N_WEEKS_MAX = 8;

/** Most dates a `dates` recurrence lists (one a day for a leap year). */
export const MAX_RECURRENCE_DATES = 366;

/** Which week of the month a monthly or annual show falls in: the 1st to 4th, or the last. */
export const RECURRENCE_WEEKS = [1, 2, 3, 4, 'last'] as const;
export type RecurrenceWeek = (typeof RECURRENCE_WEEKS)[number];

const zRecurrenceWeek = z.literal(RECURRENCE_WEEKS);

/** Every week on each listed weekday, for example a Monday and Thursday TV show. */
export const WeeklyRecurrenceSchema = z.strictObject({
  kind: z.literal('weekly'),
  weekdays: z
    .array(zWeekday)
    .min(1)
    .max(7)
    .refine((weekdays) => !hasDuplicates(weekdays), { message: 'weekdays must be unique' }),
});

/**
 * Every `intervalWeeks` weeks on one weekday, counted from `anchor` (the first show). Every other
 * Wednesday is `{ kind: 'everyNWeeks', intervalWeeks: 2, weekday: 2, anchor: <a Wednesday> }`.
 */
export const EveryNWeeksRecurrenceSchema = z
  .strictObject({
    kind: z.literal('everyNWeeks'),
    intervalWeeks: z.number().int().min(EVERY_N_WEEKS_MIN).max(EVERY_N_WEEKS_MAX),
    weekday: zWeekday,
    anchor: zGameDate,
  })
  .refine((recurrence) => weekday(recurrence.anchor) === recurrence.weekday, {
    message: 'anchor must fall on the recurrence weekday',
    path: ['anchor'],
  });

/** One show a month, for example the last Sunday. */
export const MonthlyRecurrenceSchema = z.strictObject({
  kind: z.literal('monthly'),
  week: zRecurrenceWeek,
  weekday: zWeekday,
});

/** One show a year, for example the 2nd Saturday of June. `month` is 1-12. */
export const AnnualRecurrenceSchema = z.strictObject({
  kind: z.literal('annual'),
  month: z.number().int().min(1).max(12),
  week: zRecurrenceWeek,
  weekday: zWeekday,
});

/** An explicit list of dates, sorted and unique: one-off shows and irregular tours. */
export const DatesRecurrenceSchema = z.strictObject({
  kind: z.literal('dates'),
  dates: z
    .array(zGameDate)
    .min(1)
    .max(MAX_RECURRENCE_DATES)
    .refine((dates) => !hasDuplicates(dates), { message: 'dates must be unique' })
    .refine(isStrictlyAscending, { message: 'dates must be sorted, earliest first' }),
});

export const RecurrenceSchema = z.discriminatedUnion('kind', [
  WeeklyRecurrenceSchema,
  EveryNWeeksRecurrenceSchema,
  MonthlyRecurrenceSchema,
  AnnualRecurrenceSchema,
  DatesRecurrenceSchema,
]);

export type WeeklyRecurrence = z.infer<typeof WeeklyRecurrenceSchema>;
export type EveryNWeeksRecurrence = z.infer<typeof EveryNWeeksRecurrenceSchema>;
export type MonthlyRecurrence = z.infer<typeof MonthlyRecurrenceSchema>;
export type AnnualRecurrence = z.infer<typeof AnnualRecurrenceSchema>;
export type DatesRecurrence = z.infer<typeof DatesRecurrenceSchema>;
export type Recurrence = z.infer<typeof RecurrenceSchema>;
export type RecurrenceKind = Recurrence['kind'];

// ---------------------------------------------------------------------------------------------
// Show format

/** Range of main-card segment slots a show can have. */
export const SHOW_SLOTS_MIN = 3;
export const SHOW_SLOTS_MAX = 12;
/** Range of pre-show segment slots a show can have. */
export const PRE_SHOW_SLOTS_MIN = 0;
export const PRE_SHOW_SLOTS_MAX = 3;

/**
 * How many segments a card holds: `slots` on the main card and `preShowSlots` before it. Where a
 * segment sits decides its weight and duration class, which MTCH derives from the slot position
 * and is never stored.
 *
 * The ranges are deliberately wider than the defaults so a production-budget bonus slot (EVT) needs
 * no migration. The default slot count for each importance is content and tunables, not schema:
 * WLD-08 suggests house 5, minor 5, regular 6, major 8 and flagship 10 main-card slots, with 0-2
 * pre-show slots on major and flagship shows.
 */
export const ShowFormatSchema = z.strictObject({
  slots: z.number().int().min(SHOW_SLOTS_MIN).max(SHOW_SLOTS_MAX),
  preShowSlots: z.number().int().min(PRE_SHOW_SLOTS_MIN).max(PRE_SHOW_SLOTS_MAX),
});

export type ShowFormat = z.infer<typeof ShowFormatSchema>;

// ---------------------------------------------------------------------------------------------
// Event definition

/** How big a show is, from a non-televised house show up to the flagship event of the year. */
export const EVENT_IMPORTANCES = ['house', 'minor', 'regular', 'major', 'flagship'] as const;
export type EventImportance = (typeof EVENT_IMPORTANCES)[number];

export const zEventImportance = z.enum(EVENT_IMPORTANCES);

/**
 * A recurring or one-off show. Per-importance default slot counts are content and tunables (see
 * `ShowFormatSchema`); this schema only fixes the allowed ranges.
 */
export const EventDefinitionSchema = z
  .strictObject({
    id: zId('eventDefinition'),
    promotionId: zId('promotion'),
    /** The brand that runs the show, or null for a promotion-wide (supershow) event. */
    brandId: zId('brand').nullable(),
    name: zName(60),
    importance: zEventImportance,
    recurrence: RecurrenceSchema,
    format: ShowFormatSchema,
    televised: z.boolean(),
    preferredRegionId: zId('region').nullable(),
    preferredVenueId: zId('venue').nullable(),
    /** First day the definition may produce shows. */
    activeFrom: zGameDate,
    /** Last day the definition may produce shows, or null while it keeps running. */
    activeUntil: zGameDate.nullable(),
    logoRef: zImageRef,
  })
  .refine((definition) => isOpenOrOnOrAfter(definition.activeUntil, definition.activeFrom), {
    message: 'activeUntil must not be before activeFrom',
    path: ['activeUntil'],
  });

export type EventDefinition = z.infer<typeof EventDefinitionSchema>;

export const eventDefinitionsTable = defineTable({
  kind: 'eventDefinition',
  name: 'eventDefinitions',
  schema: EventDefinitionSchema,
  refs: [
    { path: 'promotionId', target: 'promotion', nullable: false },
    { path: 'brandId', target: 'brand', nullable: true },
    { path: 'preferredRegionId', target: 'region', nullable: true },
    { path: 'preferredVenueId', target: 'venue', nullable: true },
  ],
  indexes: [{ name: 'byPromotion', key: (definition) => definition.promotionId }],
});
