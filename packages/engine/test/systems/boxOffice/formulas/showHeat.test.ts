// Show heat (EVT6-11). Design: docs/design/box-office.md#show-heat
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../../src/core/trace';
import { computeShowHeat, type CardStorylineHeat } from '../../../../src/systems/boxOffice';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

const DEFAULTS = createEngineTunables();

function story(name: string, heat: number, finale = false): CardStorylineHeat {
  return { name, heat, finale };
}

function heat(storylines: readonly CardStorylineHeat[], tunables: EngineTunables = DEFAULTS) {
  const result = computeShowHeat({ storylines }, { tunables });
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

describe('computeShowHeat', () => {
  it('is 1 with no linked storylines, with a note saying so', () => {
    const result = heat([]);
    expect(result.value).toBe(1);
    expect(findTraceNodes(result.trace, 'note').map((node) => node.label)).toContain('No storylines linked on the card');
  });

  it('adds nothing at or below heat 40 and 15% at heat 100', () => {
    expect(heat([story('Cold', 40)]).value).toBe(1);
    expect(heat([story('Warm', 70)]).value).toBeCloseTo(1.075, 12);
    expect(heat([story('Red hot', 100)]).value).toBeCloseTo(1.15, 12);
  });

  it('adds half as much again for a finale', () => {
    expect(heat([story('Warm', 70, true)]).value).toBeCloseTo(1.1125, 12);
    const labels = JSON.stringify(heat([story('Warm', 70, true)]).trace);
    expect(labels).toContain('Warm: heat 70, finale tonight');
  });

  it('counts the hottest storyline in full and a quarter of each other one', () => {
    // 7.5% (heat 70) + 0.25 × 15% (heat 100).
    const result = heat([story('Warm', 70), story('Red hot', 100)]);
    expect(result.value).toBeCloseTo(1 + 0.15 + 0.25 * 0.075, 12);
    expect(JSON.stringify(result.trace)).toContain('2 linked storylines');
  });

  it('never adds more than the cap', () => {
    const tight = createEngineTunables({ 'boxOffice.heat.cap': 0.1 });
    expect(heat([story('Red hot', 100, true)], tight).value).toBeCloseTo(1.1, 12);
  });

  it('is off with maxBonus 0', () => {
    const off = createEngineTunables({ 'boxOffice.heat.maxBonus': 0 });
    expect(heat([story('Red hot', 100, true)], off).value).toBe(1);
  });
});
