/**
 * Shared setup for the day pipeline tests: test event types, and a runtime over the toy registry
 * (FND-04's `owners`, `widgets` and `regions` tables) so the pipeline can be tested without the
 * real entity schemas.
 */

import { parseGameDate, type GameDate } from '../../../src/core/date';
import { createIdFactory } from '../../../src/core/ids';
import { createRuntime, type SimRuntime } from '../../../src/core/pipeline';
import { createWorld, type World } from '../../../src/model/world';
import type { WorldMeta } from '../../../src/model/world-meta';
import { sequentialIdEntropy } from '../../support/ids';
import {
  makeOwner,
  makeWidget,
  ownerId,
  regionId,
  TOY_PLAYER_ID,
  TOY_REGISTRY,
  toyMeta,
  widgetId,
  type ToyRegistry,
} from '../../support/toy-registry';

declare module '@ringside/engine' {
  interface DomainEventMap {
    'test.widgetScored': { widgetId: string; score: number };
    'test.ownerCreated': { ownerId: string };
  }
}

/** A Monday. */
export const MONDAY = parseGameDate('2026-01-05');
/** The day after {@link MONDAY}. */
export const TUESDAY = parseGameDate('2026-01-06');

export type ToyRuntime = SimRuntime<ToyRegistry>;

export interface ToyWorldOptions {
  readonly date?: GameDate;
  readonly seed?: string;
  readonly meta?: Partial<WorldMeta>;
  /** Widget serials to insert, in this order. Defaults to 1, 2, 3. */
  readonly widgetSerials?: readonly number[];
}

/**
 * A toy world with one region, two owners and some widgets, validating every write. It is built
 * with a sequential ID factory, which `createRuntime` replaces with the seeded minter.
 */
export function pipelineToyWorld(options: ToyWorldOptions = {}): World<ToyRegistry> {
  const date = options.date ?? MONDAY;
  const world = createWorld(
    TOY_REGISTRY,
    toyMeta({ currentDate: date, seed: options.seed ?? 'pipeline-seed', ...options.meta }),
    { idFactory: createIdFactory(sequentialIdEntropy()), validateWrites: 'always' },
  );
  world.tables.regions._put({ id: regionId(1) });
  world.tables.owners._put(
    makeOwner(1, {
      controller: { type: 'human', playerId: TOY_PLAYER_ID },
      homeRegionId: regionId(1),
    }),
  );
  world.tables.owners._put(makeOwner(2));
  for (const serial of options.widgetSerials ?? [1, 2, 3]) {
    world.tables.widgets._put(makeWidget(serial, ownerId(serial % 2 === 0 ? 2 : 1)));
  }
  return world;
}

/** A runtime over {@link pipelineToyWorld} with no phases registered. */
export function toyRuntime(
  options: ToyWorldOptions & { readonly now?: () => number } = {},
): ToyRuntime {
  return createRuntime({
    world: pipelineToyWorld(options),
    ...(options.now === undefined ? {} : { host: { now: options.now } }),
  });
}

/** A widget's score for owner 1, or 0 when it has none. */
export function scoreOf(runtime: ToyRuntime, serial: number): number {
  return runtime.world.tables.widgets.require(widgetId(serial)).scores[ownerId(1)] ?? 0;
}
