/**
 * The domain event bus.
 *
 * Systems publish events into a staging that belongs to one step or command. Nothing leaves the
 * staging until the step commits: a step that throws discards its events along with its writes,
 * so no listener ever hears about something that was rolled back. Committed events get their
 * sequence numbers at commit, in publish order.
 *
 * Committed events are then dispatched. Reactions (subscribers) run in priority order, each
 * through a runner the pipeline injects, so each reaction can get its own transaction and a
 * failing reaction loses only its own writes. Events a reaction publishes are delivered in the
 * next round, up to a cascade depth limit. Observers (read-only listeners such as the headless
 * runner or the UI forwarder) see every event of the batch after all reactions have run.
 *
 * The bus is synchronous and has no clock, no DOM and no dependency on the world's `Tx` type: the
 * reaction context is a type parameter that the pipeline fills in. See the "Domain events" section
 * of `docs/design/day-pipeline.md`.
 */

import type { GameDate } from '../date';
import { DuplicateSubscriberError, EventBusMisuseError, InvalidArgumentError } from '../errors';
import { assertJsonValue } from '../json';
import { EventLog, type RecentEventsQuery } from './log';
import { parseEventBusState, type EventBusState } from './schema';
import {
  EVENT_TYPE_PATTERN,
  type AnyDomainEvent,
  type DomainEvent,
  type DomainEventMap,
  type EventOf,
  type EventSource,
  type EventType,
} from './types';

/** Publishes one event into a staging. The pipeline hands this to reactions as `ctx.publish`. */
export type PublishEvent = <K extends EventType>(type: K, payload: DomainEventMap[K]) => void;

/** Events published by one step, command or reaction, waiting for that unit of work to finish. */
export interface EventStaging {
  /** Stages an event. Its payload is frozen and, with debug checks on, checked to be plain JSON. */
  readonly publish: PublishEvent;
  /**
   * Assigns sequence numbers in publish order, adds the events to the recent log and returns
   * them, ready for {@link EventBus.dispatch}. The staging is closed afterwards.
   */
  commit(): readonly AnyDomainEvent[];
  /** Drops every staged event without using up any sequence numbers. The staging is closed. */
  discard(): void;
}

/** The event a subscription receives: one type's event, or any event for `'*'`. */
export type SubscribedEvent<K extends EventType | '*'> = K extends EventType
  ? EventOf<K>
  : AnyDomainEvent;

/** A reaction: runs synchronously with the context the pipeline's runner supplies. */
export type ReactionHandler<K extends EventType | '*', ReactionContext> = (
  event: SubscribedEvent<K>,
  ctx: ReactionContext,
) => void;

export interface SubscribeOptions {
  /** Unique subscriber id, used in failure reports and as the source id of its events. */
  readonly id: string;
  /** Lower runs first. Defaults to 0. Equal priorities run in registration order. */
  readonly priority?: number;
}

/** What the runner reports back after running one reaction. */
export type ReactionOutcome =
  | {
      readonly status: 'committed';
      /** The events the reaction published, as returned by its staging's `commit()`. */
      readonly events: readonly AnyDomainEvent[];
    }
  | { readonly status: 'failed'; readonly error: unknown };

/**
 * Runs one reaction. The pipeline's runner opens a transaction and a staging (source
 * `{ kind: 'reaction', id: subscriberId }`), builds the context, calls `run(ctx)`, then commits
 * both, or rolls both back if `run` threw, and reports what happened.
 */
export type ReactionRunner<ReactionContext> = (
  subscriberId: string,
  run: (ctx: ReactionContext) => void,
  event: AnyDomainEvent,
) => ReactionOutcome;

/** A read-only listener. It gets frozen events and no way to publish. */
export type EventObserver = (event: AnyDomainEvent) => void;

/** A reaction that threw (or whose runner reported a failure). */
export interface ReactionFailure {
  readonly subscriberId: string;
  readonly eventSeq: number;
  readonly eventType: EventType;
  readonly error: unknown;
  readonly message: string;
}

/** An observer that threw. Observers are numbered from 1 in registration order. */
export interface ObserverFailure {
  readonly observerNumber: number;
  readonly eventSeq: number;
  readonly eventType: EventType;
  readonly error: unknown;
  readonly message: string;
}

