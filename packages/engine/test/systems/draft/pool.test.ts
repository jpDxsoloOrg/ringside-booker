// The draft pool's size and mix (DRF-07).
// Design: docs/design/draft.md#pool
import { describe, expect, it } from 'vitest';
import { testId } from '../../support/ids';
import type { Push } from '../../../src/model/entities/employment';
import type { Gender } from '../../../src/model/entities/person';
import type { DraftCandidate } from '../../../src/systems/draft/candidates';
import { compareCandidates } from '../../../src/systems/draft/candidates';
import { apportion, cardLevels, choosePool, poolSizeFor } from '../../../src/systems/draft/pool';
import { createEngineTunables } from '../../../src/systems/tunables';

const tunables = createEngineTunables();

function candidate(
  index: number,
  value: number,
  push: Push | null,
  gender: Gender,
): DraftCandidate {
  return {
    personId: testId('person', index + 1),
    name: `Wrestler ${String(index)}`,
    gender,
    weightKg: 100,
    weightClass: 'heavyweight',
    style: 'allRounder',
    heel: index % 2 === 0,
    category: 'wrestler',
    role: 'wrestler',
    age: 30,
    rating: value,
    peakPop: 0,
    worldPop: 0,
    value,
    push,
  };
}

const PUSHES: Push[] = ['mainEvent', 'upperCard', 'midCard', 'lowerCard', 'enhancement'];

/** 400 wrestlers, 80 per level (value falls with the level), one in four female. */
function world(): DraftCandidate[] {
  const rows: DraftCandidate[] = [];
  for (let index = 0; index < 400; index += 1) {
    const level = Math.floor(index / 80);
    rows.push(
      candidate(
        index,
        90 - level * 15 - (index % 80) / 10,
        PUSHES[level] ?? null,
        index % 4 === 0 ? 'female' : 'male',
      ),
    );
  }
  return rows.sort(compareCandidates);
}

describe('apportion', () => {
  it('splits a total by weights with the largest remainders', () => {
    expect(apportion(10, [0.1, 0.2, 0.3, 0.25, 0.15])).toEqual([1, 2, 3, 3, 1]);
    expect(apportion(7, [1, 1, 1])).toEqual([3, 2, 2]);
    expect(apportion(0, [1, 2])).toEqual([0, 0]);
  });
});

describe('poolSizeFor', () => {
  it('is promotions × roster size × the ratio, or everyone', () => {
    expect(poolSizeFor('auto', 12, 20, tunables)).toBe(300);
    expect(poolSizeFor('small', 10, 20, tunables)).toBe(220);
    expect(poolSizeFor('large', 10, 20, tunables)).toBe(320);
    expect(poolSizeFor('all', 10, 20, tunables)).toBeNull();
  });
});

describe('cardLevels', () => {
  it('uses the card position, and the nearest level by value for free agents', () => {
    const rows = world();
    const freeAgent = { ...candidate(999, 89, null, 'male') };
    const lowFreeAgent = { ...candidate(998, 25, null, 'male') };
    const levels = cardLevels([...rows, freeAgent, lowFreeAgent].sort(compareCandidates), tunables);
    expect(levels.get(rows[0]!.personId)).toBe('mainEvent');
    expect(levels.get(freeAgent.personId)).toBe('mainEvent');
    expect(levels.get(lowFreeAgent.personId)).toBe('enhancement');
  });
});

describe('choosePool', () => {
  it('keeps the shares by card level, best first, and the gender balance', () => {
    const rows = world();
    const choice = choosePool(rows, 100, tunables);
    expect(choice.pool).toHaveLength(100);
    expect(choice.sitOut).toHaveLength(300);
    expect(choice.mix.map((level) => level.inPool)).toEqual([10, 20, 30, 25, 15]);
    for (const level of choice.mix) {
      // One in four of the world is female, and so is one in four of every level (±1).
      expect(Math.abs(level.female - level.inPool / 4)).toBeLessThanOrEqual(1);
    }
    // Within a level, the best are taken: the main event's ten are its ten best of each group.
    const mainEvent = choice.pool.filter((row) => row.push === 'mainEvent');
    const worstTaken = Math.min(
      ...mainEvent.filter((row) => row.gender === 'male').map((row) => row.value),
    );
    const bestLeft = Math.max(
      ...choice.sitOut
        .filter((row) => row.push === 'mainEvent' && row.gender === 'male')
        .map((row) => row.value),
    );
    expect(worstTaken).toBeGreaterThan(bestLeft);
  });

  it('fills a short level from the best left anywhere', () => {
    const rows = world().filter((row) => row.push !== 'mainEvent');
    const choice = choosePool(rows, 100, tunables);
    expect(choice.pool).toHaveLength(100);
  });

  it('takes everyone when the size is everyone or more', () => {
    expect(choosePool(world(), null, tunables).sitOut).toHaveLength(0);
    expect(choosePool(world(), 1000, tunables).pool).toHaveLength(400);
  });
});
