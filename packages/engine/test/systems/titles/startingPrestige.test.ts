// Starting prestige for a new title (CRTV1-01). Design: docs/design/titles.md#starting-prestige
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../src/core/trace/helpers';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import { startingPrestige, TITLE_TIERS, type TitleTier } from '../../../src/systems/titles';
import { createEngineTunables } from '../../../src/systems/tunables';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';

function prestigeOf(
  tier: TitleTier,
  promotionPrestige: number,
  overrides: TunableOverrides = {},
): number {
  return startingPrestige(
    { tier, promotionPrestige },
    { tunables: createEngineTunables(overrides) },
  ).value;
}

describe('startingPrestige', () => {
  it('gives each tier its base at a promotion on the anchor', () => {
    expect(TITLE_TIERS.map((tier) => prestigeOf(tier, 50))).toEqual([55, 35, 20]);
  });

  it('works the doc example: a Secondary title at Altura (prestige 80) starts at 44', () => {
    expect(prestigeOf('secondary', 80)).toBe(44);
  });

  it('moves with the promotion: below the anchor lowers it, above raises it', () => {
    expect(prestigeOf('world', 20)).toBe(46);
    expect(prestigeOf('world', 90)).toBe(67);
  });

  it('gives exactly the base when the weight is 0', () => {
    const off = { 'titles.startPrestige.promotionWeight': 0 };
    expect(prestigeOf('secondary', 80, off)).toBe(35);
    expect(prestigeOf('specialty', 0, off)).toBe(20);
  });

  it('gives exactly the base when the anchor equals the promotion prestige', () => {
    expect(prestigeOf('world', 73, { 'titles.startPrestige.promotionAnchor': 73 })).toBe(55);
  });

  it('keeps the result within 0..100', () => {
    const fullWeight = { 'titles.startPrestige.promotionWeight': 1 };
    expect(prestigeOf('specialty', 0, fullWeight)).toBe(0);
    expect(prestigeOf('world', 100, fullWeight)).toBe(100);
  });

  it('rounds a half up', () => {
    // 35 + (51 − 50) × 0.5 = 35.5
    expect(prestigeOf('secondary', 51, { 'titles.startPrestige.promotionWeight': 0.5 })).toBe(36);
  });

  it('follows a tunable override of the tier base', () => {
    expect(prestigeOf('secondary', 80, { 'titles.startPrestige.secondary': 40 })).toBe(49);
  });

  it('names the tier base, the anchor and the weight in a replayable, serialisable trace', () => {
    const result = startingPrestige(
      { tier: 'secondary', promotionPrestige: 80 },
      { tunables: createEngineTunables() },
    );
    expectTraceReplays(result);
    expectSerialisable(result);
    expect(result.trace).toMatchObject({
      label: 'Starting prestige',
      docRef: 'docs/design/titles.md#starting-prestige',
    });
    expect(findTraceNodes(result.trace, 'tunable').map((node) => node.key)).toEqual([
      'titles.startPrestige.secondary',
      'titles.startPrestige.promotionAnchor',
      'titles.startPrestige.promotionWeight',
    ]);
    expectTraceContains(result, { kind: 'tunable', label: 'Secondary title base' });
    expectTraceContains(result, { kind: 'input', label: 'Promotion prestige' });
  });
});
