// The Match lab's Simulate (MTCH2-04): `match.simulate` resolves a plan on detached streams and
// rates the match with its finish, never touching the world; `match.resultMode` tells the lab
// whether Random winners decides the viewer's results.
// Design: docs/design/match-finishes.md#simulate
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  initialEngineState,
  OMNISCIENT_VIEWER,
  type Engine,
  type Viewer,
} from '../../../src/core/api';
import { parseContentKey } from '../../../src/core/content-key';
import type { PersonId, RegionId } from '../../../src/core/ids';
import { findTraceNodes, type ArithmeticNode, type TraceNode } from '../../../src/core/trace';
import type { GameWorld } from '../../../src/model/tables';
import { defaultSystems } from '../../../src/systems';
import {
  DRAW_CROWD_PENALTY_LABEL,
  RANDOM_WINNERS_LABEL,
  registerFinishFilter,
  type SimulateArgs,
  type SimulateResult,
} from '../../../src/systems/match';
import { TEST_PLAYER_ID } from '../../support/builders/build-row';
import { worldBuilder } from '../../support';
import { expectSerialisable } from '../../support/trace';
import { updatePerson } from './rating/fixtures';

const PLAYER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: TEST_PLAYER_ID },
};
const COMPUTER: Viewer = { kind: 'controller', controller: { kind: 'computer' } };

interface SimWorld {
  readonly engine: Engine;
  readonly roster: readonly PersonId[];
  readonly region: RegionId;
}

function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) {
    throw new Error(`nothing at ${String(index)}`);
  }
  return value;
}

/** Makes the first two wrestlers equal in everything the auto-winner reads. */
function makeEqual(world: GameWorld, roster: readonly PersonId[], region: RegionId): void {
  for (const personId of [at(roster, 0), at(roster, 1)]) {
    updatePerson(world, personId, (person) => ({
      ...person,
      regionalPop: { ...person.regionalPop, [region]: 50 },
    }));
    const contract = world.tables.employments
      .lookup('byPerson', personId)
      .find((employment) => employment.status === 'active');
    if (contract === undefined) {
      throw new Error(`no contract for ${personId}`);
    }
    const result = world.transact('equalise', (tx) => {
      tx.update('employments', contract.id, (row) => ({
        ...row,
        push: 'midCard',
        momentum: 0,
        alignment: 'face',
      }));
    });
    if (!result.ok) {
      throw result.error;
    }
  }
}

/** One human-run promotion with 8 wrestlers and every catalog. */
function simWorld(options: { randomWinners?: boolean; equal?: boolean } = {}): SimWorld {
  const { world, ids } = worldBuilder(
    options.randomWinners === undefined
      ? {}
      : { settings: { extra: { randomWinners: options.randomWinners } } },
  )
    .withGeography('mini')
    .withCatalogs()
    .withPromotion(
      { name: 'Test Promotion A', controller: { kind: 'human', playerId: TEST_PLAYER_ID } },
      (promotion) => promotion.withRoster(8),
    )
    .build();
  const roster = ids.people.slice(0, 8);
  const region = at(ids.regions, 0);
  if (options.equal === true) {
    makeEqual(world, roster, region);
  }
  const engine = createEngine({ state: initialEngineState(world), systems: defaultSystems });
  return { engine, roster, region };
}

function singles(sim: SimWorld, overrides: Partial<SimulateArgs> = {}): SimulateArgs {
  return {
    kind: 'match',
    typeKey: parseContentKey('match.singles'),
    sides: [[at(sim.roster, 0)], [at(sim.roster, 1)]],
    slotRole: 'mainEvent',
    importance: 'major',
    regionId: sim.region,
    televised: true,
    previewSeed: 7,
    winner: 'auto',
    finishKey: null,
    ...overrides,
  };
}

function simulate(sim: SimWorld, args: SimulateArgs, viewer: Viewer = PLAYER): SimulateResult {
  const result = sim.engine.query('match.simulate', args, viewer);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.reasons));
  }
  expectSerialisable(result.data);
  return result.data;
}

