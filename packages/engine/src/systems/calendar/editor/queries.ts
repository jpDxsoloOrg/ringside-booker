/**
 * The schedule editor's queries: what the New show, Manage shows and Retire sheets read.
 *
 * - `calendar.definitions`: the viewer's recurring shows (running, starting later, retired).
 * - `calendar.editorOptions`: brands, importances with their default card size, the date limits.
 * - `calendar.previewDefinition`: a draft's refusals, its next dates and, for an edit, the dry run
 *   of what Save does to the shows already on the books.
 * - `calendar.previewRetire`: the dates retiring takes off the calendar and the shows that stay.
 * - `calendar.placeChoices`: regions (home first) and a region's venues.
 * - `calendar.checkNewShow`: a one-off special's refusals and warnings.
 *
 * Queries never write. They run the same checks and the same planner as the commands, so a
 * preview says exactly what the command then does. A query cannot refuse except on its
 * arguments, so a rival's show comes back with a `notYourShow` reason in the result.
 *
 * Design notes: docs/design/calendar.md#schedule-editor.
 */

import { z } from 'zod';
import { viewerPromotionIds, type Viewer } from '../../../core/api/controller';
import { defineQuery, type QueryContext, type QueryDefinition } from '../../../core/api/query';
import type { Reason } from '../../../core/api/result';
import { compareDates, type GameDate } from '../../../core/date';
import type {
  BrandId,
  EventDefinitionId,
  EventInstanceId,
  PromotionId,
  RegionId,
  VenueId,
} from '../../../core/ids';
import {
  EVENT_IMPORTANCES,
  type EventDefinition,
  type EventImportance,
  type Recurrence,
  type ShowFormat,
} from '../../../model/entities/event-definition';
import { definitionAirDateKey } from '../../../model/entities/event-instance';
import { isVenueOpenOn, type VenueKind } from '../../../model/entities/venue';
import { nextOccurrence, occursOn } from '../../../model/recurrence';
import { zGameDate, zId } from '../../../model/primitives';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { recurrenceText } from '../recurrenceText';
import { addDaysWithinCalendar } from '../schedule';
import { copyRecurrence, draftedDefinition, planFor, retiredRange } from './apply';
import {
  AddOneOffArgsSchema,
  isRetired,
  keptViews,
  retireRefusals,
  type KeptShowView,
} from './commands';
import { controlsSchedule, NOT_YOUR_SHOW_MESSAGE } from './control';
import {
  checkDraft,
  dateWords,
  DefinitionDraftSchema,
  effectiveFromOf,
  IMPORTANCE_LABELS,
  maxDateOf,
  type DefinitionDraft,
  type DraftCheckContext,
} from './definitionDraft';
import { checkNewShow, type NewShowWarning } from './newShowChecks';
import type { ResyncPlan } from './planResync';
import { defaultFormatFor } from './tunables';

/** Where a recurring show is in its life. */
export type DefinitionState = 'running' | 'starts' | 'retired';

/**
 * Where a recurring show stands on the calendar:
 * - `onCalendar`: its next show is stored (`nextDate`).
 * - `later`: its next rule date (`ruleDate`) goes on the calendar on `addedOn`, when the stored
 *   horizon reaches it.
 * - `blocked`: it cannot be scheduled (closed promotion, brand not running).
 * - `noDates`: its rule has no dates left.
 * - `retired`: it has ended.
 */
export type SchedulingStatus = 'onCalendar' | 'later' | 'blocked' | 'noDates' | 'retired';

export interface DefinitionScheduling {
  status: SchedulingStatus;
  ruleDate: GameDate | null;
  addedOn: GameDate | null;
  /** The row's note in plain words; null when the show is on the calendar or retired. */
  text: string | null;
  /** `edit` when editing the show can fix it. */
  fix: 'edit' | null;
}

/** One recurring show as Manage shows lists it. */
export interface DefinitionRow {
  eventDefinitionId: EventDefinitionId;
  promotionId: PromotionId;
  name: string;
  brandId: BrandId | null;
  brandName: string | null;
  importance: EventImportance;
  recurrence: Recurrence;
  recurrenceText: string;
  format: ShowFormat;
  televised: boolean;
  preferredRegionId: RegionId | null;
  preferredRegionName: string | null;
  preferredVenueId: VenueId | null;
  preferredVenueName: string | null;
  activeFrom: GameDate;
  activeUntil: GameDate | null;
  state: DefinitionState;
  /**
   * The date of the next show already on the calendar (scheduled or booked, today or later), or
   * null when none is stored. Never a date the rule only promises: the Calendar shows stored shows.
   */
  nextDate: GameDate | null;
  /** Why there is no `nextDate`, in plain words, and what fixes it. */
  scheduling: DefinitionScheduling;
  /** True when the viewer may edit or retire it. */
  editable: boolean;
}

