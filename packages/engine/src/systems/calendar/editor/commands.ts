/**
 * The schedule editor's commands: create, change and retire a recurring show, and add a one-off
 * special. Each one checks who runs the show and the draft first, with the same functions the
 * preview queries use, then calls the `...In` helper in `apply.ts`.
 *
 * Design notes: docs/design/calendar.md#schedule-editor.
 */

import { z } from 'zod';
import { defineCommand } from '../../../core/api/command';
import type { Reason } from '../../../core/api/result';
import { compareDates, type GameDate } from '../../../core/date';
import { EntityNotFoundError } from '../../../core/errors';
import type {
  BrandId,
  EventDefinitionId,
  EventInstanceId,
  PromotionId,
  RegionId,
  VenueId,
} from '../../../core/ids';
import { zEventImportance, type EventImportance } from '../../../model/entities/event-definition';
import { zGameDate, zId } from '../../../model/primitives';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import {
  addOneOffIn,
  createDefinitionIn,
  retireDefinitionIn,
  updateDefinitionIn,
  type ResyncOutcome,
} from './apply';
import { controlsSchedule } from './control';
import {
  checkDraft,
  dateWords,
  DefinitionDraftSchema,
  effectiveFromOf,
  DraftFormatSchema,
  type DefinitionDraft,
  type DraftCheckContext,
  type DraftFormat,
} from './definitionDraft';
import { checkNewShow, type NewShowWarning } from './newShowChecks';
import { keptReasonText, type KeptReason } from './planResync';

/** A kept show as a command or preview reports it. */
export interface KeptShowView {
  eventInstanceId: EventInstanceId;
  date: GameDate;
  name: string;
  reason: KeptReason;
  reasonText: string;
  stillOnRule: boolean;
}

/** What `calendar.updateDefinition` and `calendar.retireDefinition` did to the shows. */
export interface ResyncResultView {
  added: GameDate[];
  refreshed: number;
  removed: GameDate[];
  kept: KeptShowView[];
}

export interface AddOneOffArgs {
  promotionId: PromotionId;
  name: string;
  brandId: BrandId | null;
  importance: EventImportance;
  format: DraftFormat;
  date: GameDate;
  regionId: RegionId | null;
  venueId: VenueId | null;
}

declare module '../../../core/api/maps' {
  interface CommandMap {
    'calendar.createDefinition': {
      args: { promotionId: PromotionId; draft: DefinitionDraft };
      result: { eventDefinitionId: EventDefinitionId; added: GameDate[] };
    };
    'calendar.updateDefinition': {
      args: { eventDefinitionId: EventDefinitionId; draft: DefinitionDraft };
      result: ResyncResultView;
    };
    'calendar.retireDefinition': {
      args: { eventDefinitionId: EventDefinitionId; lastShowDate?: GameDate | null | undefined };
      result: ResyncResultView & { activeUntil: GameDate };
    };
    'calendar.addOneOff': {
      args: AddOneOffArgs;
      result: { eventInstanceId: EventInstanceId; warnings: NewShowWarning[] };
    };
  }
}

function checksOf(read: GameWorldView, tunables: EngineTunables): DraftCheckContext {
  return { today: read.meta.currentDate, tunables };
}

const NOT_FOUND: Reason = { code: 'notFound', message: 'That show no longer exists' };

/**
 * True when the definition has no date left the editor could change: its last day is before the
 * first changeable day (today plus `calendar.editor.minLeadDays`).
 */
export function isRetired(
  definition: { readonly activeUntil: GameDate | null },
  checks: DraftCheckContext,
): boolean {
  return (
    definition.activeUntil !== null &&
    compareDates(definition.activeUntil, effectiveFromOf(checks)) < 0
  );
}

/** The kept rows of an outcome, in the player's words. */
export function keptViews(read: GameWorldView, kept: ResyncOutcome['kept']): KeptShowView[] {
  return kept.map((row) => ({
    eventInstanceId: row.instanceId,
    date: row.date,
    name: row.name,
    reason: row.reason,
    reasonText: keptReasonText(row.reason, row.airDate, dateWords),
    stillOnRule: row.stillOnRule,
  }));
}

function resultOf(
  read: GameWorldView,
  outcome: ResyncOutcome,
  removedDates: ReadonlyMap<EventInstanceId, GameDate>,
): ResyncResultView {
  const added = outcome.added.flatMap((id) => {
    const show = read.tables.eventInstances.get(id);
    return show === undefined ? [] : [show.date];
  });
  const removed = [...outcome.removed, ...outcome.cancelled]
    .flatMap((id) => {
      const date = removedDates.get(id);
      return date === undefined ? [] : [date];
    })
    .sort();
  return {
    added,
    refreshed: outcome.refreshed.length,
    removed,
    kept: keptViews(read, outcome.kept),
  };
}

function datesOf(
  read: GameWorldView,
  definitionId: EventDefinitionId,
): Map<EventInstanceId, GameDate> {
  return new Map(
    read.tables.eventInstances
      .lookup('byDefinition', definitionId)
      .map((show) => [show.id, show.date]),
  );
}

