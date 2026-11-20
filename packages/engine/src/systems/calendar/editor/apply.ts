/**
 * The schedule editor's writes: apply a re-sync plan, and create, change or retire a recurring
 * show, or add a one-off special. The commands call these after their checks; a computer promotion
 * (AIP7) or a brand tool (CRTV6) can call the `...In` helpers directly.
 *
 * The helpers never check who controls the show (the commands do) and throw
 * `InvalidArgumentError` for input the draft checks would refuse, so a caller validates first.
 *
 * Design notes: docs/design/calendar.md#schedule-editor.
 */

import { addDays, compareDates, type GameDate } from '../../../core/date';
import { EntityNotFoundError, InvalidArgumentError } from '../../../core/errors';
import type {
  BrandId,
  EventDefinitionId,
  EventInstanceId,
  PromotionId,
  RegionId,
  VenueId,
} from '../../../core/ids';
import type { StepContext } from '../../../core/pipeline/context';
import type {
  EventDefinition,
  EventImportance,
  Recurrence,
} from '../../../model/entities/event-definition';
import type { RecurrenceView } from '../../../model/recurrence';
import type { DeepReadonly } from '../../../model/world';
import { cancelShow } from '../cancel';
import {
  addDaysWithinCalendar,
  instanceFieldsFor,
  isSchedulable,
  scheduleDefinitionWindow,
} from '../schedule';
import {
  checkDraft,
  effectiveFromOf,
  type DefinitionDraft,
  type DraftCheckContext,
  type DraftFormat,
} from './definitionDraft';
import { checkNewShow } from './newShowChecks';
import { planResync, type ResyncPlan } from './planResync';

/** What the editor's writes need from the step they run in. */
export type EditorContext = Pick<
  StepContext,
  'tx' | 'read' | 'date' | 'tunables' | 'publish' | 'recordTrace'
>;

/** What applying a plan did. */
export interface ResyncOutcome {
  added: EventInstanceId[];
  refreshed: EventInstanceId[];
  removed: EventInstanceId[];
  cancelled: EventInstanceId[];
  kept: ResyncPlan['kept'];
}

function checkContext(ctx: EditorContext): DraftCheckContext {
  return { today: ctx.date, tunables: ctx.tunables };
}

/** The window every editor change re-syncs: today + `minLeadDays` through the stored horizon. */
export function resyncWindowOf(ctx: DraftCheckContext): {
  effectiveFrom: GameDate;
  horizonEnd: GameDate;
} {
  return {
    effectiveFrom: effectiveFromOf(ctx),
    horizonEnd: addDaysWithinCalendar(ctx.today, ctx.tunables.get('calendar.scheduleHorizonDays')),
  };
}

/** Plans the re-sync of `definition` (as it will be stored) for the standard window. */
export function planFor(
  read: EditorContext['read'],
  definition: DeepReadonly<EventDefinition>,
  ctx: DraftCheckContext,
): ResyncPlan {
  const plan = planResync(read, { definition, ...resyncWindowOf(ctx), tunables: ctx.tunables });
  if (!isSchedulable(read, definition)) {
    plan.add = [];
  }
  return plan;
}

/**
 * Applies `plan` to the shows of the stored `definition`: refreshes, then removes (deletes or
 * cancels), then schedules the added dates through `scheduleDefinitionWindow`, the one creator.
 */
export function applyResync(
  ctx: EditorContext,
  definitionId: EventDefinitionId,
  plan: ResyncPlan,
): ResyncOutcome {
  const definition = ctx.read.tables.eventDefinitions.get(definitionId);
  if (definition === undefined) {
    throw new EntityNotFoundError('eventDefinitions', definitionId);
  }
  const outcome: ResyncOutcome = {
    added: [],
    refreshed: [],
    removed: [],
    cancelled: [],
    kept: plan.kept,
  };
  for (const row of plan.refresh) {
    const instance = ctx.read.tables.eventInstances.get(row.instanceId);
    if (instance === undefined) {
      continue;
    }
    const fields = instanceFieldsFor(ctx.read, definition, instance.date, ctx.tunables).value;
    const placeChanged =
      fields.regionId !== instance.regionId || fields.venueId !== instance.venueId;
    ctx.tx.update('eventInstances', instance.id, {
      name: fields.name,
      brandId: fields.brandId,
      importance: fields.importance,
      format: fields.format,
      ...(placeChanged
        ? { regionId: fields.regionId, venueId: fields.venueId, genericVenue: null }
        : {}),
    });
    outcome.refreshed.push(instance.id);
  }
  for (const row of plan.remove) {
    const instance = ctx.read.tables.eventInstances.get(row.instanceId);
    if (instance === undefined) {
      continue;
    }
    if (row.mode === 'cancel') {
      cancelShow(ctx, instance, 'byPromotion');
      outcome.cancelled.push(instance.id);
    } else {
      ctx.tx.delete('eventInstances', instance.id);
      outcome.removed.push(instance.id);
    }
  }
  if (plan.add.length > 0 && isSchedulable(ctx.read, definition)) {
    const first = plan.add[0] ?? ctx.date;
    const last = plan.add[plan.add.length - 1] ?? ctx.date;
    outcome.added = scheduleDefinitionWindow(ctx.tx, ctx.read, definition.id, first, last, {
      tunables: ctx.tunables,
      recordTrace: { record: ctx.recordTrace, date: ctx.date },
    });
    for (const id of outcome.added) {
      const show = ctx.read.tables.eventInstances.get(id);
      if (show !== undefined) {
        ctx.publish('show.scheduled', {
          eventInstanceId: id,
          promotionId: show.promotionId,
          date: show.date,
        });
      }
    }
  }
  return outcome;
}

