// Where a match's popularity change goes (MTCH3-03): the show region, its neighbours and the reach
// providers, largest weight per region. Design: docs/design/match-aftermath.md#regional-spread
import { afterEach, describe, expect, it } from 'vitest';
import { RegistryError } from '../../../../src/core/errors';
import type { RegionId } from '../../../../src/core/ids';
import {
  listPopularityReach,
  registerPopularityReach,
  segmentRegionWeights,
  type ReachContext,
  type ReachRegion,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { testId } from '../../../support/ids';
import { aftermathWorld, NORTH_1, NORTH_2, SHOW_DATE, SOUTH_1, SOUTH_2 } from './fixtures';

const unregister: (() => void)[] = [];
afterEach(() => {
  for (const undo of unregister.splice(0)) {
    undo();
  }
});

function provide(id: string, regions: readonly ReachRegion[], order = 0): void {
  unregister.push(registerPopularityReach({ id, order, regionsFor: () => regions }));
}

function weightsAt(regionId: RegionId, overrides: Record<string, number> = {}) {
  const { world } = aftermathWorld({ popularity: [], matches: [] });
  const ctx: ReachContext = {
    promotionId: testId('promotion'),
    eventInstanceId: null,
    regionId,
    televised: true,
    importance: 'regular',
    date: SHOW_DATE,
  };
  return segmentRegionWeights(world, ctx, createEngineTunables(overrides));
}

describe('segmentRegionWeights', () => {
  it('gives the show region 1 and each neighbour the spill', () => {
    const result = weightsAt(NORTH_2);
    expect(result.lines).toEqual([
      {
        regionId: NORTH_2,
        name: 'Test Region North 2',
        weight: 1,
        source: 'show',
        reason: 'Show region',
      },
      {
        regionId: NORTH_1,
        name: 'Test Region North 1',
        weight: 0.4,
        source: 'neighbour',
        reason: 'Neighbour of Test Region North 2',
      },
      {
        regionId: SOUTH_1,
        name: 'Test Region South 1',
        weight: 0.4,
        source: 'neighbour',
        reason: 'Neighbour of Test Region North 2',
      },
    ]);
    expect([...result.weights.entries()]).toEqual([
      [NORTH_2, 1],
      [NORTH_1, 0.4],
      [SOUTH_1, 0.4],
    ]);
    expect(result.notes).toEqual([]);
  });

  it('drops the neighbours when the spill is 0', () => {
    const result = weightsAt(NORTH_2, { 'match.popularity.neighbourSpill': 0 });
    expect([...result.weights.keys()]).toEqual([NORTH_2]);
  });

  it('takes the largest weight for a region reached twice, never the sum', () => {
    provide('test.low', [{ regionId: NORTH_1, weight: 0.3, reason: 'Low reach' }]);
    provide('test.high', [{ regionId: SOUTH_1, weight: 0.9, reason: 'High reach' }]);
    provide('test.show', [{ regionId: NORTH_2, weight: 0.5, reason: 'Home TV' }]);
    const result = weightsAt(NORTH_2);
    expect(result.weights.get(NORTH_1)).toBe(0.4);
    expect(result.lines.find((line) => line.regionId === NORTH_1)?.source).toBe('neighbour');
    expect(result.weights.get(SOUTH_1)).toBe(0.9);
    expect(result.lines.find((line) => line.regionId === SOUTH_1)?.reason).toBe('High reach');
    expect(result.weights.get(NORTH_2)).toBe(1);
  });

  it('caps a provider weight at 1, drops 0 and notes what it changed', () => {
    provide('test.big', [
      { regionId: SOUTH_2, weight: 1.5, reason: 'TV reach: Big Network' },
      { regionId: NORTH_1, weight: 0, reason: 'Nothing' },
    ]);
    const result = weightsAt(NORTH_2);
    expect(result.weights.get(SOUTH_2)).toBe(1);
    expect(result.notes).toEqual([
      'TV reach: Big Network: a weight of 1.5 is outside 0 to 1, so 1 is used',
    ]);
    expect(result.weights.get(NORTH_1)).toBe(0.4);
  });

  it('leaves out a region that is not on the map', () => {
    provide('test.lost', [{ regionId: testId('region', 99), weight: 0.5, reason: 'Lost reach' }]);
    const result = weightsAt(NORTH_2);
    expect(result.weights.size).toBe(3);
    expect(result.notes).toHaveLength(1);
  });
});

describe('the reach seam', () => {
  it('runs providers by order, then id', () => {
    provide('test.second', [], 5);
    provide('test.bravo', [], 1);
    provide('test.alpha', [], 1);
    // The match bundle's own TV reach provider (MTCH3-05) is registered too; only the test's count.
    const testIds = listPopularityReach()
      .map((provider) => provider.id)
      .filter((id) => id.startsWith('test.'));
    expect(testIds).toEqual(['test.alpha', 'test.bravo', 'test.second']);
  });

  it('refuses a duplicate or malformed id', () => {
    provide('test.once', []);
    expect(() =>
      registerPopularityReach({ id: 'test.once', order: 0, regionsFor: () => [] }),
    ).toThrow(RegistryError);
    expect(() => registerPopularityReach({ id: 'Bad id', order: 0, regionsFor: () => [] })).toThrow(
      RegistryError,
    );
  });

  it('passes the match to the provider', () => {
    const seen: ReachContext[] = [];
    unregister.push(
      registerPopularityReach({
        id: 'test.spy',
        order: 0,
        regionsFor: (_read, ctx) => {
          seen.push(ctx);
          return [];
        },
      }),
    );
    weightsAt(SOUTH_2);
    expect(seen).toEqual([expect.objectContaining({ regionId: SOUTH_2, televised: true })]);
  });
});
