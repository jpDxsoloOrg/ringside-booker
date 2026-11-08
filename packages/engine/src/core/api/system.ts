/**
 * System bundles: how a game system plugs into the engine.
 *
 * A bundle declares, in one place, everything a system adds at run time: its day phases, the gates
 * that stop a multi-day skip, its reactions to domain events (subscriptions), and the queries and
 * commands screens call. `createEngine` registers every bundle it is given and refuses two bundles
 * that use the same phase, gate, subscription, query or command id.
 *
 * Two things a system owns are not in the bundle, because they have to be known at compile time:
 *
 * - **Tunables** stay in the compile-time aggregate (`systems/tunables.ts`, `ALL_TUNABLES`), so a
 *   misspelt tunable key is a type error and saves can validate overrides before any system runs.
 * - **RNG stream names** are declared by merging into `StreamNames` (`core/rng/streams.ts`), so a
 *   misspelt stream is a type error.
 *
 * Domain event types, query names and command names are declared the same way, by merging into
 * `DomainEventMap`, `QueryMap` and `CommandMap`. See docs/design/engine-api.md.
 */

import { RegistryError } from '../errors';
import type { SubscribedEvent } from '../events/bus';
import type { EventType } from '../events/types';
import type { ReactionContext } from '../pipeline/context';
import type { GateSpec } from '../pipeline/gates';
import type { PhaseSpec } from '../pipeline/phase';
import type { CommandDefinition } from './command';
import type { QueryDefinition } from './query';

/** A system id: one camelCase word, such as `sim` or `contracts`. */
export const SYSTEM_ID_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

/** A reaction to domain events, registered on the event bus when the engine is built. */
export interface SubscriptionSpec<K extends EventType | '*' = EventType | '*'> {
  /** Unique subscriber id, such as `news.onTitleChanged`. Failures are logged under it. */
  readonly id: string;
  /** The event type to react to, or `'*'` for every event. */
  readonly type: K;
  /** Lower runs first. Defaults to 0. Equal priorities run in registration order. */
  readonly priority?: number;
  /**
   * Runs in its own transaction for each matching event (see the "Reactions" section of
   * docs/design/day-pipeline.md). Written as a method so a subscription to one type fits in a
   * list of subscriptions to any type; the bus only ever delivers events of `type`.
   */
  handler(event: SubscribedEvent<K>, ctx: ReactionContext): void;
}

/** Types a subscription's handler by its event type. Returns the spec unchanged. */
export function defineSubscription<K extends EventType | '*'>(
  spec: SubscriptionSpec<K>,
): SubscriptionSpec<K> {
  return spec;
}

/** What a system writes to define its bundle. Every list is optional. */
export interface SystemSpec {
  /** One camelCase word, such as `contracts`. Named in every registration error. */
  readonly id: string;
  readonly phases?: readonly PhaseSpec[];
  readonly gates?: readonly GateSpec[];
  readonly subscriptions?: readonly SubscriptionSpec[];
  readonly queries?: readonly QueryDefinition[];
  readonly commands?: readonly CommandDefinition[];
}

/** A checked, frozen system bundle, ready to pass to `createEngine`. */
export interface SystemBundle {
  readonly id: string;
  readonly phases: readonly PhaseSpec[];
  readonly gates: readonly GateSpec[];
  readonly subscriptions: readonly SubscriptionSpec[];
  readonly queries: readonly QueryDefinition[];
  readonly commands: readonly CommandDefinition[];
}

/**
 * Checks a system spec and returns a frozen bundle with every list filled in. Throws
 * {@link RegistryError} for an id that is not one camelCase word. Phase and gate specs are checked
 * when the engine registers them; duplicate ids, inside one bundle or across bundles, are refused
 * by `createEngine`.
 */
export function defineSystem(spec: SystemSpec): SystemBundle {
  if (!SYSTEM_ID_PATTERN.test(spec.id)) {
    throw new RegistryError(
      `System id ${JSON.stringify(spec.id)} must be one camelCase word, such as "contracts"`,
      { system: spec.id },
    );
  }
  return Object.freeze({
    id: spec.id,
    phases: Object.freeze([...(spec.phases ?? [])]),
    gates: Object.freeze([...(spec.gates ?? [])]),
    subscriptions: Object.freeze([...(spec.subscriptions ?? [])]),
    queries: Object.freeze([...(spec.queries ?? [])]),
    commands: Object.freeze([...(spec.commands ?? [])]),
  });
}
