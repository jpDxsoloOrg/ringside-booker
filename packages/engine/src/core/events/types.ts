/**
 * Typed domain events.
 *
 * A domain event says that something happened in the world: a match finished, a title changed
 * hands, a contract was signed. Systems publish events without knowing who listens, and news, the
 * social feed, achievements and (later) mods react to them. See the "Domain events" section of
 * `docs/design/day-pipeline.md`.
 */

import type { GameDate } from '../date';

/**
 * Every event type and its payload. Seeded with the core events; each game system adds its own
 * events through declaration merging, next to its own code, so there is no central list to edit
 * and the map stays fully typed.
 *
 * Names are `noun.pastTenseVerb`, dot separated (`match.completed`, `title.changed`).
 *
 * Payloads hold IDs and small primitives only, never copies of entities: a listener that needs
 * the title's name reads it from the world by ID. Payloads must be plain JSON (see `core/json.ts`)
 * because events are saved in the recent-event log and cross the Web Worker boundary.
 *
 * @example
 * ```ts
 * // packages/engine/src/systems/titles/events.ts
 * import type { PersonId, TitleId } from '../../core/ids';
 *
 * declare module '../../core/events/types' {
 *   interface DomainEventMap {
 *     'title.changed': { titleId: TitleId; newHolderId: PersonId; previousHolderId: PersonId | null };
 *   }
 * }
 *
 * // Elsewhere in the titles system, inside a step:
 * staging.publish('title.changed', { titleId, newHolderId, previousHolderId });
 * ```
 */
export interface DomainEventMap {
  /** The day pipeline started a new day. */
  'day.started': { date: GameDate };
  /** The day pipeline finished a day; `failedSteps` counts the steps that were rolled back. */
  'day.ended': { date: GameDate; failedSteps: number };
  /** A pipeline step threw and its writes were rolled back. */
  'pipeline.stepFailed': { stepId: string; message: string };
  /** A tunable override was set or cleared (`null` means back to the default). */
  'tunables.changed': { key: string; value: number | boolean | string | null };
}

/** Any declared event type. */
export type EventType = keyof DomainEventMap;

/** What kind of thing published an event. */
export type EventSourceKind = 'phase' | 'command' | 'reaction';

/** Who published an event: a pipeline phase, a player or computer command, or a reaction. */
export interface EventSource {
  readonly kind: EventSourceKind;
  /** The phase id, command id or subscriber id. */
  readonly id: string;
}

/**
 * One committed event. `seq` is the bus-wide sequence number, assigned at commit in publish
 * order; it is saved, so it carries on across save and load. Committed events are deeply frozen.
 */
export interface DomainEvent<K extends EventType> {
  readonly type: K;
  readonly seq: number;
  /** The game date the event happened on. */
  readonly date: GameDate;
  readonly source: EventSource;
  /** IDs and small primitives only, never entity copies. */
  readonly payload: DomainEventMap[K];
}

/** Every event type mapped to its event, so generic code can index it by a type parameter. */
export type DomainEventByType = { [P in EventType]: DomainEvent<P> };

/** The event for one type, or for a union of types. */
export type EventOf<K extends EventType> = DomainEventByType[K];

/**
 * Any committed event, as a union discriminated by `type`: checking `event.type` narrows
 * `event.payload`.
 */
export type AnyDomainEvent = DomainEventByType[EventType];

/** The shape event type names follow at runtime: dot-separated camelCase segments. */
export const EVENT_TYPE_PATTERN = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/;

/** True when `event` is of the given type; narrows the event and its payload. */
export function isEventOfType<K extends EventType>(
  event: AnyDomainEvent,
  type: K,
): event is EventOf<K> {
  return event.type === type;
}

/** True when `event` is of one of the given types. */
export function isEventOfTypes<K extends EventType>(
  event: AnyDomainEvent,
  types: readonly K[],
): event is EventOf<K> {
  return types.some((type) => type === event.type);
}