export const createDefinitionCommand = defineCommand('calendar.createDefinition', {
  args: z.strictObject({ promotionId: zId('promotion'), draft: DefinitionDraftSchema }),
  validate: (read, args, issuedBy, env) => {
    const refused = controlsSchedule(
      read,
      { promotionId: args.promotionId, brandId: args.draft.brandId },
      issuedBy,
    );
    if (refused.length > 0) {
      return refused;
    }
    return checkDraft(read, args.promotionId, args.draft, checksOf(read, env.tunables));
  },
  apply: (ctx, args) => {
    const created = createDefinitionIn(ctx, args.promotionId, args.draft);
    return {
      eventDefinitionId: created.eventDefinitionId,
      added: resultOf(ctx.read, created.outcome, new Map()).added,
    };
  },
});

export const updateDefinitionCommand = defineCommand('calendar.updateDefinition', {
  args: z.strictObject({ eventDefinitionId: zId('eventDefinition'), draft: DefinitionDraftSchema }),
  validate: (read, args, issuedBy, env) => {
    const stored = read.tables.eventDefinitions.get(args.eventDefinitionId);
    if (stored === undefined) {
      return [NOT_FOUND];
    }
    const refused = [
      ...controlsSchedule(read, stored, issuedBy),
      ...(args.draft.brandId === stored.brandId
        ? []
        : controlsSchedule(
            read,
            { promotionId: stored.promotionId, brandId: args.draft.brandId },
            issuedBy,
          )),
    ];
    if (refused.length > 0) {
      return refused.slice(0, 1);
    }
    if (isRetired(stored, checksOf(read, env.tunables))) {
      return [{ code: 'alreadyRetired', message: 'This show is retired' }];
    }
    return checkDraft(read, stored.promotionId, args.draft, checksOf(read, env.tunables), stored);
  },
  apply: (ctx, args) => {
    const before = datesOf(ctx.read, args.eventDefinitionId);
    return resultOf(ctx.read, updateDefinitionIn(ctx, args.eventDefinitionId, args.draft), before);
  },
});

/** The refusals for retiring `definitionId` with an optional last show date. */
export function retireRefusals(
  read: GameWorldView,
  args: { eventDefinitionId: EventDefinitionId; lastShowDate?: GameDate | null | undefined },
  issuedBy: Parameters<typeof controlsSchedule>[2] | null,
  tunables: EngineTunables,
): Reason[] {
  const stored = read.tables.eventDefinitions.get(args.eventDefinitionId);
  if (stored === undefined) {
    return [NOT_FOUND];
  }
  const refused = issuedBy === null ? [] : controlsSchedule(read, stored, issuedBy);
  if (refused.length > 0) {
    return refused;
  }
  const today = read.meta.currentDate;
  if (isRetired(stored, checksOf(read, tunables))) {
    return [{ code: 'alreadyRetired', message: 'This show is already retired' }];
  }
  const last = args.lastShowDate ?? null;
  if (last !== null && compareDates(last, today) < 0) {
    return [
      {
        code: 'lastShowDateTooEarly',
        message: `The last show can be no earlier than ${dateWords(today)}`,
        field: 'lastShowDate',
      },
    ];
  }
  return [];
}

export const retireDefinitionCommand = defineCommand('calendar.retireDefinition', {
  args: z.strictObject({
    eventDefinitionId: zId('eventDefinition'),
    lastShowDate: zGameDate.nullable().optional(),
  }),
  validate: (read, args, issuedBy, env) => retireRefusals(read, args, issuedBy, env.tunables),
  apply: (ctx, args) => {
    const before = datesOf(ctx.read, args.eventDefinitionId);
    const retired = retireDefinitionIn(ctx, args.eventDefinitionId, {
      lastShowDate: args.lastShowDate ?? null,
    });
    return { ...resultOf(ctx.read, retired.outcome, before), activeUntil: retired.activeUntil };
  },
});

/** The one-off arguments: the format is plain integers so the checks word a bad size. */
export const AddOneOffArgsSchema = z.strictObject({
  promotionId: zId('promotion'),
  name: z.string().max(200),
  brandId: zId('brand').nullable(),
  importance: zEventImportance,
  format: DraftFormatSchema,
  date: zGameDate,
  regionId: zId('region').nullable(),
  venueId: zId('venue').nullable(),
});

export const addOneOffCommand = defineCommand('calendar.addOneOff', {
  args: AddOneOffArgsSchema,
  validate: (read, args, issuedBy, env) => {
    const refused = controlsSchedule(
      read,
      { promotionId: args.promotionId, brandId: args.brandId },
      issuedBy,
    );
    if (refused.length > 0) {
      return refused;
    }
    return checkNewShow(read, args, checksOf(read, env.tunables)).reasons;
  },
  apply: (ctx, args) => {
    const warnings = checkNewShow(ctx.read, args, {
      today: ctx.date,
      tunables: ctx.tunables,
    }).warnings;
    const eventInstanceId = addOneOffIn(ctx, args);
    const show = ctx.read.tables.eventInstances.get(eventInstanceId);
    if (show === undefined) {
      throw new EntityNotFoundError('eventInstances', eventInstanceId);
    }
    return { eventInstanceId, warnings };
  },
});

export const calendarEditorCommands = [
  createDefinitionCommand,
  updateDefinitionCommand,
  retireDefinitionCommand,
  addOneOffCommand,
] as const;
