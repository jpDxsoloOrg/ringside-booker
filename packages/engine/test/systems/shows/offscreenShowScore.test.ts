// Off-screen show score. Design: docs/design/show-night.md#off-screen-score
import { describe, expect, it } from 'vitest';
import { RngRegistry, type RngStream } from '../../../src/core/rng/registry';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import { EVENT_IMPORTANCES } from '../../../src/model/entities/event-definition';
import {
  offscreenShowScore,
  SHOWS_OFFSCREEN_STREAM,
  type OffscreenShowScoreInputs,
} from '../../../src/systems/shows';
import { createEngineTunables } from '../../../src/systems/tunables';
import { expectRollRecorded, expectTraceContains, expectTraceReplays } from '../../support/trace';

const BASE_INPUTS: OffscreenShowScoreInputs = {
  showName: 'Saturday Slam',
  importance: 'regular',
  prestige: 50,
  popularityInRegion: 50,
  regionName: 'the Midwest',
};

const NO_WEIGHTS: TunableOverrides = {
  'shows.offscreen.prestigeWeight': 0,
  'shows.offscreen.popularityWeight': 0,
  'shows.offscreen.spread': 0,
};

/** A seeded stream that counts how many draws it gave out. */
function countingStream(seed: string): RngStream & { readonly draws: number } {
  const inner = new RngRegistry(seed).stream(SHOWS_OFFSCREEN_STREAM);
  let draws = 0;
  return {
    name: inner.name,
    get draws() {
      return draws;
    },
    nextUint32: () => {
      draws += 1;
      return inner.nextUint32();
    },
    nextFloat: () => {
      draws += 1;
      return inner.nextFloat();
    },
  };
}

function offscreen(
  inputs: Partial<OffscreenShowScoreInputs> = {},
  overrides: TunableOverrides = {},
  seed = 'offscreen-test',
) {
  const result = offscreenShowScore(
    { ...BASE_INPUTS, ...inputs },
    { tunables: createEngineTunables(overrides), rng: countingStream(seed) },
  );
  expectTraceReplays(result);
  return result;
}

describe('offscreenShowScore', () => {
  it('labels the root and every line', () => {
    const result = offscreen();
    expect(result.trace).toMatchObject({
      kind: 'formula',
      label: 'Show score (card not booked in detail)',
      unit: 'points',
      docRef: 'docs/design/show-night.md#off-screen-score',
    });
    expectTraceContains(result, { kind: 'add', label: 'Promotion prestige' });
    expectTraceContains(result, { kind: 'add', label: 'Popularity in the Midwest' });
    expectTraceContains(result, { kind: 'add', label: 'Regular show' });
    expectTraceContains(result, { kind: 'add', label: 'Night-to-night swing' });
    expect(expectRollRecorded(result, SHOWS_OFFSCREEN_STREAM)).toMatchObject({
      kind: 'float',
      label: 'Night-to-night swing',
      min: -8,
      max: 8,
    });
  });

  it('gives exactly base plus importance with every weight and the spread at 0', () => {
    const result = offscreen({}, NO_WEIGHTS);
    expect(result.value).toBe(12);
    expectTraceContains(result, { kind: 'note', label: 'No randomness (0)' });
  });

  it('adds the importance points for each show size', () => {
    const expected = { house: 6, minor: 9, regular: 12, major: 16, flagship: 20 } as const;
    for (const importance of EVENT_IMPORTANCES) {
      expect(offscreen({ importance }, NO_WEIGHTS).value).toBe(expected[importance]);
    }
  });

  it('scales linearly with prestige and with popularity', () => {
    const prestigeOnly = { ...NO_WEIGHTS, 'shows.offscreen.prestigeWeight': 0.5 };
    expect(offscreen({ prestige: 0 }, prestigeOnly).value).toBe(12);
    expect(offscreen({ prestige: 40 }, prestigeOnly).value).toBe(32);
    expect(offscreen({ prestige: 80 }, prestigeOnly).value).toBe(52);

    const popularityOnly = { ...NO_WEIGHTS, 'shows.offscreen.popularityWeight': 0.25 };
    expect(offscreen({ popularityInRegion: 0 }, popularityOnly).value).toBe(12);
    expect(offscreen({ popularityInRegion: 40 }, popularityOnly).value).toBe(22);
    expect(offscreen({ popularityInRegion: 80 }, popularityOnly).value).toBe(32);
  });

  it('gives the same score for the same seed', () => {
    expect(offscreen({}, {}, 'twin').value).toBe(offscreen({}, {}, 'twin').value);
    expect(offscreen({}, {}, 'twin').trace).toEqual(offscreen({}, {}, 'twin').trace);
  });

  it('stays within the spread of the unrolled score over 1,000 seeds', () => {
    // 12 + 0.3 × 50 + 0.35 × 50 + 0 = 44.5 before the swing.
    const unrolled = 44.5;
    const seen = new Set<number>();
    for (let seed = 0; seed < 1000; seed += 1) {
      const result = offscreenShowScore(BASE_INPUTS, {
        tunables: createEngineTunables(),
        rng: countingStream(`spread-${String(seed)}`),
      });
      const swing = expectRollRecorded(result, SHOWS_OFFSCREEN_STREAM).result;
      expect(typeof swing === 'number' && Math.abs(swing) <= 8).toBe(true);
      // Rounding to a whole number may add up to half a point either way.
      expect(Math.abs(result.value - unrolled)).toBeLessThanOrEqual(8.5);
      seen.add(result.value);
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  it('draws exactly once per call, whatever the spread', () => {
    for (const spread of [0, 8, 50]) {
      const rng = countingStream('one-roll');
      offscreenShowScore(BASE_INPUTS, {
        tunables: createEngineTunables({ 'shows.offscreen.spread': spread }),
        rng,
      });
      expect(rng.draws).toBe(1);
    }
  });

  it('clamps at 0 and at 100', () => {
    const low = offscreen(
      { importance: 'house', prestige: 0, popularityInRegion: 0 },
      { ...NO_WEIGHTS, 'shows.offscreen.base': 0 },
    );
    expect(low.value).toBe(0);
    expect(expectTraceContains(low, { kind: 'clamp' }).applied).toBe(true);

    const high = offscreen(
      { importance: 'flagship', prestige: 100, popularityInRegion: 100 },
      { 'shows.offscreen.base': 100, 'shows.offscreen.spread': 0 },
    );
    expect(high.value).toBe(100);
    expect(expectTraceContains(high, { kind: 'clamp' }).applied).toBe(true);

    const inside = offscreen({}, NO_WEIGHTS);
    expect(expectTraceContains(inside, { kind: 'clamp' }).applied).toBe(false);
  });
});
