// The draft value (DRF-01): one formula, traced and untraced give the same number.
// Design: docs/design/draft.md#draft-value
import { describe, expect, it } from 'vitest';
import { createEngineTunables } from '../../../src/systems/tunables';
import {
  draftValue,
  draftValueParts,
  draftValueWeights,
} from '../../../src/systems/draft/draftValue';

const tunables = createEngineTunables();
const weights = draftValueWeights(tunables);

describe('draftValue', () => {
  it('weighs skill and popularity, best country first', () => {
    const parts = draftValueParts({ roleRating: 70, peakPop: 50, worldPop: 10, age: 30 }, weights);
    expect(parts.popularityIndex).toBeCloseTo(0.7 * 50 + 0.3 * 10);
    expect(parts.skill).toBeCloseTo(0.6 * 70);
    expect(parts.popularity).toBeCloseTo(0.4 * 38);
    expect(parts.age).toBe(0);
    expect(parts.value).toBeCloseTo(42 + 15.2);
  });

  it('gives the young a capped bonus and the old a penalty', () => {
    const young = draftValueParts({ roleRating: 50, peakPop: 0, worldPop: 0, age: 22 }, weights);
    expect(young.age).toBeCloseTo(4 * 0.6);
    const teen = draftValueParts({ roleRating: 50, peakPop: 0, worldPop: 0, age: 14 }, weights);
    expect(teen.age).toBe(5);
    const old = draftValueParts({ roleRating: 50, peakPop: 0, worldPop: 0, age: 42 }, weights);
    expect(old.age).toBeCloseTo(-6);
  });

  it('stays between 0 and 100', () => {
    expect(
      draftValueParts({ roleRating: 100, peakPop: 100, worldPop: 100, age: 18 }, weights).value,
    ).toBe(100);
    expect(
      draftValueParts({ roleRating: 0, peakPop: 0, worldPop: 0, age: 70 }, weights).value,
    ).toBe(0);
  });

  it('traces the same number it computes untraced', () => {
    for (const inputs of [
      { roleRating: 63.4, peakPop: 41.2, worldPop: 7.7, age: 24 },
      { roleRating: 81, peakPop: 77, worldPop: 30, age: 44 },
      { roleRating: 12.5, peakPop: 0, worldPop: 0, age: 31 },
    ]) {
      expect(draftValue(inputs, { tunables }).value).toBe(draftValueParts(inputs, weights).value);
    }
  });
});