/** What one {@link EventBus.dispatch} call did. */
export interface DispatchReport {
  /** Every event of the batch in `seq` order: the ones passed in plus those reactions published. */
  readonly events: readonly AnyDomainEvent[];
  /** How many delivery rounds ran (round 1 delivers the events passed in). */
  readonly rounds: number;
  /** How many reactions were run, failed ones included. */
  readonly reactionsRun: number;
  readonly failures: readonly ReactionFailure[];
  readonly observerFailures: readonly ObserverFailure[];
  /**
   * Events published in the last allowed round. They are committed and logged, but no reaction
   * receives them, so a cascade cannot loop forever.
   */
  readonly dropped: {
    readonly eventTypes: readonly EventType[];
    readonly eventSeqs: readonly number[];
  };
}

export interface EventBusOptions {
  /** How many committed events the recent log keeps (`sim.eventLogSize`). 0 keeps none. */
  readonly logSize: number;
  /** How many delivery rounds a dispatch runs before dropping the rest (`sim.maxEventCascadeDepth`). */
  readonly maxCascadeDepth: number;
  /**
   * Check every payload is plain JSON at publish time and fail fast with the bad path. Defaults to
   * true; the engine can turn it off in release builds where the cost matters.
   */
  readonly debugChecks?: boolean;
  /** A saved state to continue from (validated). */
  readonly state?: unknown;
}

interface Subscription<ReactionContext> {
  readonly id: string;
  readonly type: EventType | '*';
  readonly priority: number;
  readonly deliver: (event: AnyDomainEvent, ctx: ReactionContext) => void;
}

interface Observation {
  readonly observerNumber: number;
  readonly listener: EventObserver;
}

/** A staged event, waiting for its sequence number. */
type PendingEvent = (seq: number) => AnyDomainEvent;

export class EventBus<ReactionContext> {
  readonly maxCascadeDepth: number;
  readonly debugChecks: boolean;

  /** The last sequence number handed out. Saved. */
  #seq: number;
  readonly #log: EventLog;
  /** Kept sorted: priority ascending, then registration order. */
  #subscriptions: readonly Subscription<ReactionContext>[] = [];
  #observations: readonly Observation[] = [];
  #observersRegistered = 0;
  #dispatching = false;
  #observing = false;

