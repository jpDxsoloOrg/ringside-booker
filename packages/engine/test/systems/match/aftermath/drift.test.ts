// The weekly momentum drift phase (MTCH3-07): every Monday each open employment with a momentum
// moves part of the way back to the target through WRK1's momentum door, and morale never moves.
// Design: docs/design/match-aftermath.md#momentum-drift
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../../src/core/api';
import { simSystem } from '../../../../src/core/api/builtins';
import type { EmploymentId } from '../../../../src/core/ids';
import { isFullTrace, type StoredTraceEntry } from '../../../../src/core/trace/store';
import type { TraceNode } from '../../../../src/core/trace/types';
import type { GameWorld } from '../../../../src/model/tables';
import type { SerializedTables } from '../../../../src/persistence/save-document';
import {
  MOMENTUM_DRIFT_PHASE_ID,
  MOMENTUM_DRIFT_PHASE_ORDER,
  MOMENTUM_DRIFT_REASON_KEY,
  driftingEmployments,
  matchSystem,
} from '../../../../src/systems/match';
import { DOOR_TRACE_KINDS, workersSystem } from '../../../../src/systems/workers';
import { worldBuilder } from '../../../support/world-builder';
import { PLAYER_ONE } from '../../calendar/lifecycle-world';

/** Player roster momentum: hot, cold, empty (never appeared), at rest. */
const PLAYER_MOMENTUM = [100, -60, null, 0] as const;
/** Rival roster momentum. */
const RIVAL_MOMENTUM = [80, -100] as const;
const MORALE = 37;

interface DriftWorld {
  readonly world: GameWorld;
  readonly player: readonly EmploymentId[];
  readonly rival: readonly EmploymentId[];
}

/** Starts on Monday 2026-01-05. Promotion A is the player's, B a rival's. */
function driftWorld(): DriftWorld {
  const { world, ids } = worldBuilder({ startDate: '2026-01-05' })
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A', controller: PLAYER_ONE }, (promotion) =>
      promotion.withRoster(PLAYER_MOMENTUM.length, {
        employment: (index) => ({ momentum: PLAYER_MOMENTUM[index] ?? null, morale: MORALE }),
      }),
    )
    .withPromotion({ name: 'Test Promotion B' }, (promotion) =>
      promotion.withRoster(RIVAL_MOMENTUM.length, {
        employment: (index) => ({
          momentum: RIVAL_MOMENTUM[index] ?? null,
          morale: MORALE,
        }),
      }),
    )
    .build();
  const employments = [...world.tables.employments.values()];
  const promotionA = ids.promotions.A;
  return {
    world,
    player: employments.filter((row) => row.promotionId === promotionA).map((row) => row.id),
    rival: employments.filter((row) => row.promotionId !== promotionA).map((row) => row.id),
  };
}

function engineOn(world: GameWorld, overrides: Record<string, number> = {}): Engine {
  const state = initialEngineState(world);
  return createEngine({
    state: { ...state, tunableOverrides: { ...state.tunableOverrides, ...overrides } },
    systems: [simSystem, workersSystem, matchSystem],
  });
}

function employmentIn(tables: SerializedTables, id: EmploymentId) {
  const row = tables.employments.find((entry) => entry.id === id);
  if (row === undefined) {
    throw new Error(`no employment ${id}`);
  }
  return row;
}

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`no entry ${String(index)}`);
  }
  return value;
}

function labelsOf(node: TraceNode): string[] {
  return [node.label, ...(node.children ?? []).flatMap(labelsOf)];
}

function doorTrace(engine: Engine, id: EmploymentId): StoredTraceEntry | undefined {
  const { full, summaries } = engine.exportState().traces;
  return [...full, ...summaries].find(
    (entry) => entry.ref.kind === DOOR_TRACE_KINDS.momentum && entry.ref.id === id,
  );
}

