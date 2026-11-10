// A small map and helpers shared by the rating, footprint and expected-push tests.
import type { RegionId } from '../../../src/core/ids';
import type { Attributes } from '../../../src/model/entities/person';
import type { FootprintRegion, FootprintRegionalPop } from '../../../src/systems/workers';
import { testId } from '../../support/ids';

/** `count` regions, `Test Region 001` first. Populations fall from 1,000,000 in steps of 100,000. */
export function testRegions(count: number): FootprintRegion[] {
  return Array.from({ length: count }, (unused, index) => ({
    id: testId('region', index + 1),
    name: `Test Region ${String(index + 1).padStart(3, '0')}`,
    population: 1_000_000 - index * 100_000,
  }));
}

/** The same popularity in every one of `regions`. A value of 0 is left out, as rows store it. */
export function popEverywhere(
  regions: readonly FootprintRegion[],
  value: number,
): FootprintRegionalPop {
  const popularity: Partial<Record<RegionId, number>> = {};
  if (value > 0) {
    for (const region of regions) {
      popularity[region.id] = value;
    }
  }
  return popularity;
}

/** Every attribute at `value`, with `overrides` on top. */
export function attributesOf(value: number, overrides: Partial<Attributes> = {}): Attributes {
  return {
    ringwork: value,
    psychology: value,
    stamina: value,
    safety: value,
    athleticism: value,
    mic: value,
    charisma: value,
    presence: value,
    officiating: value,
    broadcasting: value,
    producing: value,
    booking: value,
    ...overrides,
  };
}
