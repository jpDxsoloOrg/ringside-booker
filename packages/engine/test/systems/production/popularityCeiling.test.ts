// Popularity ceiling (ECO7-01). Design: docs/design/production.md#popularity-ceiling
import { describe, expect, it } from 'vitest';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import { popularityCeiling } from '../../../src/systems/production';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';
import { deps } from './support';

function ceiling(marketing: number, backOffice: number, overrides: TunableOverrides = {}) {
  const result = popularityCeiling(
    { promotionName: 'Test', marketing, backOffice },
    deps(overrides),
  );
  expectTraceReplays(result);
  expectSerialisable(result.trace);
  return result;
}

describe('popularityCeiling', () => {
  it('matches the default world at the defaults', () => {
    expect(ceiling(1, 1).value).toBe(30); // Hardpan
    expect(ceiling(1, 0).value).toBe(25); // Wattle
    expect(ceiling(4, 4).value).toBe(60); // Boreal
    expect(ceiling(8, 7).value).toBe(95); // Altura
  });

  it('reads like the Why? the player sees', () => {
    const result = ceiling(1, 1);
    expect(result.trace.unit).toBe('points');
    expectTraceContains(result, { kind: 'input', label: 'Base ceiling' });
    expectTraceContains(result, { kind: 'add', label: 'Marketing (level 1 × 5)' });
    expectTraceContains(result, { kind: 'add', label: 'Back office (level 1 × 5)' });
    expectTraceContains(result, { kind: 'clamp', label: 'Popularity runs 0 to 100' });
  });

  it('stops at 100', () => {
    expect(ceiling(10, 10).value).toBe(100);
  });

  it('is the base alone when the per-level tunables are 0', () => {
    const off = {
      'production.popularityCeiling.perMarketingLevel': 0,
      'production.popularityCeiling.perBackOfficeLevel': 0,
    };
    expect(ceiling(10, 10, off).value).toBe(20);
    expect(ceiling(0, 0, { 'production.popularityCeiling.base': 0 }).value).toBe(0);
  });

  it('is not rounded', () => {
    expect(ceiling(3, 0, { 'production.popularityCeiling.perMarketingLevel': 2.5 }).value).toBe(
      27.5,
    );
  });
});