describe('the momentum drift phase', () => {
  it('runs on Mondays in the periodic group', () => {
    const phase = matchSystem.phases.find((candidate) => candidate.id === MOMENTUM_DRIFT_PHASE_ID);
    expect(phase).toMatchObject({
      group: 'periodic',
      order: MOMENTUM_DRIFT_PHASE_ORDER,
      cadence: { kind: 'weekly', weekday: 'mon' },
    });
  });

  it('cools everyone off once a week, player and rivals alike, and never touches morale', async () => {
    const built = driftWorld();
    const engine = engineOn(built.world);
    const advanced = await engine.advanceDays({ maxDays: 7 });
    expect(advanced.failures).toEqual([]);
    const tables = engine.exportState().world.tables;

    const expected = [
      [at(built.player, 0), 88],
      [at(built.player, 1), -52.8],
      [at(built.rival, 0), 70.4],
      [at(built.rival, 1), -88],
    ] as const;
    for (const [id, momentum] of expected) {
      expect(employmentIn(tables, id).momentum).toBeCloseTo(momentum, 10);
    }
    // Empty momentum stays empty; momentum at rest stays put.
    expect(employmentIn(tables, at(built.player, 2)).momentum).toBeNull();
    expect(employmentIn(tables, at(built.player, 3)).momentum).toBe(0);
    for (const row of tables.employments) {
      expect(row.morale).toBe(MORALE);
    }

    const changes = engine
      .exportState()
      .events.recent.filter((event) => event.type === 'momentum.changed');
    expect(changes).toHaveLength(expected.length);
    for (const event of changes) {
      expect(event.payload).toMatchObject({
        source: 'system',
        reasonKey: MOMENTUM_DRIFT_REASON_KEY,
      });
    }
    expect(
      engine.exportState().events.recent.filter((event) => event.type === 'morale.changed'),
    ).toEqual([]);
  });

  it('drifts again each Monday and not on other days', async () => {
    const built = driftWorld();
    const engine = engineOn(built.world);
    const hot = at(built.player, 0);
    const path: number[] = [];
    for (let day = 0; day < 15; day += 1) {
      await engine.advanceDays({ maxDays: 1 });
      path.push(employmentIn(engine.exportState().world.tables, hot).momentum ?? Number.NaN);
    }
    // Mondays: days 0, 7 and 14.
    expect(path[0]).toBeCloseTo(88, 10);
    expect(path[6]).toBeCloseTo(88, 10);
    expect(path[7]).toBeCloseTo(77.44, 10);
    expect(path[13]).toBeCloseTo(77.44, 10);
    expect(path[14]).toBeCloseTo(68.1472, 10);
  });

  it('keeps the full breakdown for the player and a short line for rivals', async () => {
    const built = driftWorld();
    const engine = engineOn(built.world);
    await engine.advanceDays({ maxDays: 1 });

    const player = doorTrace(engine, at(built.player, 0));
    const rival = doorTrace(engine, at(built.rival, 0));
    if (
      player === undefined ||
      rival === undefined ||
      !isFullTrace(player) ||
      !isFullTrace(rival)
    ) {
      throw new Error('expected full door traces');
    }
    const playerLabels = labelsOf(player.trace);
    expect(playerLabels).toContain('Cooling off: 12% of the way back to 0');
    expect(playerLabels).toContain('Distance to the resting point');
    expect(playerLabels).toContain('Weekly cooling off');
    const rivalLabels = labelsOf(rival.trace);
    expect(rivalLabels).toContain('Cooling off: 12% of the way back to 0');
    expect(rivalLabels).not.toContain('Distance to the resting point');
    expect(JSON.stringify(rival.trace).length).toBeLessThan(JSON.stringify(player.trace).length);
    // Rivals are written first, so the player's traces are the newest of the kind.
    expect(player.seq).toBeGreaterThan(rival.seq);
  });

  it('changes nothing when drift is turned off', async () => {
    const built = driftWorld();
    const engine = engineOn(built.world, { 'match.momentum.weeklyDrift': 0 });
    await engine.advanceDays({ maxDays: 7 });
    const tables = engine.exportState().world.tables;
    expect(employmentIn(tables, at(built.player, 0)).momentum).toBe(100);
    expect(employmentIn(tables, at(built.rival, 1)).momentum).toBe(-100);
  });

  it('drifts toward the target tunable', async () => {
    const built = driftWorld();
    const engine = engineOn(built.world, { 'match.momentum.driftTarget': 20 });
    await engine.advanceDays({ maxDays: 1 });
    const tables = engine.exportState().world.tables;
    expect(employmentIn(tables, at(built.player, 0)).momentum).toBeCloseTo(90.4, 10);
    expect(employmentIn(tables, at(built.player, 3)).momentum).toBeCloseTo(2.4, 10);
  });

  it('lists rivals first, then the player’s workers, skipping empty and at-rest momentum', () => {
    const built = driftWorld();
    const listed = driftingEmployments(built.world, 0).map((row) => [row.employment.id, row.human]);
    expect(listed).toEqual([
      [at(built.rival, 0), false],
      [at(built.rival, 1), false],
      [at(built.player, 0), true],
      [at(built.player, 1), true],
    ]);
  });

  it('is deterministic', async () => {
    const run = async () => {
      const engine = engineOn(driftWorld().world);
      await engine.advanceDays({ maxDays: 21 });
      return engine.exportState();
    };
    expect(await run()).toEqual(await run());
  });
});
