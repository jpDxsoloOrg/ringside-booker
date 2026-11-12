// The auto-winner decision and its inputs from the world (MTCH2-03).
// Design: docs/design/match-finishes.md#auto-winner
import { describe, expect, it } from 'vitest';
import type { PersonId } from '../../../src/core/ids';
import { RngRegistry, type RngStream } from '../../../src/core/rng/registry';
import { findTraceNodes, inputOf, type Traced } from '../../../src/core/trace';
import {
  AUTO_WINNER_LABEL,
  MATCH_AUTO_WINNER_STREAM,
  NO_UNPREDICTABILITY_NOTE,
  RANDOM_WINNERS_LABEL,
  TIE_BREAK_RULE,
  autoWinner,
  autoWinnerInputsOf,
  competitorSidesOf,
  unpredictabilityLabel,
  type AutoWinnerMode,
  type AutoWinnerSideScore,
} from '../../../src/systems/match';
import { personId } from '../../support/show-world';
import { expectRollRecorded, expectSerialisable } from '../../support/trace';
import { tinyWorld } from '../../support/worlds';
import { personAt, setMomentum, updatePerson } from './rating/fixtures';

const SEEDS = 1000;

function stream(seed: string): RngStream {
  return new RngRegistry(seed).stream(MATCH_AUTO_WINNER_STREAM);
}

function side(index: number, score: number, lowest: PersonId): AutoWinnerSideScore {
  const label = `Side ${String(index + 1)}`;
  return { side: index, label, score: inputOf(`${label} score`, score), lowestPersonId: lowest };
}

function decide(
  sides: readonly AutoWinnerSideScore[],
  options: { randomness?: number; seed?: string; mode?: AutoWinnerMode } = {},
): Traced<number> {
  const result = autoWinner(
    {
      sides,
      randomness: inputOf('Unpredictability', options.randomness ?? 0),
      mode: options.mode ?? 'standard',
    },
    { rng: stream(options.seed ?? 'auto-winner') },
  );
  expectSerialisable(result);
  return result;
}

describe('autoWinner', () => {
  it('is deterministic at randomness 0, and the higher score wins', () => {
    const sides = [side(0, 40, personId(5)), side(1, 55, personId(9))];
    const results = ['a', 'b', 'c'].map((seed) => decide(sides, { seed }));
    for (const result of results) {
      expect(result.value).toBe(1);
      expect(findTraceNodes(result.trace, 'roll')).toHaveLength(0);
    }
    const first = decide(sides, { seed: 'a' });
    expect(first.trace.label).toBe(AUTO_WINNER_LABEL);
    expect(findTraceNodes(first.trace, 'note')[0]?.label).toBe(NO_UNPREDICTABILITY_NOTE);
  });

  it('breaks an exact tie by the lowest person id', () => {
    const result = decide([side(0, 30, personId(7)), side(1, 30, personId(3))]);
    expect(result.value).toBe(1);
    expect(findTraceNodes(result.trace, 'branch').map((node) => node.label)).toContain(
      TIE_BREAK_RULE,
    );
    const reversed = decide([side(0, 30, personId(2)), side(1, 30, personId(3))]);
    expect(reversed.value).toBe(0);
  });

  it('is identical for the same seed when there is randomness', () => {
    const sides = [side(0, 40, personId(1)), side(1, 42, personId(2))];
    const first = decide(sides, { randomness: 20, seed: 'same' });
    const second = decide(sides, { randomness: 20, seed: 'same' });
    expect(second).toEqual(first);
    const roll = expectRollRecorded(first, MATCH_AUTO_WINNER_STREAM);
    expect(roll.kind).toBe('float');
    expect(roll.label).toBe(unpredictabilityLabel('Side 1'));
    expect(roll.min).toBe(-20);
    expect(roll.max).toBe(20);
  });

  it('lets both of two equal sides win at least 30% of the time at randomness 60', () => {
    const sides = [side(0, 50, personId(1)), side(1, 50, personId(2))];
    const wins = [0, 0];
    for (let index = 0; index < SEEDS; index += 1) {
      const winner = decide(sides, { randomness: 60, seed: `seed-${String(index)}` }).value;
      wins[winner] = (wins[winner] ?? 0) + 1;
    }
    expect(wins[0]).toBeGreaterThanOrEqual(SEEDS * 0.3);
    expect(wins[1]).toBeGreaterThanOrEqual(SEEDS * 0.3);
  });

  it('labels Random winners mode so the trace starts with it', () => {
    const result = decide([side(0, 10, personId(1)), side(1, 20, personId(2))], {
      mode: 'randomWinners',
      randomness: 60,
    });
    expect(result.trace.label).toBe(RANDOM_WINNERS_LABEL);
    expect(result.trace.label.startsWith('Random winners mode')).toBe(true);
  });

  it('only ever returns a side it was given, never a draw', () => {
    const sides = [side(2, 10, personId(4)), side(3, 10, personId(5))];
    for (let index = 0; index < 100; index += 1) {
      expect([2, 3]).toContain(
        decide(sides, { randomness: 30, seed: `given-${String(index)}` }).value,
      );
    }
  });

  it('refuses no sides', () => {
    expect(() => decide([])).toThrow();
  });
});