  constructor(options: EventBusOptions) {
    const { logSize, maxCascadeDepth, debugChecks = true, state } = options;
    if (!Number.isSafeInteger(maxCascadeDepth) || maxCascadeDepth < 1) {
      throw new InvalidArgumentError(
        'EventBus',
        'maxCascadeDepth',
        maxCascadeDepth,
        'a whole number of 1 or more',
      );
    }
    this.maxCascadeDepth = maxCascadeDepth;
    this.debugChecks = debugChecks;
    const validState = state === undefined ? undefined : parseEventBusState(state);
    this.#seq = validState?.seq ?? 0;
    this.#log = new EventLog(
      logSize,
      (validState?.recent ?? []).map((event) => deepFreeze(event)),
    );
  }

  /** The last sequence number handed out (0 before the first commit). */
  get seq(): number {
    return this.#seq;
  }

  /** How many committed events the recent log keeps. */
  get logSize(): number {
    return this.#log.size;
  }

  /** Opens a staging for one step, command or reaction. */
  stage(source: EventSource, date: GameDate): EventStaging {
    this.#assertNotObserving('stage events');
    if (source.id === '') {
      throw new InvalidArgumentError('EventBus.stage', 'source.id', source.id, 'a non-empty id');
    }
    const frozenSource: EventSource = Object.freeze({ kind: source.kind, id: source.id });
    let pending: PendingEvent[] = [];
    let closedBy: 'commit' | 'discard' | null = null;

    const assertOpen = (action: string): void => {
      if (closedBy !== null) {
        throw new EventBusMisuseError(
          `cannot ${action}: the staging for ${frozenSource.kind} "${frozenSource.id}" was already closed by ${closedBy}()`,
        );
      }
    };

    const publish: PublishEvent = (type, payload) => {
      assertOpen(`publish "${type}"`);
      this.#assertNotObserving('publish events');
      if (this.debugChecks) {
        if (!EVENT_TYPE_PATTERN.test(type)) {
          throw new InvalidArgumentError(
            'EventStaging.publish',
            'type',
            type,
            'an event type such as "day.started"',
          );
        }
        assertJsonValue(payload, `events.${type}`);
      }
      deepFreeze(payload);
      pending.push((seq) => createEvent(type, seq, date, frozenSource, payload));
    };

    return {
      publish,
      commit: () => {
        assertOpen('commit');
        this.#assertNotObserving('commit events');
        closedBy = 'commit';
        const events = pending.map((createAt) => {
          this.#seq += 1;
          return createAt(this.#seq);
        });
        pending = [];
        this.#log.append(events);
        return events;
      },
      discard: () => {
        assertOpen('discard');
        closedBy = 'discard';
        pending = [];
      },
    };
  }

  /**
   * Registers a reaction for one event type, or for every type with `'*'`. Returns a function
   * that removes it. Throws {@link DuplicateSubscriberError} when the id is taken.
   */
  subscribe<K extends EventType | '*'>(
    type: K,
    handler: ReactionHandler<K, ReactionContext>,
    options: SubscribeOptions,
  ): () => void {
    const { id, priority = 0 } = options;
    if (id === '') {
      throw new InvalidArgumentError('EventBus.subscribe', 'options.id', id, 'a non-empty id');
    }
    if (!Number.isFinite(priority)) {
      throw new InvalidArgumentError(
        'EventBus.subscribe',
        'options.priority',
        priority,
        'a finite number',
      );
    }
    if (this.#subscriptions.some((subscription) => subscription.id === id)) {
      throw new DuplicateSubscriberError(id);
    }
    const subscription: Subscription<ReactionContext> = {
      id,
      type,
      priority,
      deliver: (event, ctx) => {
        if (matchesSubscription(event, type)) {
          handler(event, ctx);
        }
      },
    };
    // Insert after every subscription with the same or lower priority: registration order
    // breaks ties.
    const insertAt = this.#subscriptions.findIndex((existing) => existing.priority > priority);
    const next = [...this.#subscriptions];
    next.splice(insertAt === -1 ? next.length : insertAt, 0, subscription);
    this.#subscriptions = next;
    return () => {
      this.#subscriptions = this.#subscriptions.filter((existing) => existing !== subscription);
    };
  }

  /** Subscriber ids in delivery order. */
  subscriberIds(): string[] {
    return this.#subscriptions.map((subscription) => subscription.id);
  }

  /**
   * Registers a read-only observer. It runs after all reactions of each dispatch, gets frozen
   * events, and cannot stage or publish. Returns a function that removes it.
   */
  observe(listener: EventObserver): () => void {
    this.#observersRegistered += 1;
    const observation: Observation = { observerNumber: this.#observersRegistered, listener };
    this.#observations = [...this.#observations, observation];
    return () => {
      this.#observations = this.#observations.filter((existing) => existing !== observation);
    };
  }

  /**
   * Delivers committed events to reactions, breadth first. Events reactions publish are collected
   * into the next round; after `maxCascadeDepth` rounds the remaining events are dropped and
   * reported. A failing reaction is reported and every other reaction still runs. Observers then
   * see every event of the batch in `seq` order.
   */
  dispatch(
    events: readonly AnyDomainEvent[],
    runReaction: ReactionRunner<ReactionContext>,
  ): DispatchReport {
    if (this.#dispatching) {
      throw new EventBusMisuseError(
        'dispatch was called while another dispatch was running; reactions publish through their context instead',
      );
    }
    this.#assertNotObserving('dispatch events');
    this.#dispatching = true;
    try {
      return this.#dispatchRounds(events, runReaction);
    } finally {
      this.#dispatching = false;
    }
  }

  /** Reads the recent-event log: oldest first, optionally filtered by type and limited. */
  recent(query?: { readonly limit?: number }): AnyDomainEvent[];
  recent<K extends EventType>(
    query: RecentEventsQuery<K> & { readonly types: readonly K[] },
  ): EventOf<K>[];
  recent(query: RecentEventsQuery<EventType> = {}): AnyDomainEvent[] {
    if (query.types === undefined) {
      return query.limit === undefined
        ? this.#log.recent()
        : this.#log.recent({ limit: query.limit });
    }
    return this.#log.recent({ ...query, types: query.types });
  }

  /** The bus's save state. Events are already plain JSON, so this is safe to serialise. */
  toState(): EventBusState {
    return { version: 1, seq: this.#seq, recent: this.#log.toArray() };
  }

  #dispatchRounds(
    events: readonly AnyDomainEvent[],
    runReaction: ReactionRunner<ReactionContext>,
  ): DispatchReport {
    const batch: AnyDomainEvent[] = [...events];
    const failures: ReactionFailure[] = [];
    let reactionsRun = 0;
    let rounds = 0;
    let current: readonly AnyDomainEvent[] = events;
    let dropped: readonly AnyDomainEvent[] = [];

    while (current.length > 0) {
      if (rounds >= this.maxCascadeDepth) {
        dropped = current;
        break;
      }
      rounds += 1;
      const nextRound: AnyDomainEvent[] = [];
      for (const event of current) {
        // A snapshot, so a reaction that subscribes or unsubscribes does not change this delivery.
        for (const subscription of this.#subscriptions) {
          if (subscription.type !== '*' && subscription.type !== event.type) {
            continue;
          }
          reactionsRun += 1;
          const outcome = runSafely(runReaction, subscription, event);
          if (outcome.status === 'committed') {
            nextRound.push(...outcome.events);
          } else {
            failures.push({
              subscriberId: subscription.id,
              eventSeq: event.seq,
              eventType: event.type,
              error: outcome.error,
              message: describeError(outcome.error),
            });
          }
        }
      }
      batch.push(...nextRound);
      current = nextRound;
    }

    return {
      events: batch,
      rounds,
      reactionsRun,
      failures,
      observerFailures: this.#notifyObservers(batch),
      dropped: {
        eventTypes: [...new Set(dropped.map((event) => event.type))],
        eventSeqs: dropped.map((event) => event.seq),
      },
    };
  }

  #notifyObservers(events: readonly AnyDomainEvent[]): ObserverFailure[] {
    const failures: ObserverFailure[] = [];
    const observations = this.#observations;
    this.#observing = true;
    try {
      for (const event of events) {
        for (const { observerNumber, listener } of observations) {
          try {
            listener(event);
          } catch (error: unknown) {
            failures.push({
              observerNumber,
              eventSeq: event.seq,
              eventType: event.type,
              error,
              message: describeError(error),
            });
          }
        }
      }
    } finally {
      this.#observing = false;
    }
    return failures;
  }

  #assertNotObserving(action: string): void {
    if (this.#observing) {
      throw new EventBusMisuseError(`observers are read-only and cannot ${action}`);
    }
  }
}

