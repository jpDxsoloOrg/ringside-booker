// Network benchmark. Design: docs/design/broadcast.md#benchmark
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../../src/core/trace';
import {
  audience,
  benchmarkLabel,
  networkBenchmark,
  type BenchmarkRegionInput,
  type NetworkBenchmarkInputs,
} from '../../../../src/systems/broadcast';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

const DEFAULTS = createEngineTunables();

const REFERENCE_POPULARITY = [
  'broadcast.benchmark.popularity.tier0',
  'broadcast.benchmark.popularity.tier1',
  'broadcast.benchmark.popularity.tier2',
  'broadcast.benchmark.popularity.tier3',
  'broadcast.benchmark.popularity.tier4',
] as const;

const REGIONS: readonly BenchmarkRegionInput[] = [
  {
    regionName: 'North Test',
    countryName: 'Testland',
    population: 3_000_000,
    wrestlingInterest: 45,
  },
  {
    regionName: 'South Test',
    countryName: 'Testland',
    population: 1_500_000,
    wrestlingInterest: 60,
  },
  {
    regionName: 'Far Region',
    countryName: 'Otherland',
    population: 800_000,
    wrestlingInterest: 30,
  },
];

function inputs(overrides: Partial<NetworkBenchmarkInputs> = {}): NetworkBenchmarkInputs {
  return {
    regions: REGIONS,
    networkName: 'Test TV',
    reachTier: 2,
    kind: 'tv',
    timeslot: 'evening',
    importance: 'regular',
    ...overrides,
  };
}

function bench(
  overrides: Partial<NetworkBenchmarkInputs> = {},
  tunables: EngineTunables = DEFAULTS,
): ReturnType<typeof networkBenchmark> {
  return networkBenchmark(inputs(overrides), { tunables });
}

describe('networkBenchmark', () => {
  it('is the audience formula run for the typical promotion of the tier (one formula)', () => {
    for (const [reachTier, key] of REFERENCE_POPULARITY.entries()) {
      const popularity = DEFAULTS.get(key);
      const expected = audience(
        {
          ...inputs({ reachTier }),
          regions: REGIONS.map((region) => ({ ...region, popularity })),
          live: false,
          marketingLevel: DEFAULTS.get('broadcast.benchmark.marketingLevel'),
          hype: null,
          quality: null,
          swing: false,
        },
        { tunables: DEFAULTS },
      );
      const result = bench({ reachTier });
      expect(result.value).toBe(expected.value);
      // The audience's own Why? sits under the benchmark's heading, unchanged.
      expect(result.trace.children?.[0]).toEqual(expected.trace);
      expectTraceReplays(result);
    }
  });

  it('says what the network expects, and names the reference numbers', () => {
    const result = bench();
    expect(result.trace.label).toBe(benchmarkLabel('Test TV', 2));
    expect(result.trace.label).toBe(
      'What Test TV expects from a typical promotion for a tier-2 network',
    );
    expect(result.trace.docRef).toBe('broadcast.md#benchmark');
    expectTraceContains(result, { kind: 'tunable', label: /Popularity of a typical promotion/ });
    expectTraceContains(result, { kind: 'tunable', label: /Marketing level of a typical/ });
  });

  it('never rolls and is taped with neutral quality and no hype', () => {
    const result = bench();
    expect(findTraceNodes(result.trace, 'roll')).toHaveLength(0);
    expect(findTraceNodes(result.trace, 'multiply').map((node) => node.label)).not.toContain(
      'Live',
    );
    expect(bench()).toEqual(result);
  });

  it('never expects fewer viewers from a higher tier on the same coverage', () => {
    for (const kind of ['tv', 'ppv', 'streaming'] as const) {
      const values = [0, 1, 2, 3, 4].map((reachTier) => bench({ reachTier, kind }).value);
      for (let tier = 1; tier < values.length; tier += 1) {
        expect(values[tier], `${kind} tier ${String(tier)}`).toBeGreaterThanOrEqual(
          values[tier - 1] ?? 0,
        );
      }
    }
  });

  it('moves only tier-4 benchmarks when the tier-4 reference popularity changes', () => {
    const changed = createEngineTunables({ 'broadcast.benchmark.popularity.tier4': 80 });
    for (const reachTier of [0, 1, 2, 3]) {
      expect(bench({ reachTier }, changed).value).toBe(bench({ reachTier }).value);
    }
    expect(bench({ reachTier: 4 }, changed).value).toBeGreaterThan(bench({ reachTier: 4 }).value);
  });

  it('expects nobody when the reference popularity is 0', () => {
    const none = createEngineTunables({ 'broadcast.benchmark.popularity.tier2': 0 });
    expect(bench({}, none).value).toBe(0);
  });

  it('refuses an unknown reach tier and a house show', () => {
    expect(() => bench({ reachTier: 7 })).toThrow(/reachTier/);
    expect(() => bench({ importance: 'house' })).toThrow(/house/);
  });

  it('is plain JSON', () => {
    expectSerialisable(bench());
  });
});
