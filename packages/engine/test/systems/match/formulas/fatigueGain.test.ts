// Fatigue gain (MTCH4-01). Design: docs/design/physical-toll.md#fatigue-gain
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import { computeFatigueGain, type FatigueGainInputs } from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

const DEFAULTS = createEngineTunables();

/** A singles main event for an average all-rounder: base 12 and nothing else moves it. */
function inputs(overrides: Partial<FatigueGainInputs> = {}): FatigueGainInputs {
  return {
    name: 'Kai Moreno',
    durationClass: 'long',
    workersInMatch: 2,
    stamina: 50,
    style: 'allRounder',
    traits: [],
    importance: 'regular',
    contributions: [],
    keepItSafe: false,
    matchesEarlierTonight: 0,
    ...overrides,
  };
}

function gain(overrides: Partial<FatigueGainInputs> = {}, tunables: TunableOverrides = {}) {
  return computeFatigueGain(inputs(overrides), { tunables: createEngineTunables(tunables) });
}

function labels(result: ReturnType<typeof gain>): string[] {
  return (result.trace.children ?? []).map((node) => node.label);
}

describe('computeFatigueGain', () => {
  it('is 0 when the base is 0', () => {
    expect(gain({}, { 'match.fatigue.base.long': 0 }).value).toBe(0);
  });

  it('costs more the longer the duration class: long > standard > short', () => {
    const [short, standard, long] = (['short', 'standard', 'long'] as const).map(
      (durationClass) => gain({ durationClass }).value,
    );
    expect(short).toBe(4);
    expect(standard).toBe(7);
    expect(long).toBe(12);
  });

  it('names the duration class on the first line', () => {
    const result = gain();
    expect(labels(result)[0]).toBe('Long duration class');
    expect(result.trace.children?.[0]?.kind).toBe('tunable');
  });

  it('halves the share in a four-worker match, with a branch line', () => {
    const result = gain({ workersInMatch: 4 });
    expect(result.value).toBeCloseTo(6);
    expect(findTraceNodes(result.trace, 'branch').map((node) => node.label)).toEqual([
      'Shared workload (4 workers)',
    ]);
    expect(findTraceNodes(gain().trace, 'branch')).toEqual([]);
  });

  it('floors the share at minShare, and a minShare of 1 turns sharing off', () => {
    expect(gain({ workersInMatch: 20 }).value).toBeCloseTo(12 * 0.35);
    expect(gain({ workersInMatch: 4 }, { 'match.fatigue.minShare': 1 }).value).toBe(12);
  });

  it('eases fatigue with stamina above 50 and adds below it', () => {
    expect(gain({ stamina: 100 }).value).toBeCloseTo(12 * (1 - 50 * 0.006));
    expect(gain({ stamina: 0 }).value).toBeCloseTo(12 * (1 + 50 * 0.006));
  });

  it('applies the style factor labelled with the style', () => {
    const result = gain({ style: 'highFlyer' });
    expect(result.value).toBeCloseTo(12 * 1.15);
    expect(labels(result)).toContain('High flyer style');
  });

  it.each([
    ['workhorse', { traits: ['workhorse'] }, 1.15, 'Workhorse'],
    ['coaster', { traits: ['coaster'] }, 0.85, 'Coaster'],
    ['a house show', { importance: 'house' }, 0.6, 'House show'],
    ['keep it safe', { keepItSafe: true }, 0.8, 'Keep it safe'],
  ] as const)('applies %s', (_name, overrides, factor, label) => {
    const result = gain(overrides);
    expect(result.value).toBeCloseTo(12 * factor);
    expect(labels(result)).toContain(label);
  });

  it('multiplies in a contribution, labelled with its source', () => {
    const result = gain({
      contributions: [{ source: 'Stipulation: Ladder', personIds: null, fatigueMultiplier: 2 }],
    });
    expect(result.value).toBe(24);
    expect(labels(result)).toContain('Stipulation: Ladder');
  });

  it('switches keep it safe on from a contribution, naming it', () => {
    const result = gain({
      contributions: [{ source: 'Note: Keep it safe', personIds: null, keepItSafe: true }],
    });
    expect(result.value).toBeCloseTo(12 * 0.8);
    expect(labels(result)).toContain('Keep it safe (Note: Keep it safe)');
  });

  it('compounds repeatMatch for each earlier match on the card', () => {
    const second = gain({ matchesEarlierTonight: 1 });
    expect(second.value).toBeCloseTo(18);
    expect(labels(second)).toContain('Second match tonight ×1.5');
    const third = gain({ matchesEarlierTonight: 2 });
    expect(third.value).toBeCloseTo(27);
    expect(labels(third)).toContain('Third match tonight ×2.25');
    expect(labels(gain()).some((label) => label.includes('tonight'))).toBe(false);
  });

  it('clamps at maxPerSegment', () => {
    const result = gain({
      contributions: [{ source: 'Stipulation: Iron', personIds: null, fatigueMultiplier: 10 }],
    });
    expect(result.value).toBe(40);
    expect(gain({}, { 'match.fatigue.maxPerSegment': 5 }).value).toBe(5);
  });

  it('refuses a worker count below 1 and a negative earlier-match count', () => {
    expect(() => gain({ workersInMatch: 0 })).toThrow(/workersInMatch/);
    expect(() => gain({ matchesEarlierTonight: -1 })).toThrow(/matchesEarlierTonight/);
  });

  it('replays and serialises with every branch taken', () => {
    const result = computeFatigueGain(
      inputs({
        workersInMatch: 6,
        stamina: 30,
        style: 'hardcore',
        traits: ['workhorse'],
        importance: 'house',
        keepItSafe: true,
        matchesEarlierTonight: 1,
        contributions: [{ source: 'Stipulation: Cage', personIds: null, fatigueMultiplier: 1.2 }],
      }),
      { tunables: DEFAULTS },
    );
    expectTraceReplays(result);
    expectSerialisable(result);
  });
});