function refuse(
  functionName: string,
  reasons: readonly { message: string }[],
  draft: unknown,
): never {
  throw new InvalidArgumentError(
    functionName,
    'draft',
    draft,
    reasons.map((reason) => reason.message).join('; '),
  );
}

/** A mutable copy of a recurrence (the bundle runs on bare V8, which has no structuredClone). */
export function copyRecurrence(recurrence: RecurrenceView): Recurrence {
  switch (recurrence.kind) {
    case 'weekly':
      return { kind: 'weekly', weekdays: [...recurrence.weekdays] };
    case 'everyNWeeks':
      return { ...recurrence };
    case 'monthly':
      return { ...recurrence };
    case 'annual':
      return { ...recurrence };
    case 'dates':
      return { kind: 'dates', dates: [...recurrence.dates] };
  }
}

/** A mutable copy of a stored definition. */
export function copyDefinition(definition: DeepReadonly<EventDefinition>): EventDefinition {
  return {
    ...definition,
    recurrence: copyRecurrence(definition.recurrence),
    format: { ...definition.format },
  };
}

function storedFields(draft: DeepReadonly<DefinitionDraft>) {
  return {
    brandId: draft.brandId,
    name: draft.name.trim(),
    importance: draft.importance,
    recurrence: copyRecurrence(draft.recurrence),
    format: { slots: draft.format.slots, preShowSlots: draft.format.preShowSlots },
    televised: draft.televised,
    preferredRegionId: draft.preferredRegionId,
    preferredVenueId: draft.preferredVenueId,
  };
}

/** Creates a recurring show for `promotionId` and schedules its dates up to the horizon. */
export function createDefinitionIn(
  ctx: EditorContext,
  promotionId: PromotionId,
  draft: DeepReadonly<DefinitionDraft>,
): { eventDefinitionId: EventDefinitionId; outcome: ResyncOutcome } {
  const checks = checkContext(ctx);
  const reasons = checkDraft(ctx.read, promotionId, draft, checks);
  if (reasons.length > 0) {
    refuse('createDefinitionIn', reasons, draft);
  }
  const { effectiveFrom } = resyncWindowOf(checks);
  const activeFrom =
    draft.activeFrom !== undefined && compareDates(draft.activeFrom, effectiveFrom) > 0
      ? draft.activeFrom
      : effectiveFrom;
  const definition = ctx.tx.create('eventDefinitions', {
    promotionId,
    ...storedFields(draft),
    activeFrom,
    activeUntil: null,
    logoRef: null,
  });
  const outcome = applyResync(ctx, definition.id, planFor(ctx.read, definition, checks));
  ctx.publish('eventDefinition.created', { eventDefinitionId: definition.id, promotionId });
  return { eventDefinitionId: definition.id, outcome };
}

/** The definition `draft` would make of the stored `definition` (nothing is written). */
export function draftedDefinition(
  definition: DeepReadonly<EventDefinition>,
  draft: DeepReadonly<DefinitionDraft>,
): EventDefinition {
  return { ...copyDefinition(definition), ...storedFields(draft) };
}

