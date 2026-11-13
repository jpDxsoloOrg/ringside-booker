// A small world for the promotion popularity system's tests (EVT5-02): the mini map, promotions
// with chosen popularity, completed shows, and an engine that announces each show on its date so
// `promoPop.applyAfterShow` reacts to it. Design: docs/design/promotion-popularity.md
import { createEngine, defineSystem, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { SubscriptionSpec, SystemBundle } from '../../../src/core/api/system';
import type { AnyDomainEvent } from '../../../src/core/events';
import { parseGameDate, type GameDate } from '../../../src/core/date';
import type { EventInstanceId, PromotionId } from '../../../src/core/ids';
import { definePhase } from '../../../src/core/pipeline/phase';
import { isFullTrace, type StoredTrace, type TraceRef } from '../../../src/core/trace/store';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import type { EventInstance } from '../../../src/model/entities/event-instance';
import type { SerializedTables } from '../../../src/persistence/save-document';
import { promoPopSystem } from '../../../src/systems/promoPop';
import { workersSystem } from '../../../src/systems/workers';
import { TEST_PLAYER_ID, type DeepPartial } from '../../support/builders/build-row';
import { anEventInstance } from '../../support/builders/creative';
import { testId } from '../../support/ids';
import { worldBuilder, type BuildContext, type WorldBuilder } from '../../support/world-builder';

export const OMNISCIENT = { kind: 'omniscient' } as const;

/** The mini map's regions, most populous first, in a chain: North 1 - North 2 - South 1 - South 2. */
export const NORTH_1 = testId('region', 1);
export const NORTH_2 = testId('region', 2);
export const SOUTH_1 = testId('region', 3);
export const SOUTH_2 = testId('region', 4);
export const NORTH = testId('country', 1);
export const SOUTH = testId('country', 2);

export const ANNOUNCE_PHASE_ID = 'promoPopTest.announceShows';
const EVENT_TYPES = ['popularity.changed', 'showPopularity.changed'];

/** A completed show of promotion `label` (default A) in North 1 on `date`, scoring `score`. */
export function completedShow(
  context: BuildContext,
  overrides: Omit<DeepPartial<EventInstance>, 'date' | 'result'> & { score: number; date: string },
  label: 'A' | 'B' = 'A',
): EventInstanceId {
  const promotionId = context.ids.promotions[label];
  if (promotionId === undefined) {
    throw new Error(`promotion ${label} must be added first`);
  }
  const { score, date, ...rest } = overrides;
  const day = parseGameDate(date);
  const row = context.insert(
    'eventInstances',
    anEventInstance(
      {
        promotionId,
        regionId: NORTH_1,
        status: 'completed',
        ...rest,
        date: day,
        airDate: overrides.airDate ?? day,
        result: {
          score,
          rawScore: score,
          traceId: null,
          attendance: null,
          gate: null,
          viewers: null,
        },
      },
      context.sequence,
    ),
  );
  return row.id;
}

/** The mini map with promotion A (human, prestige 20, popularity 20 in North 1). */
export function baseWorld(
  promotion: Parameters<WorldBuilder['withPromotion']>[0] = {},
  configure?: Parameters<WorldBuilder['withPromotion']>[1],
): WorldBuilder {
  return worldBuilder()
    .withGeography('mini')
    .withPromotion(
      {
        prestige: 20,
        regionalPop: { [NORTH_1]: 20 },
        controller: { kind: 'human', playerId: TEST_PLAYER_ID },
        ...promotion,
      },
      configure,
    );
}

/**
 * A system with a shows-group phase that publishes `show.completed` for every completed show dated
 * today, `times` times each, as show night would.
 */
function announcer(times: number, subscriptions: readonly SubscriptionSpec[]): SystemBundle {
  return defineSystem({
    id: 'promoPopTest',
    subscriptions,
    phases: [
      definePhase({
        id: ANNOUNCE_PHASE_ID,
        group: 'shows',
        order: 50,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          for (const instance of ctx.read.tables.eventInstances.lookup('byDate', ctx.date)) {
            if (instance.status !== 'completed' || instance.result === null) {
              continue;
            }
            for (let count = 0; count < times; count++) {
              ctx.publish('show.completed', {
                eventInstanceId: instance.id,
                promotionId: instance.promotionId,
                brandId: instance.brandId,
                date: instance.date,
                importance: instance.importance,
                score: instance.result.score,
                rawScore: instance.result.rawScore,
                offscreen:
                  ctx.read.tables.promotions.get(instance.promotionId)?.controller.kind !== 'human',
                segmentCount: 0,
              });
            }
          }
        },
      }),
    ],
  });
}

export interface RunOptions {
  /** Days to simulate from the start date (2026-01-05). Defaults to 1. */
  days?: number;
  overrides?: TunableOverrides;
  /** How many times each show is announced. Defaults to 1. */
  times?: number;
  /** Replaces the promotion popularity system (for the rollback test). */
  systems?: readonly SystemBundle[];
  /** Extra subscriptions on the announcing system. */
  subscriptions?: readonly SubscriptionSpec[];
}

export interface PromoPopRun {
  engine: Engine;
  tables: SerializedTables;
  /** The popularity events committed, oldest first. */
  events: AnyDomainEvent[];
  promotion(id: PromotionId): SerializedTables['promotions'][number];
  trace(ref: TraceRef): StoredTrace | null;
}

/** Builds an engine on `builder`'s world and simulates `days` days. */
export async function runShows(
  builder: WorldBuilder,
  options: RunOptions = {},
): Promise<PromoPopRun> {
  const { world } = builder.build();
  const engine = createEngine({
    state: initialEngineState(world),
    systems: [
      simSystem,
      workersSystem,
      ...(options.systems ?? [promoPopSystem]),
      announcer(options.times ?? 1, options.subscriptions ?? []),
    ],
  });
  for (const [key, value] of Object.entries(options.overrides ?? {})) {
    const outcome = engine.commandRaw(
      'tunables.setOverride',
      { key, value },
      { kind: 'human', playerId: TEST_PLAYER_ID },
    );
    if (!outcome.ok) {
      throw new Error(`could not override ${key}: ${JSON.stringify(outcome)}`);
    }
  }
  await engine.advanceDays({ maxDays: options.days ?? 1 });
  const events = engine.query('sim.recentEvents', { limit: 500, types: EVENT_TYPES }, OMNISCIENT);
  if (!events.ok) {
    throw new Error(JSON.stringify(events.reasons));
  }
  const { tables } = engine.exportState().world;
  return {
    engine,
    tables,
    events: events.data,
    promotion: (id) => {
      const row = tables.promotions.find((promotion) => promotion.id === id);
      if (row === undefined) {
        throw new Error(`no promotion ${id}`);
      }
      return row;
    },
    trace: (ref) => {
      const stored = engine.query('trace.get', { ref }, OMNISCIENT);
      if (!stored.ok) {
        throw new Error(JSON.stringify(stored.reasons));
      }
      if (stored.data !== null && !isFullTrace(stored.data)) {
        throw new Error('expected a full trace');
      }
      return stored.data;
    },
  };
}

/** `date` as a game date. */
export function day(date: string): GameDate {
  return parseGameDate(date);
}