function matchesSubscription<K extends EventType | '*'>(
  event: AnyDomainEvent,
  type: K,
): event is AnyDomainEvent & SubscribedEvent<K> {
  return type === '*' || event.type === type;
}

function runSafely<ReactionContext>(
  runReaction: ReactionRunner<ReactionContext>,
  subscription: Subscription<ReactionContext>,
  event: AnyDomainEvent,
): ReactionOutcome {
  try {
    return runReaction(
      subscription.id,
      (ctx) => {
        subscription.deliver(event, ctx);
      },
      event,
    );
  } catch (error: unknown) {
    // The runner should catch and report on its own; this keeps one bad runner from stopping
    // the other reactions.
    return { status: 'failed', error };
  }
}

function createEvent<K extends EventType>(
  type: K,
  seq: number,
  date: GameDate,
  source: EventSource,
  payload: DomainEventMap[K],
): AnyDomainEvent {
  const event: DomainEvent<K> = Object.freeze({ type, seq, date, source, payload });
  // TypeScript cannot see that a DomainEvent<K> for a generic K is one member of the
  // AnyDomainEvent union (it only checks unions member by member against concrete types). `type`
  // and `payload` come from the same publish<K>() call, so they always match.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return event as AnyDomainEvent;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'a non-error value was thrown';
}

/**
 * Freezes a JSON-like value and everything inside it. Returns the same value.
 *
 * It walks into objects that are already frozen too: a publisher may pass a payload frozen only
 * at the top, and its nested objects must not stay writable. `visited` stops the walk on shared
 * or circular references (possible when debug checks are off).
 */
function deepFreeze<T>(value: T, visited = new WeakSet()): T {
  if (typeof value === 'object' && value !== null && !visited.has(value)) {
    visited.add(value);
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze(readProperty(value, key), visited);
    }
  }
  return value;
}

function readProperty(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value as unknown;
}
