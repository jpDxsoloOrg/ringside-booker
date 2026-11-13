/**
 * The scheduled-format seam: how a later feature changes the format a newly scheduled show gets
 * from its definition, without editing the scheduler (EVT4-02's production bonus slot).
 *
 * `scheduleDefinitionWindow` runs every registered adjuster, in order, on the definition's format
 * right before it stores a show. With nothing registered the show gets the definition's format,
 * unchanged. An adjuster may hand back a trace; the scheduler records it under the new show's id
 * when its caller gave it a way to record traces. See docs/design/calendar.md#horizon.
 */

import type { GameDate } from '../../core/date';
import { RegistryError } from '../../core/errors';
import type { PromotionId } from '../../core/ids';
import { PHASE_ID_PATTERN } from '../../core/pipeline/phase';
import type { Traced, TraceValue } from '../../core/trace';
import type { EventDefinition, ShowFormat } from '../../model/entities/event-definition';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { EngineTunables } from '../tunables';

/** What an adjuster sees: the show about to be stored and the format so far. */
export interface ScheduledFormatInput {
  readonly promotionId: PromotionId;
  readonly definition: DeepReadonly<EventDefinition>;
  readonly date: GameDate;
  /** The definition's format, after every earlier adjuster. */
  readonly format: ShowFormat;
}

/** An adjuster's answer: the format to store, and optionally the trace of why. */
export interface ScheduledFormatAdjustment {
  readonly format: ShowFormat;
  /** Recorded as `{ kind, id: <the new show's id> }` when the scheduler can record traces. */
  readonly trace?: { readonly kind: string; readonly traced: Traced<TraceValue> };
}

/** What a system writes to change newly scheduled shows' formats. */
export interface ScheduledFormatAdjuster {
  /** `system.camelName`, like a phase id, for example `cardFlow.bonusSlot`. */
  readonly id: string;
  /** Position among the adjusters; lower runs first. Equal orders run by id. */
  readonly order: number;
  readonly adjust: (
    read: GameWorldView,
    input: ScheduledFormatInput,
    tunables: EngineTunables,
  ) => ScheduledFormatAdjustment;
}

const registry = new Map<string, ScheduledFormatAdjuster>();
let ordered: readonly ScheduledFormatAdjuster[] = [];

function sortAdjusters(): void {
  ordered = [...registry.values()].sort((left, right) =>
    left.order !== right.order ? left.order - right.order : left.id < right.id ? -1 : 1,
  );
}

/**
 * Adds a scheduled-format adjuster. Returns a function that removes it again (for tests).
 *
 * @throws RegistryError for a malformed id, an order that is not a finite number, or an id that is
 *   already registered.
 */
export function registerScheduledFormatAdjuster(adjuster: ScheduledFormatAdjuster): () => void {
  const fail = (message: string): never => {
    throw new RegistryError(`Scheduled format adjuster "${adjuster.id}": ${message}`, {
      adjusterId: adjuster.id,
    });
  };
  if (!PHASE_ID_PATTERN.test(adjuster.id)) {
    fail('the id must look like "system.camelName", for example "cardFlow.bonusSlot"');
  }
  if (!Number.isFinite(adjuster.order)) {
    fail('the order must be a finite number');
  }
  if (registry.has(adjuster.id)) {
    fail('an adjuster with this id is already registered');
  }
  const stored: ScheduledFormatAdjuster = { ...adjuster };
  registry.set(adjuster.id, stored);
  sortAdjusters();
  return () => {
    if (registry.get(adjuster.id) === stored) {
      registry.delete(adjuster.id);
      sortAdjusters();
    }
  };
}

/** Every registered adjuster, in the order they run. */
export function listScheduledFormatAdjusters(): readonly ScheduledFormatAdjuster[] {
  return ordered;
}

/** The format a show gets, and the traces the adjusters handed back, in the order they ran. */
export interface AdjustedFormat {
  readonly format: ShowFormat;
  readonly traces: readonly { readonly kind: string; readonly traced: Traced<TraceValue> }[];
}

/** Runs every adjuster on the definition's format for one date. */
export function adjustScheduledFormat(
  read: GameWorldView,
  definition: DeepReadonly<EventDefinition>,
  date: GameDate,
  tunables: EngineTunables,
): AdjustedFormat {
  let format: ShowFormat = {
    slots: definition.format.slots,
    preShowSlots: definition.format.preShowSlots,
  };
  const traces: { kind: string; traced: Traced<TraceValue> }[] = [];
  for (const adjuster of ordered) {
    const adjusted = adjuster.adjust(
      read,
      { promotionId: definition.promotionId, definition, date, format },
      tunables,
    );
    format = { slots: adjusted.format.slots, preShowSlots: adjusted.format.preShowSlots };
    if (adjusted.trace !== undefined) {
      traces.push(adjusted.trace);
    }
  }
  return { format, traces };
}
