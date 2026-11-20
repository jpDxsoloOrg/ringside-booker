/**
 * What the player fills in to create or change a recurring show, and the checks both the commands
 * and the preview query run on it, so the editor shows the same words the command would refuse
 * with.
 *
 * The format is two plain integers so an out-of-range slot count reaches these checks and gets
 * player wording ("A show needs at least 3 slots") instead of an `invalidArgs` refusal. Nothing here
 * is a length or a running time (design decision D-10).
 *
 * Design notes: docs/design/calendar.md#schedule-editor.
 */

import { z } from 'zod';
import type { Reason } from '../../../core/api/result';
import { compareDates, weekday, dayOfMonth, month, year, type GameDate } from '../../../core/date';
import type { PromotionId } from '../../../core/ids';
import {
  PRE_SHOW_SLOTS_MAX,
  PRE_SHOW_SLOTS_MIN,
  RecurrenceSchema,
  SHOW_SLOTS_MAX,
  SHOW_SLOTS_MIN,
  zEventImportance,
  type EventDefinition,
  type EventImportance,
  type Recurrence,
} from '../../../model/entities/event-definition';
import { isVenueOpenOn } from '../../../model/entities/venue';
import { zGameDate, zId } from '../../../model/primitives';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import type { EngineTunables } from '../../tunables';
import { addDaysWithinCalendar } from '../schedule';

/** The longest show name, as `zName(60)` stores it. */
export const SHOW_NAME_MAX = 60;

/** A card size as the editor sends it: plain integers, checked by {@link checkFormat}. */
export const DraftFormatSchema = z.strictObject({
  slots: z.number().int().min(-1000).max(1000),
  preShowSlots: z.number().int().min(-1000).max(1000),
});
export type DraftFormat = z.infer<typeof DraftFormatSchema>;

/** A recurring show as the editor sends it. */
export const DefinitionDraftSchema = z.strictObject({
  name: z.string().max(200),
  /** The brand that runs the show, or null for the whole promotion. */
  brandId: zId('brand').nullable(),
  importance: zEventImportance,
  recurrence: RecurrenceSchema,
  format: DraftFormatSchema,
  televised: z.boolean(),
  preferredRegionId: zId('region').nullable(),
  preferredVenueId: zId('venue').nullable(),
  /** The first day a new show may run; ignored when an existing show is changed. */
  activeFrom: zGameDate.optional(),
});
export type DefinitionDraft = z.infer<typeof DefinitionDraftSchema>;

/** What the checks read besides the world. */
export interface DraftCheckContext {
  readonly today: GameDate;
  readonly tunables: EngineTunables;
}

/** The first day a new or changed show can land on: today plus `calendar.editor.minLeadDays`. */
export function effectiveFromOf(ctx: DraftCheckContext): GameDate {
  return addDaysWithinCalendar(ctx.today, ctx.tunables.get('calendar.editor.minLeadDays'));
}

/** The last day a one-off or a new show's first date may use: today plus `maxLeadDays`. */
export function maxDateOf(ctx: DraftCheckContext): GameDate {
  return addDaysWithinCalendar(ctx.today, ctx.tunables.get('calendar.editor.maxLeadDays'));
}

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** "Fri 8 Jan 2027": a date in the player's words. */
export function dateWords(date: GameDate): string {
  return `${WEEKDAY_SHORT[weekday(date)]} ${String(dayOfMonth(date))} ${MONTH_SHORT[month(date) - 1] ?? ''} ${String(year(date))}`;
}

function reason(code: string, message: string, field: string): Reason {
  return { code, message, field };
}

/** The slot and pre-show slot refusals; `field` is prefixed to `slots` / `preShowSlots`. */
export function checkFormat(format: DraftFormat, fieldPrefix = 'format.'): Reason[] {
  const reasons: Reason[] = [];
  if (format.slots < SHOW_SLOTS_MIN) {
    reasons.push(
      reason(
        'tooFewSlots',
        `A show needs at least ${String(SHOW_SLOTS_MIN)} slots`,
        `${fieldPrefix}slots`,
      ),
    );
  } else if (format.slots > SHOW_SLOTS_MAX) {
    reasons.push(
      reason(
        'tooManySlots',
        `A show can have at most ${String(SHOW_SLOTS_MAX)} slots`,
        `${fieldPrefix}slots`,
      ),
    );
  }
  const preShowMessage = `Pre-show slots go from ${String(PRE_SHOW_SLOTS_MIN)} to ${String(PRE_SHOW_SLOTS_MAX)}`;
  if (format.preShowSlots < PRE_SHOW_SLOTS_MIN) {
    reasons.push(reason('tooFewPreShowSlots', preShowMessage, `${fieldPrefix}preShowSlots`));
  } else if (format.preShowSlots > PRE_SHOW_SLOTS_MAX) {
    reasons.push(reason('tooManyPreShowSlots', preShowMessage, `${fieldPrefix}preShowSlots`));
  }
  return reasons;
}

/** The name refusals: empty or longer than {@link SHOW_NAME_MAX} once trimmed. */
export function checkName(name: string, field = 'name'): Reason[] {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return [reason('nameMissing', 'Give the show a name', field)];
  }
  if (trimmed.length > SHOW_NAME_MAX) {
    return [
      reason('nameTooLong', `Show names can be at most ${String(SHOW_NAME_MAX)} characters`, field),
    ];
  }
  return [];
}

