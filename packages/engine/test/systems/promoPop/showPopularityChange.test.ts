// Show popularity change. Design: docs/design/promotion-popularity.md#show-popularity-change
import { describe, expect, it } from 'vitest';
import { constantOf, findTraceNodes, inputOf, type Traced } from '../../../src/core/trace';
import {
  showPopularityChange,
  type ShowPopularityChangeInputs,
} from '../../../src/systems/promoPop';
import { createEngineTunables, type EngineTunables } from '../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../support/trace';

const DEFAULTS = createEngineTunables();

function fullReach(): Traced<number> {
  return constantOf('Show region', 1, 'The region the show takes place in sees all of it');
}

/** The big company's home region: popularity 75, fans expecting 61, a regular show. */
function altura(overrides: Partial<ShowPopularityChangeInputs> = {}): ShowPopularityChangeInputs {
  return {
    regionName: 'Altura Coast',
    score: 75,
    expectation: inputOf('What fans expected', 61, undefined, 'points'),
    before: 75,
    weight: fullReach(),
    reachLabel: 'Show region',
    importance: 'regular',
    gainedThisMonth: 0,
    ...overrides,
  };
}

/** The small company's home region: popularity 20, fans expecting 16.4, a minor show. */
function hardpan(overrides: Partial<ShowPopularityChangeInputs> = {}): ShowPopularityChangeInputs {
  return altura({
    regionName: 'Hardpan',
    score: 50,
    expectation: inputOf('What fans expected', 16.4, undefined, 'points'),
    before: 20,
    importance: 'minor',
    ...overrides,
  });
}

