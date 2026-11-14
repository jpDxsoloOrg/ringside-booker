// Audience. Design: docs/design/broadcast.md#audience
import { describe, expect, it } from 'vitest';
import { RngRegistry } from '../../../../src/core/rng/registry';
import { findTraceNodes, startCalc, type Traced } from '../../../../src/core/trace';
import {
  countTraceNodes,
  TRACE_MAX_DEPTH,
  TRACE_MAX_NODES,
  traceDepth,
} from '../../../../src/core/trace/limits';
import {
  audience,
  AUDIENCE_TRACE_COUNTRY_LINES,
  BROADCAST_VIEWERS_STREAM,
  formatViewers,
  shortViewers,
  NEUTRAL_QUALITY_NOTE,
  NO_HYPE_NOTE,
  PPV_TIMESLOT_NOTE,
  SWING_LABEL,
  type AudienceInputs,
  type RegionAudienceInput,
} from '../../../../src/systems/broadcast';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import {
  expectRollRecorded,
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

const DEFAULTS = createEngineTunables();

function regionIn(country: string, name: string, popularity = 50): RegionAudienceInput {
  return {
    regionName: name,
    countryName: country,
    population: 2_000_000,
    wrestlingInterest: 40,
    popularity,
  };
}

const TWO_COUNTRIES: readonly RegionAudienceInput[] = [
  regionIn('Testland', 'North Test', 60),
  regionIn('Testland', 'South Test', 30),
  regionIn('Otherland', 'Other Region', 45),
];

function inputs(overrides: Partial<AudienceInputs> = {}): AudienceInputs {
  return {
    regions: TWO_COUNTRIES,
    networkName: 'Test TV',
    reachTier: 4,
    kind: 'tv',
    timeslot: 'primeTime',
    live: false,
    importance: 'regular',
    marketingLevel: 0,
    hype: null,
    quality: null,
    swing: false,
    ...overrides,
  };
}

function run(
  overrides: Partial<AudienceInputs> = {},
  tunables: EngineTunables = DEFAULTS,
): Traced<number> {
  return audience(inputs(overrides), { tunables });
}

/** The audience before rounding: the sum of the regions with every factor at 1. */
function regionSum(regions: readonly RegionAudienceInput[], tunables = DEFAULTS): number {
  const share = tunables.get('broadcast.audience.baseShare');
  const power = tunables.get('broadcast.audience.popularityPower');
  return regions.reduce(
    (sum, region) =>
      sum +
      ((region.population * region.wrestlingInterest) / 100) *
        (region.popularity / 100) ** power *
        share,
    0,
  );
}

function stream(seed: string) {
  return new RngRegistry(seed).stream(BROADCAST_VIEWERS_STREAM);
}

function manyCountries(count: number): RegionAudienceInput[] {
  return Array.from({ length: count }, (_unused, index) =>
    regionIn(`Country ${String(index + 1)}`, `Region ${String(index + 1)}`, 10 + index * 2),
  );
}

describe('audience', () => {
  it('is the regions added up, rounded down, on a top TV network in prime time', () => {
    const result = run();
    expect(result.value).toBe(Math.floor(regionSum(TWO_COUNTRIES)));
    expectTraceReplays(result);
  });

  it('is 0 when nobody anywhere knows the promotion, with one note for the regions', () => {
    const result = run({ regions: TWO_COUNTRIES.map((region) => ({ ...region, popularity: 0 })) });
    expect(result.value).toBe(0);
    expectTraceContains(result, { kind: 'note', label: 'No popularity in 3 regions' });
    // Unknown regions add no lines of their own.
    expect(findTraceNodes(result.trace, 'formula').map((node) => node.label)).not.toContain(
      'Audience in North Test',
    );
    expectTraceReplays(result);
  });

  it('draws the base share of everyone who cares at popularity 100 everywhere', () => {
    const full = TWO_COUNTRIES.map((region) => ({ ...region, popularity: 100 }));
    const peopleWhoCare = 3 * 2_000_000 * 0.4;
    expect(run({ regions: full }).value).toBe(
      Math.floor(peopleWhoCare * DEFAULTS.get('broadcast.audience.baseShare')),
    );
  });

  it.each([
    ['broadcast.audience.baseShare', {}],
    ['broadcast.audience.tier4', {}],
    ['broadcast.audience.kind.tv', {}],
    ['broadcast.audience.timeslot.primeTime', {}],
    ['broadcast.audience.importance.regular', {}],
    ['broadcast.audience.tier1', { reachTier: 1 }],
    ['broadcast.audience.kind.ppv', { kind: 'ppv' }],
    ['broadcast.audience.kind.streaming', { kind: 'streaming' }],
    ['broadcast.audience.timeslot.daytime', { timeslot: 'daytime' }],
    ['broadcast.audience.timeslot.lateNight', { timeslot: 'lateNight' }],
    ['broadcast.audience.importance.flagship', { importance: 'flagship' }],
  ] as const)('gives 0 when %s is 0 (0 means 0)', (key, overrides) => {
    const result = run(overrides, createEngineTunables({ [key]: 0 }));
    expect(result.value).toBe(0);
    expectTraceReplays(result);
  });

  it('adds nothing for marketing or show quality when their per-step numbers are 0', () => {
    const flat = createEngineTunables({
      'broadcast.audience.marketingPerLevel': 0,
      'broadcast.audience.qualityPerPoint': 0,
    });
    const plain = run({}, flat).value;
    expect(run({ marketingLevel: 10, quality: { score: 95, source: 'show' } }, flat).value).toBe(
      plain,
    );
  });

  it('multiplies by each factor on its own labelled line', () => {
    const result = run({
      reachTier: 2,
      timeslot: 'evening',
      importance: 'major',
      marketingLevel: 5,
      live: true,
    });
    const steps = result.trace.children?.map((node) => `${node.kind}: ${node.label}`);
    expect(steps).toEqual([
      'formula: Who could watch',
      'multiply: Reach tier 2',
      'multiply: TV channel',
      'multiply: Evening',
      'multiply: Marketing level 5',
      'multiply: Live',
      'multiply: Major show',
      'note: ' + NO_HYPE_NOTE,
      'multiply: Hype',
      'note: ' + NEUTRAL_QUALITY_NOTE,
      'multiply: Show quality',
      'round: Rounded down to whole viewers',
    ]);
    const expected = regionSum(TWO_COUNTRIES) * 0.55 * 1 * 0.7 * (1 + 5 * 0.04) * 1.05 * 1.4;
    expect(result.value).toBe(Math.floor(expected));
    expectTraceReplays(result);
  });

  it('ignores the timeslot on pay-per-view, with a note, and uses the prime-time factor', () => {
    const daytime = run({ kind: 'ppv', timeslot: 'daytime' });
    const prime = run({ kind: 'ppv', timeslot: 'primeTime' });
    expect(daytime.value).toBe(prime.value);
    expectTraceContains(daytime, { kind: 'note', label: PPV_TIMESLOT_NOTE });
    expectTraceContains(daytime, { kind: 'multiply', label: 'Prime time' });
    expect(daytime.trace.label).toBe('Buys on Test TV');
    expect(daytime.value).toBe(
      Math.floor(regionSum(TWO_COUNTRIES) * DEFAULTS.get('broadcast.audience.kind.ppv')),
    );
  });

  it('adds the live bonus only when the show is live', () => {
    const taped = run();
    const live = run({ live: true });
    expect(findTraceNodes(taped.trace, 'multiply').map((node) => node.label)).not.toContain('Live');
    expect(live.value).toBe(
      Math.floor(regionSum(TWO_COUNTRIES) * DEFAULTS.get('broadcast.audience.liveBonus')),
    );
  });

  it.each([
    [null, 1],
    [{ score: 50, source: 'neutral', note: 'Not run yet' } as const, 1],
    [{ score: 0, source: 'show' } as const, 1 - 50 * 0.006],
    [{ score: 50, source: 'show' } as const, 1],
    [{ score: 100, source: 'show' } as const, 1 + 50 * 0.006],
  ])('scales by show quality %j', (quality, factor) => {
    const result = run({ quality });
    expect(result.value).toBe(Math.floor(regionSum(TWO_COUNTRIES) * factor));
    expectTraceReplays(result);
  });

  it('keeps the neutral note given with a neutral quality', () => {
    const result = run({ quality: { score: 50, source: 'neutral', note: 'Not run yet' } });
    expectTraceContains(result, { kind: 'note', label: 'Not run yet' });
  });

  it('never lets a terrible show take the audience below 0', () => {
    const harsh = createEngineTunables({ 'broadcast.audience.qualityPerPoint': 0.05 });
    const result = run({ quality: { score: 0, source: 'show' } }, harsh);
    expect(result.value).toBe(0);
    expectTraceContains(result, { kind: 'max', label: 'Never below 0' });
    expectTraceReplays(result);
  });

  it('multiplies by a traced hype and keeps its trace, or says hype is not tracked', () => {
    const hype = startCalc('Hype', 1).multiply('Big build-up', 1.25).done();
    const result = run({ hype });
    expect(result.value).toBe(Math.floor(regionSum(TWO_COUNTRIES) * 1.25));
    expectTraceContains(result, { kind: 'multiply', label: 'Big build-up' });
    expectTraceReplays(result);
    expectTraceContains(run(), { kind: 'note', label: NO_HYPE_NOTE });
  });

  it('does not roll without swing, even when given a stream', () => {
    const rng = stream('no-swing');
    const result = audience(inputs(), { tunables: DEFAULTS, rng });
    expect(findTraceNodes(result.trace, 'roll')).toHaveLength(0);
    expect(rng.nextUint32()).toBe(stream('no-swing').nextUint32());
  });

  it('rolls exactly once with swing, inside the swing range, and replays', () => {
    const result = audience(inputs({ swing: true }), { tunables: DEFAULTS, rng: stream('swing') });
    const rolls = findTraceNodes(result.trace, 'roll');
    expect(rolls).toHaveLength(1);
    const roll = expectRollRecorded(result, BROADCAST_VIEWERS_STREAM);
    expect(roll.label).toBe(SWING_LABEL);
    const swing = roll.result;
    if (typeof swing !== 'number') {
      expect.fail('the swing roll records a number');
    }
    expect(swing).toBeGreaterThanOrEqual(0.95);
    expect(swing).toBeLessThan(1.05);
    expect(result.value).toBe(Math.floor(regionSum(TWO_COUNTRIES) * swing));
    expectTraceReplays(result);
  });

  it('gives the same viewers for the same seed', () => {
    const first = audience(inputs({ swing: true }), { tunables: DEFAULTS, rng: stream('same') });
    const second = audience(inputs({ swing: true }), { tunables: DEFAULTS, rng: stream('same') });
    expect(second).toEqual(first);
  });

  it('needs a stream to swing', () => {
    expect(() => audience(inputs({ swing: true }), { tunables: DEFAULTS })).toThrow(/rng/);
  });

  it('refuses a house show and an unknown reach tier', () => {
    expect(() => run({ importance: 'house' })).toThrow(/house/);
    expect(() => run({ reachTier: 5 })).toThrow(/reachTier/);
  });

  it('groups regions by country, biggest country first, with the regions nested', () => {
    const result = run();
    const coverage = result.trace.children?.[0];
    const countryLines = coverage?.children?.slice(1).map((node) => node.label);
    const testland = regionSum(TWO_COUNTRIES.slice(0, 2));
    const otherland = regionSum(TWO_COUNTRIES.slice(2));
    expect(countryLines).toEqual([
      `Testland: ${formatViewers(testland)}`,
      `Otherland: ${formatViewers(otherland)}`,
    ]);
    const testlandLine = expectTraceContains(result, {
      kind: 'formula',
      label: 'Audience in Testland',
    });
    expect(testlandLine.children.slice(1).map((node) => node.label)).toEqual([
      'North Test',
      'South Test',
    ]);
    expectTraceContains(result, { kind: 'input', label: 'People in North Test' });
  });

  it('folds the smallest countries into one line when more than the limit contribute', () => {
    const regions = manyCountries(30);
    const result = run({ regions });
    const coverage = result.trace.children?.[0];
    const lines = coverage?.children?.slice(1) ?? [];
    expect(lines).toHaveLength(AUDIENCE_TRACE_COUNTRY_LINES + 1);
    expect(lines[0]?.label).toMatch(/^Country 30: /);
    const other = lines.at(-1);
    expect(other?.label).toBe(`Other countries (${String(30 - AUDIENCE_TRACE_COUNTRY_LINES)})`);
    expect(other?.children?.[0]?.children?.slice(1)).toHaveLength(
      30 - AUDIENCE_TRACE_COUNTRY_LINES,
    );
    expect(result.value).toBe(Math.floor(regionSum(regions)));
    expectTraceReplays(result);
  });

  it('stays inside the trace limits for a huge network, keeping every multiplier line', () => {
    const regions = Array.from({ length: 12 }, (_country, country) =>
      Array.from({ length: 30 }, (_region, index) =>
        regionIn(`Country ${String(country)}`, `Region ${String(country)}-${String(index)}`, 20),
      ),
    ).flat();
    const result = run({ regions, live: true, quality: { score: 70, source: 'show' } });
    expect(countTraceNodes(result.trace)).toBeLessThanOrEqual(TRACE_MAX_NODES);
    expect(traceDepth(result.trace)).toBeLessThanOrEqual(TRACE_MAX_DEPTH);
    expectTraceContains(result, { kind: 'multiply', label: 'Show quality' });
    expectTraceContains(result, { kind: 'round', label: 'Rounded down to whole viewers' });
    expect(result.value).toBe(
      Math.floor(
        regionSum(regions) * 1.05 * (1 + 20 * DEFAULTS.get('broadcast.audience.qualityPerPoint')),
      ),
    );
    expectTraceReplays(result);
  });

  it('is plain JSON', () => {
    expectSerialisable(run({ live: true, quality: { score: 80, source: 'show' } }));
  });
});

describe('shortViewers', () => {
  it.each([
    [0, '0'],
    [950, '950'],
    [4_250, '4.2K'],
    [38_900, '38K'],
    [2_412_345, '2.4M'],
    [3_000_000, '3M'],
    [999_999, '999K'],
  ])('writes %d as %s, rounded down', (value, text) => {
    expect(shortViewers(value)).toBe(text);
  });
});
