import { describe, expect, it } from 'vitest';
import { beltTierOf } from './beltTier';

describe('beltTierOf', () => {
  it.each([
    [100, 'gold'],
    [70, 'gold'],
    [69.9, 'silver'],
    [45, 'silver'],
    [44, 'bronze'],
    [20, 'bronze'],
    [19, 'plain'],
    [0, 'plain'],
    [Number.NaN, 'plain'],
  ])('draws prestige %s in %s', (prestige, tier) => {
    expect(beltTierOf(prestige)).toBe(tier);
  });
});
