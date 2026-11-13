// The production ceiling on show night (EVT4-02): carded and off-screen shows are held to it.
// Design: docs/design/card-flow.md#production-ceiling
import { afterEach, describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type EngineState } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { EventInstanceId, PromotionId } from '../../../src/core/ids';
import { walkTrace, type TraceNode } from '../../../src/core/trace';
import type { GameWorld } from '../../../src/model/tables';
import '../../../src/systems/cardFlow';
import { PRODUCTION_CEILING_STEP_LABELS, type CeilingLevels } from '../../../src/systems/cardFlow';
import { matchSystem } from '../../../src/systems/match';
import {
  SHOW_SCORE_TRACE_KIND,
  registerShowScoreModifier,
  showsSystem,
  unregisterShowScoreModifier,
} from '../../../src/systems/shows';
import { withMyShowsRun } from '../../support';
import {
  OMNISCIENT,
  runsAllButUnrun,
  showNightWorld,
  type ShowNightWorld,
} from '../shows/show-night-world';

const FORCE_ID = 'test.scoreSixty';

afterEach(() => {
  unregisterShowScoreModifier(FORCE_ID);
});

/** Makes every carded show's raw score exactly 60, whatever its segments scored. */
function forceRawSixty(): void {
  registerShowScoreModifier({
    id: FORCE_ID,
    stage: 'adjust',
    order: 1,
    apply: (calc) => {
      calc.multiply('Test: ignore the card', 0).add('Test: the card earned 60', 60);
    },
  });
}

function promotionNamed(world: GameWorld, name: string): PromotionId {
  const found = world.tables.promotions.values().find((row) => row.name === name);
  if (found === undefined) throw new Error(`no promotion ${name}`);
  return found.id;
}

function setLevels(world: GameWorld, promotionName: string, levels: CeilingLevels): void {
  const id = promotionNamed(world, promotionName);
  const result = world.transact('test levels', (tx) => {
    const row = tx.view.tables.promotions.require(id);
    tx.update('promotions', id, { production: { ...row.production, ...levels } });
  });
  if (!result.ok) throw result.error;
}

async function runNight(
  built: ShowNightWorld,
  overrides: Record<string, number> = {},
): Promise<{ state: EngineState; trace: (id: EventInstanceId) => TraceNode }> {
  const engine = createEngine({
    state: { ...initialEngineState(built.world), tunableOverrides: overrides },
    systems: withMyShowsRun([simSystem, matchSystem, showsSystem], runsAllButUnrun),
  });
  const advanced = await engine.advanceDays({ maxDays: 1 });
  expect(advanced.failures).toEqual([]);
  return {
    state: engine.exportState(),
    trace: (id) => {
      const found = engine.query(
        'trace.get',
        { ref: { kind: SHOW_SCORE_TRACE_KIND, id } },
        OMNISCIENT,
      );
      if (!found.ok || found.data === null || !('trace' in found.data)) {
        throw new Error(`no show score trace for ${id}`);
      }
      return found.data.trace;
    },
  };
}

function resultOf(state: EngineState, id: EventInstanceId | null) {
  const show = state.world.tables.eventInstances.find((row) => row.id === id);
  if (show?.result === null || show?.result === undefined)
    throw new Error(`no result for ${String(id)}`);
  return show.result;
}

function nodes(trace: TraceNode): TraceNode[] {
  const all: TraceNode[] = [];
  walkTrace(trace, (node) => {
    all.push(node);
  });
  return all;
}

function heldBack(trace: TraceNode): boolean | undefined {
  const branch = nodes(trace).find(
    (node) => node.kind === 'branch' && node.label === PRODUCTION_CEILING_STEP_LABELS.heldBack,
  );
  return branch?.kind === 'branch' ? branch.taken : undefined;
}

describe('the production ceiling on show night', () => {
  it('holds a raw 60 card under a 43.5 ceiling to 43.5 and keeps 60 as the raw score', async () => {
    forceRawSixty();
    const built = showNightWorld();
    setLevels(built.world, 'Test Promotion B', { stage: 1, camera: 1, editing: 0, pyro: 0 });
    const { state, trace } = await runNight(built);

    const result = resultOf(state, built.rivalCard);
    expect(result).toMatchObject({ score: 43.5, rawScore: 60, ceiling: 43.5 });
    const why = trace(built.rivalCard);
    const children = why.kind === 'formula' ? why.children : [];
    // The Why? ends with the ceiling's step and whether it held the score back.
    expect(children.slice(-2).map((node) => node.label)).toEqual([
      PRODUCTION_CEILING_STEP_LABELS.min,
      PRODUCTION_CEILING_STEP_LABELS.heldBack,
    ]);
    const min = children.find((node) => node.kind === 'min');
    expect(min?.label).toBe('Production ceiling');
    const breakdown = nodes(why)
      .filter((node) => node.kind === 'add')
      .map((node) => node.label);
    expect(breakdown).toEqual(
      expect.arrayContaining([
        'Stage (level 1 × 1.5)',
        'Camera (level 1 × 2)',
        'Editing (level 0 × 1.5)',
        'Pyro (level 0 × 1)',
      ]),
    );
    expect(heldBack(why)).toBe(true);
  });

  it('leaves a card under its ceiling alone, with the branch not taken', async () => {
    forceRawSixty();
    const built = showNightWorld();
    const { state, trace } = await runNight(built);
    // The test builder gives every area level 5: a ceiling of 70.
    expect(resultOf(state, built.human)).toMatchObject({ score: 60, rawScore: 60, ceiling: 70 });
    expect(heldBack(trace(built.human ?? built.rivalCard))).toBe(false);
  });

  it('holds an off-screen rival score to the same ceiling', async () => {
    const built = showNightWorld();
    setLevels(built.world, 'Test Promotion B', { stage: 1, camera: 1, editing: 0, pyro: 0 });
    const { state, trace } = await runNight(built, { 'production.ceilingBase': 0 });
    const bare = built.rivalBare[0] ?? null;
    const result = resultOf(state, bare);
    expect(result.ceiling).toBe(3.5);
    expect(result.rawScore).toBeGreaterThan(3.5);
    expect(result.score).toBe(3.5);
    const why = trace(bare ?? built.rivalCard);
    expect(why.label).toBe('Show score (card not booked in detail)');
    expect(heldBack(why)).toBe(true);
    expect(
      nodes(why).some((node) => node.kind === 'min' && node.label === 'Production ceiling'),
    ).toBe(true);
  });

  it('never stores a score above the raw score or the ceiling', async () => {
    const built = showNightWorld({ bareRivalShows: 3 });
    setLevels(built.world, 'Test Promotion B', { stage: 2, camera: 0, editing: 0, pyro: 0 });
    const { state } = await runNight(built, { 'production.ceilingBase': 10 });
    const completed = state.world.tables.eventInstances.filter((row) => row.result !== null);
    expect(completed.length).toBeGreaterThan(3);
    for (const show of completed) {
      const result = show.result;
      if (result === null || result.ceiling === null) continue;
      expect(result.score).toBeLessThanOrEqual(result.rawScore);
      expect(result.score).toBeLessThanOrEqual(result.ceiling);
    }
  });
});
