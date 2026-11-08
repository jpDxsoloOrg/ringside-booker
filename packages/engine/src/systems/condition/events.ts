/**
 * The condition system's domain events.
 */

import type { PersonId } from '../../core/ids';

declare module '../../core/events/types' {
  interface DomainEventMap {
    /** A person's fatigue reached 0 after being above it. */
    'condition.fatigueCleared': { personId: PersonId };
  }
}

export {};
