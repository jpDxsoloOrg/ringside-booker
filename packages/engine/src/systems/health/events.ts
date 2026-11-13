/**
 * The health system's domain events.
 */

import type { PersonId } from '../../core/ids';

declare module '../../core/events/types' {
  interface DomainEventMap {
    /** A person's fatigue reached 0 after being above it. */
    'fatigue.cleared': { personId: PersonId };
  }
}

export {};
