// The roster.rows query: which rows, their groups, filters and order.
// Design: docs/design/roster.md#roster-rows
import { describe, expect, it } from 'vitest';
import { diffDays } from '../../../src/core/date';
import { PUSH_LEVELS } from '../../../src/model/entities/employment';
import { buildRosterRows, ROSTER_ROLE_GROUPS, type RosterRow } from '../../../src/systems/roster';
import { createEngineTunables } from '../../../src/systems/tunables';
import { DOOR_TRACE_KINDS } from '../../../src/systems/workers';
import { expectSerialisable } from '../../support/trace';
import { PLAYER, PLAYER_CONTROLLER, rosterOf, rosterTestWorld, TODAY } from './roster-world';

function byId(rows: readonly RosterRow[], employmentId: string): RosterRow {
  const row = rows.find((candidate) => candidate.employmentId === employmentId);
  if (row === undefined) {
    throw new Error(`No row for ${employmentId}`);
  }
  return row;
}

describe('roster.rows', () => {
  it('lists only active contracts, one row each, with the promotion and its brands', () => {
    const world = rosterTestWorld();
    const view = rosterOf(world.engine);
    expectSerialisable(view);
    expect(view.unavailableReason).toBeNull();
    expect(view.promotion).toEqual({
      promotionId: world.own,
      name: 'Test Promotion A',
      brands: [
        { brandId: world.flagship, name: 'Test Brand One', priority: 0 },
        { brandId: world.second, name: 'Test Brand Two', priority: 1 },
      ],
    });
    // Ten wrestlers, a referee, an announcer, a presenter and a second-brand wrestler.
    expect(view.rows).toHaveLength(14);
    const ids = view.rows.map((row) => row.employmentId);
    expect(ids).not.toContain(world.expired);
    expect(ids).not.toContain(world.offered);
    expect(new Set(ids).size).toBe(ids.length);
    expect(view.rows.every((row) => row.promotionId === world.own)).toBe(true);
  });

  it('puts every role in its group, presenters with the others', () => {
    const world = rosterTestWorld();
    const { rows } = rosterOf(world.engine);
    expect(byId(rows, world.referee).group).toBe('referees');
    expect(byId(rows, world.announcer).group).toBe('announcers');
    expect(byId(rows, world.presenter).group).toBe('others');
    expect(rows.filter((row) => row.group === 'wrestlers')).toHaveLength(11);
  });

  it('gives crew no push fields and every wrestler a verdict', () => {
    const world = rosterTestWorld();
    const { rows } = rosterOf(world.engine);
    for (const row of rows) {
      if (row.group === 'wrestlers') {
        expect(row.expectedPush).not.toBeNull();
        expect(row.pushGap).not.toBeNull();
        expect(row.pushGap?.steps).toBe(
          PUSH_LEVELS.indexOf(row.push) - PUSH_LEVELS.indexOf(row.expectedPush ?? 'none'),
        );
      } else {
        expect(row.expectedPush).toBeNull();
        expect(row.pushGap).toBeNull();
      }
      expect(row.overall.grade).toMatch(/^[A-FS][+-]?$/);
      expect(row.overall.value).toBe(Math.round(row.overall.value * 10) / 10);
      expect(row.popularity).toBe(Math.round(row.popularity * 10) / 10);
    }
    const verdicts = new Set(rows.map((row) => row.pushGap?.verdict));
    expect(verdicts).toContain('expectsMore');
    expect(verdicts).toContain('aboveExpected');
  });

  it('filters by brand, by no brand and by group', () => {
    const world = rosterTestWorld();
    const shared = rosterOf(world.engine, { brandId: 'shared' }).rows;
    expect(shared).toHaveLength(4);
    expect(shared.every((row) => row.brandId === null && row.brandName === null)).toBe(true);

    const second = rosterOf(world.engine, { brandId: world.second }).rows;
    expect(second.map((row) => row.employmentId).sort()).toEqual(
      [world.presenter, world.secondBrandWrestler].sort(),
    );
    expect(second.every((row) => row.brandName === 'Test Brand Two')).toBe(true);

    const flagship = rosterOf(world.engine, { brandId: world.flagship }).rows;
    expect(flagship).toHaveLength(8);

    const referees = rosterOf(world.engine, { group: 'referees' }).rows;
    expect(referees.map((row) => row.employmentId)).toEqual([world.referee]);
    expect(
      rosterOf(world.engine, { brandId: world.second, group: 'wrestlers' }).rows.map(
        (row) => row.employmentId,
      ),
    ).toEqual([world.secondBrandWrestler]);
  });

  it('sorts by group, card position, then ring name in natural order, the same every time', () => {
    const world = rosterTestWorld();
    const first = rosterOf(world.engine).rows;
    const second = rosterOf(world.engine).rows;
    expect(second).toEqual(first);
    const groups = first.map((row) => ROSTER_ROLE_GROUPS.indexOf(row.group));
    expect(groups).toEqual([...groups].sort((left, right) => left - right));
    const wrestlers = first.filter((row) => row.group === 'wrestlers');
    const pushes = wrestlers.map((row) => PUSH_LEVELS.indexOf(row.push));
    expect(pushes).toEqual([...pushes].sort((left, right) => left - right));
    // Indexes 0 and 5 are both main event: "Test Name 5" before "Test Name 10".
    expect(wrestlers.slice(0, 2).map((row) => row.ringName)).toEqual([
      'Test Name 5',
      'Test Name 10',
    ]);
  });

  it('carries stored state as it is: a fresh contract has no momentum and no traces', () => {
    const world = rosterTestWorld();
    const { rows } = rosterOf(world.engine);
    for (const row of rows) {
      expect(row.momentum).toEqual({ value: null, traceRef: null });
      expect(row.morale).toEqual({ value: 0, traceRef: null });
      expect(row.availability).toEqual({ status: 'available', reason: null, until: null });
    }
  });

  it("links the doors' stored momentum and morale traces when there are some", () => {
    const world = rosterTestWorld();
    const stored = new Set([`${DOOR_TRACE_KINDS.morale}:${world.referee}`]);
    const rows = buildRosterRows(world.read, world.own, TODAY, {
      tunables: createEngineTunables(),
      traces: { has: (ref) => stored.has(`${ref.kind}:${ref.id}`) },
    });
    const referee = byId(rows, world.referee);
    expect(referee.morale.traceRef).toEqual({ kind: DOOR_TRACE_KINDS.morale, id: world.referee });
    expect(referee.momentum.traceRef).toBeNull();
    expect(byId(rows, world.announcer).morale.traceRef).toBeNull();
  });

  it('counts the days left on a contract with an end date', () => {
    const world = rosterTestWorld();
    const { rows } = rosterOf(world.engine);
    const ending = rows.find((row) => row.endsOn !== null);
    expect(ending?.daysLeft).toBe(45);
    expect(ending === undefined ? null : diffDays(TODAY, ending.endsOn ?? TODAY)).toBe(45);
    expect(rows.filter((row) => row.endsOn === null).every((row) => row.daysLeft === null)).toBe(
      true,
    );
  });

  it('lists roster.expectsMoreSteps, and an override changes the verdicts', () => {
    const world = rosterTestWorld();
    const listed = world.engine.query('tunables.list', { category: 'Roster' }, PLAYER);
    if (!listed.ok) throw new Error(JSON.stringify(listed.reasons));
    expect(listed.data.map((row) => row.key)).toEqual(['roster.expectsMoreSteps']);

    const verdicts = (): (string | undefined)[] =>
      rosterOf(world.engine).rows.map((row) => row.pushGap?.verdict);
    const before = verdicts();
    const set = world.engine.command(
      'tunables.setOverride',
      { key: 'roster.expectsMoreSteps', value: 4 },
      PLAYER_CONTROLLER,
    );
    expect(set.ok).toBe(true);
    const after = verdicts();
    expect(after).not.toEqual(before);
    const flagged = (list: (string | undefined)[]): number =>
      list.filter((verdict) => verdict === 'expectsMore' || verdict === 'aboveExpected').length;
    expect(flagged(after)).toBeLessThan(flagged(before));
  });
});
