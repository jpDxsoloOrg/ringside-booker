// The doors' previews (MTCH3-03): the same math as the doors, with nothing written.
// Design: docs/design/workers.md#doors
import { describe, expect, it } from 'vitest';
import type { RegionId } from '../../../src/core/ids';
import { createEngineTunables } from '../../../src/systems/tunables';
import { previewMomentumChange, previewPopularityChange } from '../../../src/systems/workers';
import {
  aftermathWorld,
  applyInOrder,
  NORTH_1,
  NORTH_2,
  SOUTH_1,
} from '../match/aftermath/fixtures';

describe('door previews', () => {
  it('predict exactly what the doors write, and write nothing themselves', () => {
    const built = aftermathWorld({
      popularity: [30, 60],
      matches: [{ slot: 0, sides: [[0], [1]], result: 0 }],
    });
    const { world } = built;
    const tunables = createEngineTunables();
    const before = JSON.stringify(world.tables.people.values());
    const weights = { [NORTH_2]: 1, [NORTH_1]: 0.4, [SOUTH_1]: 0.4 } as Record<RegionId, number>;
    const popularity = previewPopularityChange(
      world,
      tunables,
      { kind: 'person', id: built.person(0) },
      { regionWeights: weights, delta: 4 },
    );
    const momentum = previewMomentumChange(world, tunables, built.employment(0), 5);
    expect(JSON.stringify(world.tables.people.values())).toBe(before);
    expect(popularity.byRegion[NORTH_2]).toEqual({ before: 30, after: 34 });
    expect(popularity.regions.get(NORTH_1)).toMatchObject({ before: 30, after: 31.6 });
    expect(momentum).toMatchObject({ before: 0, after: 5 });

    // The applier hands the doors this match's own delta (4 and 5 for this win).
    applyInOrder(world, [built.segment(0)]);
    expect(world.tables.people.require(built.person(0)).regionalPop).toMatchObject(
      popularity.after,
    );
    expect(world.tables.employments.require(built.employment(0)).momentum).toBe(momentum.after);
  });
});
