// EVT3 x ECO1: a real show night posts the show's costs, and `finance.ledger { eventInstanceId }`
// lists them for the results page's Show money section (ECO1-06). Rival books stay private.
// Design: docs/design/finances.md#integration
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Viewer } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { cents } from '../../../src/core/money';
import { financeSystem, SHOW_COST_CATEGORIES, showWorkersOf } from '../../../src/systems/finance';
import { matchSystem } from '../../../src/systems/match';
import { showsSystem } from '../../../src/systems/shows';
import { createEngineTunables } from '../../../src/systems/tunables';
import { TEST_PLAYER_ID, withMyShowsRun } from '../../support';
import { showNightWorld } from '../shows/show-night-world';

const HUMAN_VIEWER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: TEST_PLAYER_ID },
};

/** The show night world, with one worker on the player's card paid per appearance. */
async function showNight() {
  const built = showNightWorld();
  if (built.human === null) throw new Error('The show night world has a player show');
  const instance = built.world.tables.eventInstances.require(built.human);
  const paid = showWorkersOf(built.world, instance, createEngineTunables()).workers.find(
    (worker) => worker.employmentId !== null,
  );
  const employmentId = paid?.employmentId;
  if (employmentId === undefined || employmentId === null)
    throw new Error('No worker on a contract');
  const employment = built.world.tables.employments.require(employmentId);
  const fee = built.world.transact('per-appearance fee', (tx) => {
    tx.update('employments', employmentId, {
      terms: { ...employment.terms, perAppearanceFee: cents(40_000) },
    });
  });
  if (!fee.ok) throw fee.error;
  const engine = createEngine({
    state: initialEngineState(built.world),
    systems: withMyShowsRun([simSystem, matchSystem, showsSystem, financeSystem]),
  });
  await engine.advanceDays({ maxDays: 1 });
  const { world } = engine.exportState();
  return { built, engine, world };
}

describe('Show money: a show night through finance.ledger', () => {
  it("lists the player's show's three cost rows, each with its Why?", async () => {
    const { built, engine, world } = await showNight();
    const human = built.human;
    if (human === null) throw new Error('The show night world has a player show');
    const promotionId = built.world.tables.eventInstances.require(human).promotionId;

    const result = engine.query(
      'finance.ledger',
      { promotionId, eventInstanceId: human },
      HUMAN_VIEWER,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.reasons));
    const rows = result.data.rows;
    expect(rows.map((row) => row.category).sort()).toEqual([...SHOW_COST_CATEGORIES].sort());
    for (const row of rows) {
      expect(row.refs.eventInstanceId).toBe(human);
      expect(row.amount).toBeLessThan(0);
      expect(row.traceRef).not.toBeNull();
    }
    const stored = world.tables.ledgerEntries.filter((row) => row.refs.eventInstanceId === human);
    expect(stored).toHaveLength(3);
  });

  it("refuses a rival show's rows to the player", async () => {
    const { built, engine } = await showNight();
    const rivalPromotion = built.world.tables.eventInstances.require(built.rivalCard).promotionId;
    const result = engine.query(
      'finance.ledger',
      { promotionId: rivalPromotion, eventInstanceId: built.rivalCard },
      HUMAN_VIEWER,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.map((reason) => reason.code)).toEqual(['notYourBooks']);
  });
});