export interface EditorOptionsView {
  promotionId: PromotionId;
  promotionName: string;
  /** False for a promotion the viewer does not run: the sheets open read-only. */
  editable: boolean;
  brands: { brandId: BrandId; name: string; active: boolean }[];
  importances: { importance: EventImportance; label: string; defaultFormat: ShowFormat }[];
  /** The first date a new or changed show can land on. */
  effectiveFrom: GameDate;
  /** The last date a one-off or a new show's first date may use. */
  maxDate: GameDate;
  homeRegionId: RegionId;
  homeRegionName: string;
}

/** A dry run's plan in the player's terms. */
export interface PlanView {
  add: GameDate[];
  refresh: { eventInstanceId: EventInstanceId; date: GameDate; changes: string[] }[];
  remove: { eventInstanceId: EventInstanceId; date: GameDate; name: string; cancel: boolean }[];
  kept: KeptShowView[];
}

export interface PreviewDefinitionView {
  reasons: Reason[];
  nextDates: GameDate[];
  recurrenceText: string;
  /** For an edit: what Save does to the stored shows. Null for a new show or a refused draft. */
  plan: PlanView | null;
}

export interface PreviewRetireView {
  reasons: Reason[];
  activeUntil: GameDate;
  removed: { date: GameDate; name: string }[];
  kept: KeptShowView[];
}

export interface PlaceChoicesView {
  homeRegionId: RegionId;
  regions: {
    regionId: RegionId;
    name: string;
    countryName: string;
    isHome: boolean;
    isNeighbourOfHome: boolean;
    isHomeCountry: boolean;
  }[];
  venues: {
    venueId: VenueId;
    name: string;
    capacity: number;
    kind: VenueKind;
    available: boolean;
    unavailableReason: string | null;
  }[];
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'calendar.definitions': {
      args: { promotionId?: PromotionId | undefined };
      result: DefinitionRow[];
    };
    'calendar.editorOptions': {
      args: { promotionId: PromotionId };
      result: EditorOptionsView | null;
    };
    'calendar.previewDefinition': {
      args: {
        promotionId: PromotionId;
        eventDefinitionId: EventDefinitionId | null;
        draft: DefinitionDraft;
        count?: number | undefined;
      };
      result: PreviewDefinitionView;
    };
    'calendar.previewRetire': {
      args: { eventDefinitionId: EventDefinitionId; lastShowDate?: GameDate | null | undefined };
      result: PreviewRetireView;
    };
    'calendar.placeChoices': {
      args: {
        promotionId: PromotionId;
        regionId?: RegionId | undefined;
        date?: GameDate | undefined;
      };
      result: PlaceChoicesView | null;
    };
    'calendar.checkNewShow': {
      args: { show: z.infer<typeof AddOneOffArgsSchema> };
      result: { reasons: Reason[]; warnings: NewShowWarning[] };
    };
  }
}

function checksOf(ctx: QueryContext): DraftCheckContext {
  return { today: ctx.date, tunables: ctx.tunables };
}

/** The viewer's controller, or null for the omniscient viewer (who runs no show). */
function controllerOf(viewer: DeepReadonly<Viewer>) {
  return viewer.kind === 'controller' ? viewer.controller : null;
}

function ownership(
  ctx: QueryContext,
  owner: { readonly promotionId: PromotionId; readonly brandId: BrandId | null },
): Reason[] {
  const controller = controllerOf(ctx.viewer);
  if (controller === null) {
    return [{ code: 'notYourShow', message: NOT_YOUR_SHOW_MESSAGE }];
  }
  return controlsSchedule(ctx.read, owner, controller);
}

const IMPORTANCE_ORDER: Readonly<Record<EventImportance, number>> = {
  flagship: 0,
  major: 1,
  regular: 2,
  minor: 3,
  house: 4,
};

