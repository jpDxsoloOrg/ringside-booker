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
import type { EventDefinitionId, EventInstanceId, PromotionId } from '../../core/ids';
import type { EventDefinition } from '../../model/entities/event-definition';
import { definitionAirDateKey } from '../../model/entities/event-instance';
import { nextOccurrence, occursOn } from '../../model/recurrence';
import type { GameTables } from '../../model/tables';
import type { Tx } from '../../model/tx';
import type { DeepReadonly, WorldView } from '../../model/world';
import { placeShow } from './placement';

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

/**
 * Stores a scheduled show for every date of the definition from `from` through `to` that has no
 * show yet, and returns the new shows' ids, earliest first. A date that already has a row for the
 * definition is skipped whatever the row's status, so a cancelled show and a show taped on an
 * earlier day are never created again. Importance, format, brand and name are copied from the
 * definition. Does not check {@link isSchedulable}; `scheduleAll` does.
 *
 * @throws EntityNotFoundError when the definition is not in the world.
 */
export function scheduleDefinitionWindow(
  tx: Tx<GameTables>,
  read: WorldView<GameTables>,
  definitionId: EventDefinitionId,
  from: GameDate,
  to: GameDate,
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
    const placement = placeShow(read, definition, occurrence).value;
    const instance = tx.create('eventInstances', {
      promotionId: definition.promotionId,
      eventDefinitionId: definition.id,
      brandId: definition.brandId,
      name: definition.name,
      importance: definition.importance,
      format: { slots: definition.format.slots, preShowSlots: definition.format.preShowSlots },
      date: occurrence,
      airDate: occurrence,
      status: 'scheduled',
      venueId: placement.venueId,
      regionId: placement.regionId,
      result: null,
      cancellation: null,
    });
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
): ScheduleSummary {
  const instanceIds: EventInstanceId[] = [];
  const createdByPromotion = new Map<PromotionId, number>();
  for (const definition of read.tables.eventDefinitions.values()) {
    if (!isSchedulable(read, definition)) {
      continue;
    }
    const created = scheduleDefinitionWindow(tx, read, definition.id, from, to);
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
