// roster.explain: the Why? behind every derived roster number matches the cell it explains.
// Design: docs/design/roster.md#roster-explain
import { describe, expect, it } from 'vitest';
import type { Engine, Viewer } from '../../../src/core/api';
import type { EmploymentId } from '../../../src/core/ids';
import { findTraceNodes, walkTrace, type TraceNode } from '../../../src/core/trace';
import {
  computePushGap,
  ROSTER_EXPLAIN_METRICS,
  rowExpectedPush,
  rowInputs,
  type RosterExplainMetric,
  type RosterExplanation,
  type RosterRow,
} from '../../../src/systems/roster';
import { createEngineTunables } from '../../../src/systems/tunables';
import { testId } from '../../support/ids';
import { expectSerialisable } from '../../support/trace';
import { COMPUTER, OMNISCIENT, PLAYER, rosterOf, rosterTestWorld } from './roster-world';

function explain(
  engine: Engine,
  employmentId: EmploymentId,
  metric: RosterExplainMetric,
  viewer: Viewer = PLAYER,
): RosterExplanation | null {
  const result = engine.query('roster.explain', { employmentId, metric }, viewer);
  if (!result.ok) {
    throw new Error(`roster.explain was refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

/** The value a row shows for `metric`, or null when the row has none. */
function cellOf(row: RosterRow, metric: RosterExplainMetric): number | string | null {
  switch (metric) {
    case 'expectedPush':
      return row.expectedPush;
    case 'pushGap':
      return row.pushGap?.steps ?? null;
    case 'overall':
      return row.overall.value;
    case 'popularity':
      return row.popularity;
  }
}

function hasTunable(trace: TraceNode, key: string): boolean {
  return findTraceNodes(trace, 'tunable').some((node) => node.key === key);
}

function labels(trace: TraceNode): string[] {
  const found: string[] = [];
  walkTrace(trace, (node) => found.push(node.label));
  return found;
}

describe('roster.explain', () => {
  const world = rosterTestWorld();
  const rows = rosterOf(world.engine).rows;

  it('matches the cell for every derived number of every row', () => {
    let explained = 0;
    for (const row of rows) {
      for (const metric of ROSTER_EXPLAIN_METRICS) {
        const cell = cellOf(row, metric);
        const explanation = explain(world.engine, row.employmentId, metric);
        if (cell === null) {
          expect(explanation).toBeNull();
          continue;
        }
        expect(explanation?.value).toBe(cell);
        expect(explanation?.employmentId).toBe(row.employmentId);
        expect(explanation?.metric).toBe(metric);
        explained += 1;
      }
    }
    expect(explained).toBeGreaterThan(rows.length * 2);
  });

  it('labels each number for the Why? panel', () => {
    const wrestler = rows.find(
      (row) => row.group === 'wrestlers' && row.expectedPush === 'midCard',
    );
    if (wrestler === undefined) throw new Error('No mid card wrestler in the roster world');
    const expected = explain(world.engine, wrestler.employmentId, 'expectedPush');
    expectSerialisable(expected);
    expect(expected).toMatchObject({ label: 'Expects: Mid card', value: 'midCard', unit: null });
    expect(explain(world.engine, wrestler.employmentId, 'pushGap')).toMatchObject({
      label: 'Push gap',
      unit: 'count',
    });
    expect(explain(world.engine, wrestler.employmentId, 'overall')?.label).toBe(
      'Overall as wrestler',
    );
    expect(explain(world.engine, world.referee, 'overall')?.label).toBe('Overall as referee');
    expect(explain(world.engine, wrestler.employmentId, 'popularity')?.label).toBe(
      "Popularity in Test Promotion A's regions",
    );
  });

  it("shows the worker's popularity among the promotion's fans inside the expected push", () => {
    for (const row of rows.filter((each) => each.group === 'wrestlers')) {
      const trace = explain(world.engine, row.employmentId, 'expectedPush')?.trace;
      if (trace === undefined) throw new Error('No expected push trace');
      const popularity = findTraceNodes(trace, 'formula').find(
        (node) => node.label === 'Popularity where Test Promotion A draws',
      );
      expect(popularity).toBeDefined();
      expect(Math.round(Number(popularity?.value) * 10) / 10).toBe(row.popularity);
    }
  });

  it('names roster.expectsMoreSteps only through the verdict wrapped around the gap', () => {
    const tunables = createEngineTunables();
    const row = rows.find((each) => each.group === 'wrestlers');
    if (row === undefined) throw new Error('No wrestler in the roster world');
    const explanation = explain(world.engine, row.employmentId, 'pushGap');
    if (explanation === null) throw new Error('No push gap explanation');
    expect(hasTunable(explanation.trace, 'roster.expectsMoreSteps')).toBe(true);
    expect(labels(explanation.trace)).toContain('Push gap');

    const inputs = rowInputs(
      world.read,
      world.read.tables.employments.require(row.employmentId),
      world.read.meta.currentDate,
    );
    const expected = rowExpectedPush(inputs, { tunables });
    if (expected === null) throw new Error('A wrestler has an expected push');
    const gapAlone = computePushGap({ push: row.push, expected }, { tunables });
    expect(gapAlone.value).toBe(explanation.value);
    expect(hasTunable(gapAlone.trace, 'roster.expectsMoreSteps')).toBe(false);
  });

  it('has no expected push or push gap for crew', () => {
    for (const crew of [world.referee, world.announcer, world.presenter]) {
      expect(explain(world.engine, crew, 'expectedPush')).toBeNull();
      expect(explain(world.engine, crew, 'pushGap')).toBeNull();
      expect(explain(world.engine, crew, 'overall')).not.toBeNull();
      expect(explain(world.engine, crew, 'popularity')).not.toBeNull();
    }
  });

  it("explains nothing the viewer can't see on a roster", () => {
    const rival = world.read.tables.employments
      .values()
      .find((employment) => employment.promotionId === world.rival);
    if (rival === undefined) throw new Error('The rival has no contracts');
    expect(explain(world.engine, rival.id, 'overall', PLAYER)).toBeNull();
    expect(explain(world.engine, rival.id, 'overall', OMNISCIENT)).not.toBeNull();
    expect(explain(world.engine, world.secondBrandWrestler, 'overall', COMPUTER)).toBeNull();
    expect(explain(world.engine, world.expired, 'overall', OMNISCIENT)).toBeNull();
    expect(explain(world.engine, world.offered, 'overall', OMNISCIENT)).toBeNull();
    expect(explain(world.engine, testId('employment', 9999), 'overall')).toBeNull();
  });
});