describe('autoWinnerInputsOf', () => {
  it('reads popularity, push, momentum and alignment from the active contract', () => {
    const { world, ids } = tinyWorld();
    const { A: promotionA, B: promotionB } = ids.promotions;
    const [regionId] = ids.regions;
    if (promotionA === undefined || promotionB === undefined || regionId === undefined) {
      throw new Error('tinyWorld needs two promotions and a region');
    }
    const first = personAt(ids.people, 0);
    const second = personAt(ids.people, 1);
    updatePerson(world, first, (person) => ({ ...person, regionalPop: { [regionId]: 64 } }));
    updatePerson(world, second, (person) => ({ ...person, regionalPop: {} }));
    setMomentum(world, first, 12);
    setMomentum(world, second, null);

    const sides = autoWinnerInputsOf(world, {
      promotionId: promotionA,
      regionId,
      sides: [
        { side: 1, personIds: [second] },
        { side: 0, personIds: [first] },
      ],
    });
    expect(sides.map((entry) => entry.side)).toEqual([0, 1]);
    expect(sides.map((entry) => entry.sideLabel)).toEqual(['Side 1', 'Side 2']);
    const contract = world.tables.employments
      .lookup('byPerson', first)
      .find((employment) => employment.status === 'active');
    expect(sides[0]?.competitors[0]).toEqual({
      personId: first,
      name: contract?.ringName,
      popularityInRegion: 64,
      push: contract?.push,
      momentum: 12,
      alignment: contract?.alignment,
    });
    expect(sides[1]?.competitors[0]).toMatchObject({ popularityInRegion: 0, momentum: null });

    // The same people seen from the other promotion: not employed there.
    const elsewhere = autoWinnerInputsOf(world, {
      promotionId: promotionB,
      regionId,
      sides: [{ side: 0, personIds: [first] }],
    });
    const person = world.tables.people.get(first);
    expect(elsewhere[0]?.competitors[0]).toEqual({
      personId: first,
      name: person?.defaultRingName,
      popularityInRegion: 64,
      push: 'none',
      momentum: null,
      alignment: null,
    });
  });

  it('lists competitors in ascending id order', () => {
    const { world, ids } = tinyWorld();
    const { A: promotionA } = ids.promotions;
    const [regionId] = ids.regions;
    if (promotionA === undefined || regionId === undefined) {
      throw new Error('tinyWorld needs a promotion and a region');
    }
    const sorted = [...ids.people.slice(0, 3)].sort();
    const [inputs] = autoWinnerInputsOf(world, {
      promotionId: promotionA,
      regionId,
      sides: [{ side: 0, personIds: [...sorted].reverse() }],
    });
    expect(inputs?.competitors.map((competitor) => competitor.personId)).toEqual(sorted);
  });

  it('throws for a person the world does not have', () => {
    const { world, ids } = tinyWorld();
    const { A: promotionA } = ids.promotions;
    const [regionId] = ids.regions;
    if (promotionA === undefined || regionId === undefined) {
      throw new Error('tinyWorld needs a promotion and a region');
    }
    expect(() =>
      autoWinnerInputsOf(world, {
        promotionId: promotionA,
        regionId,
        sides: [{ side: 0, personIds: [personId(999_999)] }],
      }),
    ).toThrow();
  });
});

describe('competitorSidesOf', () => {
  it('keeps only competitors: ringside people and interferers never win', () => {
    expect(
      competitorSidesOf([
        { personId: personId(1), role: 'competitor', side: 1 },
        { personId: personId(2), role: 'competitor', side: 0 },
        { personId: personId(3), role: 'ringside', side: 0 },
        { personId: personId(4), role: 'competitor', side: 1 },
      ]),
    ).toEqual([
      { side: 0, personIds: [personId(2)] },
      { side: 1, personIds: [personId(1), personId(4)] },
    ]);
  });
});
