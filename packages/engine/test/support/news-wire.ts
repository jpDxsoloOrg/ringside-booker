/**
 * A small engine for testing a partner's news stories (DAY1-06): the news system, the partner's
 * system, and a test phase that publishes queued domain events on the next day it runs, so the
 * partner's real subscriptions turn them into stories through the real event bus.
 */

import {
  createEngine,
  defineSystem,
  initialEngineState,
  type Engine,
  type SystemBundle,
} from '../../src/core/api';
import { simSystem } from '../../src/core/api/builtins';
import type { DomainEventMap, EventType } from '../../src/core/events/types';
import type { PhaseContext } from '../../src/core/pipeline/context';
import { definePhase } from '../../src/core/pipeline/phase';
import type { News } from '../../src/model/entities/news';
import type { GameWorld } from '../../src/model/tables';
import { newsSystem } from '../../src/systems/news';

/** One event to publish, with its payload. */
export type QueuedEvent = {
  [K in EventType]: { readonly type: K; readonly payload: DomainEventMap[K] };
}[EventType];

export interface NewsWire {
  readonly engine: Engine;
  /** Events the test phase publishes, in order, on the next day. */
  readonly events: QueuedEvent[];
  /** Work the test phase does first on the next day (cancelling a show, ending a contract). */
  readonly steps: ((ctx: PhaseContext) => void)[];
}

/**
 * An engine over `world` with the news system, `systems` and the publishing phase
 * (`housekeeping`, order 50).
 */
export function newsWire(
  world: GameWorld,
  systems: readonly SystemBundle[],
  tunableOverrides: Record<string, number> = {},
): NewsWire {
  const events: QueuedEvent[] = [];
  const steps: ((ctx: PhaseContext) => void)[] = [];
  const publisher = defineSystem({
    id: 'newsWireTest',
    phases: [
      definePhase({
        id: 'newsWireTest.publish',
        group: 'housekeeping',
        order: 50,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          for (const step of steps.splice(0)) {
            step(ctx);
          }
          for (const event of events.splice(0)) {
            publishQueued(ctx, event);
          }
        },
      }),
    ],
  });
  const engine = createEngine({
    state: { ...initialEngineState(world), tunableOverrides },
    systems: [simSystem, newsSystem, ...systems, publisher],
  });
  return { engine, events, steps };
}

function publishQueued<K extends EventType>(
  ctx: PhaseContext,
  event: { readonly type: K; readonly payload: DomainEventMap[K] },
): void {
  ctx.publish(event.type, event.payload);
}

/** The stories on file whose topic is `topic`. */
export function storiesWithTopic(engine: Engine, topic: string): News[] {
  return engine
    .exportState()
    .world.tables.news.filter((news) => news.headline.key === `news.${topic}.headline`);
}

/** Every story on file. */
export function allStories(engine: Engine): News[] {
  return engine.exportState().world.tables.news;
}