const STATE_ORDER: Readonly<Record<DefinitionState, number>> = {
  running: 0,
  starts: 1,
  retired: 2,
};

function stateOf(
  definition: DeepReadonly<EventDefinition>,
  checks: DraftCheckContext,
): DefinitionState {
  const today = checks.today;
  if (isRetired(definition, checks)) {
    return 'retired';
  }
  return compareDates(definition.activeFrom, today) > 0 ? 'starts' : 'running';
}

/**
 * The next open show of the definition already on the calendar (scheduled or booked, today or
 * later), or null. Only stored shows count: the Calendar shows nothing else.
 */
function nextStoredDateOf(
  read: GameWorldView,
  definition: DeepReadonly<EventDefinition>,
  today: GameDate,
): GameDate | null {
  let soonest: GameDate | null = null;
  for (const show of read.tables.eventInstances.lookup('byDefinition', definition.id)) {
    if (
      show.status === 'cancelled' ||
      show.status === 'completed' ||
      compareDates(show.date, today) < 0
    ) {
      continue;
    }
    if (soonest === null || compareDates(show.date, soonest) < 0) {
      soonest = show.date;
    }
  }
  return soonest;
}

/**
 * The first date from `from` the definition's rule gives that has no show at all yet (a date that
 * already has a row, whatever its status, is never scheduled again), or null when the rule has no
 * such date left. Looks at most {@link MAX_RULE_LOOKAHEAD} dates ahead.
 */
function nextUnstoredRuleDate(
  read: GameWorldView,
  definition: DeepReadonly<EventDefinition>,
  from: GameDate,
): GameDate | null {
  const start = compareDates(definition.activeFrom, from) > 0 ? definition.activeFrom : from;
  let candidate: GameDate | null = occursOn(definition.recurrence, start)
    ? start
    : nextOccurrence(definition.recurrence, start);
  for (let looked = 0; candidate !== null && looked < MAX_RULE_LOOKAHEAD; looked += 1) {
    if (definition.activeUntil !== null && compareDates(candidate, definition.activeUntil) > 0) {
      return null;
    }
    const stored = read.tables.eventInstances.lookupOne(
      'byDefinitionAirDate',
      definitionAirDateKey(definition.id, candidate),
    );
    if (stored === undefined) {
      return candidate;
    }
    candidate = nextOccurrence(definition.recurrence, candidate);
  }
  return null;
}

/** How many rule dates `nextUnstoredRuleDate` steps over before it gives up. */
const MAX_RULE_LOOKAHEAD = 800;

/**
 * Whether a recurring show has a date on the calendar and, when it has none, why, in plain words
 * (UNITY-40). `nextDate` is only ever a stored show's date, so Manage shows never lists a date the
 * Calendar does not have.
 */
export function schedulingOf(
  read: GameWorldView,
  definition: DeepReadonly<EventDefinition>,
  checks: DraftCheckContext,
): { nextDate: GameDate | null; scheduling: DefinitionScheduling } {
  const today = checks.today;
  const nextDate = nextStoredDateOf(read, definition, today);
  if (isRetired(definition, checks)) {
    return {
      nextDate,
      scheduling: { status: 'retired', ruleDate: null, addedOn: null, text: null, fix: null },
    };
  }
  if (nextDate !== null) {
    return {
      nextDate,
      scheduling: { status: 'onCalendar', ruleDate: null, addedOn: null, text: null, fix: null },
    };
  }
  const promotion = read.tables.promotions.get(definition.promotionId);
  if (promotion?.status !== 'active') {
    return {
      nextDate,
      scheduling: {
        status: 'blocked',
        ruleDate: null,
        addedOn: null,
        text: `Not on the calendar: ${promotion?.name ?? 'the promotion'} has closed, so it runs no shows.`,
        fix: null,
      },
    };
  }
  if (definition.brandId !== null) {
    const brand = read.tables.brands.get(definition.brandId);
    if (brand?.active !== true) {
      return {
        nextDate,
        scheduling: {
          status: 'blocked',
          ruleDate: null,
          addedOn: null,
          text: `Not on the calendar: the ${brand?.name ?? "show's"} brand is not running. Edit the show to move it to another brand or the whole promotion.`,
          fix: 'edit',
        },
      };
    }
  }
  // Today's shows are already made (the day's scheduling starts at tomorrow), so a rule date today
  // without a show never gets one.
  const ruleDate = nextUnstoredRuleDate(read, definition, addDaysWithinCalendar(today, 1));
  if (ruleDate === null) {
    return {
      nextDate,
      scheduling: {
        status: 'noDates',
        ruleDate: null,
        addedOn: null,
        text: 'Not on the calendar: its schedule has no dates left. Edit the show to give it new dates, or retire it.',
        fix: 'edit',
      },
    };
  }
  const horizonDays = checks.tunables.get('calendar.scheduleHorizonDays');
  const horizonEnd = addDaysWithinCalendar(today, horizonDays);
  if (compareDates(ruleDate, horizonEnd) > 0) {
    const addedOn = addDaysWithinCalendar(ruleDate, -horizonDays);
    return {
      nextDate,
      scheduling: {
        status: 'later',
        ruleDate,
        addedOn,
        text: `Not on the calendar yet: the next show is ${dateWords(ruleDate)}. Shows go on the calendar ${String(horizonDays)} days ahead, so it is added on ${dateWords(addedOn)}.`,
        fix: null,
      },
    };
  }
  // Inside the horizon but not stored yet: the next day's scheduling adds it.
  return {
    nextDate,
    scheduling: {
      status: 'later',
      ruleDate,
      addedOn: addDaysWithinCalendar(today, 1),
      text: `Not on the calendar yet: ${dateWords(ruleDate)} is added when the day ends.`,
      fix: null,
    },
  };
}