function change(
  inputs: ShowPopularityChangeInputs,
  tunables: EngineTunables = DEFAULTS,
): Traced<number> {
  const result = showPopularityChange(inputs, { tunables });
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

function labelsOf(result: Traced<number>, kind: 'branch' | 'min' | 'multiply'): string[] {
  return findTraceNodes(result.trace, kind).map((node) => node.label);
}

const twoDecimals = (value: number): number => Math.round(value * 100) / 100;

describe('showPopularityChange', () => {
  it('changes nothing inside the dead zone, with one branch line', () => {
    const result = change(altura({ score: 63 }));
    expect(result.value).toBe(0);
    expect(labelsOf(result, 'branch')).toEqual(['About what fans expected (within ±3)']);
    expect(findTraceNodes(result.trace, 'formula').map((node) => node.label)).toContain(
      'Scored 63 against an expected 61: +2',
    );
  });

  it('changes nothing at the edge of the dead zone and a little just past it', () => {
    expect(change(altura({ score: 64 })).value).toBe(0);
    expect(change(altura({ score: 58 })).value).toBe(0);
    const justPast = change(altura({ score: 64.5 })).value;
    expect(justPast).toBeGreaterThan(0);
    expect(justPast).toBeLessThan(0.02);
  });

  it('gives the full gain for a blowout before shaping', () => {
    const shapingOff = createEngineTunables({ 'promoPop.diminishingPower': 0 });
    expect(change(altura({ score: 86 }), shapingOff).value).toBeCloseTo(3, 9);
    expect(change(altura({ score: 100 }), shapingOff).value).toBeCloseTo(3, 9);
  });

  it('gives a big company +0.19 for a strong regular show at home', () => {
    const result = change(altura());
    expect(twoDecimals(result.value)).toBe(0.19);
    expect(result.trace.label).toBe('Popularity change in Altura Coast');
    expect(result.trace.docRef).toBe('promotion-popularity.md#show-popularity-change');
    expect(labelsOf(result, 'multiply')).toEqual(
      expect.arrayContaining([
        'Event size: Regular × 1',
        'Seen here as: Show region',
        'Diminishing returns at popularity 75',
      ]),
    );
    expect(findTraceNodes(result.trace, 'add').map((node) => node.label)).toContain(
      'Beat expectations by 14',
    );
    expect(findTraceNodes(result.trace, 'power')).toHaveLength(1);
    expect(labelsOf(result, 'min')).toContain('Monthly gain cap: 0 of 3 used');
  });

  it('costs a big company −1.48 for a weak regular show at home', () => {
    const result = change(altura({ score: 45 }));
    expect(twoDecimals(result.value)).toBe(-1.48);
    expect(findTraceNodes(result.trace, 'subtract').map((node) => node.label)).toContain(
      'Fell short of expectations by 16',
    );
    expect(findTraceNodes(result.trace, 'power')).toHaveLength(0);
  });

  it('gives a small company +1.50 for a strong minor show at home', () => {
    expect(twoDecimals(change(hardpan()).value)).toBe(1.5);
  });

  it('gives a neighbour where nobody knew the company +1.05 at half reach', () => {
    const result = change(
      hardpan({
        regionName: 'Saltflat',
        before: 0,
        expectation: inputOf('What fans expected', 5.6, undefined, 'points'),
        weight: inputOf('Reach in Saltflat', 0.5, undefined, 'ratio'),
        reachLabel: 'Neighbour of Hardpan',
      }),
    );
    expect(twoDecimals(result.value)).toBe(1.05);
    expect(labelsOf(result, 'multiply')).toContain('Seen here as: Neighbour of Hardpan');
  });

  it('stops a gain at what is left of the monthly cap', () => {
    const result = change(hardpan({ gainedThisMonth: 2.96 }));
    expect(twoDecimals(result.value)).toBe(0.04);
    expect(labelsOf(result, 'min')).toContain('Monthly gain cap: 2.96 of 3 used');
  });

  it('gives nothing once the monthly cap is reached', () => {
    for (const gainedThisMonth of [3, 4.5]) {
      const result = change(hardpan({ gainedThisMonth }));
      expect(result.value).toBe(0);
      expect(labelsOf(result, 'min')).toContain('Monthly gain cap reached');
    }
  });

  it('never caps a loss by the monthly cap', () => {
    const fresh = change(altura({ score: 45 })).value;
    expect(change(altura({ score: 45, gainedThisMonth: 3 })).value).toBe(fresh);
    expect(labelsOf(change(altura({ score: 45 })), 'min')).not.toContain(
      'Monthly gain cap reached',
    );
  });

  it('shrinks a loss where the company has few fans to lose', () => {
    const inputs = altura({ score: 20, before: 5 });
    const result = change(inputs);
    // A blowout loss of 2.5, regular × 1, at 5 / 25 of the full loss.
    expect(result.value).toBeCloseTo(-0.5, 9);
    expect(labelsOf(result, 'multiply')).toContain('Few fans to lose here (popularity 5)');
    const unscaled = change(inputs, createEngineTunables({ 'promoPop.lossFullFrom': 0 }));
    expect(unscaled.value).toBeCloseTo(-2.5, 9);
    expect(labelsOf(unscaled, 'branch')).toContain('Losses not scaled');
  });

  it('does not diminish gains when the diminishing power is 0', () => {
    const tunables = createEngineTunables({ 'promoPop.diminishingPower': 0 });
    expect(change(altura(), tunables).value).toBeCloseTo(1.5, 9);
  });

  it('gives no gains at all when the monthly cap is 0', () => {
    const tunables = createEngineTunables({ 'promoPop.monthlyGainCap': 0 });
    expect(change(hardpan(), tunables).value).toBe(0);
    expect(change(altura({ score: 45 }), tunables).value).toBeLessThan(0);
  });

  it('counts any result outside the dead zone in full when the blowout margin is not above it', () => {
    const tunables = createEngineTunables({
      'promoPop.blowoutMargin': 2,
      'promoPop.diminishingPower': 0,
    });
    const result = change(altura({ score: 65 }), tunables);
    expect(result.value).toBeCloseTo(3, 9);
    expect(findTraceNodes(result.trace, 'note').map((node) => node.label)).toContain(
      'Any result outside the dead zone counts in full',
    );
  });

  it('keeps the new popularity within 0–100', () => {
    const generous = createEngineTunables({
      'promoPop.maxGainPerShow': 10,
      'promoPop.impact.flagship': 3,
      'promoPop.diminishingPower': 0,
      'promoPop.monthlyGainCap': 100,
      'promoPop.maxLossPerShow': 10,
      'promoPop.lossFullFrom': 0,
    });
    const nearTop = change(altura({ before: 99, importance: 'flagship', score: 100 }), generous);
    expect(nearTop.value).toBeCloseTo(1, 9);
    const nearBottom = change(altura({ before: 4, importance: 'flagship', score: 0 }), generous);
    expect(nearBottom.value).toBeCloseTo(-4, 9);
    expect(findTraceNodes(nearBottom.trace, 'clamp').at(-1)).toMatchObject({
      label: 'Popularity stays within 0–100',
      applied: true,
    });
  });

  it('takes a traced score and nests it', () => {
    const score = inputOf('Show score', 75, undefined, 'points');
    const result = change(altura({ score }));
    expect(twoDecimals(result.value)).toBe(0.19);
  });

  it('refuses popularity outside 0–100 and a negative monthly gain', () => {
    expect(() => showPopularityChange(altura({ before: 101 }), { tunables: DEFAULTS })).toThrow(
      /before/,
    );
    expect(() =>
      showPopularityChange(altura({ gainedThisMonth: -1 }), { tunables: DEFAULTS }),
    ).toThrow(/gainedThisMonth/);
  });
});
