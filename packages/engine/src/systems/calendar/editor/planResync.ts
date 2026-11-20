/**
 * The re-sync planner: what a changed recurring show does to the dated shows already on the books.
 *
 * Pure: it reads the world and the definition as it will be, and returns a plan. The commands apply
 * it (`applyResync.ts`) and the preview queries return it, so what the editor shows before Save is
 * exactly what Save then does. Anything the player has invested in is kept and listed with a
 * reason: a show with a card (booked, or a card in progress), a show that has run, and a show taped
 * ahead of its air date. Only unbooked future shows are refreshed, removed or added.
 *
 * Design notes: docs/design/calendar.md#schedule-editor.
 */

import { compareDates, type GameDate } from '../../../core/date';
import type { EventInstanceId } from '../../../core/ids';
import type { EventDefinition } from '../../../model/entities/event-definition';
import type { EventInstance } from '../../../model/entities/event-instance';
import { occursOn } from '../../../model/recurrence';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import type { EngineTunables } from '../../tunables';
import { instanceFieldsFor, occurrencesBetween } from '../schedule';
import { referencedInstances } from './references';

/** Which copied field of a refreshed show changes. */
export type RefreshChange = 'name' | 'brand' | 'importance' | 'format' | 'place';

/** Why a show stays as it is. */
export type KeptReason = 'booked' | 'hasCard' | 'completed' | 'taped';

export interface ResyncPlan {
  /** New dates the rule now has and no show has yet, earliest first. */
  add: GameDate[];
  /** Unbooked shows still on the rule whose copied fields change. */
  refresh: { instanceId: EventInstanceId; date: GameDate; changes: RefreshChange[] }[];
  /**
   * Unbooked shows the rule no longer has. `cancel` when something in the world points at the show
   * (mail, news, the ledger), so it stays on the books as cancelled; `delete` otherwise.
   */
  remove: {
    instanceId: EventInstanceId;
    date: GameDate;
    name: string;
    mode: 'delete' | 'cancel';
  }[];
  /** Shows left exactly as they are, with why. `stillOnRule` is false when the new rule drops the date. */
  kept: {
    instanceId: EventInstanceId;
    date: GameDate;
    airDate: GameDate;
    name: string;
    reason: KeptReason;
    stillOnRule: boolean;
  }[];
}

export interface ResyncWindow {
  /** The definition as it will be stored. */
  readonly definition: DeepReadonly<EventDefinition>;
  /** Shows before this day are never touched. */
  readonly effectiveFrom: GameDate;
  /** The last day new shows are added for: the stored horizon. */
  readonly horizonEnd: GameDate;
  readonly tunables: EngineTunables;
}

function onRule(definition: DeepReadonly<EventDefinition>, date: GameDate): boolean {
  if (compareDates(date, definition.activeFrom) < 0) {
    return false;
  }
  if (definition.activeUntil !== null && compareDates(date, definition.activeUntil) > 0) {
    return false;
  }
  return occursOn(definition.recurrence, date);
}

function keptReason(read: GameWorldView, instance: DeepReadonly<EventInstance>): KeptReason | null {
  if (instance.status === 'completed') {
    return 'completed';
  }
  if (compareDates(instance.date, instance.airDate) < 0) {
    return 'taped';
  }
  if (instance.status === 'booked') {
    return 'booked';
  }
  if (read.tables.segments.lookup('byEventInstance', instance.id).length > 0) {
    return 'hasCard';
  }
  return null;
}

function byDateThenId<T extends { date: GameDate; instanceId: string }>(left: T, right: T): number {
  return (
    compareDates(left.date, right.date) ||
    (left.instanceId < right.instanceId ? -1 : left.instanceId > right.instanceId ? 1 : 0)
  );
}

/** Plans what storing `window.definition` does to its shows from `window.effectiveFrom` on. */
export function planResync(read: GameWorldView, window: ResyncWindow): ResyncPlan {
  const { definition, effectiveFrom, horizonEnd } = window;
  const plan: ResyncPlan = { add: [], refresh: [], remove: [], kept: [] };
  const takenAirDates = new Set<GameDate>();
  const removable: DeepReadonly<EventInstance>[] = [];

  for (const instance of read.tables.eventInstances.lookup('byDefinition', definition.id)) {
    takenAirDates.add(instance.airDate);
    if (
      compareDates(instance.airDate, effectiveFrom) < 0 &&
      compareDates(instance.date, effectiveFrom) < 0
    ) {
      continue;
    }
    if (instance.status === 'cancelled') {
      continue;
    }
    const stillOnRule = onRule(definition, instance.airDate);
    const kept = keptReason(read, instance);
    if (kept !== null) {
      plan.kept.push({
        instanceId: instance.id,
        date: instance.date,
        airDate: instance.airDate,
        name: instance.name,
        reason: kept,
        stillOnRule,
      });
      continue;
    }
    if (!stillOnRule) {
      removable.push(instance);
      continue;
    }
    const fields = instanceFieldsFor(read, definition, instance.date, window.tunables).value;
    const changes: RefreshChange[] = [];
    if (fields.name !== instance.name) changes.push('name');
    if (fields.brandId !== instance.brandId) changes.push('brand');
    if (fields.importance !== instance.importance) changes.push('importance');
    if (
      fields.format.slots !== instance.format.slots ||
      fields.format.preShowSlots !== instance.format.preShowSlots
    ) {
      changes.push('format');
    }
    if (fields.regionId !== instance.regionId || fields.venueId !== instance.venueId) {
      changes.push('place');
    }
    if (changes.length > 0) {
      plan.refresh.push({ instanceId: instance.id, date: instance.date, changes });
    }
  }

  const referenced = referencedInstances(read, new Set(removable.map((instance) => instance.id)));
  for (const instance of removable) {
    plan.remove.push({
      instanceId: instance.id,
      date: instance.date,
      name: instance.name,
      mode: referenced.has(instance.id) ? 'cancel' : 'delete',
    });
  }

  for (const date of occurrencesBetween(definition, effectiveFrom, horizonEnd)) {
    if (!takenAirDates.has(date)) {
      plan.add.push(date);
    }
  }

  plan.refresh.sort(byDateThenId);
  plan.remove.sort(byDateThenId);
  plan.kept.sort(byDateThenId);
  return plan;
}

/** The words for a kept show's reason. */
export function keptReasonText(
  reason: KeptReason,
  airDate: GameDate,
  words: (date: GameDate) => string,
): string {
  switch (reason) {
    case 'booked':
      return 'Card already booked';
    case 'hasCard':
      return 'Card in progress';
    case 'completed':
      return 'Already run';
    case 'taped':
      return `Taped, airs ${words(airDate)}`;
  }
}