/** The brand refusals: the brand must belong to the promotion and still be running. */
export function checkBrand(
  read: GameWorldView,
  promotionId: PromotionId,
  brandId: DefinitionDraft['brandId'],
  field = 'brandId',
): Reason[] {
  if (brandId === null) {
    return [];
  }
  const brand = read.tables.brands.get(brandId);
  const promotion = read.tables.promotions.get(promotionId);
  if (brand?.promotionId !== promotionId) {
    return [
      reason(
        'brandNotInPromotion',
        `That brand is not part of ${promotion?.name ?? 'this promotion'}`,
        field,
      ),
    ];
  }
  if (!brand.active) {
    return [reason('brandInactive', `${brand.name} is not running any more`, field)];
  }
  return [];
}

/**
 * The place refusals: a known region, and a venue that is in that region, open on `onDate` and
 * not kept for another promotion.
 */
export function checkPlace(
  read: GameWorldView,
  promotionId: PromotionId,
  place: {
    readonly regionId: DefinitionDraft['preferredRegionId'];
    readonly venueId: DefinitionDraft['preferredVenueId'];
  },
  onDate: GameDate,
  fields: { readonly region: string; readonly venue: string },
): Reason[] {
  const reasons: Reason[] = [];
  const region = place.regionId === null ? undefined : read.tables.regions.get(place.regionId);
  if (place.regionId !== null && region === undefined) {
    reasons.push(reason('unknownRegion', 'That region is not on the map', fields.region));
  }
  if (place.venueId === null) {
    return reasons;
  }
  const venue = read.tables.venues.get(place.venueId);
  if (venue === undefined) {
    reasons.push(reason('unknownVenue', 'That venue does not exist', fields.venue));
    return reasons;
  }
  if (region !== undefined && venue.regionId !== region.id) {
    reasons.push(
      reason('venueNotInRegion', `${venue.name} is not in ${region.name}`, fields.venue),
    );
  }
  if (!isVenueOpenOn(venue, onDate)) {
    reasons.push(
      reason('venueClosed', `${venue.name} is not open on ${dateWords(onDate)}`, fields.venue),
    );
  }
  if (venue.exclusivePromotionId !== null && venue.exclusivePromotionId !== promotionId) {
    const other = read.tables.promotions.get(venue.exclusivePromotionId);
    reasons.push(
      reason(
        'venueExclusive',
        `${venue.name} only hosts ${other?.name ?? 'another promotion'}`,
        fields.venue,
      ),
    );
  }
  return reasons;
}

function sameRecurrence(left: DeepReadonly<Recurrence>, right: DeepReadonly<Recurrence>): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Every reason the draft cannot be saved for `promotionId`, each with the `field` the editor puts
 * it under. `editing` is the stored definition when an existing show is changed: its own name does
 * not count as taken, and it may keep (but not switch to) a set-dates recurrence.
 */
export function checkDraft(
  read: GameWorldView,
  promotionId: PromotionId,
  draft: DeepReadonly<DefinitionDraft>,
  ctx: DraftCheckContext,
  editing?: DeepReadonly<EventDefinition>,
): Reason[] {
  const reasons: Reason[] = [...checkName(draft.name)];
  const promotion = read.tables.promotions.get(promotionId);
  const trimmed = draft.name.trim().toLowerCase();
  if (reasons.length === 0) {
    for (const definition of read.tables.eventDefinitions.lookup('byPromotion', promotionId)) {
      const retired =
        definition.activeUntil !== null && compareDates(definition.activeUntil, ctx.today) < 0;
      if (definition.id === editing?.id || retired) {
        continue;
      }
      if (definition.name.trim().toLowerCase() === trimmed) {
        reasons.push(
          reason(
            'nameTaken',
            `${promotion?.name ?? 'This promotion'} already has a show called ${draft.name.trim()}`,
            'name',
          ),
        );
        break;
      }
    }
  }
  reasons.push(...checkBrand(read, promotionId, draft.brandId));
  if (
    draft.recurrence.kind === 'dates' &&
    (editing === undefined || !sameRecurrence(editing.recurrence, draft.recurrence))
  ) {
    reasons.push(
      reason('datesNotAllowed', 'Use a one-off special for shows on set dates', 'recurrence'),
    );
  }
  reasons.push(...checkFormat(draft.format));
  const effectiveFrom = effectiveFromOf(ctx);
  if (editing === undefined && draft.activeFrom !== undefined) {
    if (compareDates(draft.activeFrom, effectiveFrom) < 0) {
      reasons.push(
        reason(
          'activeFromTooEarly',
          `New shows can start from ${dateWords(effectiveFrom)}`,
          'activeFrom',
        ),
      );
    } else if (compareDates(draft.activeFrom, maxDateOf(ctx)) > 0) {
      reasons.push(
        reason(
          'activeFromTooFar',
          `New shows must start by ${dateWords(maxDateOf(ctx))}`,
          'activeFrom',
        ),
      );
    }
  }
  reasons.push(
    ...checkPlace(
      read,
      promotionId,
      { regionId: draft.preferredRegionId, venueId: draft.preferredVenueId },
      editing === undefined &&
        draft.activeFrom !== undefined &&
        compareDates(draft.activeFrom, effectiveFrom) > 0
        ? draft.activeFrom
        : effectiveFrom,
      { region: 'preferredRegionId', venue: 'preferredVenueId' },
    ),
  );
  return reasons;
}

/** The importance words the editor shows, house show to flagship. */
export const IMPORTANCE_LABELS: Readonly<Record<EventImportance, string>> = {
  house: 'House show',
  minor: 'Minor show',
  regular: 'Weekly TV',
  major: 'Major event',
  flagship: 'Flagship event',
};
