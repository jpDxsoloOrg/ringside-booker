/**
 * Turning event definitions into dated shows.
 *
 * `occurrencesBetween` lists the dates a definition runs on inside a window, and
 * `scheduleDefinitionWindow` stores one `eventInstances` row for each date that has none yet. The
 * unique `byDefinitionAirDate` index is the idempotency key: a date that already has a row for the
 * definition, whatever the row's status, is never scheduled again. Nothing here is random.
 *
 * Design notes: docs/design/calendar.md#horizon.
 */

import {
  compareDates,
  fromEpochDay,
  makeGameDate,
  MAX_GAME_YEAR,
  toEpochDay,
  type GameDate,
} from '../../core/date';
import { EntityNotFoundError } from '../../core/errors';
import type {
  EventDefinitionId,
  EventInstanceId,
  PromotionId,
  RegionId,
  VenueId,
} from '../../core/ids';
import type { EventDefinition, ShowFormat } from '../../model/entities/event-definition';
import { definitionAirDateKey, type EventInstance } from '../../model/entities/event-instance';
import { nextOccurrence, occursOn } from '../../model/recurrence';
import type { GameTables } from '../../model/tables';
import type { Tx } from '../../model/tx';
import type { DeepReadonly, WorldView } from '../../model/world';
import type { TraceStaging } from '../../core/trace/store';
import { createEngineTunables, type EngineTunables } from '../tunables';
import { adjustScheduledFormat, type AdjustedFormat } from './formatAdjusters';
import { placeShow } from './placement';

/**
 * How the scheduler runs the scheduled-format adjusters (`formatAdjusters.ts`). The day phase and
 * the new-game step pass their tunables and their trace recorder; a caller that passes neither
 * gets the default tunables and no recorded traces.
 */
export interface ScheduleOptions {
  readonly tunables?: EngineTunables;
  /** Records each adjuster's trace under the new show's id, dated `date`. */
  readonly recordTrace?: { readonly record: TraceStaging['record']; readonly date: GameDate };
}

let defaultTunables: EngineTunables | undefined;

function tunablesOf(options: ScheduleOptions): EngineTunables {
  if (options.tunables !== undefined) {
    return options.tunables;
  }
  defaultTunables ??= createEngineTunables();
  return defaultTunables;
}

/**
 * The most dates one call lists for one definition. A show can run every day of the week, and the
 * horizon can be tuned up to 730 days, so a window is not bounded by the recurrence alone. 400
 * covers more than a year of a daily show and every non-daily show at the largest horizon (a
 * weekly show has under 110 dates in 730 days). A daily show at a horizon above 400 days is
 * stored 400 dates ahead instead; the daily run keeps that many on the books.
 */
export const MAX_OCCURRENCES_PER_WINDOW = 400;

const LAST_GAME_DATE = makeGameDate(MAX_GAME_YEAR, 12, 31);

function laterOf(left: GameDate, right: GameDate): GameDate {
  return compareDates(left, right) >= 0 ? left : right;
}

function earlierOf(left: GameDate, right: GameDate): GameDate {
  return compareDates(left, right) <= 0 ? left : right;
}

/** The date `days` after `date`, stopping at the last supported game date. */
export function addDaysWithinCalendar(date: GameDate, days: number): GameDate {
  const epochDay = Math.min(toEpochDay(date) + days, toEpochDay(LAST_GAME_DATE));
  return fromEpochDay(epochDay);
}

/**
 * The dates `definition` runs on from `from` through `to` (both included), earliest first. The
 * window is clipped to the definition's active range, and the list stops at
 * {@link MAX_OCCURRENCES_PER_WINDOW} dates.
 */
export function occurrencesBetween(
  definition: DeepReadonly<Pick<EventDefinition, 'recurrence' | 'activeFrom' | 'activeUntil'>>,
  from: GameDate,
  to: GameDate,
): GameDate[] {
  const first = laterOf(from, definition.activeFrom);
  const last = definition.activeUntil === null ? to : earlierOf(to, definition.activeUntil);
  const dates: GameDate[] = [];
  if (compareDates(first, last) > 0) {
    return dates;
  }
  let candidate: GameDate | null = occursOn(definition.recurrence, first)
    ? first
    : nextOccurrence(definition.recurrence, first);
  while (
    candidate !== null &&
    compareDates(candidate, last) <= 0 &&
    dates.length < MAX_OCCURRENCES_PER_WINDOW
  ) {
    dates.push(candidate);
    candidate = nextOccurrence(definition.recurrence, candidate);
  }
  return dates;
}

/**
 * True when the definition may produce shows: its promotion is active and it is promotion-wide or
 * its brand is active.
 */
export function isSchedulable(
  read: WorldView<GameTables>,
  definition: DeepReadonly<Pick<EventDefinition, 'promotionId' | 'brandId'>>,
): boolean {
  const promotion = read.tables.promotions.get(definition.promotionId);
  if (promotion?.status !== 'active') {
    return false;
  }
  if (definition.brandId === null) {
    return true;
  }
  return read.tables.brands.get(definition.brandId)?.active === true;
}