/** The next `count` dates the definition runs on from `from` (included). */
function nextDates(
  definition: DeepReadonly<Pick<EventDefinition, 'recurrence' | 'activeFrom' | 'activeUntil'>>,
  from: GameDate,
  count: number,
): GameDate[] {
  const dates: GameDate[] = [];
  const start = compareDates(definition.activeFrom, from) > 0 ? definition.activeFrom : from;
  let candidate: GameDate | null = occursOn(definition.recurrence, start)
    ? start
    : nextOccurrence(definition.recurrence, start);
  while (candidate !== null && dates.length < count) {
    if (definition.activeUntil !== null && compareDates(candidate, definition.activeUntil) > 0) {
      break;
    }
    dates.push(candidate);
    candidate = nextOccurrence(definition.recurrence, candidate);
  }
  return dates;
}

export const definitionsQuery: QueryDefinition<'calendar.definitions'> = defineQuery(
  'calendar.definitions',
  {
    args: z.strictObject({ promotionId: zId('promotion').optional() }),
    run: (ctx, args) => {
      const promotionIds =
        args.promotionId === undefined
          ? viewerPromotionIds(ctx.read, ctx.viewer)
          : [args.promotionId];
      const rows: DefinitionRow[] = [];
      for (const promotionId of promotionIds) {
        for (const definition of ctx.read.tables.eventDefinitions.lookup(
          'byPromotion',
          promotionId,
        )) {
          const brand =
            definition.brandId === null
              ? undefined
              : ctx.read.tables.brands.get(definition.brandId);
          const region =
            definition.preferredRegionId === null
              ? undefined
              : ctx.read.tables.regions.get(definition.preferredRegionId);
          const venue =
            definition.preferredVenueId === null
              ? undefined
              : ctx.read.tables.venues.get(definition.preferredVenueId);
          const state = stateOf(definition, checksOf(ctx));
          rows.push({
            eventDefinitionId: definition.id,
            promotionId: definition.promotionId,
            name: definition.name,
            brandId: definition.brandId,
            brandName: brand?.name ?? null,
            importance: definition.importance,
            recurrence: copyRecurrence(definition.recurrence),
            recurrenceText: recurrenceText(definition.recurrence),
            format: {
              slots: definition.format.slots,
              preShowSlots: definition.format.preShowSlots,
            },
            televised: definition.televised,
            preferredRegionId: definition.preferredRegionId,
            preferredRegionName: region?.name ?? null,
            preferredVenueId: definition.preferredVenueId,
            preferredVenueName: venue?.name ?? null,
            activeFrom: definition.activeFrom,
            activeUntil: definition.activeUntil,
            state,
            ...schedulingOf(ctx.read, definition, checksOf(ctx)),
            editable: state !== 'retired' && ownership(ctx, definition).length === 0,
          });
        }
      }
      rows.sort(
        (left, right) =>
          STATE_ORDER[left.state] - STATE_ORDER[right.state] ||
          IMPORTANCE_ORDER[left.importance] - IMPORTANCE_ORDER[right.importance] ||
          (left.name < right.name ? -1 : left.name > right.name ? 1 : 0) ||
          (left.eventDefinitionId < right.eventDefinitionId ? -1 : 1),
      );
      return rows;
    },
  },
);