function labelsOf(node: TraceNode): string[] {
  return [node.label, ...(node.children ?? []).flatMap(labelsOf)];
}

/** The one add line labelled `label` in the work rate trace. */
function workRateLine(result: SimulateResult, label: string): ArithmeticNode {
  const trace = result.preview.workRate?.trace;
  if (trace === undefined) {
    throw new Error('no work rate');
  }
  const lines = findTraceNodes(trace, 'add').filter((node) => node.label === label);
  expect(lines).toHaveLength(1);
  const line = lines[0];
  if (line?.kind !== 'add') {
    throw new Error(`no ${label} line`);
  }
  return line;
}

describe('match.simulate', () => {
  it('gives the same result for the same arguments', () => {
    const sim = simWorld();
    const first = simulate(sim, singles(sim));
    expect(simulate(sim, singles(sim))).toEqual(first);
    expect(first.preview.previewSeed).toBe(7);
    expect(first.outcome.kind).toBe('win');
    expect(first.winnerNames).toHaveLength(1);
    expect(first.method).not.toBeNull();
    expect(first.randomWinnersMode).toBe(false);
  });

  it('names the finish and method in the result Why? by name, never by content key', () => {
    const sim = simWorld();
    for (let seed = 0; seed < 20; seed += 1) {
      const result = simulate(sim, singles(sim, { previewSeed: seed }));
      const decisions = findTraceNodes(result.resultTrace, 'decision');
      const options = decisions.flatMap((node) => [
        node.chosen,
        ...node.considered.map((entry) => entry.option),
      ]);
      expect(options.filter((option) => /^(finish|method)\./.test(String(option)))).toEqual([]);
      expect(options).toContain(result.finish.name);
    }
    const booked = simulate(
      sim,
      singles(sim, { winner: { side: 0 }, finishKey: parseContentKey('finish.disqualification') }),
    );
    const chosen = findTraceNodes(booked.resultTrace, 'decision').map((node) => node.chosen);
    expect(chosen).toContain('Disqualification');
  });

  it('never moves the world, its RNG, traces or event log over 50 calls', () => {
    const sim = simWorld();
    const before = JSON.stringify(sim.engine.exportState());
    for (let seed = 0; seed < 50; seed += 1) {
      simulate(sim, singles(sim, { previewSeed: seed }));
    }
    expect(JSON.stringify(sim.engine.exportState())).toBe(before);
  });

  it('lets a booked Side 2 win on every seed', () => {
    const sim = simWorld();
    for (let seed = 0; seed < 50; seed += 1) {
      const result = simulate(sim, singles(sim, { previewSeed: seed, winner: { side: 1 } }));
      expect(result.outcome).toMatchObject({ kind: 'win', winningSide: 1 });
      expect(result.winningSide).toBe(1);
    }
  });

  it('takes exactly 4 work rate off a disqualification against a clean finish', () => {
    const sim = simWorld();
    const plan = { previewSeed: 11, winner: { side: 0 } } as const;
    const clean = simulate(
      sim,
      singles(sim, { ...plan, finishKey: parseContentKey('finish.clean') }),
    );
    const dq = simulate(
      sim,
      singles(sim, { ...plan, finishKey: parseContentKey('finish.disqualification') }),
    );
    const cleanLine = workRateLine(clean, 'Clean finish');
    const dqLine = workRateLine(dq, 'Disqualification finish');
    expect(dqLine.operand).toBe(-4);
    expect(dqLine.before).toBe(cleanLine.before);
    expect(dqLine.after).toBe(cleanLine.after - 4);
    expect(dq.finish).toMatchObject({ key: 'finish.disqualification', name: 'Disqualification' });
    expect(dq.method?.key).toBe('method.disqualification');
  });

  it('gives a Draw no winner and the crowd its draw line', () => {
    const sim = simWorld();
    const result = simulate(sim, singles(sim, { winner: 'draw' }));
    expect(result.outcome.kind).toBe('draw');
    expect(result.winnerNames).toEqual([]);
    expect(result.winningSide).toBeNull();
    expect(result.method).toBeNull();
    expect(labelsOf(result.preview.crowd.trace)).toContain(DRAW_CROWD_PENALTY_LABEL);
  });

  it('refuses a disqualification in a three-sided match', () => {
    const sim = simWorld();
    const result = sim.engine.query(
      'match.simulate',
      singles(sim, {
        typeKey: parseContentKey('match.triple-threat'),
        sides: [[at(sim.roster, 0)], [at(sim.roster, 1)], [at(sim.roster, 2)]],
        finishKey: parseContentKey('finish.disqualification'),
      }),
      PLAYER,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.map((reason) => reason.code)).toEqual(['finishNotAllowed']);
    }
  });

  it('follows a registered finish filter, the door MTCH7 stipulations wire through', () => {
    // A stand-in for MTCH7's "no disqualifications" stipulation: the filter removes both
    // finishes that stop a match on a rule break.
    const banned = new Set(['finish.disqualification', 'finish.count-out']);
    const unregister = registerFinishFilter({
      id: 'test.no-disqualifications',
      order: 10,
      filter: (entries) => entries.filter((entry) => !banned.has(entry.key)),
    });
    try {
      const sim = simWorld();
      const refused = sim.engine.query(
        'match.simulate',
        singles(sim, {
          winner: { side: 0 },
          finishKey: parseContentKey('finish.disqualification'),
        }),
        PLAYER,
      );
      expect(refused.ok ? [] : refused.reasons.map((reason) => reason.code)).toEqual([
        'finishNotAllowed',
      ]);
      const listed = sim.engine.query(
        'match.finishes',
        { matchTypeKey: parseContentKey('match.singles') },
        PLAYER,
      );
      const keys = listed.ok ? listed.data.map((option) => option.key) : [];
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.filter((key) => banned.has(key))).toEqual([]);
      for (let seed = 0; seed < 30; seed += 1) {
        const result = simulate(sim, singles(sim, { previewSeed: seed }));
        expect(banned.has(result.finish.key)).toBe(false);
      }
    } finally {
      unregister();
    }
  });

  it('refuses an angle', () => {
    const sim = simWorld();
    const result = sim.engine.query(
      'match.simulate',
      singles(sim, { kind: 'angle', typeKey: parseContentKey('angle.promo') }),
      PLAYER,
    );
    expect(result.ok).toBe(false);
  });

  it('decides an Auto winner on the night in a Random winners game', () => {
    const sim = simWorld({ randomWinners: true, equal: true });
    const winners = new Set<number | null>();
    for (let seed = 0; seed < 30; seed += 1) {
      const result = simulate(sim, singles(sim, { previewSeed: seed }));
      expect(result.randomWinnersMode).toBe(true);
      const [winnerDecision] = result.resultTrace.children ?? [];
      expect(winnerDecision?.label.startsWith('Random winners mode')).toBe(true);
      expect(winnerDecision?.label).toBe(RANDOM_WINNERS_LABEL);
      winners.add(result.winningSide);
    }
    expect(winners.size).toBeGreaterThan(1);
  });

  it('still honours a booked side in a Random winners game', () => {
    const sim = simWorld({ randomWinners: true });
    const result = simulate(sim, singles(sim, { winner: { side: 0 } }));
    expect(result.randomWinnersMode).toBe(false);
    expect(result.winningSide).toBe(0);
  });
});

describe('match.resultMode', () => {
  const mode = (sim: SimWorld, viewer: Viewer): boolean => {
    const result = sim.engine.query('match.resultMode', {}, viewer);
    if (!result.ok) {
      throw new Error(JSON.stringify(result.reasons));
    }
    expectSerialisable(result.data);
    return result.data.randomWinners;
  };

  it('is on only with the setting on, for a human seat', () => {
    const on = simWorld({ randomWinners: true });
    expect(mode(on, PLAYER)).toBe(true);
    expect(mode(on, OMNISCIENT_VIEWER)).toBe(false);
    expect(mode(on, COMPUTER)).toBe(false);
    expect(mode(simWorld(), PLAYER)).toBe(false);
    expect(mode(simWorld({ randomWinners: false }), PLAYER)).toBe(false);
  });
});