/** The fields a show copies from its definition when it is scheduled on a date. */
export interface InstanceFields {
  readonly name: string;
  readonly brandId: EventInstance['brandId'];
  readonly importance: EventInstance['importance'];
  readonly format: ShowFormat;
  readonly regionId: RegionId;
  readonly venueId: VenueId | null;
}

/**
 * What a show of `definition` on `date` copies from it: name, brand and importance as they are,
 * the format after the scheduled-format adjusters (`formatAdjusters.ts`, e.g. the production bonus
 * slot) and the place `placeShow` picks. A new show and a show the schedule editor refreshes both
 * come from here, so they can never disagree. `traces` are the adjusters' traces, for the caller to
 * record under the show's id.
 */
export function instanceFieldsFor(
  read: WorldView<GameTables>,
  definition: DeepReadonly<EventDefinition>,
  date: GameDate,
  tunables: EngineTunables,
): { value: InstanceFields; traces: AdjustedFormat['traces'] } {
  const placement = placeShow(read, definition, date).value;
  const adjusted = adjustScheduledFormat(read, definition, date, tunables);
  return {
    value: {
      name: definition.name,
      brandId: definition.brandId,
      importance: definition.importance,
      format: adjusted.format,
      regionId: placement.regionId,
      venueId: placement.venueId,
    },
    traces: adjusted.traces,
  };
}

/**
 * Stores a scheduled show for every date of the definition from `from` through `to` that has no
 * show yet, and returns the new shows' ids, earliest first. A date that already has a row for the
 * definition is skipped whatever the row's status, so a cancelled show and a show taped on an
 * earlier day are never created again. Importance, brand and name are copied from the
 * definition; the format is the definition's after the scheduled-format adjusters
 * (`formatAdjusters.ts`), which is the definition's own when none is registered. Does not check {@link isSchedulable}; `scheduleAll` does.
 *
 * @throws EntityNotFoundError when the definition is not in the world.
 */
export function scheduleDefinitionWindow(
  tx: Tx<GameTables>,
  read: WorldView<GameTables>,
  definitionId: EventDefinitionId,
  from: GameDate,
  to: GameDate,
  options: ScheduleOptions = {},
): EventInstanceId[] {
  const definition = read.tables.eventDefinitions.get(definitionId);
  if (definition === undefined) {
    throw new EntityNotFoundError('eventDefinitions', definitionId);
  }
  const created: EventInstanceId[] = [];
  for (const occurrence of occurrencesBetween(definition, from, to)) {
    const existing = read.tables.eventInstances.lookupOne(
      'byDefinitionAirDate',
      definitionAirDateKey(definition.id, occurrence),
    );
    if (existing !== undefined) {
      continue;
    }
    const fields = instanceFieldsFor(read, definition, occurrence, tunablesOf(options));
    const instance = tx.create('eventInstances', {
      promotionId: definition.promotionId,
      eventDefinitionId: definition.id,
      brandId: fields.value.brandId,
      name: fields.value.name,
      importance: fields.value.importance,
      format: fields.value.format,
      date: occurrence,
      airDate: occurrence,
      status: 'scheduled',
      venueId: fields.value.venueId,
      genericVenue: null,
      regionId: fields.value.regionId,
      result: null,
      cancellation: null,
    });
    if (options.recordTrace !== undefined) {
      for (const trace of fields.traces) {
        options.recordTrace.record(
          { kind: trace.kind, id: instance.id },
          options.recordTrace.date,
          trace.traced,
        );
      }
    }
    created.push(instance.id);
  }
  return created;
}

/** What one pass over every definition created. */
export interface ScheduleSummary {
  /** Every new show, in definition order and then by date. */
  readonly instanceIds: readonly EventInstanceId[];
  /** How many shows each promotion got. Promotions that got none are left out. */
  readonly createdByPromotion: ReadonlyMap<PromotionId, number>;
  /** The total across all promotions. */
  readonly created: number;
}

/**
 * Runs every schedulable definition, in ascending id order, through
 * {@link scheduleDefinitionWindow} for the window `from` through `to`.
 */
export function scheduleAll(
  tx: Tx<GameTables>,
  read: WorldView<GameTables>,
  from: GameDate,
  to: GameDate,
  options: ScheduleOptions = {},
): ScheduleSummary {
  const instanceIds: EventInstanceId[] = [];
  const createdByPromotion = new Map<PromotionId, number>();
  for (const definition of read.tables.eventDefinitions.values()) {
    if (!isSchedulable(read, definition)) {
      continue;
    }
    const created = scheduleDefinitionWindow(tx, read, definition.id, from, to, options);
    if (created.length === 0) {
      continue;
    }
    instanceIds.push(...created);
    createdByPromotion.set(
      definition.promotionId,
      (createdByPromotion.get(definition.promotionId) ?? 0) + created.length,
    );
  }
  return { instanceIds, createdByPromotion, created: instanceIds.length };
}
