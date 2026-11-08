/**
 * The recent-event log: a ring buffer of the newest committed events.
 *
 * The engine sizes it from the `sim.eventLogSize` tunable. It is saved with the bus state, so a
 * loaded game still knows what happened lately. A size of 0 keeps nothing.
 */

import { InvalidArgumentError } from '../errors';
import { isEventOfTypes, type AnyDomainEvent, type EventOf, type EventType } from './types';

/** What to read from the log. */
export interface RecentEventsQuery<K extends EventType> {
  /** At most this many events (the newest ones). Omit for every kept event. */
  readonly limit?: number;
  /** Only events of these types. Omit for every type. */
  readonly types?: readonly K[];
}

export class EventLog {
  /** How many events the log keeps. */
  readonly size: number;

  /** Slot storage; `#start` is the oldest kept event and `#count` how many slots are filled. */
  readonly #slots: (AnyDomainEvent | undefined)[];
  #start = 0;
  #count = 0;

  /** Creates a log keeping the newest `size` events, seeded with `initial` (oldest first). */
  constructor(size: number, initial: readonly AnyDomainEvent[] = []) {
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new InvalidArgumentError('EventLog', 'size', size, 'a whole number of 0 or more');
    }
    this.size = size;
    this.#slots = new Array<AnyDomainEvent | undefined>(size).fill(undefined);
    this.append(initial);
  }

  /** How many events are kept right now. */
  get length(): number {
    return this.#count;
  }

  /** Adds events (oldest first), dropping the oldest kept ones once the log is full. */
  append(events: readonly AnyDomainEvent[]): void {
    if (this.size === 0) {
      return;
    }
    for (const event of events) {
      const slot = (this.#start + this.#count) % this.size;
      this.#slots[slot] = event;
      if (this.#count < this.size) {
        this.#count++;
      } else {
        this.#start = (this.#start + 1) % this.size;
      }
    }
  }

  /**
   * The newest kept events that match the query, oldest first (so in `seq` order). With `limit`,
   * only the last `limit` matches are returned. Filtering by `types` narrows the result type.
   */
  recent(query?: { readonly limit?: number }): AnyDomainEvent[];
  recent<K extends EventType>(
    query: RecentEventsQuery<K> & { readonly types: readonly K[] },
  ): EventOf<K>[];
  recent(query: RecentEventsQuery<EventType> = {}): AnyDomainEvent[] {
    const { limit, types } = query;
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
      throw new InvalidArgumentError(
        'EventLog.recent',
        'limit',
        limit,
        'a whole number of 0 or more',
      );
    }
    const matches: AnyDomainEvent[] = [];
    for (let i = this.#count - 1; i >= 0; i--) {
      if (limit !== undefined && matches.length >= limit) {
        break;
      }
      const event = this.#slots[(this.#start + i) % this.size];
      if (event !== undefined && (types === undefined || isEventOfTypes(event, types))) {
        matches.push(event);
      }
    }
    return matches.reverse();
  }

  /** Every kept event, oldest first. */
  toArray(): AnyDomainEvent[] {
    return this.recent();
  }
}
