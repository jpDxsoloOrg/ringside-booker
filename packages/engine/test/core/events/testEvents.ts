/**
 * Event types used only by the event bus tests. Declared the same way a system declares its own,
 * plus a shared reaction runner that plays the part of the day pipeline.
 */

import {
  makeGameDate,
  type EventBus,
  type PublishEvent,
  type ReactionRunner,
} from '@ringside/engine';

declare module '@ringside/engine' {
  interface DomainEventMap {
    'test.pinged': { count: number };
    'test.echoed': { depth: number };
    'test.loose': { value: unknown };
  }
}

/** The context the test runner hands each reaction, standing in for `{ tx, rng, ... }`. */
export interface TestReactionContext {
  readonly publish: PublishEvent;
  /** Writes made by reactions that committed, in order. */
  readonly writes: string[];
}

export const TEST_DATE = makeGameDate(2026, 1, 5);

/**
 * A runner like the pipeline's: each reaction gets its own staging and its own "transaction" (a
 * list of writes that is only kept when the reaction does not throw).
 */
export function createTestRunner(
  bus: EventBus<TestReactionContext>,
  committedWrites: string[],
): ReactionRunner<TestReactionContext> {
  return (subscriberId, run, event) => {
    const staging = bus.stage({ kind: 'reaction', id: subscriberId }, event.date);
    const pendingWrites: string[] = [];
    try {
      run({ publish: staging.publish, writes: pendingWrites });
    } catch (error: unknown) {
      staging.discard();
      return { status: 'failed', error };
    }
    committedWrites.push(...pendingWrites);
    return { status: 'committed', events: staging.commit() };
  };
}