/** Changes a recurring show and re-syncs its future dates. */
export function updateDefinitionIn(
  ctx: EditorContext,
  definitionId: EventDefinitionId,
  draft: DeepReadonly<DefinitionDraft>,
): ResyncOutcome {
  const stored = ctx.read.tables.eventDefinitions.get(definitionId);
  if (stored === undefined) {
    throw new EntityNotFoundError('eventDefinitions', definitionId);
  }
  const checks = checkContext(ctx);
  const reasons = checkDraft(ctx.read, stored.promotionId, draft, checks, stored);
  if (reasons.length > 0) {
    refuse('updateDefinitionIn', reasons, draft);
  }
  const next = draftedDefinition(stored, draft);
  const plan = planFor(ctx.read, next, checks);
  ctx.tx.update('eventDefinitions', definitionId, storedFields(draft));
  const outcome = applyResync(ctx, definitionId, plan);
  ctx.publish('eventDefinition.updated', {
    eventDefinitionId: definitionId,
    promotionId: stored.promotionId,
    added: outcome.added.length,
    removed: outcome.removed.length + outcome.cancelled.length,
    kept: outcome.kept.length,
  });
  return outcome;
}

/**
 * The `activeUntil` retiring gives: the chosen last show date, else the day before the editor's
 * first changeable day. A show retired before it ever ran keeps `activeFrom <= activeUntil` by
 * moving `activeFrom` back to the same day, so the row stays valid and produces nothing.
 */
export function retiredRange(
  definition: DeepReadonly<Pick<EventDefinition, 'activeFrom'>>,
  lastShowDate: GameDate | null,
  ctx: DraftCheckContext,
): { activeFrom: GameDate; activeUntil: GameDate } {
  const activeUntil = lastShowDate ?? addDays(effectiveFromOf(ctx), -1);
  const activeFrom =
    compareDates(activeUntil, definition.activeFrom) < 0 ? activeUntil : definition.activeFrom;
  return { activeFrom, activeUntil };
}

/** Retires a recurring show: no dates after `activeUntil`; kept shows stay. */
export function retireDefinitionIn(
  ctx: EditorContext,
  definitionId: EventDefinitionId,
  options: { readonly lastShowDate?: GameDate | null } = {},
): { activeUntil: GameDate; outcome: ResyncOutcome } {
  const stored = ctx.read.tables.eventDefinitions.get(definitionId);
  if (stored === undefined) {
    throw new EntityNotFoundError('eventDefinitions', definitionId);
  }
  const checks = checkContext(ctx);
  const range = retiredRange(stored, options.lastShowDate ?? null, checks);
  const next: EventDefinition = { ...copyDefinition(stored), ...range };
  const plan = planFor(ctx.read, next, checks);
  ctx.tx.update('eventDefinitions', definitionId, range);
  const outcome = applyResync(ctx, definitionId, plan);
  ctx.publish('eventDefinition.retired', {
    eventDefinitionId: definitionId,
    promotionId: stored.promotionId,
    activeUntil: range.activeUntil,
  });
  return { activeUntil: range.activeUntil, outcome };
}

/** A one-off special as the editor sends it. */
export interface OneOffInput {
  readonly promotionId: PromotionId;
  readonly name: string;
  readonly brandId: BrandId | null;
  readonly importance: EventImportance;
  readonly format: DraftFormat;
  readonly date: GameDate;
  /** Null for the promotion's home region. */
  readonly regionId: RegionId | null;
  readonly venueId: VenueId | null;
}

/** Adds a one-off special: one dated show with no definition. */
export function addOneOffIn(ctx: EditorContext, input: OneOffInput): EventInstanceId {
  const checks = checkNewShow(ctx.read, input, checkContext(ctx));
  if (checks.reasons.length > 0) {
    refuse('addOneOffIn', checks.reasons, input);
  }
  const promotion = ctx.read.tables.promotions.get(input.promotionId);
  if (promotion === undefined) {
    throw new EntityNotFoundError('promotions', input.promotionId);
  }
  const venue = input.venueId === null ? undefined : ctx.read.tables.venues.get(input.venueId);
  const regionId = input.regionId ?? venue?.regionId ?? promotion.homeRegionId;
  const show = ctx.tx.create('eventInstances', {
    promotionId: input.promotionId,
    eventDefinitionId: null,
    brandId: input.brandId,
    name: input.name.trim(),
    importance: input.importance,
    format: { slots: input.format.slots, preShowSlots: input.format.preShowSlots },
    date: input.date,
    airDate: input.date,
    status: 'scheduled',
    venueId: input.venueId,
    genericVenue: null,
    regionId,
    result: null,
    cancellation: null,
  });
  ctx.publish('show.added', {
    eventInstanceId: show.id,
    promotionId: input.promotionId,
    date: input.date,
  });
  return show.id;
}
