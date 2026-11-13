/**
 * The booked-card steps: hooks that run on a rival card right after `aip.bookShow` writes it and
 * before the card is validated.
 *
 * Later features plug in here without editing the booker: AIP5 sets the winners, MTCH8 the crew,
 * MTCH7 the stipulations. Steps run by `order`, then by id. Each runs in a savepoint of its own
 * with its own buffered events and traces: a step that throws is logged and skipped, with nothing
 * it did left behind, and the card still books. Module-level like `registerAiJob`. See
 * docs/design/rival-booking.md#show-day.
 */

import { RegistryError } from '../../../core/errors';
import type { SegmentId } from '../../../core/ids';
import { API_NAME_PATTERN } from '../../../core/api/query';
import type { StepContext } from '../../../core/pipeline/context';
import type { EventInstance } from '../../../model/entities/event-instance';
import type { DeepReadonly } from '../../../model/world';
import type { AiUnit } from '../units';
import type { CardPlan } from './planCard';

/** What the booker and its steps work with for one show: a step context and the unit. */
export interface ShowBookingContext extends Pick<
  StepContext,
  'date' | 'tx' | 'read' | 'tunables' | 'rng' | 'publish' | 'recordTrace' | 'log'
> {
  /** The computer unit that runs the show. */
  readonly unit: AiUnit;
}

/** What a step is told about the card it works on. */
export interface BookedCardInput {
  /** The show as it stands after the card was written. */
  readonly instance: DeepReadonly<EventInstance>;
  /** The segments the booker wrote, in running order (kept segments are not listed). */
  readonly segmentIds: readonly SegmentId[];
  /** The plan the card came from. */
  readonly plan: Extract<CardPlan, { kind: 'card' }>;
}

/** What a feature writes to add a booked-card step. */
export interface BookedCardStepSpec {
  /** `system.camelName` or longer, like an API name, for example `aip.plannedWinners`. */
  readonly id: string;
  /** Lower runs first; equal orders run by id. */
  readonly order: number;
  readonly run: (ctx: ShowBookingContext, input: BookedCardInput) => void;
}

/** A registered step, as {@link bookedCardSteps} lists it. */
export type BookedCardStep = Readonly<BookedCardStepSpec>;

const registry = new Map<string, BookedCardStep>();

/**
 * Adds a booked-card step. Returns a function that removes it again (for tests).
 *
 * @throws RegistryError for a malformed id, an order that is not a finite number, or an id that is
 * already registered.
 */
export function registerBookedCardStep(spec: BookedCardStepSpec): () => void {
  if (!API_NAME_PATTERN.test(spec.id)) {
    throw new RegistryError(
      `Booked-card step "${spec.id}": the id must look like "system.camelName", for example "aip.plannedWinners"`,
      { stepId: spec.id },
    );
  }
  if (!Number.isFinite(spec.order)) {
    throw new RegistryError(`Booked-card step "${spec.id}": the order must be a finite number`, {
      stepId: spec.id,
    });
  }
  if (registry.has(spec.id)) {
    throw new RegistryError(`Booked-card step "${spec.id}" is already registered`, {
      stepId: spec.id,
    });
  }
  const stored: BookedCardStep = Object.freeze({ id: spec.id, order: spec.order, run: spec.run });
  registry.set(spec.id, stored);
  return () => {
    if (registry.get(spec.id) === stored) {
      registry.delete(spec.id);
    }
  };
}

/** Every registered step, in the order they run: by `order`, then id. */
export function bookedCardSteps(): BookedCardStep[] {
  return [...registry.values()].sort(
    (left, right) =>
      left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
}