export const editorOptionsQuery: QueryDefinition<'calendar.editorOptions'> = defineQuery(
  'calendar.editorOptions',
  {
    args: z.strictObject({ promotionId: zId('promotion') }),
    run: (ctx, args) => {
      const promotion = ctx.read.tables.promotions.get(args.promotionId);
      if (promotion === undefined) {
        return null;
      }
      const brands = [...ctx.read.tables.brands.lookup('byPromotion', promotion.id)]
        .sort((left, right) => left.priority - right.priority || (left.id < right.id ? -1 : 1))
        .map((brand) => ({ brandId: brand.id, name: brand.name, active: brand.active }));
      const checks = checksOf(ctx);
      return {
        promotionId: promotion.id,
        promotionName: promotion.name,
        editable: ownership(ctx, { promotionId: promotion.id, brandId: null }).length === 0,
        brands,
        importances: EVENT_IMPORTANCES.map((importance) => ({
          importance,
          label: IMPORTANCE_LABELS[importance],
          defaultFormat: defaultFormatFor(ctx.tunables, importance),
        })),
        effectiveFrom: effectiveFromOf(checks),
        maxDate: maxDateOf(checks),
        homeRegionId: promotion.homeRegionId,
        homeRegionName: ctx.read.tables.regions.get(promotion.homeRegionId)?.name ?? '',
      };
    },
  },
);

function planView(read: GameWorldView, plan: ResyncPlan): PlanView {
  return {
    add: plan.add,
    refresh: plan.refresh.map((row) => ({
      eventInstanceId: row.instanceId,
      date: row.date,
      changes: row.changes,
    })),
    remove: plan.remove.map((row) => ({
      eventInstanceId: row.instanceId,
      date: row.date,
      name: row.name,
      cancel: row.mode === 'cancel',
    })),
    kept: keptViews(read, plan.kept),
  };
}

const MAX_PREVIEW_DATES = 10;

export const previewDefinitionQuery: QueryDefinition<'calendar.previewDefinition'> = defineQuery(
  'calendar.previewDefinition',
  {
    args: z.strictObject({
      promotionId: zId('promotion'),
      eventDefinitionId: zId('eventDefinition').nullable(),
      draft: DefinitionDraftSchema,
      count: z.number().int().min(1).max(MAX_PREVIEW_DATES).optional(),
    }),
    run: (ctx, args) => {
      const checks = checksOf(ctx);
      const count = args.count ?? 5;
      const stored =
        args.eventDefinitionId === null
          ? undefined
          : ctx.read.tables.eventDefinitions.get(args.eventDefinitionId);
      const effectiveFrom = effectiveFromOf(checks);
      const text = recurrenceText(args.draft.recurrence);
      if (args.eventDefinitionId !== null && stored === undefined) {
        return {
          reasons: [{ code: 'notFound', message: 'That show no longer exists' }],
          nextDates: [],
          recurrenceText: text,
          plan: null,
        };
      }
      const owner = stored ?? { promotionId: args.promotionId, brandId: args.draft.brandId };
      const reasons = [
        ...ownership(ctx, owner),
        ...checkDraft(ctx.read, owner.promotionId, args.draft, checks, stored),
      ];
      if (stored === undefined) {
        const activeFrom =
          args.draft.activeFrom !== undefined &&
          compareDates(args.draft.activeFrom, effectiveFrom) > 0
            ? args.draft.activeFrom
            : effectiveFrom;
        return {
          reasons,
          nextDates: nextDates(
            { recurrence: args.draft.recurrence, activeFrom, activeUntil: null },
            activeFrom,
            count,
          ),
          recurrenceText: text,
          plan: null,
        };
      }
      const next = draftedDefinition(stored, args.draft);
      return {
        reasons,
        nextDates: nextDates(next, effectiveFrom, count),
        recurrenceText: text,
        plan: reasons.length > 0 ? null : planView(ctx.read, planFor(ctx.read, next, checks)),
      };
    },
  },
);

