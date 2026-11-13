// A small world for the Office's dashboard and series tests (DAY2-03).
import { expect } from 'vitest';
import { createEngine, initialEngineState, type Engine, type Viewer } from '../../../src/core/api';
import type { QueryArgs, QueryData, QueryName } from '../../../src/core/api/maps';
import { parseGameDate, type GameDate } from '../../../src/core/date';
import type { PromotionId } from '../../../src/core/ids';
import { writePromotionSnapshots } from '../../../src/systems/office';
import { createEngineTunables } from '../../../src/systems/tunables';
import { SYSTEMS_WITHOUT_SHOW_DAY_GATE, TEST_PLAYER_ID, worldBuilder } from '../../support';
import { testId } from '../../support/ids';

export const MONDAY = parseGameDate('2026-01-05');
export const WEDNESDAY = parseGameDate('2026-01-07');

export const HUMAN_VIEWER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: TEST_PLAYER_ID },
};
export const COMPUTER_VIEWER: Viewer = { kind: 'controller', controller: { kind: 'computer' } };
/** A human seat that runs no promotion. */
export const SPECTATOR_VIEWER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: 'player_spectator' },
};

export interface OfficeWorld {
  readonly engine: Engine;
  readonly human: PromotionId;
  readonly rival: PromotionId;
}

/**
 * The human's promotion A (three wrestlers with morale 10, 20 and -6) and a computer rival B (two
 * wrestlers), started on `start` with a baseline row, then run for `days` days.
 */
export async function officeWorld(start: GameDate, days: number): Promise<OfficeWorld> {
  const { world, ids } = worldBuilder({ startDate: start, currentDate: start })
    .withGeography('mini')
    .withPromotion(
      {
        name: 'Altura Wrestling',
        controller: { kind: 'human', playerId: TEST_PLAYER_ID },
        regionalPop: { [testId('region', 1)]: 40, [testId('region', 3)]: 12.5 },
        prestige: 61,
      },
      (promotion) =>
        promotion.withRoster(3, {
          employment: (index) => ({ morale: [10, 20, -6][index] ?? 0 }),
        }),
    )
    .withPromotion({ name: 'Rival Wrestling', prestige: 40 }, (promotion) =>
      promotion.withRoster(2),
    )
    .build();
  const human = ids.promotions.A;
  const rival = ids.promotions.B;
  if (human === undefined || rival === undefined) throw new Error('setup');
  const baseline = world.transact('baseline', (tx) =>
    writePromotionSnapshots(tx, start, 'baseline', ['active'], createEngineTunables()),
  );
  if (!baseline.ok) throw baseline.error;
  const engine = createEngine({
    state: initialEngineState(world),
    systems: SYSTEMS_WITHOUT_SHOW_DAY_GATE,
  });
  if (days > 0) {
    const advanced = await engine.advanceDays({ maxDays: days });
    expect(advanced.failures).toEqual([]);
  }
  return { engine, human, rival };
}

/** Runs a query and fails the test when it is refused. */
export function queryOk<N extends QueryName>(
  engine: Engine,
  name: N,
  args: QueryArgs<N>,
  viewer: Viewer,
): QueryData<N> {
  const result = engine.query(name, args, viewer);
  if (!result.ok) {
    throw new Error(`Query ${name} refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}
