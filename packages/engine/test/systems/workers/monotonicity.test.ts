// Property checks on seeded random cases: more of a good thing never lowers the result.
// Design: docs/design/workers.md#role-ratings and #expected-push
import { describe, expect, it } from 'vitest';
import type { RegionId } from '../../../src/core/ids';
import { floatBetween, intBetween, pick, RngRegistry } from '../../../src/core/rng';
import { PUSH_LEVELS, type Push } from '../../../src/model/entities/employment';
import { ATTRIBUTE_KEYS } from '../../../src/model/entities/person';
import { createEngineTunables } from '../../../src/systems/tunables';
import {
  expectedPush,
  fanBaseOf,
  RATING_ROLES,
  ratingWeightKey,
  roleRating,
} from '../../../src/systems/workers';
import { attributesOf, testRegions } from './push-fixtures';

const CASES = 300;
const tunables = createEngineTunables();

/** A seeded stream per property. Any registered stream name does; the seed is what sets the cases. */
function casesFor(seed: string) {
  return new RngRegistry(seed).stream('worldgen.people.popularity');
}

/** Lower is better: the main event is 0. */
function cardStep(push: Push): number {
  return PUSH_LEVELS.indexOf(push);
}

describe('monotonicity', () => {
  it('raising an attribute that counts never lowers a role rating', () => {
    const stream = casesFor('workers-monotonicity-rating');
    for (let caseIndex = 0; caseIndex < CASES; caseIndex += 1) {
      const attributes = attributesOf(0);
      for (const key of ATTRIBUTE_KEYS) {
        attributes[key] = floatBetween(stream, 0, 100);
      }
      const role = pick(stream, RATING_ROLES);
      const counted = ATTRIBUTE_KEYS.filter((key) => tunables.get(ratingWeightKey(role, key)) > 0);
      const raised = pick(stream, counted);
      const higher = { ...attributes, [raised]: floatBetween(stream, attributes[raised], 100) };
      const before = roleRating({ role, attributes }, { tunables }).value;
      const after = roleRating({ role, attributes: higher }, { tunables }).value;
      expect(after).toBeGreaterThanOrEqual(before);
      expect(after).toBeLessThanOrEqual(100);
      expect(before).toBeGreaterThanOrEqual(0);
    }
  });

  it('raising popularity in a fan-base region never lowers the expected push', () => {
    const stream = casesFor('workers-monotonicity-push');
    const regions = testRegions(8);
    const minPop = tunables.get('workers.expectedPush.footprintMinPop');
    let moved = 0;
    for (let caseIndex = 0; caseIndex < CASES; caseIndex += 1) {
      const promotionPop: Partial<Record<RegionId, number>> = {};
      const workerPop: Partial<Record<RegionId, number>> = {};
      for (const region of regions) {
        promotionPop[region.id] = intBetween(stream, 1, 90);
        const known = intBetween(stream, 0, 60);
        if (known > 0) {
          workerPop[region.id] = known;
        }
      }
      const fanBase = fanBaseOf(promotionPop, regions, minPop).members;
      const raisedRegion = pick(stream, fanBase).region.id;
      const current = workerPop[raisedRegion] ?? 0;
      const higher = { ...workerPop, [raisedRegion]: intBetween(stream, current, 100) };
      const shared = {
        employmentRole: 'wrestler',
        promotionPop,
        promotionName: 'Test Promotion A',
        regions,
      } as const;
      const before = expectedPush({ ...shared, workerPop }, { tunables }).value;
      const after = expectedPush({ ...shared, workerPop: higher }, { tunables }).value;
      expect(cardStep(after)).toBeLessThanOrEqual(cardStep(before));
      moved += after === before ? 0 : 1;
    }
    // The cases are not all trivially equal.
    expect(moved).toBeGreaterThan(0);
  });
});