export const previewRetireQuery: QueryDefinition<'calendar.previewRetire'> = defineQuery(
  'calendar.previewRetire',
  {
    args: z.strictObject({
      eventDefinitionId: zId('eventDefinition'),
      lastShowDate: zGameDate.nullable().optional(),
    }),
    run: (ctx, args) => {
      const stored = ctx.read.tables.eventDefinitions.get(args.eventDefinitionId);
      const checks = checksOf(ctx);
      const reasons = retireRefusals(
        ctx.read,
        args,
        controllerOf(ctx.viewer) ?? { kind: 'computer' },
        ctx.tunables,
      );
      if (stored === undefined) {
        return { reasons, activeUntil: ctx.date, removed: [], kept: [] };
      }
      const range = retiredRange(stored, args.lastShowDate ?? null, checks);
      const next = { ...stored, ...range };
      const plan = planFor(ctx.read, next, checks);
      return {
        reasons,
        activeUntil: range.activeUntil,
        removed: plan.remove.map((row) => ({ date: row.date, name: row.name })),
        kept: keptViews(ctx.read, plan.kept),
      };
    },
  },
);

export const placeChoicesQuery: QueryDefinition<'calendar.placeChoices'> = defineQuery(
  'calendar.placeChoices',
  {
    args: z.strictObject({
      promotionId: zId('promotion'),
      regionId: zId('region').optional(),
      date: zGameDate.optional(),
    }),
    run: (ctx, args) => {
      const promotion = ctx.read.tables.promotions.get(args.promotionId);
      if (promotion === undefined) {
        return null;
      }
      const home = ctx.read.tables.regions.get(promotion.homeRegionId);
      const neighbours = new Set<string>(home?.neighbourRegionIds ?? []);
      const regions = ctx.read.tables.regions
        .values()
        .map((region) => ({
          regionId: region.id,
          name: region.name,
          countryName: ctx.read.tables.countries.get(region.countryId)?.name ?? '',
          isHome: region.id === promotion.homeRegionId,
          isNeighbourOfHome: neighbours.has(region.id),
          isHomeCountry: region.countryId === home?.countryId,
        }))
        .sort(
          (left, right) =>
            Number(right.isHome) - Number(left.isHome) ||
            Number(right.isNeighbourOfHome) - Number(left.isNeighbourOfHome) ||
            Number(right.isHomeCountry) - Number(left.isHomeCountry) ||
            (left.countryName < right.countryName
              ? -1
              : left.countryName > right.countryName
                ? 1
                : 0) ||
            (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
        );
      const venues: PlaceChoicesView['venues'] = [];
      if (args.regionId !== undefined) {
        const date = args.date ?? effectiveFromOf(checksOf(ctx));
        for (const venue of ctx.read.tables.venues.lookup('byRegion', args.regionId)) {
          let unavailableReason: string | null = null;
          if (!isVenueOpenOn(venue, date)) {
            unavailableReason = 'Closed';
          } else if (
            venue.exclusivePromotionId !== null &&
            venue.exclusivePromotionId !== promotion.id
          ) {
            const other = ctx.read.tables.promotions.get(venue.exclusivePromotionId);
            unavailableReason = `Only hosts ${other?.name ?? 'another promotion'}`;
          }
          venues.push({
            venueId: venue.id,
            name: venue.name,
            capacity: venue.capacity,
            kind: venue.kind,
            available: unavailableReason === null,
            unavailableReason,
          });
        }
        venues.sort(
          (left, right) => left.capacity - right.capacity || (left.name < right.name ? -1 : 1),
        );
      }
      return { homeRegionId: promotion.homeRegionId, regions, venues };
    },
  },
);

export const checkNewShowQuery: QueryDefinition<'calendar.checkNewShow'> = defineQuery(
  'calendar.checkNewShow',
  {
    args: z.strictObject({ show: AddOneOffArgsSchema }),
    run: (ctx, args) => {
      const checked = checkNewShow(ctx.read, args.show, checksOf(ctx));
      return {
        reasons: [
          ...ownership(ctx, { promotionId: args.show.promotionId, brandId: args.show.brandId }),
          ...checked.reasons,
        ],
        warnings: checked.warnings,
      };
    },
  },
);

export const calendarEditorQueries: readonly QueryDefinition[] = [
  definitionsQuery,
  editorOptionsQuery,
  previewDefinitionQuery,
  previewRetireQuery,
  placeChoicesQuery,
  checkNewShowQuery,
];
