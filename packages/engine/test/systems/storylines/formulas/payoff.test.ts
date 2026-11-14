// Storyline payoff formulas (CRTV4-03). Design: docs/design/storylines.md#payoff
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../../src/core/trace/helpers';
import type { Traced } from '../../../../src/core/trace/types';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  ALREADY_BIGGER_TEXT,
  memberPayoff,
  payoffEligible,
  payoffQuality,
  type MemberPayoff,
} from '../../../../src/systems/storylines';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

/** The keys of every tunable the trace read. */
function tunableKeys(result: Traced<unknown>): string[] {
  return findTraceNodes(result.trace, 'tunable').map((node) => node.key);
}

interface QualityCase {
  heat: number;
  countedSegments?: number;
  finalePlayed?: boolean;
}

function quality(input: QualityCase, overrides: TunableOverrides = {}): Traced<number> {
  const result = payoffQuality(
    {
      heat: input.heat,
      countedSegments: input.countedSegments ?? 4,
      finalePlayed: input.finalePlayed ?? false,
      storylineName: 'Test Feud',
    },
    { tunables: createEngineTunables(overrides) },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

function member(
  input: QualityCase & { marketPop: number },
  overrides: TunableOverrides = {},
): MemberPayoff {
  const result = memberPayoff(
    {
      quality: quality(input, overrides),
      heat: input.heat,
      memberMarketPop: input.marketPop,
      memberName: 'Test Wrestler',
    },
    { tunables: createEngineTunables(overrides) },
  );
  for (const part of [result.popularity, result.momentum]) {
    expectTraceReplays(part);
    expectSerialisable(part);
  }
  return result;
}

describe('payoffQuality', () => {
  it('heat 80 with the defaults is a quality of 0.75', () => {
    const result = quality({ heat: 80 });
    expect(result.value).toBeCloseTo(0.75, 10);
    expect(result.trace).toMatchObject({
      kind: 'formula',
      label: 'Payoff quality',
      docRef: 'docs/design/storylines.md#payoff',
    });
    expect(tunableKeys(result)).toContain('storylines.payoff.neutralHeat');
    expect(tunableKeys(result)).toContain('storylines.payoff.heatSpan');
    expect(
      expectTraceContains(result, { kind: 'branch', label: 'Paid off with a finale' }),
    ).toMatchObject({
      kind: 'branch',
      taken: false,
    });
  });

  it('a played finale multiplies a gain by 1.25', () => {
    const result = quality({ heat: 80, finalePlayed: true });
    expect(result.value).toBeCloseTo(0.9375, 10);
    expect(tunableKeys(result)).toContain('storylines.payoff.finaleFactor');
  });

  it('heat 30 is -0.5, with or without a finale', () => {
    expect(quality({ heat: 30 }).value).toBeCloseTo(-0.5, 10);
    const withFinale = quality({ heat: 30, finalePlayed: true });
    expect(withFinale.value).toBeCloseTo(-0.5, 10);
    expectTraceContains(withFinale, {
      kind: 'note',
      label: 'A finale never makes a cold payoff worse',
    });
  });

  it('heat 50 is exactly neutral', () => {
    expect(quality({ heat: 50 }).value).toBe(0);
    expect(quality({ heat: 50, finalePlayed: true }).value).toBe(0);
  });

  it('heat 90 and 10 reach exactly ±1; heat 100 and 0 are clamped there', () => {
    expect(quality({ heat: 90 }).value).toBe(1);
    expect(quality({ heat: 10 }).value).toBe(-1);
    const hottest = quality({ heat: 100 });
    expect(hottest.value).toBe(1);
    expect(expectTraceContains(hottest, { kind: 'clamp' })).toMatchObject({ applied: true });
    expect(quality({ heat: 0 }).value).toBe(-1);
  });

  it('a heat span of 1 makes every step from neutral a full payoff', () => {
    expect(quality({ heat: 51 }, { 'storylines.payoff.heatSpan': 1 }).value).toBe(1);
    expect(quality({ heat: 49 }, { 'storylines.payoff.heatSpan': 1 }).value).toBe(-1);
  });

  it('3 counted segments with minSegments 4: no payoff, quality 0', () => {
    const result = quality({ heat: 80, countedSegments: 3, finalePlayed: true });
    expect(result.value).toBe(0);
    expect(
      expectTraceContains(result, {
        kind: 'branch',
        label: 'No payoff (needs 4 linked segments, has 3)',
      }),
    ).toMatchObject({ taken: true });
  });

  it('minSegments 0 pays with no segments at all', () => {
    const result = quality(
      { heat: 80, countedSegments: 0 },
      { 'storylines.payoff.minSegments': 0 },
    );
    expect(result.value).toBeCloseTo(0.75, 10);
  });
});

describe('payoffEligible', () => {
  function eligible(countedSegments: number, overrides: TunableOverrides = {}) {
    const result = payoffEligible(
      { countedSegments, storylineName: 'Test Feud' },
      { tunables: createEngineTunables(overrides) },
    );
    // A decision has no arithmetic to replay; it only has to be plain JSON.
    expectSerialisable(result);
    return result;
  }

  it('pays from 4 counted segments with the defaults', () => {
    expect(eligible(4).value).toBe('pay');
    expect(eligible(30).value).toBe('pay');
  });

  it('words the refusal with the numbers', () => {
    const result = eligible(3);
    expect(result.value).toBe('noPayoff');
    expect(result.trace).toMatchObject({
      kind: 'decision',
      reason: 'No payoff (needs 4 linked segments, has 3)',
    });
    expect(eligible(0, { 'storylines.payoff.minSegments': 1 }).trace).toMatchObject({
      reason: 'No payoff (needs 1 linked segment, has 0)',
    });
  });

  it('minSegments 0 always pays', () => {
    expect(eligible(0, { 'storylines.payoff.minSegments': 0 }).value).toBe('pay');
  });
});

describe('memberPayoff', () => {
  it('heat 80 with a finale: 3.75 popularity at market pop 50, momentum 9.375', () => {
    const result = member({ heat: 80, finalePlayed: true, marketPop: 50 });
    expect(result.popularity.value).toBeCloseTo(3.75, 10);
    expect(result.momentum.value).toBeCloseTo(9.375, 10);
    expect(
      expectTraceContains(result.popularity, { kind: 'branch', label: ALREADY_BIGGER_TEXT }),
    ).toMatchObject({
      kind: 'branch',
      taken: false,
    });
    expect(tunableKeys(result.popularity)).toContain('storylines.payoff.popularityMax');
    expect(tunableKeys(result.popularity)).toContain('storylines.payoff.headroomMargin');
    expect(tunableKeys(result.momentum)).toContain('storylines.payoff.momentumMax');
  });

  it('a star at market pop 85 has a quarter of the room: 0.9375', () => {
    const result = member({ heat: 80, finalePlayed: true, marketPop: 85 });
    expect(result.popularity.value).toBeCloseTo(0.9375, 10);
    expect(result.momentum.value).toBeCloseTo(9.375, 10);
  });

  it('a star at market pop 95 is already bigger than the story: 0', () => {
    const result = member({ heat: 80, finalePlayed: true, marketPop: 95 });
    expect(result.popularity.value).toBe(0);
    expect(
      expectTraceContains(result.popularity, { kind: 'branch', label: ALREADY_BIGGER_TEXT }),
    ).toMatchObject({
      kind: 'branch',
      taken: true,
    });
    // Momentum has no headroom.
    expect(result.momentum.value).toBeCloseTo(9.375, 10);
  });

  it.each([
    [10, false],
    [50, false],
    [95, false],
    [10, true],
    [95, true],
  ])('heat 30 costs -2 popularity and -5 momentum at market pop %d (finale %s)', (pop, finale) => {
    const result = member({ heat: 30, finalePlayed: finale, marketPop: pop });
    expect(result.popularity.value).toBeCloseTo(-2, 10);
    expect(result.momentum.value).toBeCloseTo(-5, 10);
  });

  it('a loss has no headroom line', () => {
    const result = member({ heat: 30, marketPop: 95 });
    expect(() =>
      expectTraceContains(result.popularity, { kind: 'branch', label: ALREADY_BIGGER_TEXT }),
    ).toThrow();
  });

  it('heat 50 pays nothing either way', () => {
    const result = member({ heat: 50, finalePlayed: true, marketPop: 40 });
    expect(result.popularity.value).toBeCloseTo(0, 10);
    expect(result.momentum.value).toBeCloseTo(0, 10);
  });

  it('too few segments pays nothing', () => {
    const result = member({ heat: 90, countedSegments: 3, marketPop: 20 });
    expect(result.popularity.value).toBeCloseTo(0, 10);
    expect(result.momentum.value).toBeCloseTo(0, 10);
  });

  it('popularityMax 0 and momentumMax 0 turn the payoff off', () => {
    const off = {
      'storylines.payoff.popularityMax': 0,
      'storylines.payoff.momentumMax': 0,
    };
    for (const heat of [90, 10]) {
      const result = member({ heat, marketPop: 40 }, off);
      expect(result.popularity.value).toBeCloseTo(0, 10);
      expect(result.momentum.value).toBeCloseTo(0, 10);
    }
  });

  it('the top of each range scales the full payoff', () => {
    const result = member(
      { heat: 100, finalePlayed: true, marketPop: 0 },
      {
        'storylines.payoff.popularityMax': 20,
        'storylines.payoff.momentumMax': 50,
        'storylines.payoff.finaleFactor': 3,
      },
    );
    expect(result.popularity.value).toBeCloseTo(60, 10);
    expect(result.momentum.value).toBeCloseTo(150, 10);
  });
});
