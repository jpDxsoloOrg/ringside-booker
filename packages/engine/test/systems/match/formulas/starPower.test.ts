// Star power. Design: docs/design/match-rating.md#star-power
import { describe, expect, it } from 'vitest';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import { rankLabel, starPower, type StarPowerMember } from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectTraceContains, expectTraceReplays } from '../../../support/trace';

function member(id: string, popularity: number): StarPowerMember {
  return { id, name: `Worker ${id}`, popularity };
}

function power(members: readonly StarPowerMember[], overrides: TunableOverrides = {}) {
  const result = starPower(
    { regionName: 'Great Lakes', members },
    { tunables: createEngineTunables(overrides) },
  );
  expectTraceReplays(result);
  return result;
}

describe('starPower', () => {
  it('is titled with the region', () => {
    expect(power([member('a', 50)]).trace.label).toBe('Star power in Great Lakes');
  });

  it('gives 0 for popularity 0 and 100 for popularity 100', () => {
    expect(power([member('a', 0), member('b', 0)]).value).toBe(0);
    expect(power([member('a', 100), member('b', 100)]).value).toBe(100);
  });

  it.each([
    [50, 70],
    [80, 92.8],
    [100, 100],
  ])('bends %s to %s at the default curve 0.8', (popularity, expected) => {
    expect(power([member('a', popularity)]).value).toBeCloseTo(expected, 9);
  });

  it('is plain popularity at curve 0', () => {
    for (const popularity of [0, 13, 50, 87.5, 100]) {
      expect(power([member('a', popularity)], { 'match.starPower.curve': 0 }).value).toBeCloseTo(
        popularity,
        9,
      );
    }
  });

  it('weights the biggest star most, with depth decay 0.5', () => {
    // 90 × 2/3 + 30 × 1/3 = 70, bent to 70 × (1 + 0.8 × 0.3) = 86.8.
    const result = power([member('a', 30), member('b', 90)]);
    expect(result.value).toBeCloseTo(86.8, 9);
    expectTraceContains(result, {
      kind: 'add',
      label: `Worker b (${rankLabel(0, 'match.starPower.depthDecay')}) × 0.67`,
    });
    expectTraceContains(result, { kind: 'tunable', label: 'Depth decay' });
    expect(rankLabel(1, 'match.starPower.depthDecay')).toBe('2nd draw');
  });

  it('counts only the biggest star at depth decay 0', () => {
    const result = power([member('a', 30), member('b', 90)], { 'match.starPower.depthDecay': 0 });
    expect(result.value).toBeCloseTo(90 * (1 + 0.8 * 0.1), 9);
  });

  it('refuses an empty segment', () => {
    expect(() => power([])).toThrow(/members/);
  });
});
