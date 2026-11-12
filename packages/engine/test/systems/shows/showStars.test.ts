// Show stars. Design: docs/design/show-night.md#show-score
import { describe, expect, it } from 'vitest';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import { showStars } from '../../../src/systems/shows';
import { createEngineTunables } from '../../../src/systems/tunables';
import { expectTraceContains, expectTraceReplays } from '../../support/trace';

function stars(score: number, overrides: TunableOverrides = {}) {
  const result = showStars({ score }, { tunables: createEngineTunables(overrides) });
  expectTraceReplays(result);
  return result;
}

describe('showStars', () => {
  it('labels the root', () => {
    expect(stars(60).trace).toMatchObject({
      kind: 'formula',
      label: 'Show stars',
      unit: 'stars',
      docRef: 'docs/design/show-night.md#show-score',
    });
  });

  it('gives 0 stars at the zero-star score and below', () => {
    expect(stars(35).value).toBe(0);
    expect(stars(0).value).toBe(0);
  });

  it('gives 5 stars at 95 and above at defaults', () => {
    expect(stars(95).value).toBe(5);
    expect(stars(100).value).toBe(5);
    expect(expectTraceContains(stars(100), { kind: 'clamp' }).applied).toBe(true);
  });

  it('only ever lands on quarter stars', () => {
    for (let score = 0; score <= 100; score += 1) {
      const value = stars(score).value;
      expect(Number.isInteger(value * 4)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(5);
    }
    // (50 − 35) / 12 = 1.25; (52 − 35) / 12 = 1.4167 → 1.5; (51 − 35) / 12 = 1.333 → 1.25
    expect(stars(50).value).toBe(1.25);
    expect(stars(52).value).toBe(1.5);
    expect(stars(51).value).toBe(1.25);
    expectTraceContains(stars(52), { kind: 'round', label: 'Nearest quarter star' });
  });

  it('gives 5 above the zero-star score and 0 at or below it when points per star is 0', () => {
    const flat = { 'shows.stars.pointsPerStar': 0 };
    const above = stars(36, flat);
    expect(above.value).toBe(5);
    expectTraceContains(above, { kind: 'note', label: 'Points per star is 0' });
    expect(stars(35, flat).value).toBe(0);
    expect(stars(10, flat).value).toBe(0);
  });

  it('follows overridden tunables at their boundaries', () => {
    expect(stars(0, { 'shows.stars.zeroAt': 0, 'shows.stars.pointsPerStar': 30 }).value).toBe(0);
    expect(stars(100, { 'shows.stars.zeroAt': 0, 'shows.stars.pointsPerStar': 30 }).value).toBe(
      3.25,
    );
    expect(stars(80, { 'shows.stars.zeroAt': 80 }).value).toBe(0);
    expect(stars(81, { 'shows.stars.zeroAt': 80, 'shows.stars.pointsPerStar': 0.5 }).value).toBe(2);
  });
});
